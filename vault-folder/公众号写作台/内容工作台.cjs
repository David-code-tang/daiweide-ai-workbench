'use strict';
// 戴卫得AI工作台 · 「微信公众号」页：内嵌 content-workbench（参考 Gary 曹淦的开源内容工作台，MIT）。
// 插件负责：在本机启动它（127.0.0.1:8765，只本机能访问）、把它的模型调用转给工作台选好的模型（默认 GPT 6.1）、
// 把它嵌进 Obsidian。它的数据在插件目录 cw-data 里（不进坚果云），每篇稿子另外存一份到 公众号写作台/稿件/工作台。
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn } = require('child_process');
const PORT = 8765, BRIDGE_PORT = 51887;
const SYSTEM = '你是用户的写作助手。严格按用户消息里的要求和输出格式回答，要求输出 JSON 时只输出 JSON。';

function keyFile(name) {
  const dir = path.join(os.homedir(), '.gzh-studio');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, name);
  let k = '';
  try { k = fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  if (!/^[a-f0-9]{32,}$/.test(k)) { k = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(f, k, { mode: 0o600 }); }
  return k;
}

function install(p) {
  const base = p.vaultBase();
  const pluginDir = path.join(base, p.manifest.dir);
  const appDir = path.join(pluginDir, 'content-workbench');
  const dataDir = path.join(pluginDir, 'cw-data');
  const archiveDir = path.join(base, p.p('稿件', '工作台'));
  const logFile = path.join(dataDir, 'server.log');
  const uv = path.join(pluginDir, 'bin', 'uv');
  const LOCAL_KEY = keyFile('cw-local-key'), LLM_KEY = keyFile('cw-llm-key');
  const st = { phase: 'idle', error: '', child: null, startedAt: 0, restarts: 0, stopped: false, lastPath: '' };
  const log = (s) => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${s}\n`); } catch (e) {} };

  // ---------- 设置：署名、写作规则，用你自己的 ----------
  function writeSettings() {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const f = path.join(dataDir, 'settings.json');
    let s = {};
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    const mine = {
      port: PORT, rp_id: 'localhost',
      origins: [`http://localhost:${PORT}`], allowed_hosts: [`localhost:${PORT}`, `127.0.0.1:${PORT}`],
      session_days: 3650,
    };
    const defaults = {
      author: '',
      persona: { name: '我', identity: '替不太懂技术的中文读者把 AI 用明白的普通人（第一次用请在「微信公众号」页的设置里改成你自己）', speaker_hint: '', domain: 'AI 工具和效率' },
      voice_guide_path: path.join(base, p.p('规则', '写作规则.md')),
      manual_path: path.join(base, p.p('X', '我的表达习惯.md')),
      transcribe_vocab: 'Claude, Codex, ChatGPT, Gemini, GPT, Obsidian, Prompt, Skill, Agent, 公众号, 小红书',
    };
    for (const [k, v] of Object.entries(defaults)) if (s[k] === undefined || s[k] === '' || (k === 'persona' && !Object.keys(s[k] || {}).length)) s[k] = v;
    Object.assign(s, mine);
    fs.writeFileSync(f + '.tmp', JSON.stringify(s, null, 1), { mode: 0o600 });
    fs.renameSync(f + '.tmp', f);
  }

  // ---------- 推公众号草稿箱：内容工作台排好版交过来，Chrome 扩展每分钟来取，用浏览器里登录的公众号后台存草稿 ----------
  const wxFile = path.join(dataDir, 'wechat-queue.json');
  let wxQueue = [];
  try { wxQueue = JSON.parse(fs.readFileSync(wxFile, 'utf8')) || []; } catch (e) {}
  const saveWx = () => { try { fs.writeFileSync(wxFile + '.tmp', JSON.stringify(wxQueue)); fs.renameSync(wxFile + '.tmp', wxFile); } catch (e) {} };
  function wechatWant() {
    wxQueue = wxQueue.filter((j) => Date.now() - j.at < 24 * 3600e3);
    const j = wxQueue.find((x) => !x.takenAt || Date.now() - x.takenAt > 4 * 60e3);
    if (!j) return null;
    j.takenAt = Date.now(); saveWx();
    return j;
  }
  async function wechatDone(r) {
    const j = wxQueue.find((x) => x.id === r.id);
    wxQueue = wxQueue.filter((x) => x.id !== r.id); saveWx();
    log(`wechat job ${r.ok ? 'ok' : 'failed'}: ${r.error || r.url || ''}`);
    if (j) await post('/api/local/wechat-result', { draft_id: j.draft_id, ok: !!r.ok, url: r.url || '', appmsgid: r.appmsgid || '', error: r.error || '', cover: r.cover || '' }).catch((e) => log('wechat result failed: ' + e.message));
    return { ok: true };
  }

  // ---------- 模型桥：它要调模型时，交给工作台（默认 GPT 6.1） ----------
  const modelRef = () => p.settings.cwModel || p.settings.models?.draft || 'codex:gpt-6.1-sol';
  const bridge = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || (req.url !== '/llm' && req.url !== '/wechat-job')) return send(404, { error: '未知接口' });
    if (req.headers.origin) return send(403, { error: '不接受网页请求' });
    const k = String(req.headers['x-cw-key'] || '');
    if (k.length !== LLM_KEY.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(LLM_KEY))) return send(403, { error: '密钥不对' });
    let body = ''; req.on('data', (c) => { body += c; if (body.length > 40e6) req.destroy(); });
    req.on('end', async () => {
      let q; try { q = JSON.parse(body || '{}'); } catch (e) { return send(400, { error: 'JSON 格式不对' }); }
      if (req.url === '/wechat-job') { wxQueue.push({ ...q, id: crypto.randomUUID(), at: Date.now(), takenAt: 0 }); saveWx(); log(`wechat job queued: draft ${q.draft_id}`); return send(200, { queued: true }); }
      if (q.ping) return send(200, { detail: '用工作台的模型：' + String(modelRef()).replace(/^(codex|claude):/, '') });
      const t0 = Date.now();
      try {
        const text = await p.llm.generate(modelRef(), { system: SYSTEM, prompt: String(q.prompt || ''), effort: 'medium', timeoutMs: Math.max(60, Math.min(1800, +q.timeout || 600)) * 1000 });
        log(`model ok ${Math.round((Date.now() - t0) / 1000)}s ${q.purpose || ''}`);
        send(200, { text });
      } catch (e) { log('model failed: ' + (e.message || e)); send(500, { error: String(e.message || e) }); }
    });
  });
  bridge.on('error', (e) => log('bridge error: ' + e.message));
  bridge.listen(BRIDGE_PORT, '127.0.0.1');

  // ---------- 启动服务 ----------
  const ping = () => new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/auth/state', headers: { host: `localhost:${PORT}` }, timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
  });
  async function killOld() {
    await new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/local/shutdown', method: 'POST', timeout: 3000, headers: { 'x-cw-key': LOCAL_KEY, 'content-length': 0 } }, (res) => { res.resume(); res.on('end', resolve); });
      r.on('error', resolve); r.on('timeout', () => { r.destroy(); resolve(); }); r.end();
    });
    for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 500)); if (!(await ping())) { log('old server stopped'); return; } }
    // 老版本没有退出接口：找到占着端口、而且确实是内容工作台的进程，结束它
    const { execFileSync } = require('child_process');
    try {
      const pids = execFileSync('/usr/sbin/lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        const cmd = execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' });
        if (/content-workbench/.test(cmd)) { process.kill(+pid, 'SIGTERM'); log('killed old server ' + pid); }
      }
    } catch (e) { log('killOld: ' + e.message); }
    for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 500)); if (!(await ping())) return; }
  }
  async function start() {
    if (st.stopped || st.phase === 'starting' || st.phase === 'ready') return;
    if (await ping()) { // 上次 Obsidian 留下的还在跑：让它退出，换上新代码
      st.phase = 'starting';
      await killOld();
      st.phase = 'idle';
      if (await ping()) { st.phase = 'ready'; log('old server kept'); startSync(); startInbox(); return; }
    }
    if (!fs.existsSync(uv) || !fs.existsSync(path.join(appDir, 'pyproject.toml'))) { st.phase = 'error'; st.error = '没找到内容工作台的程序文件（插件目录里的 content-workbench 和 bin/uv）'; return; }
    try { fs.chmodSync(uv, 0o755); } catch (e) {}
    writeSettings();
    st.phase = 'starting'; st.error = ''; st.startedAt = Date.now();
    const env = { ...process.env,
      PATH: ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin', path.dirname(uv)].join(':'),
      UV_PROJECT_ENVIRONMENT: path.join(os.homedir(), '.gzh-studio', 'cw-venv'),
      CW_DATA_DIR: dataDir, CW_ARCHIVE_DIR: archiveDir, CW_VAULT_DIR: base, CW_LOCAL_KEY: LOCAL_KEY,
      CW_LLM_URL: `http://127.0.0.1:${BRIDGE_PORT}/llm`, CW_LLM_KEY: LLM_KEY, PYTHONUNBUFFERED: '1' };
    const args = ['run', '--project', appDir, '--frozen', '--extra', 'transcribe', '--python', '3.13', 'content-workbench', 'serve', '--port', String(PORT)];
    log('start: uv ' + args.join(' '));
    const child = spawn(uv, args, { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    st.child = child;
    const out = (d) => { const s = String(d); try { fs.appendFileSync(logFile, s); } catch (e) {} };
    child.stdout.on('data', out); child.stderr.on('data', out);
    child.on('error', (e) => { st.phase = 'error'; st.error = '启动失败：' + e.message; log(st.error); });
    child.on('exit', (code) => {
      log('exit ' + code); if (st.child === child) st.child = null;
      if (st.stopped) return;
      st.phase = 'error'; st.error = '内容工作台退出了（' + code + '）';
      if (st.restarts < 3) { st.restarts++; setTimeout(() => { st.phase = 'idle'; start(); }, 3000 * st.restarts); }
    });
    for (let i = 0; i < 600 && st.child === child; i++) { // 第一次要下载 Python 和依赖，最多等 10 分钟
      if (await ping()) { st.phase = 'ready'; st.restarts = 0; log('ready'); startSync(); startInbox(); return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (st.phase === 'starting') { st.phase = 'error'; st.error = '等了 10 分钟还没启动好'; }
  }
  function stop() {
    st.stopped = true;
    try { st.child && st.child.kill('SIGTERM'); } catch (e) {}
    try { bridge.close(); } catch (e) {}
  }
  p.register(stop);
  setTimeout(start, 1500);

  const tail = () => { try { const s = fs.readFileSync(logFile, 'utf8'); return s.slice(-1800); } catch (e) { return ''; } };
  const url = (to) => `http://localhost:${PORT}/api/auth/local?k=${LOCAL_KEY}&to=${encodeURIComponent(to || '/')}`;

  // ---------- 页面 ----------
  async function render(view, body) {
    body.empty();
    body.style.maxWidth = 'none'; body.style.padding = '0'; body.style.margin = '0';
    const wrap = body.createDiv({ cls: 'gzh-cw' });
    wrap.style.cssText = 'display:flex;flex-direction:column;width:100%';
    if (st.phase !== 'ready') {
      if (st.phase === 'idle' || (st.phase === 'error' && !st.child)) start();
      const box = wrap.createDiv(); box.style.cssText = 'max-width:640px;margin:60px auto;padding:24px;border:1px solid var(--background-modifier-border);border-radius:14px;line-height:1.7';
      const t = box.createEl('h3', { text: st.phase === 'error' ? '内容工作台没启动起来' : '正在启动内容工作台…' });
      const d = box.createEl('p', { text: st.phase === 'error' ? st.error : '第一次启动要下载运行环境（Python 和依赖，约几百 MB），大概 2 到 5 分钟，之后每次几秒钟。这一页会自己刷新。' });
      const pre = box.createEl('pre'); pre.style.cssText = 'font-size:11px;max-height:220px;overflow:auto;white-space:pre-wrap;opacity:.7';
      pre.setText(tail().split('\n').slice(-12).join('\n'));
      const row = box.createDiv(); row.style.cssText = 'display:flex;gap:8px;margin-top:10px';
      const retry = row.createEl('button', { text: '重新启动' }); retry.onclick = () => { st.restarts = 0; st.phase = 'idle'; st.stopped = false; start(); render(view, body); };
      const timer = setInterval(() => {
        if (!body.isConnected) return clearInterval(timer);
        if (st.phase === 'ready') { clearInterval(timer); render(view, body); return; }
        t.setText(st.phase === 'error' ? '内容工作台没启动起来' : '正在启动内容工作台…');
        if (st.phase === 'error') d.setText(st.error);
        pre.setText(tail().split('\n').slice(-12).join('\n'));
      }, 2000);
      return;
    }
    const bar = wrap.createDiv(); bar.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:flex-end;font-size:12px;padding:2px 10px;opacity:.75';
    const ext = bar.createEl('a', { text: '在浏览器里打开', href: '#' }); ext.onclick = (e) => { e.preventDefault(); require('electron').shell.openExternal(url(st.lastPath)); };
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:gzh-content-workbench');
    wv.setAttribute('src', url(st.lastPath));
    wv.style.cssText = 'width:100%;border:0;display:flex';
    wrap.appendChild(wv);
    const fit = () => { if (!wv.isConnected) return window.removeEventListener('resize', fit); const top = wv.getBoundingClientRect().top; wv.style.height = Math.max(400, window.innerHeight - top - 4) + 'px'; };
    window.addEventListener('resize', fit); setTimeout(fit, 0); setTimeout(fit, 300);
    const remember = (e) => { try { const u = new URL(e.url); if (u.host === `localhost:${PORT}` && !u.pathname.startsWith('/api/')) st.lastPath = u.pathname + u.hash; } catch (x) {} };
    wv.addEventListener('did-navigate', remember); wv.addEventListener('did-navigate-in-page', remember);
    const applyTheme = () => {
      if (!wv.isConnected) return;
      const dark = document.body.classList.contains('theme-dark');
      try { wv.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(dark ? 'dark' : 'light')}`); wv.insertCSS(themeCss()); } catch (x) {}
    };
    wv.addEventListener('dom-ready', applyTheme);
    if (!st.cssHook) { st.cssHook = true; p.registerEvent(p.app.workspace.on('css-change', () => { const w = document.querySelector('.gzh-cw webview'); if (w && w.isConnected) { const dark = document.body.classList.contains('theme-dark'); try { w.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(dark ? 'dark' : 'light')}`); w.insertCSS(themeCss()); } catch (x) {} } })); }
    wv.addEventListener('new-window', (e) => { try { require('electron').shell.openExternal(e.url); } catch (x) {} });
  }

  // ---------- 把旧写作台的选题、素材、稿件接进来（按来源去重，每 10 分钟同步一次新的） ----------
  const post = (pathname, obj, timeout = 30000) => new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(obj));
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST', timeout,
      headers: { 'content-type': 'application/json', 'content-length': data.length, 'x-cw-key': LOCAL_KEY } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; });
      res.on('end', () => { if (res.statusCode !== 200) return reject(Error(pathname + ' ' + res.statusCode + ' ' + s.slice(0, 200))); try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    r.on('error', reject); r.on('timeout', () => r.destroy(Error('超时'))); r.end(data);
  });
  const splitFront = (md) => {
    if (!md.startsWith('---\n')) return { fm: {}, rest: md };
    const end = md.indexOf('\n---\n', 4); if (end < 0) return { fm: {}, rest: md };
    const fm = {}; for (const line of md.slice(4, end).split('\n')) { const m = line.match(/^([^:\s][^:]*):\s*(.*)$/); if (m) fm[m[1].trim()] = m[2].replace(/^"|"$/g, '').trim(); }
    return { fm, rest: md.slice(end + 5) };
  };
  async function syncOld() {
    const topics = [], mats = [], drafts = [];
    const tDir = path.join(base, p.p('选题'));
    for (const f of (fs.existsSync(tDir) ? fs.readdirSync(tDir) : []).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort()) {
      let d; try { d = JSON.parse(fs.readFileSync(path.join(tDir, f), 'utf8')); } catch (e) { continue; }
      const date = f.slice(0, 10), at = (Date.parse(d.generatedAt || date + 'T07:00:00') || Date.now()) / 1000;
      (d.items || []).forEach((it, k) => {
        if (!it || !it.title) return;
        const lines = (a) => (Array.isArray(a) ? a : a ? [a] : []).map((x) => '- ' + x).join('\n');
        const material = [
          `选题：${it.title}`, it.cat ? `类型：${it.cat}` : '',
          it.why ? `\n读者能拿走什么：\n${it.why}` : '',
          it.fresh?.length ? `\n引子和热度：\n${lines(it.fresh)}` : '',
          it.outline?.length ? `\n大纲：\n${lines(it.outline)}` : '',
          it.peers ? `\n撞题情况：\n${it.peers}` : '',
          it.prep ? `\n写之前要准备：\n${it.prep}` : '',
          it.urls?.length ? `\n来源链接：\n${lines(it.urls)}` : '',
          it.refs?.length ? `\n标题候选：\n${lines(it.refs)}` : '',
        ].filter(Boolean).join('\n');
        topics.push({ ref: `${date}:${it.id || k}`, title: it.title, angle: it.why || it.formula || '', notes: (it.outline || []).join('\n'),
          material, platforms: ['wechat'], status: it.notePath ? 'drafted' : 'new', created_at: at + k });
      });
    }
    const mDir = path.join(base, p.p('素材'));
    for (const f of (fs.existsSync(mDir) ? fs.readdirSync(mDir) : []).filter((f) => f.endsWith('.md'))) {
      const fp = path.join(mDir, f); let txt = ''; try { txt = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
      const title = (txt.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '').replace(/^\d{4}-\d\d-\d\d\s*/, '');
      mats.push({ ref: f, title: title.slice(0, 100), body: txt, created_at: fs.statSync(fp).mtimeMs / 1000, extract: false });
    }
    const dDir = path.join(base, p.p('稿件'));
    for (const f of (fs.existsSync(dDir) ? fs.readdirSync(dDir) : []).filter((f) => f.endsWith('.md'))) {
      const fp = path.join(dDir, f); let md = ''; try { md = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
      const st2 = fs.statSync(fp); const { fm, rest } = splitFront(md);
      let body = rest.replace(/^\s+/, ''); let title = fm['选题'] || f.replace(/\.md$/, '').replace(/^\d{4}-\d\d-\d\d\s*/, '');
      const h1 = body.match(/^#\s+(.+)\n/); if (h1) { title = h1[1].trim(); body = body.slice(h1[0].length).replace(/^\s+/, ''); }
      let notes = '';
      const callout = body.match(/^(>.*(?:\n>.*)*)\n*/); if (callout && /^> \[!/.test(callout[1])) { notes = callout[1]; body = body.slice(callout[0].length); }
      // 旧写作台藏在 %% %% 里的大纲和备注：放到「备注」里，不混进正文
      const hidden = body.match(/%%[\s\S]*?%%/g) || [];
      if (hidden.length) { body = body.replace(/%%[\s\S]*?%%/g, '').replace(/\n{3,}/g, '\n\n'); notes = [notes, ...hidden].filter(Boolean).join('\n\n'); }
      drafts.push({ path: fp, title, body: body.trim(), notes, rev: String(Math.floor(st2.mtimeMs / 1000)), created_at: st2.mtimeMs / 1000 });
    }
    const r = await post('/api/local/import', { ideas: topics, materials: mats, drafts }, 60000);
    if (r.materials || r.ideas || r.drafts) log(`synced old: ${JSON.stringify(r)}`);
    return r;
  }
  let syncTimer = null;
  const syncSoon = async () => { try { await syncOld(); } catch (e) { log('sync old failed: ' + e.message); } };
  const startSync = () => { if (syncTimer) return; syncSoon(); syncTimer = setInterval(() => { if (st.phase === 'ready') syncSoon(); }, 10 * 60 * 1000); p.register(() => clearInterval(syncTimer)); };


  // ---------- 成稿投递箱：~/.gzh-studio/inbox/<任务>/job.json + 图片。Claude 在云端真跑、截图、写好稿子后放进来，
  // 这里（有本机密钥）建稿、传图、把 {IMG:名字} 换成图片、设好默认封面。处理完改名成 done-<任务>，结果写 result.json。
  const inboxDir = path.join(os.homedir(), '.gzh-studio', 'inbox');
  const call = (method, pathname, buf, headers = {}, timeout = 60000) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, timeout,
      headers: Object.assign({ 'x-cw-key': LOCAL_KEY }, buf ? { 'content-length': buf.length } : {}, headers) }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; });
      res.on('end', () => { if (res.statusCode !== 200) return reject(Error(method + ' ' + pathname + ' ' + res.statusCode + ' ' + s.slice(0, 200))); try { resolve(JSON.parse(s)); } catch (e) { resolve(s); } });
    });
    r.on('error', reject); r.on('timeout', () => r.destroy(Error('超时'))); r.end(buf || undefined);
  });
  const callJson = (method, pathname, obj) => call(method, pathname, Buffer.from(JSON.stringify(obj)), { 'content-type': 'application/json' });
  async function uploadImage(did, file, label) {
    const boundary = '----cw' + crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file).toLowerCase(); const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    const name = (label || path.basename(file, ext)).replace(/["\r\n\/\\]/g, ' ') + ext;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`);
    const buf = Buffer.concat([head, fs.readFileSync(file), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = await call('POST', `/api/drafts/${did}/images`, buf, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    return r[0].id;
  }

  // ---------- 按你工作台里的 Skill 真正出稿：khazix-writer 写正文、五位博主式标题、media-visual-hub 样片 + GPT 生图画封面和配图 ----------
  const L1_RE = /说白了|意味着|本质上|换句话说|不可否认|综上所述|总的来说|首先|其次|值得注意的是|不难发现|让我们来看看|接下来让我们|——|[“”"]|^#{1,6}\s|\*\*/m;
  const protect = (t, fn) => { const keep = []; t = t.replace(/```[\s\S]*?```|【[^】\n]*】/g, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; }); t = fn(t); return t.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]); };
  const hardClean = (t) => protect(t, (x) => x.replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, '').replace(/——/g, '，').replace(/[“”"]/g, '').replace(/：/g, '，').replace(/，，/g, '，'));
  const l1Hits = (t) => protect(t, (x) => x).split('\n').filter((ln) => L1_RE.test(ln.replace(/【[^】]*】/g, '')) || /：/.test(ln.replace(/【[^】]*】/g, ''))).slice(0, 30);
  async function samplePath(id) {
    const rel = p.p('X', '样片', id + '.png'), abs = path.join(base, rel);
    if (fs.existsSync(abs)) return abs;
    let list = []; try { list = JSON.parse(fs.readFileSync(path.join(base, p.p('skills', 'media-visual-hub', 'references', 'samples.json')), 'utf8')); } catch (e) {}
    const smp = (Array.isArray(list) ? list : list.samples || []).find((x) => x.id === id);
    if (!smp) throw Error('样片库里没有 ' + id);
    const { requestUrl } = require('obsidian');
    for (const u of [smp.url, smp.original]) {
      try { const r = await requestUrl({ url: u, throw: true }); if (r.arrayBuffer && r.arrayBuffer.byteLength > 1000) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, Buffer.from(r.arrayBuffer)); return abs; } } catch (e) {}
    }
    throw Error('样片 ' + id + ' 下载失败');
  }
  async function sampleMeta(id) {
    try { const list = JSON.parse(fs.readFileSync(path.join(base, p.p('skills', 'media-visual-hub', 'references', 'samples.json')), 'utf8')); return (Array.isArray(list) ? list : list.samples || []).find((x) => x.id === id) || { id, name: id, source: '' }; } catch (e) { return { id, name: id, source: '' }; }
  }
  async function cropFile(src, ratio, out) {
    const bmp = await createImageBitmap(new Blob([fs.readFileSync(src)]));
    let w = bmp.width, h = Math.round(bmp.width / ratio);
    if (h > bmp.height) { h = bmp.height; w = Math.round(h * ratio); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, Math.round((bmp.width - w) / 2), Math.round((bmp.height - h) / 2), w, h, 0, 0, w, h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  }
  async function drawWithSample(id, o) {
    const smp = await sampleMeta(id), img = await samplePath(id);
    const textRule = o.text ? '图上必须清晰呈现以下原文，逐字保留中文、英文和标点，不翻译、不概括、不删字：\n' + JSON.stringify(o.text) + '\n文字必须是图片中的可见排版，字号醒目、对比清楚、允许合理换行，不出现占位符和乱码。文字要求优先于样片中的无字设计或风格描述。' : '本图不放标题、标签或装饰文字，不要水印。';
    const prompt = [
      '请直接用你的图片生成工具画一张图，不要写代码，不要用命令行，画完只回复一句话。',
      `参考：${smp.id} · ${smp.name}（附图就是这张样片，来源：${smp.source || ''}）`,
      `发布位置：${o.platform}`, `比例：${o.ratio}`, '内容：', String(o.content || '').slice(0, 2500),
      o.extra ? '额外要求：' + o.extra : '', '',
      '先看附图样片，提取配色、构图、质感、留白和字体层级，再用于本次内容，重新设计画面。',
      '不要沿用参考图的无关文案、商标、水印或数据；解释图要保持逻辑准确。不要真实名人的脸，不要品牌标志。',
      textRule,
      o.cover ? '最终图片会中心裁切为 2.35:1 和 5:2。所有文字必须完整位于画面中央宽度 80%、高度 30% 的安全区域内，缩略图也应能读清标题。' : '',
    ].filter(Boolean).join('\n');
    const r = await p.llm.codex.run({ model: String((p.settings.models || {}).xImage || 'codex:gpt-6-luna').split(':')[1] || undefined, effort: 'low',
      system: '你是插画师，只负责用图片生成工具画图。', prompt, images: [img], timeoutMs: 360000 });
    if (!r.images || !r.images.length) throw Error('GPT 这次没画出图：' + String(r.text || '').slice(0, 120));
    return r.images[r.images.length - 1];
  }
  const progress = (dir, step) => { try { fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify({ step, at: new Date().toISOString() })); } catch (e) {} log('inbox gen: ' + step); };
  async function genJob(job, dir) {
    const g = job.gen, M = p.settings.models || {};
    const rules = await p.rules();
    const skillName = g.skill || p.settings.draftSkill || 'khazix-writer';
    const skill = await p.skillText(skillName, 20000);
    let skeleton = ''; try { skeleton = await p.readText(p.p('规则', '公众号文章骨架库.md')); } catch (e) {}
    const shots = g.shots || [];
    const system = [
      '你是 用户 的公众号写手，按 用户 定的规则和卡兹克的写作方法写正文。读者是不太懂技术的中文普通人。',
      '<规则>', (rules.writing || '') + '\n\n' + String(rules.master || '').slice(0, 6000), '</规则>',
      skill ? '<写作方法>\n' + skill + '\n</写作方法>' : '',
      skeleton ? '<公众号文章骨架库（从头部公众号高分文章提炼）>\n' + skeleton.slice(0, 8000) + '\n</公众号文章骨架库>\n先在心里挑最适合的一种骨架再写，不要把骨架名写进正文。' : '',
      `硬性要求：${g.length || '3000 到 4500'} 字；大白话；短段落；不用冒号、破折号、双引号；不用 markdown 小标题和加粗；不用禁用词；不编经历和数字。`,
      '这篇的素材是一次真实操作记录，按素材里实际发生的事写，所有引用、分数、选项都必须和素材一字不差，素材里没有的不写。',
      '正文用第一人称「我」写，正文里不要出现 用户、戴卫得、Claude 这些名字，也不要交代是谁代为操作（这些只写在备注里）。资料里的具体数字和例子要写出来，并说清出处。',
      '截图：下面列出了这次真实操作的截图，在正文合适的位置单独一行写【截图：编号】，每张最多用一次，至少用 5 张。',
      '解释图：另外最多在 2 处单独一行写【配图：画面说明】，只给最核心的观点配一张解释图，画面说明写清要画的关系。',
      '不要写写作方法里那种固定结尾（点赞在看转发三连、星标、作者署名、投稿邮箱、下次再见）。',
      '只输出正文 Markdown（不要标题行，不要解释）。',
    ].filter(Boolean).join('\n');
    const prompt = [`选题：${g.topic || job.title || ''}`, g.angle ? '角度：' + g.angle : '', '', '【可用截图】', ...shots.map((x) => `- ${x.key}：${x.desc}`), '', '【素材：真实操作记录】', g.material].join('\n');
    progress(dir, `按 ${skillName} 写正文`);
    let body = String(await p.llm.generate(M.draft || 'codex:gpt-6.1-sol', { system, prompt, timeoutMs: 12 * 60 * 1000 }) || '').replace(/<\/?改后>/g, '').trim();
    const hits = l1Hits(body);
    if (hits.length) {
      progress(dir, `L1 自检命中 ${hits.length} 处，按写作方法改一遍`);
      const fixed = String(await p.llm.generate(M.edit || M.draft || 'codex:gpt-6.1-sol', {
        system: '你是公众号编辑，按下面的写作方法里的「四层自检体系」修改全文。保留所有【截图：…】【配图：…】行和素材事实，不新增事实。不用冒号、破折号、双引号、小标题和加粗。只输出改后的全文 Markdown。\n<写作方法>\n' + skill + '\n</写作方法>',
        prompt: '【L1 命中的行】\n' + hits.join('\n') + '\n\n【全文】\n' + body, timeoutMs: 10 * 60 * 1000 }) || '').replace(/<\/?改后>/g, '').trim();
      if (fixed.length > body.length * 0.6) body = fixed;
    }
    body = hardClean(body);
    progress(dir, '出质检报告');
    let report = '';
    try { report = String(await p.llm.generate(M.edit || M.draft || 'codex:gpt-6.1-sol', { system: '按下面写作方法的「四层自检体系」检查这篇稿子，只输出质检报告（按方法里的输出格式，简短）。\n<写作方法>\n' + skill + '\n</写作方法>', prompt: body, timeoutMs: 6 * 60 * 1000 }) || '').trim(); } catch (e) { report = '质检报告没出来：' + e.message; }
    if (/❌/.test(report) && !g.noRevise) {
      progress(dir, '质检没过，按质检报告返工一遍');
      try {
        const rev = String(await p.llm.generate(M.draft || 'codex:gpt-6.1-sol', {
          system: system + '\n\n现在是返工：按质检报告的修复优先级改全文，重点补口语化表达、情绪标点、真实反应和自然的升维，删掉重复解释。素材事实一字不改，不编新经历。保留所有【截图：…】【配图：…】行。',
          prompt: '【质检报告】\n' + report + '\n\n【素材：真实操作记录】\n' + g.material + '\n\n【上一版全文】\n' + body, timeoutMs: 12 * 60 * 1000 }) || '').replace(/<\/?改后>/g, '').trim();
        if (rev.length > body.length * 0.6) {
          body = hardClean(rev);
          progress(dir, '返工后再出一次质检报告');
          report = String(await p.llm.generate(M.edit || M.draft || 'codex:gpt-6.1-sol', { system: '按下面写作方法的「四层自检体系」检查这篇稿子，只输出质检报告（按方法里的输出格式，简短）。【截图：…】【配图：…】是图片占位，不算冒号。\n<写作方法>\n' + skill + '\n</写作方法>', prompt: body, timeoutMs: 6 * 60 * 1000 }) || '').trim();
        }
      } catch (e) { log('revise failed ' + e.message); }
    }
    // 正文没写解释图位置：让模型挑 1-2 个最核心的观点（认知锚点）配图
    if (!/【配图[：:]/.test(body)) {
      try {
        const js = String(await p.llm.generate(M.edit || M.draft || 'codex:gpt-6.1-sol', { system: '你是公众号配图编辑，只给文章最核心的 1 到 2 个观点配解释图（认知锚点），不给流程截图已经说明白的地方配图。只输出 JSON 数组。', prompt: '输出格式：[{"after":"正文里某一段的原句（逐字，20 字以内，必须能在正文里找到）","desc":"这张解释图要画的关系，写清主体和箭头"}]\n\n正文：\n' + body, timeoutMs: 4 * 60 * 1000 }) || '');
        const arr = JSON.parse((js.match(/\[[\s\S]*\]/) || ['[]'])[0]);
        for (const it of arr.slice(0, 2)) {
          const i = it.after ? body.indexOf(String(it.after).slice(0, 20)) : -1;
          if (i < 0 || !it.desc) continue;
          const end = body.indexOf('\n', i); const at = end < 0 ? body.length : end;
          body = body.slice(0, at) + '\n\n【配图：' + String(it.desc).replace(/[】\n]/g, ' ') + '】\n' + body.slice(at);
        }
      } catch (e) { log('illus pick failed ' + e.message); }
    }
    progress(dir, '出标题（卡兹克式、袋鼠帝式、卡尔式、花叔式、刘小排式）');
    let titles = [];
    try {
      const t = String(await p.llm.generate(M.title || M.draft || 'codex:gpt-6.1-sol', { system: '你是公众号标题编辑。只输出要求的内容。', prompt: ['【内容】\n' + body.slice(0, 6000), '请按这 5 位的风格各起 1 个标题：卡兹克式、袋鼠帝式、卡尔式、花叔式、刘小排式。每行一个，格式：卡兹克式：标题。可以用感叹号和问号，不用「」和破折号。放在 <改后> 和 </改后> 之间。'].join('\n\n'), timeoutMs: 4 * 60 * 1000 }) || '');
      const inner = (t.match(/<改后>([\s\S]*?)<\/改后>/) || [, t])[1];
      titles = inner.split('\n').map((x) => x.trim()).filter((x) => /式[：:]/.test(x)).map((x) => ({ style: x.split(/[：:]/)[0], title: x.split(/[：:]/).slice(1).join('：').trim() }));
    } catch (e) { log('titles failed ' + e.message); }
    const title = (titles[0] && titles[0].title) || job.title || g.topic;
    // 正文图：截图直接用；解释图按样片画
    const images = [...(job.images || [])];
    let n = 0; const illus = [];
    body = body.replace(/^【截图[：:]\s*([\w-]+)\s*】\s*$/gm, (m, k) => shots.find((x) => x.key === k) ? `\n{IMG:${k}}\n` : '');
    body = body.replace(/^【配图[：:]\s*([^】]+)】\s*$/gm, (m, d) => { if (n >= 2) return ''; n++; illus.push({ key: 'ill' + n, desc: d.trim() }); return `\n{IMG:ill${n}}\n`; });
    for (const il of illus) {
      progress(dir, `按样片 ${g.illus_sample || '7-I02'} 画解释图：${il.desc.slice(0, 30)}`);
      try {
        const src = await drawWithSample(g.illus_sample || '7-I02', { platform: '微信公众号正文配图（3:2 横版）', ratio: '3:2', content: '这是一篇公众号文章里的一张解释图。画面要表达：' + il.desc + '\n\n上下文：\n' + body.slice(Math.max(0, body.indexOf(`{IMG:${il.key}}`) - 600), body.indexOf(`{IMG:${il.key}}`)), extra: (g.illus_extra || '') + '图中文字只用简短的中文标签，不要加原文没有依据的数字。', text: '' });
        const out = path.join(dir, il.key + '.png'); await cropFile(src, 1.5, out);
        images.push({ key: il.key, file: il.key + '.png', label: `解释图-${il.desc.slice(0, 16)}（样片${g.illus_sample || '7-I02'}）`, alt: il.desc.slice(0, 40) });
      } catch (e) { log('illus failed ' + e.message); body = body.replace(`{IMG:${il.key}}`, ''); }
    }
    // 封面：每个样片画一张，裁成公众号 2.35:1 和 X 5:2
    const coverKeys = [];
    for (const cv of g.covers || []) {
      progress(dir, `按样片 ${cv.sample} 画封面`);
      try {
        const src = await drawWithSample(cv.sample, { cover: true, platform: '微信公众号封面（横版 2.35:1 构图，主体居中，四周留出可裁切的余量）', ratio: '2.35:1', text: cv.text || g.cover_text || title, content: '标题：' + title + '\n' + (g.angle || ''), extra: cv.extra || '' });
        const meta = await sampleMeta(cv.sample);
        for (const [suf, ratio, lab] of [['wx', 2.35, '公众号'], ['x', 2.5, 'X长文']]) {
          const key = `cover_${cv.sample}_${suf}`.replace(/[^\w-]/g, '_'), file = key + '.png';
          await cropFile(src, ratio, path.join(dir, file));
          images.push({ key, file, label: `封面-${meta.name}-${lab}（样片${cv.sample}）` });
          coverKeys.push(key);
        }
      } catch (e) { log('cover failed ' + e.message); }
    }
    const notes = [
      `【按 Skill 出稿 · ${new Date().toLocaleString('zh-CN')}】`,
      `正文：${M.draft || ''} + ${skillName} + 写作规则${skeleton ? ' + 公众号文章骨架库' : ''}；标题：五位博主式；封面和解释图：media-visual-hub 样片 + GPT 生图（${M.xImage || 'codex:gpt-6-luna'}）。`,
      '', '标题候选（点标题可以直接改）：', ...titles.map((t) => `- ${t.style}｜${t.title}`),
      '', '封面：' + (g.covers || []).map((c) => c.sample).join('、') + '，每个样片一张，在「封面·配图」里点选。',
      '', '质检报告（khazix-writer 四层自检）：', report,
      g.notes ? '\n' + g.notes : '',
    ].join('\n');
    return { title, body, images, notes, cover_wechat: coverKeys.find((k) => k.endsWith('_wx')), cover_x: coverKeys.find((k) => k.endsWith('_x')) };
  }

  async function runInbox() {
    if (st.phase !== 'ready' || st.inboxBusy || !fs.existsSync(inboxDir)) return;
    st.inboxBusy = true;
    try {
      for (const name of fs.readdirSync(inboxDir)) {
        const dir = path.join(inboxDir, name), jf = path.join(dir, 'job.json');
        if (name.startsWith('done-') || name.startsWith('failed-') || !fs.existsSync(jf)) continue;
        let job; try { job = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (e) { continue; }
        try {
          if (job.gen) Object.assign(job, await genJob(job, dir));
          if (job.update_draft) {
            const did = parseInt(job.update_draft, 10);
            const upd0 = {};
            for (const k of ['title', 'body', 'notes', 'summary']) if (typeof job[k] === 'string') upd0[k] = job[k];
            await callJson('PUT', `/api/drafts/${did}`, upd0);
            fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, draft_id: did, updated: Object.keys(upd0), at: new Date().toISOString() }, null, 1));
            fs.renameSync(dir, path.join(inboxDir, 'done-' + name));
            log(`inbox ${name} → updated draft ${did}`);
            continue;
          }
          const { id } = await callJson('POST', '/api/drafts', { platform: job.platform || 'wechat', title: job.title || name, body: '' });
          const ids = {};
          for (const im of job.images || []) ids[im.key] = await uploadImage(id, path.join(dir, im.file), im.label || im.key);
          let body = String(job.body || '').replace(/\{IMG:([\w-]+)\}/g, (m, k) => ids[k] ? `![${((job.images || []).find((x) => x.key === k) || {}).alt || ''}](/api/images/${ids[k]})` : '');
          body = body.replace(/\n{3,}/g, '\n\n');
          const upd = { title: job.title, body, notes: job.notes || '', summary: job.summary || '' };
          if (job.cover_wechat && ids[job.cover_wechat]) upd.cover_wechat = ids[job.cover_wechat];
          if (job.cover_x && ids[job.cover_x]) upd.cover_x = ids[job.cover_x];
          if (upd.cover_wechat) upd.cover_crop = { square_x: 0.5 };
          await callJson('PUT', `/api/drafts/${id}`, upd);
          fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, draft_id: id, images: ids, at: new Date().toISOString() }, null, 1));
          fs.renameSync(dir, path.join(inboxDir, 'done-' + name));
          log(`inbox ${name} → draft ${id}`);
          try { new (require('obsidian').Notice)(`公众号：新稿子「${job.title}」已放进内容工作台，封面和配图去「封面·配图」里挑`, 12000); } catch (e) {}
        } catch (e) {
          fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString() }, null, 1));
          fs.renameSync(dir, path.join(inboxDir, 'failed-' + name));
          log(`inbox ${name} failed: ${e.message}`);
        }
      }
    } finally { st.inboxBusy = false; }
  }
  let inboxTimer = null;
  const startInbox = () => { if (inboxTimer) return; fs.mkdirSync(inboxDir, { recursive: true }); runInbox(); inboxTimer = setInterval(() => runInbox().catch((e) => log('inbox ' + e.message)), 30 * 1000); p.register(() => clearInterval(inboxTimer)); };

  // ---------- 配色跟着 Obsidian 走（浅色 / 深色、强调色都一样） ----------
  function themeCss() {
    const cs = getComputedStyle(document.body);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    const dark = document.body.classList.contains('theme-dark');
    const accent = v('--interactive-accent', '#7c5cff');
    return `:root{
  --bg:${v('--background-primary', '#fff')}!important;--surface:${v('--background-primary', '#fff')}!important;
  --surface-2:${v('--background-secondary', '#f1f1ed')}!important;--surface-3:${v('--background-modifier-hover', '#e9e8e3')}!important;--text-2:${v('--text-normal', '#3f3f46')}!important;
  --border:${v('--background-modifier-border', '#e5e4df')}!important;--border-strong:${v('--background-modifier-border-hover', '#d4d2cb')}!important;
  --text:${v('--text-normal', '#18181b')}!important;--muted:${v('--text-muted', '#6f6f78')}!important;--faint:${v('--text-faint', '#a1a1aa')}!important;
  --accent:${accent}!important;--accent-hover:${v('--interactive-accent-hover', accent)}!important;
  --accent-soft:color-mix(in srgb, ${accent} 13%, transparent)!important;--accent-text:${accent}!important;--on-accent:${v('--text-on-accent', '#fff')}!important;
  --ring:0 0 0 3px color-mix(in srgb, ${accent} 25%, transparent)!important;
  --font:${v('--font-interface', '-apple-system, "PingFang SC", sans-serif')}!important;
  color-scheme:${dark ? 'dark' : 'light'};
}`;
  }

  // 给插件其他地方用：把一段内容存成工作台素材（会自动提炼选题）
  async function addMaterial(title, text) {
    const data = Buffer.from(JSON.stringify({ title, body: text }));
    return new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/materials', method: 'POST', timeout: 15000,
        headers: { 'content-type': 'application/json', 'content-length': data.length, 'x-cw-key': LOCAL_KEY } }, (res) => {
        let s = ''; res.on('data', (c) => { s += c; });
        res.on('end', () => { if (res.statusCode !== 200) return reject(Error('存进内容工作台失败：' + s.slice(0, 200))); try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
      });
      r.on('error', (e) => reject(Error('内容工作台没在运行：' + e.message))); r.end(data);
    });
  }

  return { render, start, stop, addMaterial, syncOld, runInbox, wechatWant, wechatDone, wechatGet: (id) => wxQueue.find((x) => x.id === id) || null, wechatPending: () => wxQueue.length, status: () => ({ phase: st.phase, error: st.error }), get active() { return true; } };
}
module.exports = { install, PORT };
