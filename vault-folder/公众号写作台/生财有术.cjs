'use strict';
// 生财有术：通过官方 MCP（OAuth 2.1 + PKCE，Streamable HTTP）读内容，做成一个像信息流的模块。
// 令牌只存在本机 ~/.gzh-studio/scys-oauth.json（不进知识库、不进同步）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const MCP = 'https://mcp.scys.com/shengcai-web/mcp';
const AS = 'https://mcp.scys.com/mcp-oauth';
const TOKEN_FILE = path.join(os.homedir(), '.gzh-studio', 'scys-oauth.json');
const DIR = '生财有术';
let api, H = {};

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const readTok = () => { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch (e) { return null; } };
const writeTok = (t) => { fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 }); };

async function req(url, opt = {}) {
  const r = await api.requestUrl({ url, method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body, contentType: opt.contentType, throw: false });
  return r;
}
const form = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

// ---------- OAuth ----------
async function meta() {
  const r = await req('https://mcp.scys.com/.well-known/oauth-authorization-server/mcp-oauth');
  if (r.status !== 200) throw new Error('读不到生财有术授权服务信息（' + r.status + '）');
  return r.json;
}

async function connect(p) {
  const m = await meta();
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));
  let resolveCode, rejectCode;
  const got = new Promise((a, b) => { resolveCode = a; rejectCode = b; });
  const server = http.createServer((rq, rs) => {
    const u = new URL(rq.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') { rs.writeHead(404); rs.end(); return; }
    const ok = u.searchParams.get('code') && u.searchParams.get('state') === state;
    rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    rs.end(`<html><body style="font-family:-apple-system;padding:60px;text-align:center"><h2>${ok ? '生财有术已连接到戴卫得AI工作台 ✓' : '授权没有完成'}</h2><p>${ok ? '可以关掉这个页面，回到 Obsidian。' : (u.searchParams.get('error_description') || u.searchParams.get('error') || '')}</p></body></html>`);
    if (ok) resolveCode(u.searchParams.get('code')); else rejectCode(new Error(u.searchParams.get('error_description') || u.searchParams.get('error') || '授权被取消'));
  });
  await new Promise((a) => server.listen(0, '127.0.0.1', a));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  try {
    const reg = await req(m.registration_endpoint, { method: 'POST', contentType: 'application/json', body: JSON.stringify({ client_name: '戴卫得AI工作台（Obsidian）', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp' }) });
    if (reg.status >= 300) throw new Error('注册客户端失败（' + reg.status + '）：' + String(reg.text).slice(0, 200));
    const client_id = reg.json.client_id;
    const auth = m.authorization_endpoint + '?' + form({ response_type: 'code', client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'mcp', resource: MCP });
    try { window.require('electron').shell.openExternal(auth); } catch (e) { window.open(auth); }
    new api.Notice('已在浏览器打开生财有术授权页，确认后回到这里', 10000);
    const timer = setTimeout(() => rejectCode(new Error('5 分钟内没完成授权')), 5 * 60e3);
    const code = await got.finally(() => clearTimeout(timer));
    const tk = await req(m.token_endpoint, { method: 'POST', contentType: 'application/x-www-form-urlencoded', body: form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id, code_verifier: verifier, resource: MCP }) });
    if (tk.status >= 300) throw new Error('换取令牌失败（' + tk.status + '）');
    const t = tk.json;
    writeTok({ client_id, token_endpoint: m.token_endpoint, revocation_endpoint: m.revocation_endpoint, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000, at: Date.now() });
    session = null;
    return true;
  } finally { server.close(); }
}

async function refresh() {
  const t = readTok();
  if (!t?.refresh_token) throw new Error('需要重新连接生财有术');
  const r = await req(t.token_endpoint, { method: 'POST', contentType: 'application/x-www-form-urlencoded', body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client_id, resource: MCP }) });
  if (r.status >= 300) { writeTok({ ...t, access_token: '', expired: true }); throw new Error('生财有术授权已过期，点「重新连接」'); }
  const j = r.json;
  writeTok({ ...t, access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
}

async function disconnect() {
  const t = readTok();
  try { if (t?.revocation_endpoint && t.refresh_token) await req(t.revocation_endpoint, { method: 'POST', contentType: 'application/x-www-form-urlencoded', body: form({ token: t.refresh_token, client_id: t.client_id }) }); } catch (e) {}
  try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
  session = null;
}

// ---------- MCP（Streamable HTTP）----------
let session = null, rid = 1;
function parseRpc(r) {
  const ct = String(r.headers['content-type'] || r.headers['Content-Type'] || '');
  const txt = String(r.text || '');
  if (ct.includes('text/event-stream') || /^(event|data):/m.test(txt)) {
    const msgs = txt.split(/\n\n+/).map((blk) => blk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')).filter(Boolean).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
    return msgs.find((m) => m.result || m.error) || msgs[msgs.length - 1];
  }
  try { return JSON.parse(txt); } catch (e) { return null; }
}
async function rpc(method, params, retry = true) {
  let t = readTok();
  if (!t?.access_token) throw new Error('还没连接生财有术');
  if (t.expires_at && Date.now() > t.expires_at - 60e3) { await refresh(); t = readTok(); }
  const isNote = method.startsWith('notifications/');
  const headers = { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };
  if (session?.id) headers['Mcp-Session-Id'] = session.id;
  const r = await req(MCP, { method: 'POST', contentType: 'application/json', headers, body: JSON.stringify(isNote ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: rid++, method, params }) });
  if (r.status === 401 && retry) { await refresh(); session = null; if (method !== 'initialize') await ensure(); return rpc(method, params, false); }
  if (r.status === 404 && session && retry) { session = null; await ensure(); return rpc(method, params, false); }
  if (r.status >= 300) throw new Error(`生财有术 MCP 返回 ${r.status}：${String(r.text).slice(0, 160)}`);
  const sid = r.headers['mcp-session-id'] || r.headers['Mcp-Session-Id'];
  if (sid && method === 'initialize') session = { id: sid };
  if (isNote) return null;
  const j = parseRpc(r);
  if (!j) throw new Error('看不懂 MCP 的返回');
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}
async function ensure() {
  if (session?.ready) return;
  session = null;
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gzh-studio', version: '1.0' } });
  session = session || { id: '' };
  await rpc('notifications/initialized', {});
  session.ready = true;
}
async function tools(p) {
  await ensure();
  const r = await rpc('tools/list', {});
  const list = r.tools || [];
  try { await p.writeText(p.p(DIR, '工具清单.json'), JSON.stringify(list, null, 1)); } catch (e) {}
  return list;
}
// 只允许只读工具：点赞、投锚、收藏、关注、反馈、Skill 安装这类会改动账号的，一律不调
const READ_ONLY = ['ai__listAiFeedItems', 'contentSearch', 'searchTopic', 'searchTrustedContent', 'getTrustedContentSection', 'topicDetail', 'pageTopicComment', 'projectLibSearch', 'projectLibDetail', 'searchProjectCases', 'activityManualSearch', 'activityPilotSearch', 'activitySearch', 'activityList', 'listMenu', 'searchProjectTools', 'getProjectToolDetail'];
async function call(name, args) {
  if (!READ_ONLY.includes(name)) throw new Error('这个生财有术工具会改动账号或不在只读名单里，工作台不调用：' + name);
  await ensure();
  const r = await rpc('tools/call', { name, arguments: args || {} });
  if (r.isError) throw new Error((r.content || []).map((c) => c.text).join('\n').slice(0, 300) || '工具调用失败');
  return r;
}

// ---------- 把工具结果变成条目 ----------
function itemsFrom(result) {
  const texts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  let data = result.structuredContent;
  if (!data) for (const t of texts) { try { data = JSON.parse(t); break; } catch (e) {} }
  const findArr = (v, depth = 0) => {
    if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? v : null;
    if (!v || typeof v !== 'object' || depth > 4) return null;
    let best = null;
    for (const x of Object.values(v)) { const a = findArr(x, depth + 1); if (a && (!best || a.length > best.length)) best = a; }
    return best;
  };
  const arr = findArr(data);
  if (!arr) return { items: [], raw: texts.join('\n\n') || JSON.stringify(data || result, null, 1) };
  const pick0 = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return ''; };
  // 字段可能包在 topicDTO / topic / entity 之类的子对象里
  const pick = (o, keys) => { const v = pick0(o, keys); if (v !== '') return v; for (const sub of Object.values(o)) if (sub && typeof sub === 'object' && !Array.isArray(sub)) { const w = pick0(sub, keys); if (w !== '') return w; } return ''; };
  return {
    items: arr.map((o0, i) => { const o = o0; return ({
      id: String(pick(o, ['id', 'entityId', 'itemId', 'topic_id', 'topicId', 'article_id', 'url', 'link']) || i),
      t: String(pick(o, ['showTitle', 'titleZh', 'title', 'topicTitle', 'subject', 'headline']) || String(pick(o, ['articleContent', 'snippet', 'content', 'text', 'summary', 'abstract', 'contentText']) || '').replace(/\s+/g, ' ').slice(0, 40) || '（无标题）').replace(/<[^>]+>/g, ''),
      s: String(pick(o, ['articleContent', 'aiSummaryContent', 'summary', 'snippet', 'abstract', 'description', 'desc', 'excerpt', 'content', 'contentText', 'text']) || '').replace(/&ldquo;|&rdquo;/g, '"').slice(0, 1200),
      likes: Number(pick(o, ['likeCount']) || 0), reads: Number(pick(o, ['readingCount']) || 0),
      tag: (() => { const ml = pick(o, ['menuList']); return Array.isArray(ml) ? ml.map((m) => m.value).filter(Boolean).join('、') : ''; })(),
      src: String(pick(o, ['sourceType']) || ''), iid: String(pick(o, ['itemId']) || ''), sid: (() => { const sec = pick(o, ['sections']); return Array.isArray(sec) && sec[0] ? String(sec[0].sectionId) : ''; })(),
      u: String(pick(o, ['url', 'link', 'href', 'share_url', 'shareUrl', 'originalUrl', 'sourceUrl']) || ''),
      a: (() => { const u = o.topicUserDTO || o.userDTO || o.user || o.authorDTO || o.author; if (u && typeof u === 'object') return String(u.name || u.nickName || u.nickname || u.userName || u.username || ''); const v = pick(o, ['accountName', 'author', 'authorName', 'author_name', 'nickName', 'nickname', 'userName', 'username']); return typeof v === 'object' && v ? String(v.name || v.nickname || '') : String(v || ''); })(),
      d: (() => { const v = pick(o, ['publishedAt', 'published_at', 'created_at', 'createdAt', 'publish_time', 'publishTime', 'gmtCreate', 'gmt_create', 'date', 'time']); return typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : String(v || ''); })(),
      et: String(pick(o, ['entityType', 'entity_type']) || ''),
      eid: String(pick(o, ['entityId', 'entity_id', 'topicId', 'topic_id']) || ''),
      raw: o,
    }); }), raw: '',
  };
}

// ---------- 自动更新：像信息流一样定时拉最新内容，最便宜的模型写一句话摘要和分类 ----------
const CATS = ['AI 工具与玩法', '搞钱项目', '小红书', '出海', '流量与运营', '电商', '认知与方法', '其他'];
const FEED = () => DIR + '/feed.json';
function hasToken() { return !!readTok()?.access_token; }
async function loadFeed(p) {
  const f = (await Promise.resolve(p.readJSON(p.p(FEED()))).catch(() => null)) || { updatedAt: 0, items: [], errors: [] };
  f.items = f.items.filter((x) => x.tool !== 'AI 情报' && x.src !== 'twitter' && !/^https:\/\/(x|twitter)\.com\//.test(x.u || ''));
  return f;
}
/** 挑能直接列内容的工具：没有必填参数，名字或说明像「最新/列表/推荐/精华/热门」 */
function feedTools(list) {
  const noArg = list.filter((t) => !(t.inputSchema?.required || []).length);
  const pref = noArg.filter((t) => /latest|recent|list|feed|hot|top|recommend|digest|new|精华|最新|推荐|热门|列表|动态|日报|周报/i.test(t.name + ' ' + (t.description || '')) && !/whoami|profile|me\b|account|个人信息|我的资料|用户信息/i.test(t.name + ' ' + (t.description || '')));
  return (pref.length ? pref : noArg).slice(0, 6);
}
async function update(p, manual = false) {
  if (!hasToken()) { if (manual) new api.Notice('还没连接生财有术'); return 0; }
  if (p.busy.has('scys')) return 0;
  p.busy.add('scys'); p.refreshViews?.();
  const feed = await loadFeed(p);
  const errors = [];
  let added = 0;
  try {
    const list = await tools(p);
    const known = new Set(feed.items.map((x) => x.key));
    const fresh = [];
    const names = new Set(list.map((t) => t.name));
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const month = new Date().toISOString().slice(0, 7);
    const SOURCES = [
      // 只要生财有术社区自己的帖子；「AI 情报」和推文是转述 X 上的内容，不收
      { name: 'contentSearch', title: '精华区', args: { pageScene: 'good', pageSize: 30 } },
      { name: 'contentSearch', title: '风向标', args: { pageScene: 'fxb', pageSize: 30 } },
      { name: 'contentSearch', title: '中标区', args: { pageScene: 'winBid', pageSize: 20 } },
      { name: 'contentSearch', title: '主题区', args: { pageScene: 'topic', pageSize: 30 } },
      { name: 'contentSearch', title: '广场', args: { pageScene: 'square', pageSize: 30 } },
      { name: 'searchTopic', title: '本周热门', args: { isHot: true, gmtCreateStart: since, pageSize: 10 } },
      { name: 'searchTopic', title: '本周精华', args: { isDigested: true, gmtCreateStart: since, pageSize: 10 } },
      { name: 'searchTrustedContent', title: '航海家群聊精华', args: { sourceType: 'navigator_chat_highlight', month, pageSize: 20 } },
    ].filter((x) => names.has(x.name));
    for (const t of SOURCES) {
      try {
        // 生财有术按用户限流：每次调用之间歇一下，碰到限流按它说的秒数等一次再试
        await new Promise((r) => setTimeout(r, 1500));
        let res;
        try { res = await call(t.name, t.args); }
        catch (e) {
          const m = String(e.message || e).match(/RATE_LIMITED[\s\S]*?retryAfterSeconds=(\d+)/);
          if (!m) throw e;
          await new Promise((r) => setTimeout(r, (Number(m[1]) + 1) * 1000));
          res = await call(t.name, t.args);
        }
        const r = itemsFrom(res);
        for (const it of r.items) {
          const key = it.u || (it.eid ? it.et + ':' + it.eid : t.title + ':' + it.id);
          if (known.has(key)) continue;
          known.add(key);
          if (!it.u && it.et && it.eid) it.u = `https://scys.com/articleDetail/${it.et}/${it.eid}`;
          fresh.push({ key, tool: t.title, et: it.et, eid: it.eid, src: it.src, iid: it.iid, sid: it.sid, likes: it.likes, reads: it.reads, tag: it.tag, t: it.t, s: it.s, u: it.u, a: it.a, d: it.d, body: String(it.raw?.content || it.raw?.text || it.raw?.body || '').slice(0, 20000), added: Date.now() });
        }
      } catch (e) { errors.push(t.title + '：' + (e.message || e)); }
    }
    // 最便宜的模型：一句话摘要 + 分类，每批 20 条
    for (let i = 0; i < fresh.length; i += 10) {
      const batch = fresh.slice(i, i + 10);
      try {
        const raw = await p.llm.generate(p.settings.models.cheap || p.settings.models.translate, {
          system: '你给生财有术社区的帖子写一句话中文摘要并分类。只输出 JSON。',
          prompt: `每行一条：序号｜标题｜摘要。给每条写 one（30 字以内，只根据这一条自己的标题和摘要，说清楚讲了什么、对普通人有什么用，不要套话）和 cat（只能从这里选：${CATS.join('、')}）。h 填这条标题的前 6 个字，用来核对没串行。\n输出 {"items":[{"i":序号,"h":"","one":"","cat":""}]}\n\n` + batch.map((x, k) => `${k}｜${x.t}｜${(x.s || x.body).slice(0, 200)}`).join('\n'),
          timeoutMs: 120000, effort: 'low',
        });
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        for (const r of (m ? JSON.parse(m[0]).items : []) || []) { const x = batch[Number(r.i)]; const norm = (v) => String(v || '').replace(/\s/g, '').slice(0, 4); if (x && (!r.h || norm(x.t).startsWith(norm(r.h).slice(0, 3)) || norm(r.h).startsWith(norm(x.t).slice(0, 3)))) { x.one = String(r.one || ''); x.cat = CATS.includes(r.cat) ? r.cat : '其他'; } }
      } catch (e) { errors.push('摘要：' + (e.message || e)); }
    }
    for (const x of fresh) x.cat ||= '其他';
    added = fresh.length;
    feed.items = [...fresh, ...feed.items].slice(0, 800);
    feed.updatedAt = Date.now();
    feed.errors = errors;
    await p.writeText(p.p(FEED()), JSON.stringify(feed));
    // 每天第一次更新（7 点以后）顺手出当天的日报
    try { const day = localDay(); if (new Date().getHours() >= 7 && !(await loadDaily(p, day))) await makeDaily(p, day); } catch (e) { errors.push('日报：' + (e.message || e)); }
  } catch (e) { errors.push(e.message || String(e)); }
  feed.errors = errors;
  await p.writeText(p.p(FEED()), JSON.stringify(feed));
  p.busy.delete('scys'); p.refreshViews?.();
  if (manual) new api.Notice(added ? `生财有术新增 ${added} 条` : errors.length ? '生财有术更新出错：' + errors[0] : '生财有术没有新内容');
  return added;
}

// ---------- 页面 ----------
function install(p, obsidian, h) { api = obsidian; H = h || {}; }

async function render(view, p, el) {
  el.addClass('gzh-scys'); el.addClass('gzh-feed-wide');
  const st = view.scysState ||= { tool: '', q: '', open: '' };
  const head = el.createDiv({ cls: 'gzh-head' });
  head.createEl('h2', { text: '生财有术' });
  const tok = readTok();
  if (!tok?.access_token) {
    const box = el.createDiv({ cls: 'gzh-scys-connect' });
    box.createEl('p', { text: tok?.expired ? '生财有术的授权过期了，重新连接一次就好。' : '用生财有术官方 MCP 读社区内容。点下面的按钮，会在浏览器打开生财有术的授权页，你确认一下就连上了，不用复制任何东西。' });
    box.createEl('p', { cls: 'gzh-muted', text: '令牌只保存在这台电脑的 ~/.gzh-studio 里，不进知识库，也不会同步到坚果云。随时可以在 scys.com/mcp 撤销。' });
    const b = box.createEl('button', { text: tok?.expired ? '重新连接生财有术' : '连接生财有术', cls: 'mod-cta' });
    b.onclick = async () => { b.disabled = true; b.setText('等你在浏览器确认…'); try { await connect(p); new api.Notice('生财有术已连接'); await tools(p); } catch (e) { new api.Notice('连接没完成：' + (e.message || e), 10000); } finally { view.render(); } };
    return;
  }
  const hr = head.createDiv({ cls: 'gzh-bar' });
  const ub = hr.createEl('button', { text: p.busy.has('scys') ? '更新中…' : '更新', cls: 'mod-cta' });
  ub.disabled = p.busy.has('scys');
  ub.onclick = () => update(p, true).then(() => view.render());
  for (const [k, l] of [['daily', '日报'], ['feed', '最新内容'], ['tools', '搜索 / 按工具看']]) {
    const b = hr.createEl('button', { text: l, cls: 'gzh-pill' + ((st.mode || 'daily') === k ? ' is-on' : '') });
    b.onclick = () => { st.mode = k; view.render(); };
  }
  hr.createEl('button', { text: '断开连接' }).onclick = async () => { await disconnect(); view.render(); };
  if ((st.mode || 'daily') === 'feed') return renderFeed(view, p, el, st);
  if ((st.mode || 'daily') === 'daily') return renderDaily(view, p, el, st);

  let list = [];
  try { list = st.toolsCache ||= await tools(p); }
  catch (e) { el.createDiv({ cls: 'gzh-empty', text: '读不到生财有术的工具：' + (e.message || e) }); if (/重新连接|过期|还没连接/.test(String(e.message))) { st.toolsCache = null; } return; }
  // 能直接列内容的工具：没有必填参数，或者只需要一个文字参数（当搜索框用）
  const usable = list.filter((t) => READ_ONLY.includes(t.name) && !['getTrustedContentSection', 'topicDetail', 'pageTopicComment', 'projectLibDetail', 'getProjectToolDetail'].includes(t.name)).map((t) => {
    const props = t.inputSchema?.properties || {}, req = t.inputSchema?.required || [];
    const strReq = req.filter((k) => (props[k]?.type || 'string') === 'string');
    return { t, props, req, query: req.length === 0 ? (Object.keys(props).find((k) => /query|keyword|q|search|kw/i.test(k)) || '') : strReq.length === 1 && req.length === 1 ? strReq[0] : null };
  }).filter((x) => x.query !== null);
  if (!usable.length) { el.createDiv({ cls: 'gzh-empty', text: `连上了，共 ${list.length} 个工具，但都需要复杂参数。工具清单已存到 公众号写作台/生财有术/工具清单.json。` }); return; }
  if (!st.tool || !usable.some((x) => x.t.name === st.tool)) st.tool = usable[0].t.name;
  const bar = el.createDiv({ cls: 'gzh-bar wrap' });
  for (const x of usable) {
    const b = bar.createEl('button', { text: x.t.title || x.t.annotations?.title || x.t.name, cls: 'gzh-pill' + (st.tool === x.t.name ? ' is-on' : '') });
    b.title = x.t.description || '';
    b.onclick = () => { st.tool = x.t.name; st.result = null; view.render(); };
  }
  const cur = usable.find((x) => x.t.name === st.tool);
  if (cur.t.description) el.createDiv({ cls: 'gzh-muted', text: cur.t.description.slice(0, 200) });
  const qb = el.createDiv({ cls: 'gzh-bar' });
  let qi = null;
  if (cur.query) { qi = qb.createEl('input', { type: 'search', value: st.q, attr: { placeholder: '输入关键词' } }); qi.onkeydown = (e) => { if (e.key === 'Enter') go.onclick(); }; }
  const go = qb.createEl('button', { text: st.result ? '刷新' : cur.query ? '搜索' : '读取', cls: 'mod-cta' });
  go.onclick = async () => {
    if (qi) st.q = qi.value.trim();
    if (cur.req.length && !st.q) return new api.Notice('先输入关键词');
    go.disabled = true; go.setText('正在读…');
    try { st.result = itemsFrom(await call(cur.t.name, cur.query && st.q ? { [cur.query]: st.q } : {})); st.open = ''; }
    catch (e) { new api.Notice('读取失败：' + (e.message || e), 10000); }
    view.render();
  };
  if (!st.result && !cur.req.length && !st.autoTried) { st.autoTried = true; setTimeout(() => go.onclick(), 0); }

  const { lst, reader } = splitWorkspace(el);
  const R = st.result;
  if (!R) { lst.createDiv({ cls: 'gzh-empty', text: '点上面的按钮读取内容。' }); return; }
  if (!R.items.length) { const pre = lst.createDiv({ cls: 'gzh-reader-article' }); await api.MarkdownRenderer.render(p.app, R.raw.slice(0, 60000), pre, '', view); return; }
  for (const it of R.items) {
    const c = lst.createDiv({ cls: 'gzh-fi' + (st.open === it.id ? ' is-selected' : '') });
    c.createDiv({ cls: 'gzh-fi-t', text: it.t });
    c.createDiv({ cls: 'gzh-muted', text: [it.a, it.d].filter(Boolean).join(' · ') });
    if (it.s) c.createDiv({ cls: 'gzh-muted', text: it.s.slice(0, 90) });
    c.onclick = () => { st.open = it.id; view.render(); };
  }
  const it = R.items.find((x) => x.id === st.open);
  if (!it) { reader.createDiv({ cls: 'gzh-reader-empty', text: '点左边任意一条，在这里看内容。' }); return; }
  if (it.et && it.eid && !it.u) it.u = `https://scys.com/articleDetail/${it.et}/${it.eid}`;
  return showItem(view, p, reader, it);
  const tb = reader.createDiv({ cls: 'gzh-reader-toolbar' });
  if (it.u) tb.createEl('a', { text: '打开原文 ↗', href: it.u, attr: { target: '_blank' } });
  const full = () => `${it.t}\n${it.u}\n\n${it.s || ''}\n\n${JSON.stringify(it.raw).length < 8000 ? '' : ''}`;
  const text = () => {
    const o = it.raw || {};
    const body = o.content || o.text || o.body || o.markdown || it.s || '';
    return String(body);
  };
  const lm = H.learnModule && H.learnModule();
  if (lm) tb.createEl('button', { text: '存到学习', cls: 'gzh-mini' }).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { const f = await lm.saveToLearn(p, { title: it.t, url: it.u, text: text(), author: it.a, from: '生财有术', tags: ['生财有术'] }); b.setText('已存进学习 ✓'); new api.Notice('已存进学习：' + f.basename); } catch (er) { b.disabled = false; new api.Notice('没存成：' + er.message); } };
  if (H.openProcessModal) tb.createEl('button', { text: '做成 X 帖子', cls: 'gzh-mini' }).onclick = () => H.openProcessModal(p, `${it.t}\n${it.u}\n\n${text()}`.slice(0, 15000));
  if (H.openLongModal) tb.createEl('button', { text: '写成公众号文章', cls: 'gzh-mini' }).onclick = () => H.openLongModal(p, `${it.t}\n${it.u}\n\n${text()}`.slice(0, 30000));
  reader.createEl('h2', { text: it.t });
  reader.createDiv({ cls: 'gzh-muted', text: [it.a, it.d].filter(Boolean).join(' · ') });
  const body = reader.createDiv({ cls: 'gzh-reader-article' });
  await api.MarkdownRenderer.render(p.app, text() || '（这条只有标题和摘要，点「打开原文」看全文）', body, '', view);
  void full;
}

/** 左右两栏，中间一条可以拖的分隔线；宽度记在本机，下次打开还是这个比例 */
function splitWorkspace(el) {
  const ws = el.createDiv({ cls: 'gzh-feed-workspace gzh-split' });
  const lst = ws.createDiv({ cls: 'gzh-feed-list' });
  const bar = ws.createDiv({ cls: 'gzh-split-bar', attr: { title: '拖动调整左右宽度，双击恢复默认' } });
  const reader = ws.createDiv({ cls: 'gzh-feed-reader' });
  const KEY = 'gzh-scys-split';
  const apply = (w) => { ws.style.gridTemplateColumns = `${Math.round(w)}px 10px minmax(0, 1fr)`; };
  let w = 360; try { w = Number(localStorage.getItem(KEY)) || 360; } catch (e) {}
  w = Math.min(w, 520);
  apply(w);
  let wide = false; try { wide = localStorage.getItem(KEY + '-wide') === '1'; } catch (e) {}
  const setWide = (v) => { wide = v; ws.toggleClass('is-wide', v); lst.style.display = v ? 'none' : ''; bar.style.display = v ? 'none' : ''; if (v) ws.style.gridTemplateColumns = 'minmax(0, 1fr)'; else apply(w); reader.style.maxWidth = v ? '980px' : ''; reader.style.margin = v ? '0 auto' : ''; reader.style.width = v ? '100%' : ''; try { localStorage.setItem(KEY + '-wide', v ? '1' : '0'); } catch (e) {} };
  setWide(wide);
  ws.toggleWide = () => setWide(!wide);
  bar.onpointerdown = (e) => {
    e.preventDefault(); bar.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = lst.getBoundingClientRect().width, max = ws.getBoundingClientRect().width - 320;
    bar.onpointermove = (ev) => { w = Math.min(max, Math.max(240, w0 + ev.clientX - x0)); apply(w); };
    bar.onpointerup = () => { bar.onpointermove = null; try { localStorage.setItem(KEY, String(Math.round(w))); } catch (e2) {} };
  };
  bar.ondblclick = () => { w = 360; apply(w); try { localStorage.removeItem(KEY); } catch (e) {} };
  return { ws, lst, reader };
}

/** 生财有术的时间：数字时间戳已转成 ISO；没带时区的字符串是北京时间 */
function scysTime(d) {
  let s = String(d || '').trim();
  if (!s) return 0;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s) || 0;
  if (/^\d{1,2}-\d{1,2}/.test(s)) s = new Date().getFullYear() + '-' + s;
  s = s.replace(' ', 'T');
  if (/T\d{1,2}:\d{2}$/.test(s)) s += ':00';
  return Date.parse(s + '+08:00') || Date.parse(s) || 0;
}
const fmtTime = (d) => { const t = scysTime(d); return t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : String(d || ''); };

async function renderFeed(view, p, el, st) {
  const F = await loadFeed(p);
  el.createDiv({ cls: 'gzh-muted', text: (F.updatedAt ? '更新于 ' + new Date(F.updatedAt).toLocaleString() + '，' : '还没更新过，') + '每 2 小时自动拉一次，用最便宜的模型写一句话摘要和分类。' + (F.errors?.length ? '问题：' + F.errors.join('；') : '') });
  if (!F.items.length) { el.createDiv({ cls: 'gzh-empty', text: p.busy.has('scys') ? '正在拉第一批内容…' : '还没有内容，点「更新」。' }); if (!p.busy.has('scys') && !F.updatedAt) update(p).then(() => view.render()); return; }
  const cats = {};
  for (const x of F.items) cats[x.cat] = (cats[x.cat] || 0) + 1;
  st.cat ||= '全部';
  const bar = el.createDiv({ cls: 'gzh-bar wrap' });
  for (const c of ['全部', ...CATS.filter((c) => cats[c])]) {
    const b = bar.createEl('button', { text: c + ' ' + (c === '全部' ? F.items.length : cats[c]), cls: 'gzh-pill' + (st.cat === c ? ' is-on' : '') });
    b.onclick = () => { st.cat = c; view.render(); };
  }
  const tools = {};
  for (const x of F.items) tools[x.tool] = (tools[x.tool] || 0) + 1;
  st.src ||= '全部来源';
  const bar2 = el.createDiv({ cls: 'gzh-bar wrap' });
  for (const c of ['全部来源', ...Object.keys(tools)]) {
    const b = bar2.createEl('button', { text: c + (c === '全部来源' ? '' : ' ' + tools[c]), cls: 'gzh-pill' + (st.src === c ? ' is-on' : '') });
    b.onclick = () => { st.src = c; view.render(); };
  }
  const q = bar2.createEl('input', { type: 'search', value: st.fq || '', attr: { placeholder: '搜标题或摘要' } });
  const { lst, reader } = splitWorkspace(el);
  const draw = () => {
    lst.empty();
    const kw = (st.fq || '').toLowerCase();
    const ts = (x) => scysTime(x.d) || x.added;
    const L = F.items.filter((x) => (st.cat === '全部' || x.cat === st.cat) && (st.src === '全部来源' || x.tool === st.src) && (!kw || (x.t + x.one + x.s).toLowerCase().includes(kw))).sort((a, b) => ts(b) - ts(a));
    // 和信息流一样：按天分组，左边时间轴显示几点几分
    let lastDay = '', tl = null;
    const dayKey = (x) => new Date(ts(x)).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    lst.createDiv({ cls: 'gzh-muted', text: `按发布时间从新到旧排列。当前 ${L.length} 条` });
    for (const x of L.slice(0, 400)) {
      const dk = dayKey(x);
      if (dk !== lastDay) {
        lastDay = dk;
        const dh = lst.createDiv({ cls: 'gzh-day' });
        dh.createEl('b', { text: dk });
        dh.createSpan({ text: L.filter((y) => dayKey(y) === dk).length + ' 条' });
        tl = lst.createDiv({ cls: 'gzh-tl' });
      }
      const row = tl.createDiv({ cls: 'gzh-row' });
      row.createDiv({ cls: 'gzh-time', text: new Date(ts(x)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) });
      row.createDiv({ cls: 'gzh-dot' });
      const c = row.createDiv({ cls: 'gzh-fi' + (st.fopen === x.key ? ' is-selected' : '') });
      c.createDiv({ cls: 'gzh-fi-t', text: x.t });
      c.createDiv({ cls: 'gzh-muted', text: [x.tool, x.cat, x.a, x.reads ? x.reads + ' 阅读' : '', x.likes ? x.likes + ' 赞' : ''].filter(Boolean).join(' · ') });
      if (x.one || x.s) c.createDiv({ text: x.one || x.s.slice(0, 80) });
      c.onclick = () => { st.fopen = x.key; showItem(view, p, reader, { t: x.t, u: x.u, a: x.a, d: x.d, s: x.s, et: x.et, eid: x.eid, src: x.src, iid: x.iid, sid: x.sid, raw: { content: x.body || x.s } }); lst.querySelectorAll('.gzh-fi').forEach((n) => n.removeClass('is-selected')); c.addClass('is-selected'); };
    }
  };
  q.oninput = () => { st.fq = q.value; draw(); };
  draw();
  const cur = F.items.find((x) => x.key === st.fopen);
  if (cur) showItem(view, p, reader, { t: cur.t, u: cur.u, a: cur.a, d: cur.d, s: cur.s, et: cur.et, eid: cur.eid, src: cur.src, iid: cur.iid, sid: cur.sid, raw: { content: cur.body || cur.s } });
  else reader.createDiv({ cls: 'gzh-reader-empty', text: '点左边任意一条，在这里看内容。' });
}

async function showItem(view, p, reader, it) {
  reader.empty();
  const text = () => String(it.raw?.content || it.raw?.text || it.raw?.body || it.s || '');
  const tb = reader.createDiv({ cls: 'gzh-reader-toolbar' });
  const ws = reader.parentElement;
  if (ws?.toggleWide) { const wb = tb.createEl('button', { text: ws.hasClass('is-wide') ? '⤡ 还原' : '⤢ 放大阅读', cls: 'gzh-mini' }); wb.onclick = () => { ws.toggleWide(); wb.setText(ws.hasClass('is-wide') ? '⤡ 还原' : '⤢ 放大阅读'); }; }
  if (it.u) tb.createEl('a', { text: '打开原文 ↗', href: it.u, attr: { target: '_blank' } });
  const lm = H.learnModule && H.learnModule();
  if (lm) tb.createEl('button', { text: '存到学习', cls: 'gzh-mini' }).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { const f = await lm.saveToLearn(p, { title: it.t, url: it.u, text: text(), author: it.a, from: '生财有术', tags: ['生财有术'] }); b.setText('已存进学习 ✓'); new api.Notice('已存进学习：' + f.basename); } catch (er) { b.disabled = false; new api.Notice('没存成：' + er.message); } };
  if (H.openProcessModal) tb.createEl('button', { text: '做成 X 帖子', cls: 'gzh-mini' }).onclick = () => H.openProcessModal(p, `${it.t}\n${it.u}\n\n${text()}`.slice(0, 15000));
  if (H.openLongModal) tb.createEl('button', { text: '写成公众号文章', cls: 'gzh-mini' }).onclick = () => H.openLongModal(p, `${it.t}\n${it.u}\n\n${text()}`.slice(0, 30000));
  reader.createEl('h2', { text: it.t });
  reader.createDiv({ cls: 'gzh-muted', text: [it.a, fmtTime(it.d)].filter(Boolean).join(' · ') });
  const body = reader.createDiv({ cls: 'gzh-reader-article' });
  // 帖子只带了摘要时，再读一次全文
  if (it.src && it.iid && it.sid && text().length < 600) {
    body.setText('正在读全文…');
    try {
      const r = await call('getTrustedContentSection', { sourceType: it.src, itemId: it.iid, sectionId: it.sid });
      const d = r.structuredContent || (() => { try { return JSON.parse((r.content || []).find((c) => c.type === 'text')?.text || ''); } catch (e) { return null; } })();
      const full = (d && (d.content || d.text || d.body)) || (r.content || []).map((c) => c.text || '').join('\n');
      if (full) it.raw = { ...(it.raw || {}), content: String(full) };
    } catch (e) { console.warn('生财有术：读全文失败', e); }
    body.empty();
  } else if (it.et && it.eid && text().length < 600) {
    body.setText('正在读全文…');
    try {
      const r = await call('topicDetail', { entityType: it.et, entityId: it.eid });
      const d = r.structuredContent || (() => { try { return JSON.parse((r.content || []).find((c) => c.type === 'text')?.text || ''); } catch (e) { return null; } })();
      const find = (v, k = 0) => { if (!v || typeof v !== 'object' || k > 4) return ''; for (const key of ['articleContent', 'articleContentContainFeishuDoc', 'questionContent', 'answerContent', 'content', 'contentText', 'text', 'body']) if (typeof v[key] === 'string' && v[key].trim().length > 10 && !/^\s*[{[]/.test(v[key])) return v[key]; for (const x of Object.values(v)) { const f = find(x, k + 1); if (f) return f; } return ''; };
      const full = find(d);
      if (full) it.raw = { ...(it.raw || {}), content: full };
    } catch (e) { console.warn('生财有术：读全文失败', e); }
    body.empty();
  }
  await api.MarkdownRenderer.render(p.app, text() || '（这条只有标题和摘要，点「打开原文」看全文）', body, '', view);
}

// ---------- 生财有术日报（版式参照 AIHOT 日报）----------
const localDay = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DAILY = (day) => DIR + '/日报/' + day + '.json';
async function loadDaily(p, day) { return Promise.resolve(p.readJSON(p.p(DAILY(day)))).catch(() => null); }
const SECTIONS = ['搞钱项目与案例', 'AI 工具与玩法', '流量与运营', '认知与方法'];

async function makeDaily(p, day = localDay()) {
  const F = await loadFeed(p);
  const end = new Date(day + 'T23:59:59').getTime(), start = end - 48 * 36e5;
  let pool = F.items.filter((x) => { const t = scysTime(x.d) || x.added; return t >= start && t <= end; });
  if (pool.length < 12) pool = F.items.slice().sort((a, b) => (scysTime(b.d) || b.added) - (scysTime(a.d) || a.added)).slice(0, 60);
  pool = pool.sort((a, b) => (b.reads || 0) + (b.likes || 0) * 20 - ((a.reads || 0) + (a.likes || 0) * 20)).slice(0, 60);
  if (!pool.length) throw new Error('没有可用的内容，先点「更新」');
  const lines = pool.map((x, i) => `${i}｜${x.tool}｜${x.cat || ''}｜${x.t}｜${x.a || ''}｜阅读${x.reads || 0} 赞${x.likes || 0}｜${(x.one || '')}｜${String(x.s || x.body || '').replace(/\s+/g, ' ').slice(0, 220)}`);
  const raw = await p.llm.generate(p.settings.models.cheap || p.settings.models.translate, {
    system: '你是《生财有术日报》的编辑，读者是想用 AI 和互联网搞副业的普通人。只用给你的帖子，不编造数字和事实。只输出 JSON。',
    prompt: `下面是生财有术社区近两天的帖子（序号｜来源｜分类｜标题｜作者｜热度｜一句话｜摘要）。请编一期日报：\n` +
      `1. headline：最值得读的 1 条做头条，写 lead（60 到 90 字，讲清楚是什么、怎么做到的、普通人能学什么）。\n` +
      `2. highlights：今日看点 3 条，每条一句话（25 字内），要具体。\n` +
      `3. sections：按这几个版面分组（${SECTIONS.join('、')}），每个版面 2 到 4 条，每条写 title（可以比原标题更清楚，20 字内）和 summary（1 到 2 句，带关键数字、做法）。没有合适内容的版面可以不出。\n` +
      `4. flashes：快讯 4 到 6 条，每条一句话标题。\n头条、看点、版面、快讯里同一条不要重复出现（看点可以和版面重复）。\n` +
      `输出 {"headline":{"i":序号,"title":"","lead":""},"highlights":[{"i":序号,"line":""}],"sections":[{"name":"版面名","items":[{"i":序号,"title":"","summary":""}]}],"flashes":[{"i":序号,"line":""}]}\n\n` + lines.join('\n'),
    timeoutMs: 240000, effort: 'low',
  });
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : raw);
  const ref = (i) => { const x = pool[Number(i)]; return x ? { key: x.key, tool: x.tool, a: x.a, u: x.u, reads: x.reads, likes: x.likes, orig: x.t } : null; };
  const rep2 = { day, at: Date.now(), count: pool.length,
    headline: j.headline && ref(j.headline.i) ? { ...ref(j.headline.i), title: j.headline.title || ref(j.headline.i).orig, lead: j.headline.lead || '' } : null,
    highlights: (j.highlights || []).map((h) => ref(h.i) && { ...ref(h.i), line: h.line }).filter(Boolean).slice(0, 3),
    sections: (j.sections || []).map((sec) => ({ name: sec.name, items: (sec.items || []).map((it) => ref(it.i) && { ...ref(it.i), title: it.title || ref(it.i).orig, summary: it.summary || '' }).filter(Boolean) })).filter((sec) => sec.items.length),
    flashes: (j.flashes || []).map((f) => ref(f.i) && { ...ref(f.i), line: f.line || ref(f.i).orig }).filter(Boolean),
  };
  const all = [rep2.headline, ...rep2.sections.flatMap((x) => x.items), ...rep2.flashes].filter(Boolean);
  rep2.stats = { items: all.length, sources: new Set(all.map((x) => x.tool)).size, minutes: Math.max(3, Math.round(all.length * 0.4)) };
  const old = await Promise.resolve(p.readJSON(p.p(DIR, '日报', '期数.json'))).catch(() => null) || {};
  rep2.no = old[day] || (Math.max(0, ...Object.values(old)) + 1);
  old[day] = rep2.no;
  await p.ensureFolder?.(p.p(DIR, '日报'));
  await p.writeText(p.p(DIR, '日报', '期数.json'), JSON.stringify(old));
  await p.writeText(p.p(DAILY(day)), JSON.stringify(rep2));
  await p.writeText(p.p(DIR, '日报', day + '.md'), dailyMarkdown(rep2));
  return rep2;
}

function dailyMarkdown(r) {
  const link = (x, t) => x.u ? `[${t}](${x.u})` : t;
  const out = [`# 生财有术日报 · ${r.day}（第 ${r.no} 期）`, ''];
  if (r.headline) out.push('## 头条', '', `### ${link(r.headline, r.headline.title)}`, '', r.headline.lead, '', `— ${r.headline.a || ''} · ${r.headline.tool}`, '');
  if (r.highlights.length) out.push('## 今日看点', '', ...r.highlights.map((h, i) => `${i + 1}. ${h.line}`), '');
  r.sections.forEach((sec, k) => { out.push(`## ${String(k + 1).padStart(2, '0')} ${sec.name}`, ''); for (const it of sec.items) out.push(`### ${link(it, it.title)}`, '', it.summary, '', `— ${it.a || ''} · ${it.tool}`, ''); });
  if (r.flashes.length) out.push('## 快讯', '', ...r.flashes.map((f) => `- ${link(f, f.line)}（${f.tool}）`), '');
  out.push('（本期完）');
  return out.join('\n');
}

async function renderDaily(view, p, el, st) {
  st.day ||= localDay();
  let R = await loadDaily(p, st.day);
  const wrap = el.createDiv({ cls: 'gzh-scys-daily' });
  // 日期导航
  const nav = wrap.createDiv({ cls: 'gzh-sd-nav' });
  for (let k = 0; k < 7; k++) {
    const d = localDay(Date.now() - k * 864e5);
    const b = nav.createEl('button', { text: k === 0 ? '今天' : `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`, cls: 'gzh-pill' + (st.day === d ? ' is-on' : '') });
    b.onclick = () => { st.day = d; view.render(); };
  }
  const gen = nav.createEl('button', { text: R ? '重新生成这一期' : '生成这一期', cls: R ? '' : 'mod-cta' });
  gen.onclick = async () => { gen.disabled = true; gen.setText('最便宜的模型正在编…'); try { await makeDaily(p, st.day); } catch (e) { new api.Notice('日报没生成：' + (e.message || e), 10000); } view.render(); };
  if (!R) { wrap.createDiv({ cls: 'gzh-empty', text: st.day === localDay() ? '今天的日报还没出。每天 7 点后第一次自动更新时会出，也可以点「生成这一期」。' : '这一天没有日报。' }); return; }
  const open = (x) => { st.mode = 'feed'; st.fopen = x.key; st.cat = '全部'; st.src = '全部来源'; view.render(); };
  const srcLine = (box, x) => { const l = box.createDiv({ cls: 'gzh-sd-src' }); l.createSpan({ cls: 'gzh-sd-tag', text: x.tool }); if (x.a) l.createSpan({ text: x.a }); if (x.reads) l.createSpan({ text: x.reads + ' 阅读' }); if (x.likes) l.createSpan({ text: x.likes + ' 赞' }); };
  const actions = (box, x) => { const a = box.createDiv({ cls: 'gzh-sd-act' }); a.createEl('a', { text: '在阅读栏看' }).onclick = () => open(x); if (x.u) { const o = a.createEl('a', { text: '原文 ↗', href: x.u }); o.setAttr('target', '_blank'); } };
  // 报头
  const mast = wrap.createDiv({ cls: 'gzh-sd-mast' });
  mast.createDiv({ cls: 'gzh-sd-kicker', text: '每天 7:00 出刊 · 第 ' + R.no + ' 期' });
  mast.createEl('h1', { text: '生财有术日报' });
  const dd = new Date(R.day + 'T12:00:00');
  mast.createDiv({ cls: 'gzh-sd-date', text: dd.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) });
  mast.createDiv({ cls: 'gzh-sd-stats', text: `${R.stats.items} 条 · ${R.stats.sources} 个版块 · 阅读约 ${R.stats.minutes} 分钟 · 从 ${R.count} 条帖子里选出` });
  // 头条
  if (R.headline) {
    const h = wrap.createDiv({ cls: 'gzh-sd-head' });
    h.createDiv({ cls: 'gzh-sd-label', text: '头条' });
    srcLine(h, R.headline);
    h.createEl('h2', { text: R.headline.title }).onclick = () => open(R.headline);
    h.createEl('p', { text: R.headline.lead });
    actions(h, R.headline);
  }
  // 今日看点
  if (R.highlights.length) {
    const hl = wrap.createDiv({ cls: 'gzh-sd-hl' });
    hl.createDiv({ cls: 'gzh-sd-label', text: '今日看点' });
    R.highlights.forEach((x, i) => { const r = hl.createDiv({ cls: 'gzh-sd-hlrow' }); r.createSpan({ cls: 'gzh-sd-num', text: String(i + 1) }); r.createSpan({ text: x.line }).onclick = () => open(x); });
  }
  // 本期版面
  if (R.sections.length) {
    const toc = wrap.createDiv({ cls: 'gzh-sd-toc' });
    toc.createDiv({ cls: 'gzh-sd-label', text: '本期版面' });
    R.sections.forEach((sec, k) => { const t = toc.createEl('a', { text: `${String(k + 1).padStart(2, '0')} ${sec.name} · ${sec.items.length}` }); t.onclick = () => wrap.querySelector('#gzh-sd-sec-' + k)?.scrollIntoView({ behavior: 'smooth' }); });
    if (R.flashes.length) { const t = toc.createEl('a', { text: `${String(R.sections.length + 1).padStart(2, '0')} 快讯 · ${R.flashes.length}` }); t.onclick = () => wrap.querySelector('#gzh-sd-flash')?.scrollIntoView({ behavior: 'smooth' }); }
  }
  R.sections.forEach((sec, k) => {
    const sb = wrap.createDiv({ cls: 'gzh-sd-sec', attr: { id: 'gzh-sd-sec-' + k } });
    const sh = sb.createDiv({ cls: 'gzh-sd-sechead' });
    sh.createSpan({ cls: 'gzh-sd-secno', text: String(k + 1).padStart(2, '0') });
    sh.createSpan({ text: sec.name });
    for (const it of sec.items) {
      const c = sb.createDiv({ cls: 'gzh-sd-item' });
      srcLine(c, it);
      c.createEl('h3', { text: it.title }).onclick = () => open(it);
      c.createEl('p', { text: it.summary });
      actions(c, it);
    }
  });
  if (R.flashes.length) {
    const fb = wrap.createDiv({ cls: 'gzh-sd-sec', attr: { id: 'gzh-sd-flash' } });
    const sh = fb.createDiv({ cls: 'gzh-sd-sechead' });
    sh.createSpan({ cls: 'gzh-sd-secno', text: String(R.sections.length + 1).padStart(2, '0') });
    sh.createSpan({ text: '快讯' });
    for (const f of R.flashes) { const r = fb.createDiv({ cls: 'gzh-sd-flash' }); r.createSpan({ cls: 'gzh-sd-tag', text: f.tool }); r.createSpan({ text: f.line }).onclick = () => open(f); }
  }
  const end = wrap.createDiv({ cls: 'gzh-sd-end' });
  end.createDiv({ text: '（本期完）' });
  end.createDiv({ cls: 'gzh-muted', text: '根据生财有术社区公开帖子自动整理，每条都能点开看原帖。Markdown 版存在 公众号写作台/生财有术/日报/' + R.day + '.md' });
  const prev = localDay(new Date(R.day + 'T12:00:00').getTime() - 864e5);
  end.createEl('a', { text: '前一日 · ' + Number(prev.slice(5, 7)) + '月' + Number(prev.slice(8)) + '日' }).onclick = () => { st.day = prev; view.render(); };
}

module.exports = { makeDaily,  update, hasToken, loadFeed, feedTools,  install, render, connect, disconnect, tools, call, itemsFrom, parseRpc, TOKEN_FILE };
