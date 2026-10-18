// X Article 导出：正文、封面和图片位置独立保存，源笔记保持原样。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function buildPayload({title, body, cover, resolveAsset, vaultRoot}) {
  title = title.trim();
  if (!title || title.length > 100) throw new Error('X Article 标题需为 1～100 字，请在窗口中调整标题。');
  if (!body.trim()) throw new Error('正文为空，无法创建草稿。');
  const {marked} = await import('marked');
  const assets = [];
  function asset(ref) {
    if (/^(https?:|data:|file:)/i.test(ref)) throw new Error('请先将网络图片保存到知识库，再插入文章：' + ref.slice(0,100));
    let decoded; try { decoded = decodeURIComponent(ref); } catch { decoded = ref; }
    const abs = resolveAsset(decoded);
    if (!abs || !fs.existsSync(abs)) throw new Error('找不到图片：' + ref);
    const real = fs.realpathSync(abs), root = fs.realpathSync(vaultRoot);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error('图片必须保存在当前知识库内。');
    if (!/\.(png|jpe?g|webp|gif)$/i.test(real)) throw new Error('图片格式暂不支持：' + ref);
    if(fs.statSync(real).size > 20*1024*1024) throw new Error('图片超过 20 MB，请先压缩：'+ref);
    return {path:real, sha256:hash(fs.readFileSync(real))};
  }
  const coverAsset = cover ? asset(cover) : null;
  body = body.replace(/<!-- gzh-cover -->[\s\S]*?<!-- \/gzh-cover -->/g,'').replace(/^# [^\n]+\n/, '');
  body = body.replace(/%%[\s\S]*?%%/g, '').replace(/<!--[^]*?-->/g,'');
  body = body.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_,ref) => `![](${encodeURI(ref).replace(/\(/g,'%28').replace(/\)/g,'%29')})`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_,ref,label)=>label||ref);
  const tokens = marked.lexer(body);
  const nonce = hash(body).slice(0,12);
  marked.walkTokens(tokens, token => {
    if (token.type === 'link' && !/^(https?:|mailto:|#)/i.test(token.href)) throw new Error('正文包含 X 无法打开的本地链接，请先改为公开链接：'+token.href);
    if (token.type === 'html') throw new Error('正文含原始 HTML，请先转换成普通 Markdown，避免发布时丢失内容。');
    if (token.type === 'table' || (token.type === 'code' && token.lang === 'mermaid')) throw new Error('表格或 Mermaid 请先转成图片再推送，目前不会静默丢弃这些内容。');
    if (token.type === 'image' || token.type === 'hr') {
      const item = {kind:token.type === 'image'?'image':'divider', marker:`GZHMEDIA${nonce}N${assets.length}END`};
      if(token.type === 'image') Object.assign(item,asset(token.href));
      assets.push(item);
      // block 与 inline 均转为独立段落，确保图片不会插到相邻文字中。
      token.type='html';token.block=true;token.text=`<p>${item.marker}</p>`;delete token.tokens;
    }
  });
  const html = marked.parser(tokens);
  const fingerprint = hash(JSON.stringify({title,html,assets,coverAsset}));
  return {version:1,title,html,assets,cover:coverAsset,fingerprint};
}
module.exports = {buildPayload,hash};
