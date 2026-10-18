// 运行在 x.com 页面里：只读 X 自己已经加载的数据，从里面取出每个账号的粉丝数，不额外请求。
(() => {
  if (window.__dwdHook) return; window.__dwdHook = 1;
  const pick = (o, out, d) => {
    if (!o || typeof o !== 'object' || d > 80) return;
    if (Array.isArray(o)) { for (const v of o) pick(v, out, d + 1); return; }
    const L = o.legacy, RC = o.relationship_counts;
    const sn0 = (o.core && o.core.screen_name) || (L && L.screen_name);
    if (sn0 && RC && typeof RC.followers === 'number') out[sn0.toLowerCase()] = RC.followers;
    else if (L && typeof L.followers_count === 'number') {
      if (sn0) out[sn0.toLowerCase()] = L.followers_count;
    } else if (typeof o.followers_count === 'number' && o.screen_name) out[o.screen_name.toLowerCase()] = o.followers_count;
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') pick(v, out, d + 1); }
  };
  const take = (j) => { const out = {}; try { pick(j, out, 0); } catch (e) {} if (Object.keys(out).length) window.postMessage({ __dwd: 'users', users: out }, location.origin); };
  const want = (u) => /\/i\/api\/|graphql|api\.(x|twitter)\.com/.test(String(u || ''));
  const of = window.fetch;
  window.fetch = function (...a) {
    const p = of.apply(this, a);
    try { const u = a[0] && (a[0].url || a[0]); if (want(u)) p.then(r => r.clone().json().then(take).catch(() => {})).catch(() => {}); } catch (e) {}
    return p;
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...r) {
    if (want(u)) this.addEventListener('load', () => {
      try { take(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch (e) {}
    });
    return oo.call(this, m, u, ...r);
  };
})();

// ---- X 收藏同步：只在「戴卫得 X 助手」自己在后台开的收藏页标签里执行（由 content.js 下指令）。
// 用的是这个页面本身已登录的 X 会话，读收藏 / 按清单取消收藏，不碰密码。
(() => {
  if (window.__dwdBm) return; window.__dwdBm = 1;
  let cap = null, anyHeaders = null;
  const H_KEEP = /^(authorization|x-csrf-token|x-twitter-[a-z-]+|x-client-transaction-id|accept-language)$/i;
  const toObj = (h) => { const o = {}; try { if (!h) return o; if (h instanceof Headers) h.forEach((v, k) => { o[k] = v; }); else if (Array.isArray(h)) h.forEach(([k, v]) => { o[k] = v; }); else Object.assign(o, h); } catch (e) {} return o; };
  const note = (url, headers) => {
    const u = String(url || '');
    if (!/\/i\/api\/graphql\//.test(u)) return;
    const h = {}; for (const [k, v] of Object.entries(headers || {})) if (H_KEEP.test(k)) h[k.toLowerCase()] = v;
    if (h.authorization) anyHeaders = h;
    if (!cap && /\/graphql\/[^/]+\/Bookmarks\?/.test(u)) cap = { url: new URL(u, location.origin).href, headers: h };
  };
  const of2 = window.fetch;
  window.fetch = function (input, init) {
    try { const url = input && (input.url || input); note(url, Object.assign(toObj(input && input.headers), toObj(init && init.headers))); } catch (e) {}
    return of2.apply(this, arguments);
  };
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.setRequestHeader, xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__dwdU = u; this.__dwdH = {}; return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { this.__dwdH && (this.__dwdH[k] = v); } catch (e) {} return xs.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { try { note(this.__dwdU, this.__dwdH); } catch (e) {} return xsend.apply(this, arguments); };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loginPage = () => /\/(login|i\/flow|i\/jf\/onboarding|account\/access)/.test(location.pathname) || /mode=login|redirect_after_login/.test(location.search);
  function parseBookmarks(json) {
    const out = []; let cursor = null;
    const ins = json?.data?.bookmark_timeline_v2?.timeline?.instructions || json?.data?.bookmark_timeline?.timeline?.instructions || [];
    for (const i of ins) for (const e of (i.entries || (i.entry ? [i.entry] : []))) {
      const c = e.content || {};
      if (c.cursorType === 'Bottom' || /^cursor-bottom/.test(e.entryId || '')) { cursor = c.value || cursor; continue; }
      let r = c.itemContent?.tweet_results?.result; if (!r) continue;
      if (r.__typename === 'TweetWithVisibilityResults') r = r.tweet;
      const lg = r?.legacy; if (!lg) continue;
      const u = r.core?.user_results?.result || {};
      const sn = u.core?.screen_name || u.legacy?.screen_name || '';
      let text = r.note_tweet?.note_tweet_results?.result?.text || lg.full_text || '';
      for (const x of lg.entities?.urls || []) if (x.url && x.expanded_url) text = text.split(x.url).join(x.expanded_url);
      for (const m of lg.extended_entities?.media || lg.entities?.media || []) if (m.url) text = text.split(m.url).join('').trim();
      const id = lg.id_str || r.rest_id;
      out.push({ tweet_id: id, username: sn, name: u.core?.name || u.legacy?.name || '', url: `https://x.com/${sn}/status/${id}`, text, created_at: lg.created_at ? new Date(lg.created_at).toISOString() : '',
        favorite_count: lg.favorite_count || 0, retweet_count: lg.retweet_count || 0, reply_count: lg.reply_count || 0, bookmark_count: lg.bookmark_count || 0, view_count: Number(r.views?.count || 0),
        media_urls: (lg.extended_entities?.media || []).map((m) => m.type === 'photo' ? m.media_url_https : (m.video_info?.variants || []).filter((v) => v.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url || m.media_url_https).filter(Boolean),
        quoted: r.quoted_status_result?.result?.legacy?.full_text || '' });
    }
    return { items: out, cursor };
  }
  async function fetchAll(known, max) {
    const u = new URL(cap.url), qid = u.pathname.split('/')[4], features = u.searchParams.get('features') || '{}', fieldToggles = u.searchParams.get('fieldToggles');
    const baseVars = JSON.parse(u.searchParams.get('variables') || '{}');
    let headers = { ...cap.headers };
    const seen = new Set(known || []), all = []; let cursor = null, pages = 0;
    while (pages < 30 && all.length < (max || 300)) {
      const vars = { ...baseVars, count: 20, includePromotedContent: false }; if (cursor) vars.cursor = cursor; else delete vars.cursor;
      const qs = new URLSearchParams({ variables: JSON.stringify(vars), features }); if (fieldToggles) qs.set('fieldToggles', fieldToggles);
      let r = await of2(`${location.origin}/i/api/graphql/${qid}/Bookmarks?${qs}`, { headers, credentials: 'include' });
      if (r.status !== 200 && headers['x-client-transaction-id']) { const h2 = { ...headers }; delete h2['x-client-transaction-id']; r = await of2(`${location.origin}/i/api/graphql/${qid}/Bookmarks?${qs}`, { headers: h2, credentials: 'include' }); if (r.status === 200) headers = h2; }
      if (r.status === 429) { all.partial = true; break; }
      if (r.status !== 200) { if (!all.length) throw new Error('读取收藏失败：HTTP ' + r.status); all.partial = true; break; }
      const { items, cursor: next } = parseBookmarks(await r.json()); pages++;
      if (!items.length) break;
      let fresh = 0;
      for (const it of items) { if (seen.has(it.tweet_id)) continue; seen.add(it.tweet_id); all.push(it); fresh++; }
      window.postMessage({ __dwd: 'bm-progress', p: { stage: 'reading', pages, count: all.length } }, location.origin);
      if (!fresh) break; // 这一页全是导入过的：后面更早的也都导过了
      if (!next || next === cursor) break; cursor = next; await sleep(800);
    }
    return all;
  }
  const pagesCapped = (got, job) => got.length >= (job.max || 300);
  async function deleteQid() {
    const urls = [...new Set([...document.scripts].map((s) => s.src).concat(performance.getEntriesByType('resource').map((e) => e.name)).filter((u) => /abs\.twimg\.com\/.+\.js/.test(u)))];
    urls.sort((a, b) => (/\/main\./.test(b) ? 1 : 0) - (/\/main\./.test(a) ? 1 : 0));
    for (const u of urls) { try { const t = await (await of2(u)).text(); const m = t.match(/queryId:"([\w-]+)",operationName:"DeleteBookmark"/); if (m) return m[1]; } catch (e) {} }
    return null;
  }
  async function removeAll(ids) {
    const headers = { ...(cap?.headers || anyHeaders || {}), 'content-type': 'application/json' }; delete headers['x-client-transaction-id'];
    const qid = await deleteQid(); const removed = [], failed = [];
    for (const id of ids) {
      let ok = false;
      if (qid) {
        const r = await of2(`${location.origin}/i/api/graphql/${qid}/DeleteBookmark`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ variables: { tweet_id: id }, queryId: qid }) });
        if (r.status === 429) { failed.push(...ids.filter((x) => !removed.includes(x) && !failed.includes(x))); break; }
        ok = r.status === 200 && /Done|tweet_bookmark_delete/.test(await r.text());
      }
      (ok ? removed : failed).push(id);
      window.postMessage({ __dwd: 'bm-progress', p: { stage: 'removing', removed: removed.length, failed: failed.length, total: ids.length } }, location.origin);
      await sleep(500);
    }
    return { removed, failed };
  }
  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.__dwd !== 'bm-run') return;
    window.postMessage({ __dwd: 'bm-ack' }, location.origin);
    if (window.__dwdBmRunning) return; window.__dwdBmRunning = 1;
    const job = e.data.job || {}, out = { __dwd: 'bm-result' };
    try {
      const t0 = Date.now();
      while (!cap && Date.now() - t0 < 30000) { if (loginPage()) break; await sleep(500); }
      if (loginPage()) throw new Error('Chrome 里的 X 没有登录');
      if (!cap) throw new Error('收藏页没加载出来（可能网络慢，或 X 改版了）');
      if (job.fetch) { const got = await fetchAll(job.known, job.max); out.items = [...got]; out.partial = !!got.partial || pagesCapped(got, job); }
      if ((job.remove || []).length) Object.assign(out, await removeAll(job.remove));
    } catch (er) { out.error = String(er.message || er); }
    window.postMessage(out, location.origin);
  });
})();
