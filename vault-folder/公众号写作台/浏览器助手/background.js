// 浏览器助手的后台：把请求转给本机的戴卫得AI工作台（127.0.0.1:51888）。
// 耗时任务只返回任务号，由页面自己每隔几秒来问结果，避免后台被浏览器休眠后结果丢失。
const BASE = 'http://127.0.0.1:51888';
const NOCONN = '连不上工作台：请确认电脑上的 Obsidian 已打开，戴卫得AI工作台插件已启用';
async function call(command, args) {
  let r;
  try { r = await fetch(BASE + '/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, args: args || {} }) }); }
  catch (e) { throw new Error(NOCONN); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 202 && j.job) return { __job: j.job };
  if (!r.ok) throw new Error(j.error || ('工作台返回 ' + r.status));
  return j.result;
}
async function job(id) {
  // 用 POST 查结果：GET 请求浏览器不带来源，会被工作台的安全检查挡掉
  const r = await call('job', { id });
  return r;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  const p = msg.type === 'dwd' ? call(msg.command, msg.args) : msg.type === 'dwd-job' ? job(msg.id) : null;
  if (!p) return;
  p.then(result => reply({ ok: true, result }), e => reply({ ok: false, error: String(e.message || e) }));
  return true;
});

// ---- X 收藏同步：每分钟问一次工作台要不要读收藏 / 取消收藏；要的话在后台开一个收藏页标签，
// 由那个标签里的页面脚本用你已登录的 X 会话读取，读完把结果交回工作台，然后关掉标签。----
const BM_KEY = 'dwdBmJob';
const bmGet = async () => { try { return (await chrome.storage.session.get(BM_KEY))[BM_KEY] || null; } catch (e) { return null; } };
const bmSet = async (v) => { try { if (v) await chrome.storage.session.set({ [BM_KEY]: v }); else await chrome.storage.session.remove(BM_KEY); } catch (e) {} };
const ST_KEY = 'dwdBmStatus';
const stSet = async (o) => { try { await chrome.storage.session.set({ [ST_KEY]: { ...o, t: Date.now() } }); } catch (e) {} };
const stGet = async () => { try { return (await chrome.storage.session.get(ST_KEY))[ST_KEY] || null; } catch (e) { return null; } };
async function bmFinish(job, result) {
  await bmSet(null);
  try { await chrome.tabs.remove(job.tabId); } catch (e) {}
  try {
    if (result.error && !result.items) { await stSet({ stage: 'error', error: result.error }); await call('bookmarks.ingest', { error: result.error }); return; }
    let text = [];
    if (job.job.fetch) {
      await stSet({ stage: 'importing', count: (result.items || []).length });
      const r = await call('bookmarks.ingest', { items: result.items || [], quiet: !!job.job.quiet, error: result.error || '', deep: !!job.job.deep, complete: !result.error && !result.partial && (result.items || []).length < (job.job.max || 300) });
      text.push((result.items || []).length ? `新导入 ${(r && r.imported) || 0} 条收藏` : '没有新收藏');
    }
    if ((job.job.remove || []).length) { await call('bookmarks.removed', { removed: result.removed || [], failed: result.failed || job.job.remove }); text.push(`取消了 ${(result.removed || []).length} 条收藏`); }
    await stSet({ stage: 'done', fetch: !!job.job.fetch, text: '同步完成：' + text.join('，') });
  } catch (e) { await stSet({ stage: 'error', error: String(e.message || e) }); }
}
async function bmPoll() {
  const cur = await bmGet();
  if (cur) {
    if (Date.now() - cur.t0 < 3 * 60 * 1000) return;
    return bmFinish(cur, { error: '同步收藏超时（3 分钟没读完）' });
  }
  let w; try { w = await call('bookmarks.want', {}); } catch (e) { return; }
  if (!w || (!w.fetch && !(w.remove || []).length)) return;
  await stSet({ stage: 'opening' });
  const tab = await chrome.tabs.create({ url: 'https://x.com/i/bookmarks', active: false });
  await bmSet({ tabId: tab.id, job: w, t0: Date.now() });
}
// 扩展还没在 chrome://extensions 里刷新时没有 alarms 权限：不能因此让整个后台报错（否则评论、原创等功能全部失灵）
try {
  if (chrome.alarms) {
    chrome.alarms.create('dwd-bm', { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'dwd-bm') { bmPoll().catch(() => {}); wxPoll().catch(() => {}); } });
  }
  chrome.runtime.onStartup.addListener(() => bmPoll().catch(() => {}));
} catch (e) {}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'dwd-bm-poll') { bmPoll().catch(() => {}); reply(true); return; }
  if (msg && msg.type === 'dwd-bm-status') { stGet().then((s) => reply(s)); return true; }
  if (msg && msg.type === 'dwd-bm-progress') { bmGet().then((cur) => { if (cur && sender.tab && sender.tab.id === cur.tabId) { stSet(msg.p || {}); bmSet({ ...cur, t0: Date.now() }); } }); reply(true); return; }
  if (!msg || (msg.type !== 'dwd-bm-hello' && msg.type !== 'dwd-bm-done')) return;
  (async () => {
    const cur = await bmGet();
    const mine = cur && sender.tab && sender.tab.id === cur.tabId;
    if (msg.type === 'dwd-bm-hello') return reply(mine ? cur.job : null);
    reply(true);
    if (mine) await bmFinish(cur, msg.result || {});
  })();
  return true;
});

// ---- 公众号草稿箱：每分钟问一次工作台有没有写好要推的公众号稿；有就在后台开一个公众号后台标签，
// 由那个标签里的 wx.js 用你登录着的公众号后台上传图片、存草稿，做完关掉标签。只存草稿，不发表。----
const WX_KEY = 'dwdWxJob';
const wxGet = async () => { try { return (await chrome.storage.session.get(WX_KEY))[WX_KEY] || null; } catch (e) { return null; } };
const wxSet = async (v) => { try { if (v) await chrome.storage.session.set({ [WX_KEY]: v }); else await chrome.storage.session.remove(WX_KEY); } catch (e) {} };
async function wxFinish(cur, result) {
  await wxSet(null);
  try { await chrome.tabs.remove(cur.tabId); } catch (e) {}
  try { await call('wechat.done', { ...result, id: cur.id }); } catch (e) {}
}
async function wxPoll() {
  const cur = await wxGet();
  if (cur) {
    if (Date.now() - cur.t0 < 4 * 60 * 1000) return;
    return wxFinish(cur, { ok: false, error: '4 分钟没存完，可能公众号后台没打开或卡住了' });
  }
  let w; try { w = await call('wechat.want', {}); } catch (e) { return; }
  if (!w || !w.id) return;
  const tab = await chrome.tabs.create({ url: 'https://mp.weixin.qq.com/', active: false });
  await wxSet({ tabId: tab.id, id: w.id, t0: Date.now() });
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || (msg.type !== 'dwd-wx-hello' && msg.type !== 'dwd-wx-done' && msg.type !== 'dwd-wx-poll')) return;
  if (msg.type === 'dwd-wx-poll') { wxPoll().catch(() => {}); reply(true); return; }
  (async () => {
    const cur = await wxGet();
    const mine = cur && sender.tab && sender.tab.id === cur.tabId;
    if (msg.type === 'dwd-wx-hello') {
      if (!mine) return reply(null);
      try { reply(await call('wechat.get', { id: cur.id })); } catch (e) { reply(null); }
      return;
    }
    reply(true);
    if (mine) await wxFinish(cur, msg.result || {});
  })();
  return true;
});
