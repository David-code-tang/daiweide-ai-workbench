// 戴卫得 X 创作助手 · 公众号草稿箱：只在扩展自己开的后台标签里干活。
// 用你在 Chrome 里登录着的公众号后台：上传正文图片和封面，再存一篇草稿。只存草稿，不群发、不发表。
(() => {
  if (window.__dwdWx) return; window.__dwdWx = true;
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
  const b64Blob = (b64, mime) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime || 'image/png' }); };

  async function meta() {
    const html = await (await fetch('https://mp.weixin.qq.com/', { credentials: 'include' })).text();
    const t = (html.match(/data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/) || [])[1];
    if (!t) throw new Error('公众号后台没登录：在 Chrome 里打开 mp.weixin.qq.com 扫码登录后，再点一次「推到草稿箱」');
    const pick = (re) => (html.match(re) || [])[1] || '';
    return { token: t, ticket: pick(/ticket:\s*["']([^"']+)["']/), user: pick(/user_name:\s*["']([^"']+)["']/), time: pick(/time:\s*["'](\d+)["']/) || String(Math.floor(Date.now() / 1000)) };
  }
  async function upload(m, img, seq) {
    const blob = b64Blob(img.b64, img.mime);
    const name = img.name || ('image' + seq + '.png');
    const fd = new FormData();
    fd.append('type', blob.type); fd.append('id', String(Date.now())); fd.append('name', name);
    fd.append('lastModifiedDate', new Date().toString()); fd.append('size', String(blob.size)); fd.append('file', blob, name);
    const url = `https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id=${encodeURIComponent(m.user)}&ticket=${encodeURIComponent(m.ticket)}&svr_time=${m.time}&token=${m.token}&lang=zh_CN&seq=${seq}&t=${Math.random()}`;
    const j = await (await fetch(url, { method: 'POST', body: fd, credentials: 'include' })).json();
    if (!j || !j.cdn_url) throw new Error('图片上传到公众号失败：' + JSON.stringify(j && j.base_resp || j).slice(0, 120));
    return { url: j.cdn_url.replace(/^http:/, 'https:'), fileid: j.content || '' };
  }
  async function save(m, job, content, cover) {
    const f = {
      token: m.token, lang: 'zh_CN', f: 'json', ajax: '1', random: String(Math.random()), AppMsgId: '', count: '1', data_seq: '0', operate_from: 'Chrome', isnew: '0',
      title0: job.title || '', author0: job.author || '', writerid0: '0', digest0: job.digest || '', auto_gen_digest0: job.digest ? '0' : '1',
      content0: content, sourceurl0: job.source_url || '', need_open_comment0: '1', only_fans_can_comment0: '0',
      fileid0: cover ? cover.fileid : '', cdn_url0: cover ? cover.url : '', cdn_235_1_url0: cover ? cover.url : '', cdn_1_1_url0: cover ? (cover.square || cover.url) : '',
      cdn_url_back0: '', crop_list0: '', show_cover_pic0: '0', copyright_type0: '0', can_reward0: '0', fee0: '0', is_share_copyright0: '0', share_page_type0: '0',
      share_imageinfo0: '{"list":[]}', dot0: '{}', categories_list0: '[]', is_video_recommend0: '-1',
    };
    const r = await fetch(`https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${m.token}&lang=zh_CN`,
      { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f) });
    const j = await r.json().catch(() => ({}));
    return j;
  }
  async function run(job) {
    const m = await meta();
    let html = job.html || '', seq = 1;
    for (const img of job.images || []) {
      const up = await upload(m, img, seq++);
      html = html.split(`cwimg://${img.key}`).join(up.url);
    }
    if (/cwimg:\/\//.test(html)) throw new Error('有图片没换成公众号地址');
    let cover = null, coverNote = '';
    try {
      if (job.cover) { cover = await upload(m, job.cover, seq++); if (job.square) cover.square = (await upload(m, job.square, seq++)).url; }
    } catch (e) { coverNote = '封面没传上：' + e.message; cover = null; }
    let res = await save(m, job, html, cover);
    if (!res.appMsgId && cover) { res = await save(m, job, html, null); coverNote = '封面字段公众号没收，草稿先存好了，封面需要在后台手动选'; }
    if (!res.appMsgId) throw new Error('公众号没存成草稿：' + JSON.stringify(res.base_resp || res).slice(0, 160));
    return { ok: true, appmsgid: String(res.appMsgId), url: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${res.appMsgId}&token=${m.token}&lang=zh_CN`, cover: coverNote };
  }
  (async () => {
    const job = await send({ type: 'dwd-wx-hello' });
    if (!job) return; // 不是扩展开的标签，什么都不做
    let result;
    try { result = await run(job); } catch (e) { result = { ok: false, error: String(e.message || e) }; }
    await send({ type: 'dwd-wx-done', result: { ...result, id: job.id } });
  })();
})();
