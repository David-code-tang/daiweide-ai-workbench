// 戴卫得 X 创作助手（v2）：粉丝数 + 评论灵感 / 引用观点 / 存为素材 / 原创 / 人设，和戴卫得AI工作台联动。
(() => {
  if (window.__dwdLoaded) return; window.__dwdLoaded = 1;
  const alive = () => { try { return !!chrome.runtime?.id; } catch (e) { return false; } };
  const send = (msg) => new Promise((res, rej) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) return rej(new Error('扩展刚更新过，请按 ⌘+R 刷新这个页面'));
        r && r.ok ? res(r.result) : rej(new Error((r && r.error) || '没有响应'));
      });
    } catch (e) { rej(new Error('扩展刚更新过，请按 ⌘+R 刷新这个页面')); }
  });
  const api = async (command, args, onTick) => {
    const r = await send({ type: 'dwd', command, args });
    if (!r || !r.__job) return r;
    const t0 = Date.now();
    while (Date.now() - t0 < 5 * 60 * 1000) {
      await new Promise(ok => setTimeout(ok, 2000));
      if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
      const j = await send({ type: 'dwd-job', id: r.__job });
      if (j.status === 'completed') return j.result;
      if (j.status === 'failed') throw new Error(j.error || '生成失败');
    }
    throw new Error('等了 5 分钟还没写完，工作台的模型可能卡住了，稍后再试');
  };

  // ================= 粉丝数 =================
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js'); s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  // ================= X 收藏同步 =================
  // 打开着 X 的时候每分钟叫醒一次后台（不依赖 alarms 权限）
  if (window.top === window) setInterval(() => { try { if (alive()) chrome.runtime.sendMessage({ type: 'dwd-bm-poll' }, () => void chrome.runtime.lastError); } catch (e) {} }, 60000);
  // 只有扩展后台为同步专门开的收藏页标签才会执行：问后台「我是不是同步标签」，是的话让页面脚本读收藏 / 取消收藏，结果交回后台。
  if (/^\/i\/bookmarks/.test(location.pathname) || /onboarding|login|i\/flow/.test(location.pathname)) {
    try {
      chrome.runtime.sendMessage({ type: 'dwd-bm-hello' }, (job) => {
        if (chrome.runtime.lastError || !job) return;
        const onResult = (e) => {
          if (e.source !== window || !e.data || e.data.__dwd !== 'bm-result') return;
          window.removeEventListener('message', onResult);
          try { chrome.runtime.sendMessage({ type: 'dwd-bm-done', result: e.data }); } catch (er) {}
        };
        window.addEventListener('message', onResult);
        window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.__dwd === 'bm-progress') { try { chrome.runtime.sendMessage({ type: 'dwd-bm-progress', p: e.data.p }, () => void chrome.runtime.lastError); } catch (er) {} } });
        // 页面脚本可能还没加载好：每秒发一次，直到它回 ack
        let acked = false;
        const onAck = (e) => { if (e.source === window && e.data && e.data.__dwd === 'bm-ack') { acked = true; window.removeEventListener('message', onAck); } };
        window.addEventListener('message', onAck);
        const tick = () => { if (acked) return; window.postMessage({ __dwd: 'bm-run', job }, location.origin); setTimeout(tick, 1000); };
        tick();
      });
    } catch (e) {}
  }
  const followers = new Map(); const KEY = 'dwdFollowers';
  try { chrome.storage.local.get(KEY, (v) => { const o = (v && v[KEY]) || {}, now = Date.now(); for (const [k, x] of Object.entries(o)) if (now - x.t < 3 * 864e5 && !followers.has(k)) followers.set(k, x.n); schedule(); }); } catch (e) {}
  let saveTimer = 0;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { const o = {}, now = Date.now(); [...followers].slice(-4000).forEach(([k, n]) => o[k] = { n, t: now }); chrome.storage.local.set({ [KEY]: o }); } catch (e) {} }, 3000); };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__dwd !== 'users') return;
    for (const [k, n] of Object.entries(e.data.users)) followers.set(k, n);
    persist(); schedule();
  });
  const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万' : n.toLocaleString('en-US');
  const handleOf = (box) => {
    for (const el of box.querySelectorAll('a[href^="/"], span')) {
      if (el.tagName === 'SPAN' && el.querySelector('span')) continue;
      const t = (el.textContent || '').trim();
      if (/^@[A-Za-z0-9_]{1,15}$/.test(t)) return { h: t.slice(1), el: el.tagName === 'SPAN' ? (el.closest('a') || el) : el };
    }
    return null;
  };
  function badges() {
    for (const box of document.querySelectorAll('[data-testid="User-Name"],[data-testid="UserCell"]')) {
      const x = handleOf(box); if (!x) continue;
      const n = followers.get(x.h.toLowerCase());
      let b = box.querySelector('.dwd-fans');
      if (n === undefined) { if (b) b.remove(); continue; }
      const text = fmt(n) + ' Followers';
      if (b && b.dataset.h === x.h && b.textContent === text) continue;
      if (!b) {
        b = document.createElement('span'); b.className = 'dwd-fans';
        const time = box.querySelector('time'); const anchor = time ? (time.closest('a') || time) : x.el;
        anchor.insertAdjacentElement('afterend', b);
      }
      b.dataset.h = x.h; b.textContent = text; b.title = '@' + x.h + ' · ' + n.toLocaleString('en-US') + ' 位粉丝';
      b.style.cssText = 'margin-left:6px;font-weight:700;white-space:nowrap;color:rgb(15,20,25);align-self:center;display:inline-block';
      if (document.body && getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.slice(0, 3).reduce((a, c) => a + +c, 0) < 200) b.style.color = 'rgb(231,233,234)';
    }
  }

  // ================= 帖子下面的三个按钮 =================
  function tweetData(art) {
    const texts = [...art.querySelectorAll('[data-testid="tweetText"]')];
    const main = texts.find(t => !t.closest('div[role="link"]')) || texts[0];
    const quoted = texts.find(t => t !== main && t.closest('div[role="link"]'));
    const nameBox = art.querySelector('[data-testid="User-Name"]');
    const hx = nameBox && handleOf(nameBox);
    const timeA = [...art.querySelectorAll('a[href*="/status/"]')].find(a => a.querySelector('time') && !a.closest('div[role="link"]'));
    const url = timeA ? new URL(timeA.getAttribute('href'), location.origin).href.replace(/\/(analytics|photo\/\d+)$/, '') : location.href;
    const nameSpan = nameBox && nameBox.querySelector('a span, span');
    const group = art.querySelector('[role="group"][aria-label]');
    const author = hx ? hx.h : ((url.match(/x\.com\/([^/]+)\/status/) || [])[1] || '');
    const av = art.querySelector('[data-testid="Tweet-User-Avatar"] img');
    return { url: url.replace('twitter.com', 'x.com'), author, name: nameSpan ? nameSpan.textContent.trim() : '', avatar: av ? av.src : '',
      text: main ? main.innerText.trim() : '', quoted: quoted ? quoted.innerText.trim() : '',
      followers: followers.get(author.toLowerCase()) ?? null, metrics: group ? group.getAttribute('aria-label') : '', art };
  }
  const ICON = {
    comment: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z"/></svg>',
    quote: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>'
  };
  function tweetButtons() {
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (art.querySelector('.dwd-row')) continue;
      const group = art.querySelector('[role="group"]'); if (!group) continue;
      const row = document.createElement('div'); row.className = 'dwd-row';
      row.style.cssText = 'display:flex;gap:18px;margin:2px 0 2px;font-size:13px;color:rgb(83,100,113)';
      const mk = (icon, label, fn) => {
        const b = document.createElement('button'); b.type = 'button';
        b.style.cssText = 'all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:4px 2px;border-radius:6px;font:inherit;color:inherit';
        b.innerHTML = ICON[icon] + '<span>' + label + '</span>';
        b.onmouseenter = () => b.style.color = 'rgb(31,111,74)'; b.onmouseleave = () => { if (!b.dataset.done) b.style.color = ''; };
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!alive()) { b.querySelector('span').textContent = '请按 ⌘+R 刷新页面'; return; } fn(b); });
        row.appendChild(b); return b;
      };
      mk('comment', '评论灵感', () => openPanel('评论', tweetData(art)));
      mk('quote', '引用观点', () => openPanel('引用', tweetData(art)));
      mk('save', '存为素材', async (b) => {
        if (b.dataset.done) return; const sp = b.querySelector('span'); sp.textContent = '存储中…';
        try { const r = await api('save', strip(tweetData(art))); b.dataset.done = 1; b.style.color = 'rgb(31,111,74)'; b.innerHTML = ICON.check + '<span>' + (r.duplicate ? '已在素材里' : '已存为素材') + '</span>'; state.matCount = r.total; refreshBadge(); }
        catch (e) { sp.textContent = '没存上：' + e.message.slice(0, 30); }
      });
      group.insertAdjacentElement('afterend', row);
    }
  }
  let pending = false;
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; try { badges(); tweetButtons(); } catch (e) {} }); }
  const start = () => { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); schedule(); mountFab(); };
  document.body ? start() : document.addEventListener('DOMContentLoaded', start);

  // ================= 面板 =================
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const state = { tab: '评论', tweet: null, conn: null, model: '', matCount: 0, picked: { m: new Set(), n: new Set() }, names: {}, links: '', idea: '', lang: 'zh', results: {} };
  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .wrap{--bg:#fff;--fg:#14211b;--mut:#7d8a84;--line:#e7ece9;--soft:#f4f7f5;--ac:#1f6f4a;--mint:#d7f3e3;--mint2:#c3ecd5;--bad:#d9534f;
    position:fixed;z-index:2147483646;top:16px;right:16px;bottom:16px;width:400px;max-width:calc(100vw - 32px);background:var(--bg);color:var(--fg);
    border-radius:22px;box-shadow:0 18px 50px rgba(20,33,27,.18),0 0 0 1px rgba(20,33,27,.06);display:flex;flex-direction:column;overflow:hidden;
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;animation:in .18s ease-out}
  @keyframes in{from{opacity:0;transform:translateY(8px)}}
  @media (max-width:640px){.wrap{top:auto;left:0;right:0;bottom:0;width:100vw;max-width:100vw;height:88vh;border-radius:22px 22px 0 0}.grab{display:block!important}}
  .grab{display:none;width:40px;height:4px;border-radius:2px;background:var(--line);margin:8px auto 0}
  header{display:flex;align-items:center;gap:12px;padding:16px 18px 12px}
  .logo{width:40px;height:40px;border-radius:12px;background:var(--mint);display:grid;place-items:center;overflow:hidden;flex:none}
  .logo img{width:100%;height:100%;object-fit:cover}
  .ttl{flex:1;min-width:0}.ttl b{display:block;font-size:16px;letter-spacing:.2px}.ttl small{display:block;font-size:10.5px;letter-spacing:1.6px;color:var(--mut);text-transform:uppercase}
  .ib{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--mut)}.ib:hover{background:var(--soft);color:var(--fg)}
  .seg{display:flex;gap:2px;background:var(--soft);border-radius:12px;padding:3px;margin:0 18px}
  .seg button{all:unset;cursor:pointer;flex:1;text-align:center;padding:7px 0;border-radius:9px;font-size:13px;color:var(--mut);display:flex;align-items:center;justify-content:center;gap:4px}
  .seg button.on{background:#fff;color:var(--fg);font-weight:600;box-shadow:0 1px 3px rgba(20,33,27,.1)}
  .seg .n{font-size:10.5px;background:var(--mint);color:var(--ac);border-radius:5px;padding:0 5px;font-weight:700}
  .body{flex:1;overflow:auto;padding:18px}
  .eyebrow{font-size:10.5px;letter-spacing:1.6px;color:var(--ac);font-weight:700;text-transform:uppercase}
  .h{display:flex;align-items:center;gap:10px;margin:4px 0 14px}.h b{font-size:17px;flex:1}
  .pill{font-size:11.5px;color:var(--ac);background:var(--mint);border-radius:6px;padding:1px 8px;white-space:nowrap}
  .empty{background:var(--soft);border-radius:14px;padding:34px 20px;text-align:center;color:var(--mut);font-size:13px}
  .empty .ic{color:var(--ac);margin-bottom:8px}.empty b{display:block;color:var(--fg);font-size:14px;margin-bottom:4px}
  .src{background:var(--soft);border-radius:14px;padding:12px 14px;margin-bottom:14px;font-size:13px}
  .src .who{display:flex;align-items:center;gap:8px;margin-bottom:4px}.src .who img{width:22px;height:22px;border-radius:50%}
  .src .who b{font-size:13px}.src .who span{color:var(--mut)}
  .src .t{white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  label.l{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  textarea,input[type=text],select{width:100%;border:1px solid var(--line);background:#fff;color:var(--fg);border-radius:14px;padding:12px 14px;font:inherit;resize:vertical;outline:none}
  textarea::placeholder,input::placeholder{color:#a9b3ae}
  textarea:focus,input:focus,select:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(31,111,74,.12)}
  select{width:auto;padding:7px 12px;border-radius:10px;font-size:13px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}
  .muted{color:var(--mut);font-size:12.5px}
  .go{all:unset;cursor:pointer;display:block;width:100%;text-align:center;background:var(--mint);color:var(--fg);font-weight:700;border-radius:14px;padding:14px 0;margin-top:14px}
  .go:hover{background:var(--mint2)}.go[disabled]{opacity:.55;pointer-events:none}
  .hint{font-size:12px;color:var(--mut);margin-top:8px}
  .card{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:12px}
  .tag{display:inline-block;font-size:11.5px;color:var(--ac);background:var(--mint);border-radius:6px;padding:0 7px;margin-bottom:6px}
  .card textarea{border:none;padding:0;border-radius:0;min-height:44px;resize:none;box-shadow:none}
  .acts{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
  .sm{all:unset;cursor:pointer;font-size:12.5px;padding:5px 11px;border-radius:9px;border:1px solid var(--line);color:var(--fg);text-align:center}
  .sm:hover{border-color:var(--ac);color:var(--ac)}.sm.pri{background:var(--ac);border-color:var(--ac);color:#fff}.sm.pri:hover{opacity:.9;color:#fff}
  .sm[disabled]{opacity:.6;pointer-events:none}
  .msg{font-size:12.5px;color:var(--mut);margin-top:10px}.msg:empty{display:none}.msg.err{color:var(--bad)}.msg.ok{color:var(--ac)}
  .spin{display:inline-block;width:12px;height:12px;border:2px solid var(--mint2);border-top-color:var(--ac);border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px;margin-right:6px}
  @keyframes s{to{transform:rotate(360deg)}}
  .box{background:var(--soft);border-radius:14px;padding:14px}
  .box .bh{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13.5px}
  .box .bh a{all:unset;cursor:pointer;font-weight:400;font-size:12.5px;color:var(--mut)}.box .bh a:hover{color:var(--ac)}
  .box p{margin:8px 0 10px;color:var(--mut);font-size:12.5px}
  .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.chips:empty{display:none}.chip{font-size:12px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:2px 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .twin{display:flex;gap:8px}.twin .sm{flex:1;background:#fff}.twin .sm.on{border-color:var(--ac);color:var(--ac)}
  .list{margin-top:10px;max-height:260px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:12px}
  .it{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer}.it:last-child{border:none}
  .it input{accent-color:var(--ac);margin-top:3px}.it .m{color:var(--mut);font-size:11.5px}
  .mat{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:10px;font-size:13px}
  .mat .who{font-weight:600;font-size:12.5px}.mat .who span{color:var(--mut);font-weight:400}
  .mat .t{margin:4px 0 8px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .mat .note{font-size:12px;color:var(--ac);margin-bottom:6px}
  footer{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid var(--line);font-size:12px;color:var(--mut)}
  footer .md{display:flex;align-items:center;gap:6px;color:var(--ac);font-weight:600}.dot{width:7px;height:7px;border-radius:50%;background:#b7c2bd}.dot.on{background:#2fb36b}.dot.off{background:var(--bad)}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}.stat{background:var(--soft);border-radius:12px;padding:9px 6px;text-align:center}.stat b{display:block;font-size:17px}.stat span{font-size:11px;color:var(--mut)}
  `;
  let host, root;
  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div'); host.id = 'dwd-panel-host';
    root = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root && root.querySelector('.wrap')) close(); });
  function close() { if (root) root.innerHTML = ''; }
  const GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const TABS = ['评论', '引用', '原创', '素材', '人设'];
  function openPanel(tab, tweet) {
    ensureHost();
    if (tweet) state.tweet = tweet;
    state.tab = tab || state.tab;
    root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="grab"></div>
      <header><div class="logo"><img src="${chrome.runtime.getURL('avatar.png')}" alt=""></div>
        <div class="ttl"><b>戴卫得 X 创作助手</b><small>Create with your own voice</small></div>
        <button class="ib set" title="人设设置">${GEAR}</button><button class="ib x" title="关闭（Esc）">${CLOSE}</button></header>
      <div class="seg">${TABS.map(t => `<button data-t="${t}" class="${t === state.tab ? 'on' : ''}">${t}${t === '素材' ? `<span class="n" ${state.matCount ? '' : 'hidden'}>${state.matCount}</span>` : ''}</button>`).join('')}</div>
      <div class="body"></div>
      <footer><span class="md"><span class="dot ${state.conn === true ? 'on' : state.conn === false ? 'off' : ''}"></span><span class="mn">${esc(state.model || '连接工作台…')}</span></span><span>草稿由你确认 · 在 X 内发布</span></footer></div>`;
    root.querySelector('.x').onclick = close;
    root.querySelector('.set').onclick = () => openPanel('人设');
    root.querySelectorAll('.seg > button').forEach(b => b.onclick = () => openPanel(b.dataset.t));
    api('ping').then(r => { state.conn = true; state.model = r.model; state.matCount = r.materials; foot(); refreshBadge(); }, (e) => { state.conn = false; state.model = '工作台未连接'; foot(); const m = root.querySelector('.body .msg'); if (m && !m.textContent) fail(m, e); });
    const body = root.querySelector('.body');
    ({ 评论: tabComment, 引用: tabQuote, 原创: tabOriginal, 素材: tabMaterials, 人设: tabPersona })[state.tab](body);
  }
  function foot() { if (!root || !root.querySelector('footer')) return; root.querySelector('footer .dot').className = 'dot ' + (state.conn ? 'on' : 'off'); root.querySelector('footer .mn').textContent = state.model; }
  function refreshBadge() { const n = root && root.querySelector('.seg .n'); if (n) { n.textContent = state.matCount; n.hidden = !state.matCount; } }
  const busy = (el, text) => { el.className = 'msg'; el.innerHTML = `<span class="spin"></span>${esc(text)}`; };
  const fail = (el, e) => { el.className = 'msg err'; el.textContent = String(e.message || e); };
  const ok = (el, t) => { el.className = 'msg ok'; el.textContent = t; };
  const head = (eyebrow, title, pill) => `<div class="eyebrow">${eyebrow}</div><div class="h"><b>${title}</b>${pill ? `<span class="pill">${pill}</span>` : ''}</div>`;
  const emptyTweet = (btn) => `<div class="empty"><div class="ic">${ICON.quote.replace(/15/g, '22')}</div><b>从一条帖子开始</b>在 X 帖子下点击「${btn}」，助手会读取你选中的原帖。</div>`;
  const srcCard = (t) => `<div class="src"><div class="who">${t.avatar ? `<img src="${esc(t.avatar)}">` : ''}<b>${esc(t.name || t.author)}</b><span>@${esc(t.author)}${t.followers != null ? ' · ' + fmt(t.followers) + ' Followers' : ''}</span></div><div class="t">${esc(t.text || '（这条没有文字）')}</div></div>`;
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); } if (btn) { const o = btn.textContent; btn.textContent = '已复制'; setTimeout(() => btn.textContent = o, 1200); } };
  const waitFor = (sel, ms = 6000) => new Promise((res) => { const end = Date.now() + ms; const t = setInterval(() => { const el = [...document.querySelectorAll(sel)].pop(); if (el || Date.now() > end) { clearInterval(t); res(el || null); } }, 120); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // X 的输入框是富文本编辑器：先试 insertText，不行再模拟粘贴，最后检查真的填进去了
  const editorIn = (box) => { if (!box) return null; if (box.isContentEditable || box.tagName === 'TEXTAREA') return box; return box.querySelector('[contenteditable="true"],textarea') || box; };
  const hasText = (ed, text) => { const v = ed.tagName === 'TEXTAREA' ? ed.value : (ed.innerText || ''); const probe = text.replace(/\s+/g, '').slice(0, 12); return !!probe && v.replace(/\s+/g, '').includes(probe); };
  // 只认「刚弹出来的那个框」：首页顶部常驻的输入框不算（之前就是填到了那里、发成了不带引用的普通帖子）
  const editorsNow = () => new Set(document.querySelectorAll('[data-testid^="tweetTextarea_"]'));
  async function waitComposer(before, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].reverse().find((d) => d.querySelector('[data-testid="tweetTextarea_0"]'));
      if (dlg) return { box: dlg.querySelector('[data-testid="tweetTextarea_0"]'), scope: dlg };
      const fresh = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')].find((e) => !before.has(e));
      if (fresh && /\/compose\/|\/status\//.test(location.pathname)) return { box: fresh, scope: fresh.closest('[role="dialog"]') || fresh.closest('div[data-testid="toolBar"]')?.parentElement?.parentElement || document };
      await sleep(120);
    }
    return null;
  }
  async function fillComposer(text, before) {
    const found = await waitComposer(before || new Set());
    if (!found) throw new Error('没等到弹出的输入框，文字已复制，按 ⌘V 粘贴');
    const ed = editorIn(found.box);
    if (!ed) throw new Error('没找到输入框，文字已复制，按 ⌘V 粘贴');
    ed.__dwdScope = found.scope;
    await sleep(400);
    ed.focus();
    try { const sel = window.getSelection(), r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
    if (ed.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ed, text); ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // 只填一次：X 的编辑器对 insertText 会重复插入（实测出现两遍），所以先用「模拟粘贴」，确认没进去才退回 insertText
      const waitHas = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (hasText(ed, text)) return true; await sleep(100); } return hasText(ed, text); };
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      if (!(await waitHas(1200))) { try { document.execCommand('insertText', false, text); } catch (e) {} await waitHas(800); }
    }
    if (!hasText(ed, text)) throw new Error('没能自动填进去，文字已复制，按 ⌘V 粘贴');
    return ed;
  }
  // 你点了「直接发布」才会调用：点 X 自己的发布按钮，等弹窗关掉
  async function postNow(ed, needQuote) {
    await sleep(400);
    const scope = ed && ed.__dwdScope;
    if (!scope || scope === document) throw new Error('已填好，但没认出是哪个发帖框，为安全起见没有自动发，请手动点「发布」');
    if (!hasText(ed, ed.innerText || ed.value || '')) throw new Error('输入框是空的，没有发');
    if (needQuote && !scope.querySelector('article, [data-testid="quoteTweet"], div[role="link"]')) throw new Error('已填好，但框里没看到被引用的原帖，为安全起见没有自动发');
    const btn = scope.querySelector('[data-testid="tweetButton"]') || scope.querySelector('[data-testid="tweetButtonInline"]');
    if (!btn) throw new Error('已填好，但没找到发布按钮，请手动点「发布」');
    for (let i = 0; i < 20 && btn.getAttribute('aria-disabled') === 'true'; i++) await sleep(150);
    if (btn.getAttribute('aria-disabled') === 'true') throw new Error('已填好，但发布按钮是灰的（可能超字数），请检查后手动发布');
    btn.click();
    for (let i = 0; i < 40; i++) { await sleep(200); if (!btn.isConnected) return true; }
    return true;
  }
  // 发布按钮点两下才发：第一下变成「确认发布？」，3 秒内再点才真的发
  const confirmPost = (fn) => async (v, b) => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; const o = b.textContent; b.textContent = '再点一次确认发布'; setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = o; } }, 3000); return; }
    delete b.dataset.armed; b.disabled = true; b.textContent = '正在发布…';
    try { await fn(v); b.textContent = '已发布 ✓'; } catch (e) { b.disabled = false; b.textContent = '直接发布'; throw e; }
  };
  async function openReply(art, text, post) { await copy(text); const b = art && art.isConnected && art.querySelector('[data-testid="reply"]'); if (!b) throw new Error('原帖已经滑走了，文字已复制，请手动粘贴'); if (!post) close(); const before = editorsNow(); b.click(); const ed = await fillComposer(text, before); if (post) await postNow(ed, false); }
  async function openQuote(art, text, post) {
    await copy(text); const b = art && art.isConnected && art.querySelector('[data-testid="retweet"],[data-testid="unretweet"]'); if (!b) throw new Error('原帖已经滑走了，文字已复制，请手动粘贴');
    if (!post) close(); b.click(); const menu = await waitFor('[role="menuitem"]', 3000); if (!menu) throw new Error('没打开转发菜单，文字已复制');
    const q = [...document.querySelectorAll('[role="menuitem"]')].find(m => /quote|引用/i.test(m.textContent) || m.getAttribute('href') === '/compose/post');
    if (!q) throw new Error('没找到「引用」，文字已复制，请手动粘贴'); const before = editorsNow(); q.click(); const ed = await fillComposer(text, before); if (post) await postNow(ed, true);
  }
  async function openCompose(text, post) { await copy(text); if (!post) close(); const before = editorsNow(); const b = document.querySelector('[data-testid="SideNav_NewTweet_Button"],a[href="/compose/post"]'); if (b) b.click(); else location.href = '/compose/post'; const ed = await fillComposer(text, before); if (post) await postNow(ed, false); }
  function cards(box, items, actions) {
    box.innerHTML = '';
    items.forEach((it) => {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = `${it.angle ? `<span class="tag">${esc(it.angle)}</span>` : ''}<textarea rows="2">${esc(it.text)}</textarea><div class="acts"></div>`;
      const ta = c.querySelector('textarea'); const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; ta.oninput = () => { it.text = ta.value; fit(); }; setTimeout(fit);
      actions.forEach(([label, fn, pri]) => { const b = document.createElement('button'); b.className = 'sm' + (pri ? ' pri' : ''); b.textContent = label; b.onclick = async () => { try { await fn(ta.value, b); } catch (e) { const m = c.querySelector('.msg') || c.appendChild(Object.assign(document.createElement('div'), { className: 'msg' })); fail(m, e); } }; c.querySelector('.acts').appendChild(b); });
      box.appendChild(c);
    });
  }
  // 生成类按钮的通用流程：结果按帖子缓存，切页签回来还在
  async function run(key, btn, msg, out, command, args, label, render) {
    btn.disabled = true; out.innerHTML = ''; busy(msg, label + '…');
    try { const r = await api(command, args, (s) => { if (msg.isConnected) busy(msg, `${label}… ${s} 秒`); }); state.results[key] = r; if (r.model) { state.model = r.model; foot(); } if (!msg.isConnected) return; msg.className = 'msg'; msg.textContent = ''; render(r); }
    catch (e) { if (msg.isConnected) fail(msg, e); } finally { btn.disabled = false; }
  }

  function tabComment(body) {
    const t = state.tweet;
    body.innerHTML = head('Join the conversation', '让每一次互动都有内容', '3 个角度') + (t ? `${srcCard(t)}<label class="l">你的想法（可选）</label><input type="text" class="idea" placeholder="比如：我也踩过这个坑 / 夸一下他的思路"><button class="go">✦ 生成 3 条评论</button><div class="hint">补充信息 · 表达判断 · 轻松接话 · ${isZhText(t.text) ? '中文帖回中文' : '英文帖回英文'}</div><div class="msg"></div><div class="out"></div>` : emptyTweet('评论灵感') + '<div class="msg"></div>');
    if (!t) return;
    const [go, msg, out, idea] = ['.go', '.msg', '.out', '.idea'].map(q => body.querySelector(q));
    const render = (r) => cards(out, r.items, [['复制', (v, b) => copy(v, b)], ['填入回复框', (v) => openReply(t.art, v)], ['直接发布', confirmPost((v) => openReply(t.art, v, true)), true]]);
    const key = 'c:' + t.url; if (state.results[key]) render(state.results[key]);
    go.onclick = () => run(key, go, msg, out, 'comments', { ...strip(t), idea: idea.value.trim() }, '工作台正在想评论', render);
  }
  function tabQuote(body) {
    const t = state.tweet;
    body.innerHTML = head('Add your take', '引用时，说出你的观点', '3 个角度') + (t ? `${srcCard(t)}<div class="twin"><button data-m="opinion" class="sm on">结合我的观点</button><button data-m="summary" class="sm">先提炼原帖</button></div><label class="l">你的想法（可选）</label><textarea rows="3" class="idea" placeholder="比如：这个思路普通人也能用，关键是第二步"></textarea><button class="go">✦ 生成 3 条引用观点</button><div class="hint">一句话短评 · 提炼要点 · 观点延伸</div><div class="msg"></div><div class="out"></div>` : emptyTweet('引用观点') + '<div class="msg"></div>');
    if (!t) return;
    let mode = 'opinion';
    body.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; body.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); });
    const [go, msg, out, idea] = ['.go', '.msg', '.out', '.idea'].map(q => body.querySelector(q));
    const render = (r) => cards(out, r.items, [['复制', (v, b) => copy(v, b)], ['放进工作台待发', async (v, b) => { const q = await api('queue', { text: v, kind: 'single', arche: '引用转发', source: { tweetUrl: t.url, author: '@' + t.author, title: t.text.slice(0, 60) } }); b.textContent = '已放进 ' + q.postDate; b.disabled = true; }], ['打开引用并填入', (v) => openQuote(t.art, v)], ['直接发布', confirmPost((v) => openQuote(t.art, v, true)), true]]);
    const key = 'q:' + t.url; if (state.results[key]) render(state.results[key]);
    go.onclick = () => run(key, go, msg, out, 'quotes', { ...strip(t), mode, idea: idea.value.trim() }, '工作台正在写引用观点', render);
  }
  function tabOriginal(body) {
    const P = state.picked, names = state.names;
    body.innerHTML = `<div class="stats"><div class="stat"><b>–</b><span>今日已发</span></div><div class="stat"><b>–</b><span>今日已评</span></div><div class="stat"><b>–</b><span>粉丝</span></div></div>`
      + head('Make something yours', '把素材，变成你的观点', '3 个角度')
      + `<div class="box"><div class="bh">选题，可以来自两个方向<a class="mng">管理素材 →</a></div><p>主动找热点，或加入你看中的帖子、文章；两种来源可以混用。也可以直接写下自己的想法。</p>
        <div class="twin"><button class="sm hot">找热点</button><button class="sm mine">从素材选</button><button class="sm lnk">贴文章链接</button></div><div class="picker"></div><div class="chips"></div></div>
        <label class="l">你的想法</label><textarea rows="4" class="idea" placeholder="你想表达什么？例如：这项更新对个人创作者意味着什么……"></textarea>
        <div class="row between" style="margin-top:12px"><span class="muted">围绕你的人设生成</span><select class="lang"><option value="zh">默认中文</option><option value="en">English</option></select></div>
        <button class="go">✦ 生成 3 条原创建议</button><div class="hint">明确判断 · 可操作方法 · 趋势影响</div><div class="msg"></div><div class="out"></div>`;
    api('overview').then(o => { const b = body.querySelectorAll('.stat b'), sp = body.querySelectorAll('.stat span'); b[0].textContent = `${o.posted}/${o.postTarget}`; b[1].textContent = `${o.replied}/${o.replyTarget}`; b[2].textContent = o.growth.current ?? '–'; if (o.growth.needPerDay) sp[2].textContent = `粉丝 · 日需 +${o.growth.needPerDay}`; }).catch(() => {});
    const idea = body.querySelector('.idea'), lang = body.querySelector('.lang'), picker = body.querySelector('.picker'), chips = body.querySelector('.chips');
    idea.value = state.idea; idea.oninput = () => state.idea = idea.value; lang.value = state.lang; lang.onchange = () => state.lang = lang.value;
    const drawChips = () => { const arr = [...P.n].map(id => '热点 · ' + (names[id] || '已选')).concat([...P.m].map(id => '素材 · ' + (names[id] || '已选'))).concat(state.links.split(/\s+/).filter(u => /^https?:/.test(u)).map(u => '链接 · ' + u.replace(/^https?:\/\//, ''))); chips.innerHTML = arr.map(x => `<span class="chip">${esc(x.slice(0, 40))}</span>`).join(''); };
    const btns = { hot: body.querySelector('.hot'), mine: body.querySelector('.mine'), lnk: body.querySelector('.lnk') };
    const on = (k) => Object.entries(btns).forEach(([n, b]) => b.classList.toggle('on', n === k));
    const list = async (kind) => {
      on(kind);
      picker.innerHTML = (kind === 'hot' ? '<input type="text" class="q" placeholder="搜关键词，比如 Claude、视频、Agent" style="margin-top:10px;padding:9px 12px;border-radius:10px">' : '') + '<div class="list"><div class="it">读取中…</div></div>';
      const box = picker.querySelector('.list'), set = kind === 'hot' ? P.n : P.m;
      const load = async (query) => {
        try {
          const r = kind === 'hot' ? await api('news', { query, limit: 40 }) : await api('materials', {});
          if (!r.items.length) { box.innerHTML = `<div class="it">${kind === 'hot' ? '没有找到相关热点' : '还没有素材，在帖子下点「存为素材」'}</div>`; return; }
          box.innerHTML = r.items.map(i => { names[i.id] = (kind === 'hot' ? i.title : (i.author + ' ' + i.text)).slice(0, 30); return `<label class="it"><input type="checkbox" value="${esc(i.id)}" ${set.has(i.id) ? 'checked' : ''}><div>${kind === 'hot' ? `<div>${esc(i.title)}</div><div class="m">${esc(i.source || '')}</div>` : `<div class="m">${esc(i.author)}${i.note ? ' · ' + esc(i.note) : ''}</div>${esc(i.text.slice(0, 110))}`}</div></label>`; }).join('');
          box.querySelectorAll('input').forEach(c => c.onchange = () => { c.checked ? set.add(c.value) : set.delete(c.value); drawChips(); });
        } catch (e) { box.innerHTML = ''; const m = document.createElement('div'); m.className = 'msg'; box.appendChild(m); fail(m, e); }
      };
      const q = picker.querySelector('.q'); if (q) { let tm; q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => load(q.value.trim()), 400); }; }
      load('');
    };
    btns.hot.onclick = () => list('hot');
    btns.mine.onclick = () => list('mine');
    body.querySelector('.mng').onclick = () => openPanel('素材');
    btns.lnk.onclick = () => { on('lnk'); picker.innerHTML = '<textarea rows="3" style="margin-top:10px" placeholder="文章或帖子链接，一行一个（最多 3 个，会读全文）"></textarea>'; const ta = picker.querySelector('textarea'); ta.value = state.links; ta.oninput = () => { state.links = ta.value; drawChips(); }; ta.focus(); };
    drawChips();
    const [go, msg, out] = ['.go', '.msg', '.out'].map(q => body.querySelector(q));
    const render = (r) => cards(out, r.items, [['复制', (v, b) => copy(v, b)], ['放进工作台待发', async (v, b) => { const q = await api('queue', { kind: 'single', text: v, usedMaterials: r.used }); b.textContent = '已放进 ' + q.postDate; b.disabled = true; }], ['去发帖', (v) => openCompose(v)], ['直接发布', confirmPost((v) => openCompose(v, true)), true]]);
    if (state.results.o) render(state.results.o);
    go.onclick = () => run('o', go, msg, out, 'original', { materialIds: [...P.m], newsIds: [...P.n], links: state.links.split(/\s+/).filter(u => /^https?:\/\//.test(u)), idea: idea.value.trim(), lang: lang.value }, '工作台正在读材料写草稿', render);
  }
  async function tabMaterials(body) {
    if (state.matView === 'bm') return tabBookmarks(body);
    await tabSaved(body);
    body.insertAdjacentHTML('afterbegin', matSwitch());
    bindMatSwitch(body);
  }
  const matSwitch = () => `<div class="dwd-mswitch" style="display:flex;gap:6px;margin:0 0 10px"><button class="sm ${state.matView !== 'bm' ? 'pri' : ''}" data-v="saved">存下的素材</button><button class="sm ${state.matView === 'bm' ? 'pri' : ''}" data-v="bm">我的 X 收藏</button></div>`;
  const bindMatSwitch = (body) => body.querySelectorAll('.dwd-mswitch button').forEach((b) => { b.onclick = () => { state.matView = b.dataset.v; tabMaterials(body); }; });
  // 我的 X 收藏：用「三步进度」讲清楚——读收藏 → 存进工作台 → 从 X 收藏里清掉，每一步做到哪、还要多久
  async function tabBookmarks(body) {
    const C = { ok: '#1f6f4a', okBg: '#eef8f2', mut: '#7d8a84', line: '#e7ece9', soft: '#f4f7f5', err: '#c0392b' };
    body.innerHTML = matSwitch() + head('Your bookmarks', '我的 X 收藏', '') + `
      <div class="bm-sum" style="font-size:15px;line-height:1.6;font-weight:600;margin:6px 0 10px">读取中…</div>
      <div class="bm-steps" style="border:1px solid ${C.line};border-radius:14px;overflow:hidden"></div>
      <div class="row" style="display:flex;gap:6px;margin:12px 0 6px"><input class="q" placeholder="搜一下还在 X 收藏里的帖子" style="flex:1;min-width:0"><button class="sm pri sync">立即同步一次</button></div>
      <div class="msg"></div><div class="out"></div>`;
    bindMatSwitch(body);
    const $ = (s) => body.querySelector(s);
    const msg = $('.msg'), out = $('.out'), q = $('.q'), syncBtn = $('.sync');
    let r = null, last = null, listAt = 0, mySyncAt = 0;
    const hhmm = (t) => { const d = new Date(t); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); };
    const mins = (ms) => ms <= 60000 ? '1 分钟内' : Math.ceil(ms / 60000) + ' 分钟后';
    const statusOf = () => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'dwd-bm-status' }, (x) => { void chrome.runtime.lastError; res(x || null); }); } catch (e) { res(null); } });
    // 一步一行：图标（✓ 做完 / 转圈 正在做 / ○ 等着）+ 标题 + 说明 + 进度条
    const step = (n, state, title, desc, pct) => {
      const icon = state === 'done' ? `<span style="width:22px;height:22px;border-radius:50%;background:${C.ok};color:#fff;display:grid;place-items:center;font-size:13px">✓</span>`
        : state === 'run' ? `<span class="spin" style="width:18px;height:18px;margin:2px"></span>`
        : state === 'err' ? `<span style="width:22px;height:22px;border-radius:50%;background:${C.err};color:#fff;display:grid;place-items:center;font-size:13px">!</span>`
        : `<span style="width:20px;height:20px;border-radius:50%;border:2px solid ${C.line};display:grid;place-items:center;font-size:11px;color:${C.mut}">${n}</span>`;
      const bar = pct == null ? '' : `<div style="height:6px;border-radius:3px;background:${C.line};margin-top:8px;overflow:hidden"><div style="height:100%;width:${Math.max(2, Math.min(100, pct))}%;background:${C.ok};transition:width .4s"></div></div>`;
      return `<div style="display:flex;gap:10px;padding:12px;border-top:1px solid ${C.line};background:${state === 'run' ? C.okBg : '#fff'}"><div style="flex:0 0 22px">${icon}</div><div style="flex:1;min-width:0"><div style="font-weight:600;${state === 'err' ? 'color:' + C.err : ''}">${esc(title)}</div><div style="font-size:12px;color:${C.mut};margin-top:2px">${esc(desc)}</div>${bar}</div></div>`;
    };
    const render = (st) => {
      if (!r) return;
      const fresh = st && Date.now() - st.t < 4 * 60 * 1000;
      const stage = fresh ? st.stage : '';
      const queued = r.waiting || (mySyncAt && Date.now() - mySyncAt < 25000 && !['opening', 'reading', 'importing'].includes(stage));
      const removed = r.moved, total = r.total, left = r.pending;
      // 第 1 步：读你的 X 收藏
      let s1;
      if (stage === 'opening') s1 = step(1, 'run', '正在读你的 X 收藏', '在后台打开收藏页（会短暂多一个标签，读完自动关掉）', 10);
      else if (stage === 'reading') s1 = step(1, 'run', `正在读你的 X 收藏：第 ${st.pages || 0} 页`, `读到 ${st.count || 0} 条还没存过的收藏`, Math.min(90, 10 + (st.pages || 0) * 4));
      else if (queued) s1 = step(1, 'run', '马上开始读你的 X 收藏', '排队中：如果正在清理上一批，做完就开始', 3);
      else if (fresh && stage === 'error') s1 = step(1, 'err', '读收藏没成功', st.error || '');
      else s1 = step(1, total ? 'done' : 'wait', total ? `读完了：你一共收藏过 ${total} 条` : '还没读过你的 X 收藏', total ? `上次读取：${r.lastRun || '今天'}。以后每天自动读一次新收藏` : '点下面「立即同步一次」开始');
      // 第 2 步：存进工作台
      let s2;
      if (stage === 'importing') s2 = step(2, 'run', `正在存进工作台：${st.count || 0} 条`, '收藏的 X 长文会顺便取回全文', 80);
      else s2 = step(2, total ? 'done' : 'wait', total ? `都存好了：${total} / ${total} 条已在工作台` : '存进工作台', total ? '在 Obsidian 工作台「X 发帖台 → 博主素材库 → 我的收藏」里看' : '读完收藏后自动存');
      // 第 3 步：从 X 收藏里清掉
      let s3;
      const pct3 = total ? Math.round(100 * removed / total) : null;
      if (stage === 'removing') s3 = step(3, 'run', `正在从 X 收藏里清掉：这一批 ${st.removed || 0} / ${st.total || 0}`, `总进度 ${removed + (st.removed || 0)} / ${total}，帖子都已存在工作台，清掉不会丢`, total ? Math.round(100 * (removed + (st.removed || 0)) / total) : 0);
      else if (!total) s3 = step(3, 'wait', '从 X 收藏里清掉', '存好之后自动清，让 X 收藏保持干净');
      else if (!left) s3 = step(3, 'done', `清完了：${total} / ${total} 条已从 X 收藏里清掉`, 'X 的书签页现在是空的', 100);
      else if (!r.autoRemove) s3 = step(3, 'wait', `还有 ${left} 条留在 X 收藏里`, '自动清理没开：在工作台「X 收藏」窗口里勾选「导入成功后自动取消收藏」', pct3);
      else { const wait = Math.max(0, (r.nextRemoveAt || 0) - Date.now()); const eta = Date.now() + wait + (Math.ceil(left / 60) - 1) * 5 * 60000; s3 = step(3, 'run', `正在分批清掉：${removed} / ${total} 条已清`, `还剩 ${left} 条 · 下一批（60 条）${mins(wait)}开始 · 预计 ${hhmm(eta)} 全部清完`, pct3); }
      $('.bm-steps').innerHTML = s1 + s2 + s3;
      $('.bm-steps').firstElementChild.style.borderTop = 'none';
      // 最上面一句话总结
      const sum = !total ? '还没有同步过你的 X 收藏。'
        : stage === 'reading' || stage === 'opening' || queued ? '正在读你的 X 收藏，看看有没有新收藏…'
        : !left ? `✓ 全部完成：${total} 条 X 收藏都存进了工作台，X 收藏也清空了。`
        : `你的 ${total} 条 X 收藏都已安全存进工作台；正在把它们从 X 收藏里清掉，还剩 ${left} 条。`;
      $('.bm-sum').textContent = sum;
      const busyNow = ['opening', 'reading', 'importing', 'removing'].includes(stage) || queued;
      syncBtn.disabled = busyNow; syncBtn.textContent = busyNow ? '进行中…' : '立即同步一次';
    };
    const renderList = () => {
      if (!r.items.length) { out.innerHTML = q.value ? '<div class="empty"><b>没搜到</b></div>' : ''; return; }
      out.innerHTML = `<div style="font-size:12px;color:${C.mut};margin:8px 0 4px">还留在 X 收藏里的帖子（已存进工作台，等着清掉）：</div>` + r.items.map((i) => `<div class="mat" data-id="${esc(i.id)}"><div class="who">${esc(i.author || '')}</div><div class="t">${esc(i.text || '')}</div><div class="acts"><button class="sm pri use">用来写原创</button><a class="sm" href="${esc(i.url)}" target="_blank">看原帖</a></div></div>`).join('');
      out.querySelectorAll('.mat').forEach((el) => {
        const it = r.items.find((x) => x.id === el.dataset.id);
        el.querySelector('.use').onclick = async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = '正在加入…';
          try { const sv = await api('save', { url: it.url, author: String(it.author || '').replace(/^@/, ''), name: '', text: it.text || it.url, note: '来自我的 X 收藏' }); state.picked.m.add(sv.id); state.names[sv.id] = (it.author + ' ' + it.text).slice(0, 30); openPanel('原创'); }
          catch (e) { b.disabled = false; b.textContent = '用来写原创'; fail(msg, e); }
        };
      });
    };
    const tick = async (forceList) => {
      if (!body.isConnected) return false;
      const st = await statusOf();
      const changed = st && last && st.t !== last.t && ['done', 'error'].includes(st.stage);
      if (forceList || changed || !r || Date.now() - listAt > 6000) {
        try { r = await api('bookmarks.list', { query: q.value.trim(), limit: 80 }); listAt = Date.now(); renderList(); msg.textContent = ''; } catch (e) { fail(msg, e); }
      }
      last = st; render(st);
      return true;
    };
    let tq = 0; q.oninput = () => { clearTimeout(tq); tq = setTimeout(() => tick(true), 300); };
    syncBtn.onclick = async () => {
      syncBtn.disabled = true; mySyncAt = Date.now();
      try { await api('bookmarks.sync', {}); chrome.runtime.sendMessage({ type: 'dwd-bm-poll' }, () => void chrome.runtime.lastError); } catch (e) { fail(msg, e); }
      tick(true);
    };
    (async () => { while (await tick(false)) await new Promise((res) => setTimeout(res, 1500)); })();
  }
  async function tabSaved(body) {
    body.innerHTML = head('Your library', '存下来的好内容', state.matCount ? state.matCount + ' 条' : '') + '<div class="msg"><span class="spin"></span>读取中…</div><div class="out"></div>';
    const msg = body.querySelector('.msg'), out = body.querySelector('.out');
    try {
      const r = await api('materials', {}); msg.textContent = '';
      if (!r.items.length) { out.innerHTML = `<div class="empty"><div class="ic">${ICON.save.replace(/15/g, '22')}</div><b>还没有素材</b>刷到有价值的帖子，点帖子下面的「存为素材」。</div>`; return; }
      out.innerHTML = r.items.map(i => `<div class="mat" data-id="${esc(i.id)}"><div class="who">${esc(i.name || i.author)} <span>${esc(i.author)}${i.followers != null ? ' · ' + fmt(i.followers) + ' Followers' : ''}</span></div><div class="t">${esc(i.text)}</div>${i.note ? `<div class="note">批注：${esc(i.note)}</div>` : ''}<div class="acts"><button class="sm pri use">${state.picked.m.has(i.id) ? '已加入原创' : '用来写原创'}</button><a class="sm" href="${esc(i.url)}" target="_blank">看原帖</a><button class="sm del">删除</button></div></div>`).join('');
      out.querySelectorAll('.mat').forEach(el => {
        const id = el.dataset.id, it = r.items.find(x => x.id === id);
        el.querySelector('.use').onclick = () => { state.picked.m.add(id); state.names[id] = (it.author + ' ' + it.text).slice(0, 30); openPanel('原创'); };
        el.querySelector('.del').onclick = async () => { try { const x = await api('materials.remove', { id }); state.picked.m.delete(id); state.matCount = x.total; el.remove(); refreshBadge(); } catch (e) { fail(msg, e); } };
      });
    } catch (e) { fail(msg, e); }
  }
  async function tabPersona(body) {
    body.innerHTML = head('Your voice', '让生成的内容更像你') + `<label class="l" style="margin-top:0">账号定位</label><textarea rows="3" class="position" placeholder="你是谁、写给谁、想给读者什么"></textarea>
      <label class="l">表达习惯</label><textarea rows="5" class="voice" placeholder="平时怎么说话，爱用和不用的词"></textarea>
      <label class="l">写过的内容</label><textarea rows="6" class="samples" placeholder="贴几条你自己写过、满意的帖子"></textarea>
      <button class="go">保存人设</button><div class="hint">保存在 Obsidian 的 公众号写作台/X/我的表达习惯.md，评论、引用、原创都会参考它</div><div class="msg"></div>`;
    const f = ['position', 'voice', 'samples'].map(k => body.querySelector('.' + k)), msg = body.querySelector('.msg'), go = body.querySelector('.go');
    try { const v = await api('persona.get'); f[0].value = v.position || ''; f[1].value = v.voice || ''; f[2].value = v.samples || ''; } catch (e) { fail(msg, e); }
    go.onclick = async () => { go.disabled = true; try { await api('persona.set', { position: f[0].value, voice: f[1].value, samples: f[2].value }); ok(msg, '已保存'); } catch (e) { fail(msg, e); } finally { go.disabled = false; } };
  }
  const strip = (t) => { const { art, avatar, ...rest } = t; return rest; };
  const isZhText = (s) => { const zh = (String(s).match(/[一-鿿]/g) || []).length, en = (String(s).match(/[A-Za-z]{2,}/g) || []).length; return zh >= 6 || zh > en; };

  function mountFab() {
    if (document.getElementById('dwd-fab')) return;
    const f = document.createElement('button'); f.id = 'dwd-fab'; f.type = 'button'; f.title = '戴卫得 X 创作助手';
    f.style.cssText = 'all:unset;position:fixed;right:24px;bottom:96px;z-index:2147483645;width:52px;height:52px;border-radius:16px;background:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(20,33,27,.18),0 0 0 1px rgba(20,33,27,.06);display:grid;place-items:center;touch-action:none;user-select:none;will-change:transform';
    f.innerHTML = `<img src="${chrome.runtime.getURL('avatar.png')}" draggable="false" style="width:34px;height:34px;border-radius:50%;object-fit:cover;pointer-events:none;user-select:none" alt="">`;
    f.title = '戴卫得 X 创作助手（按住可以拖到任意位置）';
    // 可拖动：按住鼠标拖，松开就停（位置记住；双击恢复默认位置）。拖动时只改 transform，用 requestAnimationFrame 节流，不卡页面
    const POS = 'dwdFabPos', W = 52, M = 6;
    const clamp = (x, y) => ({ x: Math.min(Math.max(M, x), window.innerWidth - W - M), y: Math.min(Math.max(M, y), window.innerHeight - W - M) });
    const setPos = (p) => { Object.assign(f.style, { left: '0px', top: '0px', right: 'auto', bottom: 'auto', transform: `translate3d(${p.x}px,${p.y}px,0)` }); f._pos = p; };
    try { const p = JSON.parse(localStorage.getItem(POS) || 'null'); if (p) setPos(clamp(p.x, p.y)); } catch (e) {}
    let drag = null, moved = false, raf = 0, next = null;
    const onMove = (e) => {
      if (!drag) return;
      if (!(e.buttons & 1)) return onUp(); // 鼠标已经松开（松开事件被页面吞掉时）：立刻停
      if (!moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      moved = true; f.style.cursor = 'grabbing'; f.style.transition = 'none';
      next = clamp(e.clientX - drag.dx, e.clientY - drag.dy);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (next) setPos(next); });
    };
    const onUp = () => {
      if (!drag) return;
      drag = null; f.style.cursor = 'pointer';
      window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true); window.removeEventListener('blur', onUp);
      if (moved && f._pos) { try { localStorage.setItem(POS, JSON.stringify(f._pos)); } catch (er) {} }
    };
    f.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = f.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY }; moved = false;
      window.addEventListener('pointermove', onMove, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onUp, true); window.addEventListener('blur', onUp);
      e.preventDefault();
    });
    f.addEventListener('dragstart', (e) => e.preventDefault());
    f.addEventListener('dblclick', () => { try { localStorage.removeItem(POS); } catch (e) {} f._pos = null; Object.assign(f.style, { left: 'auto', top: 'auto', right: '24px', bottom: '96px', transform: 'none' }); });
    window.addEventListener('resize', () => { if (f._pos) setPos(clamp(f._pos.x, f._pos.y)); });
    f.onclick = (e) => { if (moved) { moved = false; e.preventDefault(); return; } if (!alive()) { f.title = '扩展刚更新过，请按 ⌘+R 刷新页面'; f.style.outline = '3px solid #d9534f'; return; } (root && root.querySelector('.wrap')) ? close() : openPanel(state.tweet ? state.tab : '原创'); };
    document.body.appendChild(f);
  }
  try { chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'dwd-open-original') openPanel('原创'); }); } catch (e) {}
})();
