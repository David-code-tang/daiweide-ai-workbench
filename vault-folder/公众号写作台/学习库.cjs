'use strict';
// 学习：把知识库「学习/」目录当成一本本地杂志来读。
// 笔记本身只读（学习目录约定只增不改）；阅读状态、标签、AI 分类、导读都存在工作台的 学习库状态.json。
const ROOT = '学习';
const CLIP = '学习/剪藏';
const STATE = '学习库状态.json';
const PAGE = 48;
const QUQU_TOPICS = ['恋爱择偶', '婚姻经营', '出轨与第三者', '分手离婚', '识人与人性', '搞钱与事业', '原生家庭', '职场与人际', '自我成长', '生育与育儿', '阶层与时代'];
const GENERAL_TOPICS = ['AI 工具与玩法', 'AI 行业与趋势', '编程与开发', '内容创作与运营', '搞钱与商业', '财务与投资', '效率与方法', '个人成长', '生活与其他'];
let api, H = {};

const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const strip = (t) => String(t || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
const plain = (t) => strip(t)
  .replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '').replace(/^>\s?(\[![^\]]*\][-+]?)?/gm, '').replace(/[*_`~|]/g, '')
  .replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
const firstImage = (t) => { const m = strip(t).match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)/) || strip(t).match(/<img[^>]+src="(https?:\/\/[^"]+)"/); return m ? m[1] : ''; };
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const fmtDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const ytId = (u) => { const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : ''; };
const ytThumb = (id) => id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
const safeName = (s) => String(s || '未命名').replace(/[\\/:*?"<>|#^[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名';

/** 直接读文件开头的 title / source / author / created / image，不依赖 Obsidian 的缓存 */
function rawFront(app, f) {
  try {
    const fs = require('fs'), path = require('path');
    const fd = fs.openSync(path.join(app.vault.adapter.getBasePath(), f.path), 'r');
    const buf = Buffer.alloc(4096); const n = fs.readSync(fd, buf, 0, 4096, 0); fs.closeSync(fd);
    const head = (buf.slice(0, n).toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    const get = (k) => { const m = head.match(new RegExp('^' + k + ':\\s*"?([^"\\n]*)"?\\s*$', 'm')); return m ? m[1].trim() : ''; };
    const au = head.match(/^author:\s*\n\s*-\s*"?\[*([^\]"\n]+)/m);
    const o = { title: get('title'), source: get('source'), created: get('created'), published: get('published'), image: get('image') };
    if (au) o.author = au[1].trim();
    for (const k of Object.keys(o)) if (!o[k]) delete o[k];
    return o;
  } catch (e) { return {}; }
}

function isNoise(f) {
  const b = f.basename;
  if (/^(CLAUDE|AGENTS|README)$/i.test(b)) return true;
  if (/指引$|^PDF转录|^_索引_|知识地图/.test(b)) return true;
  if (b === 'transcript' && f.parent?.children?.some((c) => c.basename === 'transcript_可读版')) return true;
  return false;
}

/** 栏目：学习/ 下的一级文件夹；剪藏按来源拆成 YouTube / 文章 */
function columnOf(path, src) {
  const parts = path.split('/');
  const top = parts[1] && parts.length > 2 ? parts[1] : '散篇';
  if (top === '剪藏') return ytId(src) ? 'YouTube' : /mp\.weixin\.qq\.com/.test(src || '') ? '公众号' : '文章';
  return top;
}

function scan(p) {
  const app = p.app, out = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(ROOT + '/') || isNoise(f)) continue;
    let fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
    // 剪藏的笔记：Obsidian 有时读不出头部信息（说明文字里有空行时），直接读文件开头补上
    if (!fm.source && f.path.startsWith(CLIP + '/')) fm = { ...rawFront(app, f), ...fm };
    let src = typeof fm.source === 'string' ? fm.source : typeof fm['链接'] === 'string' ? fm['链接'] : '';
    let title = (typeof fm.title === 'string' && fm.title) || (typeof fm['标题'] === 'string' && fm['标题']) || f.basename;
    let vid = ytId(src);
    // 曲曲：核心观点解析的 source 里带原视频 ID 和原标题
    const m = String(fm.source || '').match(/\d{4}-\d{2}-\d{2}_([\w-]{11})_([^/]+)/);
    if (m && !/^https?:/.test(src)) {
      vid = m[1];
      const orig = m[2].replace(/曲曲(麥|麦)肯(錫|锡)|曲曲大女人|曲曲現場直播|曲曲现场直播|高清|分章节完整版|分章節完整版|完整版|分章節版|分章节版|分章節|分章节|直播/g, ' ').replace(/[_\s]+/g, ' ').trim();
      const hints = Array.isArray(fm.topics) ? fm.topics.map(String) : [];
      if (/核心观点解析|直播/.test(title)) title = orig.length >= 4 ? orig : hints.slice(0, 2).join('｜') || title;
      src = 'https://www.youtube.com/watch?v=' + vid;
    }
    if (/^transcript/.test(f.basename) && f.parent) title = f.parent.name.replace(/^\d{4}-\d{2}-\d{2}_[\w-]{11}_/, '').replace(/_/g, ' ');
    const dateStr = fm.date || fm.published || fm.created || fm['日期'] || '';
    const added = Date.parse(String(dateStr)) || f.stat.ctime;
    const fmTags = (Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? [fm.tags] : []).map(String).filter((t) => !/^(clippings|曲曲|MOC)$/i.test(t));
    out.push({
      f, path: f.path, title: String(title).replace(/^["']|["']$/g, ''), col: columnOf(f.path, src), src, vid,
      cover: (typeof (fm.image || fm.cover || fm.thumbnail) === 'string' && (fm.image || fm.cover || fm.thumbnail)) || ytThumb(vid),
      author: Array.isArray(fm.author) ? String(fm.author[0] || '').replace(/^\[\[|\]\]$/g, '') : typeof fm.author === 'string' ? fm.author : '',
      desc: typeof fm.description === 'string' ? fm.description : '',
      hints: Array.isArray(fm.topics) ? fm.topics.map(String) : [],
      fmTags, added, year: new Date(added).getFullYear(),
      minutes: Math.max(1, Math.round(f.stat.size / 3 / 450)),
    });
  }
  return out;
}

async function loadState(p) { const s = await Promise.resolve(p.readJSON(p.p(STATE))).catch(() => null); return Object.assign({ items: {}, digest: {} }, s || {}); }
async function saveState(p, s) { await p.writeText(p.p(STATE), JSON.stringify(s)); }
const rec = (s, path) => s.items[path] || {};
const status = (s, path) => rec(s, path).status || '未读';
const topicOf = (s, x) => rec(s, x.path).topic || rec(s, x.path).ai?.topic || '';
function tagsOf(s, x) {
  const r = rec(s, x.path), hidden = new Set(r.hidden || []);
  return [...new Set([...(r.tags || []), ...(r.ai?.tags || []), ...x.fmTags])].filter((t) => t && !hidden.has(t));
}

// ---------- 朗读：在线神经音色（微软 Edge，和乔木 AI RSS 同一个）为主，Mac 自带声音兜底；句子卡拉 OK 高亮 ----------
const TTS_KEY = 'gzh-learn-tts';
const ttsPrefs = () => { try { return JSON.parse(localStorage.getItem(TTS_KEY) || '{}'); } catch (e) { return {}; } };
const ttsSave = (o) => { try { localStorage.setItem(TTS_KEY, JSON.stringify({ ...ttsPrefs(), ...o })); } catch (e) {} };
const hasCJK = (s) => /[㐀-鿿]/.test(s);
let PL = null;
const EDGE_VOICES = [['zh-CN-XiaoxiaoNeural', '晓晓 · 温暖女声'], ['zh-CN-YunxiNeural', '云希 · 年轻男声'], ['zh-CN-YunjianNeural', '云健 · 沉稳男声，适合讲书'], ['zh-CN-XiaoyiNeural', '晓伊 · 活泼女声'], ['zh-CN-YunyangNeural', '云扬 · 新闻播音'], ['zh-TW-HsiaoChenNeural', '曉臻 · 台湾女声']];
const EDGE_EN = 'en-US-JennyNeural';
// Mac 里那些搞怪/沙哑的声音（Eddy、Grandpa 这类）不拿来读书
const NOVELTY = /Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph/i;

function ttsStop() {
  try { window.speechSynthesis.cancel(); } catch (e) {}
  try { window.__gzhTtsAudio?.pause(); } catch (e) {}
  try { CSS.highlights?.delete('gzh-tts'); } catch (e) {}
  document.querySelectorAll('.gzh-tts-block').forEach((n) => n.classList.remove('gzh-tts-block'));
  if (window.__gzhTts) { window.__gzhTts.playing = false; window.__gzhTts.turn = (window.__gzhTts.turn || 0) + 1; }
}
function loadVoices() {
  return new Promise((res) => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) return res(v);
    window.speechSynthesis.onvoiceschanged = () => res(window.speechSynthesis.getVoices());
    setTimeout(() => res(window.speechSynthesis.getVoices()), 1500);
  });
}
function pickVoice(voices, lang, wanted) {
  if (wanted) { const w = voices.find((v) => v.name === wanted); if (w) return w; }
  const L = voices.filter((v) => (lang === 'zh' ? /^zh|cmn/i : /^en/i).test(v.lang) && !NOVELTY.test(v.name));
  const score = (v) => (/Premium|高品质/i.test(v.name) ? 3 : /Enhanced|增强/i.test(v.name) ? 2 : 0) + (lang === 'zh' ? (/zh[-_]CN/i.test(v.lang) ? 1 : 0) + (/Tingting|婷婷|Meijia|美佳|Lilian/i.test(v.name) ? 0.8 : 0) : (/en[-_](US|GB)/i.test(v.lang) ? 1 : 0) + (/Samantha|Daniel|Ava|Zoe/i.test(v.name) ? 0.8 : 0));
  return L.sort((a, b) => score(b) - score(a))[0] || null;
}

/** 微软 Edge 在线神经音色：一句话换一段 MP3 */
function edgeSynth(text, voice) {
  const path = require('path'), crypto = require('crypto');
  const dir = path.join(PL.app.vault.adapter.getBasePath(), PL.manifest?.dir || path.join(PL.app.vault.configDir, 'plugins', 'gzh-studio'), 'node_modules', 'ws');
  const WS = require(dir);
  const TOK = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const ticks = (Math.floor((Date.now() / 1e3 + 11644473600) / 300) * 300 * 1e7).toFixed(0);
  const gec = crypto.createHash('sha256').update(ticks + TOK).digest('hex').toUpperCase();
  const id = crypto.randomUUID().replace(/-/g, '');
  const url = `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TOK}&ConnectionId=${id}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-143.0.3650.75`;
  const esc = (s) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  return new Promise((res, rej) => {
    const chunks = []; let done = false;
    const ws = new WS(url, { handshakeTimeout: 10000, headers: { Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0', Cookie: `muid=${crypto.randomUUID().replace(/-/g, '').toUpperCase()};` } });
    const fin = (e) => { if (done) return; done = true; clearTimeout(tm); try { ws.terminate(); } catch (_) {} if (e) return rej(e); if (!chunks.length) return rej(new Error('没有声音返回')); res(Buffer.concat(chunks)); };
    const tm = setTimeout(() => fin(new Error('在线音色超时')), 30000);
    ws.on('error', (e) => fin(e));
    ws.on('unexpected-response', (q, r) => fin(new Error('在线音色被拒绝（' + r.statusCode + '）')));
    ws.on('close', () => fin(chunks.length ? null : new Error('连接断开')));
    ws.on('open', () => {
      const ts = new Date().toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.*) GMT$/, '$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)');
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` + JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }));
      ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${esc(text)}</prosody></voice></speak>`);
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) { if (String(data).includes('Path:turn.end')) fin(); return; }
      const b = Buffer.from(data); const n = b.readUInt16BE(0);
      if (b.slice(2, n + 2).toString().includes('Path:audio')) chunks.push(b.slice(n + 2));
    });
  });
}
const audioCache = new Map();
function edgeUrl(text, voice) {
  const k = voice + '|' + text;
  if (!audioCache.has(k)) {
    const pr = edgeSynth(text, voice).then((b) => URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' })));
    pr.catch(() => audioCache.delete(k));
    audioCache.set(k, pr);
    if (audioCache.size > 300) { const first = audioCache.keys().next().value; audioCache.get(first).then((u) => URL.revokeObjectURL(u)).catch(() => {}); audioCache.delete(first); }
  }
  return audioCache.get(k);
}

// ---------- 正文分块：语言、句子 ----------
const LEAF = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td';
const leafBlocks = (root) => [...root.querySelectorAll(LEAF)].filter((b) => !b.querySelector('p, li, blockquote') && b.textContent.trim());
function langOf(t) { const c = (t.match(/[㐀-鿿]/g) || []).length; const w = (t.match(/[A-Za-z]{2,}/g) || []).length; if (!c && !w) return 'x'; return c >= w ? 'zh' : 'en'; }

function buildSentences(root) {
  const blocks = leafBlocks(root).filter((b) => b.getClientRects().length);
  const out = [];
  for (const b of blocks) {
    const map = [];
    let text = '';
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { map.push({ n, s: text.length }); text += n.nodeValue; }
    const pieces = [];
    let last = 0;
    const cut = hasCJK(text) ? /[。！？!?；;…]+["」』）)]*|\n/g : /[.!?]+["')\]]*(?=\s)|\n/g;
    for (let m = cut.exec(text); m; m = cut.exec(text)) { const end = m.index + m[0].length; if (text.slice(last, end).trim()) pieces.push([last, end]); last = end; }
    if (text.slice(last).trim()) pieces.push([last, text.length]);
    for (const [s, e] of pieces) {
      const pos = (i) => { let k = map.length - 1; while (k > 0 && map[k].s > i) k--; return { node: map[k].n, off: Math.min(i - map[k].s, map[k].n.nodeValue.length) }; };
      try {
        const r = document.createRange(); const a = pos(s), z = pos(e);
        r.setStart(a.node, a.off); r.setEnd(z.node, z.off);
        const t = text.slice(s, e).replace(/\s+/g, ' ').trim();
        if (t.replace(/[\s\p{P}]/gu, '').length) out.push({ block: b, range: r, text: t });
      } catch (er) {}
    }
  }
  return out;
}

async function mountReader(bar, content, onEnd) {
  ttsStop();
  const prefs = ttsPrefs();
  const voices = window.speechSynthesis ? await loadVoices() : [];
  if (!content.isConnected) return;
  const st = window.__gzhTts = { playing: false, paused: false, i: 0, list: [], end: 0, turn: (window.__gzhTts?.turn || 0) + 1 };
  const wrap = bar.createDiv({ cls: 'gzh-pop-wrap gzh-tts' });
  const play = wrap.createEl('button', { text: '🔊 朗读', cls: 'mod-cta gzh-tts-main' });
  const stop = wrap.createEl('button', { text: '■', cls: 'gzh-tts-stop' }); stop.title = '结束朗读';
  const caret = wrap.createEl('button', { text: '▾', cls: 'gzh-tts-caret' }); caret.title = '朗读设置';
  const box = wrap.createDiv({ cls: 'gzh-pop' });
  makePop(wrap, caret, box);
  const row = (label) => { const r = box.createDiv({ cls: 'gzh-pop-row' }); r.createSpan({ cls: 'gzh-pop-label', text: label }); return r; };
  const eng = row('声音').createEl('select'); eng.title = '声音来源';
  eng.createEl('option', { value: 'edge', text: '在线真人音色' });
  eng.createEl('option', { value: 'mac', text: 'Mac 自带声音' });
  eng.value = prefs.engine || 'edge';
  const vz = row('音色').createEl('select'); vz.title = '中文音色';
  const rate = row('语速').createEl('select');
  for (const r of [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2]) rate.createEl('option', { value: String(r), text: r + '×' });
  rate.value = String(prefs.rate || 1.15);
  const ops = row('选段');
  const sel = ops.createEl('button', { text: '只读选中的' });
  const from = ops.createEl('button', { text: '从选中处读到尾' });
  const tip = box.createDiv({ cls: 'gzh-tts-tip' });
  const zhMac = voices.filter((v) => /^zh|cmn/i.test(v.lang) && !NOVELTY.test(v.name));
  const fillVoices = () => {
    vz.empty(); tip.setText('');
    if (eng.value === 'edge') {
      for (const [id, l] of EDGE_VOICES) vz.createEl('option', { value: id, text: l });
      vz.value = prefs.edgeVoice && EDGE_VOICES.some((v) => v[0] === prefs.edgeVoice) ? prefs.edgeVoice : EDGE_VOICES[0][0];
    } else {
      const best = pickVoice(voices, 'zh', prefs.voice);
      for (const v of zhMac) vz.createEl('option', { value: v.name, text: v.name.replace(/\s*\(.*?\)\s*/g, ' ').trim() + (/Premium|Enhanced|高品质|增强/i.test(v.name) ? ' ★' : '') });
      if (best) vz.value = best.name;
      if (!zhMac.some((v) => /Premium|Enhanced|高品质|增强/i.test(v.name))) tip.setText('Mac 自带声音偏机械。想更自然：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音，下载带「高品质」的中文声音；或直接用「在线真人音色」。');
    }
  };
  fillVoices();
  eng.onchange = () => { ttsSave({ engine: eng.value }); const was = st.playing && !st.paused; fillVoices(); if (was) restart(); };
  rate.onchange = () => { ttsSave({ rate: Number(rate.value) }); if (window.__gzhTtsAudio) window.__gzhTtsAudio.playbackRate = Number(rate.value); };
  vz.onchange = () => { ttsSave(eng.value === 'edge' ? { edgeVoice: vz.value } : { voice: vz.value }); if (st.playing && !st.paused) restart(); };

  const show = () => { const n = st.list.length && (st.playing || st.paused) ? ` ${st.i + 1}/${st.end}` : ''; play.setText(st.playing && !st.paused ? '⏸' + n : st.paused ? '▶ 继续' + n : '🔊 朗读'); wrap.toggleClass('is-playing', !!(st.playing || st.paused)); };
  const highlight = (it) => {
    document.querySelectorAll('.gzh-tts-block').forEach((n) => n.classList.remove('gzh-tts-block'));
    it.block.classList.add('gzh-tts-block');
    try { CSS.highlights.set('gzh-tts', new Highlight(it.range)); } catch (e) {}
    if (content.__reveal) return content.__reveal(it.block);
    const r = it.block.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 80) it.block.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const voiceFor = (t) => (hasCJK(t) ? vz.value : EDGE_EN);
  const finish = () => { const done = st.playing && st.full && st.i >= st.end; st.playing = false; ttsStop(); show(); if (done && onEnd) onEnd(); };
  const speak = async () => {
    if (!content.isConnected) { st.playing = false; ttsStop(); return; }
    if (!st.playing || st.i >= st.end) return finish();
    const it = st.list[st.i], turn = st.turn;
    const next = () => { if (turn !== st.turn || !st.playing) return; st.i++; show(); speak(); };
    if (eng.value === 'edge') {
      try {
        const u = await edgeUrl(it.text, voiceFor(it.text));
        for (let k = 1; k <= 3; k++) { const nx = st.list[st.i + k]; if (nx && st.i + k < st.end) edgeUrl(nx.text, voiceFor(nx.text)).catch(() => {}); }
        if (turn !== st.turn || !st.playing) return;
        const a = window.__gzhTtsAudio = new Audio(u);
        a.playbackRate = Number(rate.value) || 1;
        a.onplay = () => highlight(it);
        a.onended = next;
        a.onerror = next;
        if (!st.paused) await a.play();
      } catch (e) {
        if (turn !== st.turn) return;
        new api.Notice('在线音色暂时连不上，先换成 Mac 自带声音：' + String(e.message || e).slice(0, 80), 6000);
        eng.value = 'mac'; fillVoices(); speak();
      }
      show();
      return;
    }
    const u = new SpeechSynthesisUtterance(it.text);
    const cjk = hasCJK(it.text);
    const v = cjk ? voices.find((x) => x.name === vz.value) || pickVoice(voices, 'zh') : pickVoice(voices, 'en', prefs.enVoice);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = cjk ? 'zh-CN' : 'en-US';
    u.rate = Number(rate.value) || 1;
    u.onstart = () => highlight(it);
    u.onend = () => { if (st.paused) return; next(); };
    u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') return; next(); };
    window.speechSynthesis.speak(u);
    show();
  };
  const halt = () => { try { window.speechSynthesis.cancel(); } catch (e) {} try { window.__gzhTtsAudio?.pause(); } catch (e) {} st.turn++; };
  const start = (list, i = 0, end = list.length, full = false) => { halt(); Object.assign(st, { list, i, end, full, playing: true, paused: false }); speak(); };
  const restart = () => { halt(); st.playing = true; st.paused = false; speak(); };
  st.playAll = () => { const list = buildSentences(content); if (list.length) start(list, 0, list.length, true); };
  play.onclick = () => {
    if (st.playing && !st.paused) { st.paused = true; if (eng.value === 'edge') window.__gzhTtsAudio?.pause(); else window.speechSynthesis.pause(); return show(); }
    if (st.paused) {
      st.paused = false;
      if (eng.value === 'edge') { const a = window.__gzhTtsAudio; if (a && !a.ended) a.play(); else speak(); }
      else { window.speechSynthesis.resume(); if (!window.speechSynthesis.speaking) speak(); }
      return show();
    }
    st.playAll();
  };
  const selected = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!content.contains(r.commonAncestorContainer)) return null;
    const list = buildSentences(content);
    const hit = list.map((x, k) => (x.range.compareBoundaryPoints(Range.END_TO_START, r) < 0 && x.range.compareBoundaryPoints(Range.START_TO_END, r) > 0 ? k : -1)).filter((k) => k >= 0);
    return hit.length ? { list, first: hit[0], last: hit[hit.length - 1] } : null;
  };
  st.readSel = () => { wrap.removeClass('is-open'); const h = selected(); if (!h) return new api.Notice('先在正文里选一段文字'); start(h.list, h.first, h.last + 1); };
  sel.onclick = st.readSel;
  from.onclick = () => { const h = selected(); if (!h) return new api.Notice('先在正文里点选一个位置（选中几个字）'); start(h.list, h.first, h.list.length, true); };
  stop.onclick = () => { st.playing = false; st.paused = false; ttsStop(); show(); };
  show();
}

// ---------- 中英视图：对照 / 中文 / 英文；纯英文的文章按需翻译（便宜模型，译文缓存） ----------
const sha = (s) => require('crypto').createHash('sha1').update(String(s)).digest('hex');
async function translateBlocks(p, content, key, onProgress) {
  const en = leafBlocks(content).filter((b) => b.dataset.lang === 'en' && !b.dataset.tr && b.tagName !== 'TD');
  const file = p.p('学习译文', sha(key) + '.json');
  const cache = (await Promise.resolve(p.readJSON(file)).catch(() => null)) || {};
  const put = (b, zh) => {
    const n = document.createElement(/^H\d$/.test(b.tagName) || b.tagName === 'LI' ? b.tagName : 'P');
    n.className = 'gzh-tr'; n.dataset.lang = 'zh'; n.textContent = zh;
    b.after(n); b.dataset.tr = '1';
    applyAnnsTo(n, content.__anns || []);
  };
  const todo = [];
  for (const b of en) { const t = b.textContent.replace(/\s+/g, ' ').trim(); const h = sha(t).slice(0, 16); if (cache[h]) put(b, cache[h]); else todo.push({ b, t, h }); }
  const total = en.length; let done = total - todo.length;
  onProgress(done, total);
  const batches = []; let cur = [], len = 0;
  for (const x of todo) { if (cur.length && (cur.length >= 40 || len + x.t.length > 6000)) { batches.push(cur); cur = []; len = 0; } cur.push(x); len += x.t.length; }
  if (cur.length) batches.push(cur);
  let k = 0, failed = 0;
  const run = async (batch) => {
    const raw = await p.llm.generate(cheap(p), {
      system: '你是专业译者，把英文翻成自然、地道、好读的简体中文。产品名、公司名、人名保留英文。不解释，只输出 JSON。',
      prompt: '把下面每一段翻成中文。输出 JSON 数组，每项 {"i":编号,"zh":"译文"}，编号和输入一一对应，一段都不能漏：\n\n' + JSON.stringify(batch.map((x, i) => ({ i, en: x.t }))),
      timeoutMs: 240000, effort: 'low',
    });
    const s = String(raw || ''); const m = s.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : s);
    for (const r of arr) { const x = batch[Number(r.i)]; if (x && r.zh && x.b.isConnected && !x.b.dataset.tr) { cache[x.h] = String(r.zh); put(x.b, String(r.zh)); done++; } }
    await p.writeText(file, JSON.stringify(cache));
    onProgress(done, total);
  };
  const worker = async () => { while (k < batches.length) { const b = batches[k++]; if (!content.isConnected) return; try { await run(b); } catch (e) { failed++; console.warn('[学习] 翻译失败', e); } } };
  await Promise.all([worker(), worker(), worker()]);
  return { done, total, failed };
}

// ---------- 翻页：单页 / 双页，像阅读器一样左右翻 ----------
function applyLayout(content, mode) {
  const old = content.parentElement?.classList.contains('gzh-pageclip') ? content.parentElement : null;
  const oldNav = old?.nextElementSibling?.classList.contains('gzh-pagenav') ? old.nextElementSibling : null;
  content.dataset.layout = mode;
  if (mode === 'scroll') {
    if (old) { old.before(content); old.remove(); }
    oldNav?.remove();
    content.style.height = ''; content.style.transform = '';
    content.__reveal = null; content.__go = null;
    return;
  }
  let clip = old;
  if (!clip) { clip = document.createElement('div'); clip.className = 'gzh-pageclip'; content.before(clip); clip.append(content); }
  let nav = oldNav;
  if (!nav) { nav = document.createElement('div'); nav.className = 'gzh-pagenav'; clip.after(nav); }
  nav.empty();
  const h = Math.max(360, window.innerHeight - 270);
  clip.style.height = h + 'px'; content.style.height = h + 'px';
  const GAP = 56;
  const prev = nav.createEl('button', { text: '‹ 上一页' });
  const lab = nav.createSpan({ cls: 'gzh-tts-prog' });
  const next = nav.createEl('button', { text: '下一页 ›' });
  const step = () => clip.clientWidth + GAP;
  const pages = () => Math.max(1, Math.ceil((content.scrollWidth + GAP - 4) / step()));
  let cur = 0;
  const go = (n) => { cur = Math.max(0, Math.min(pages() - 1, n)); content.style.transform = `translateX(${-cur * step()}px)`; lab.setText(`${cur + 1} / ${pages()}`); };
  prev.onclick = () => go(cur - 1); next.onclick = () => go(cur + 1);
  content.__go = (d) => go(d == null ? cur : cur + d);
  content.__reveal = (el) => { const r = el.getBoundingClientRect(), c = clip.getBoundingClientRect(); const off = Math.floor((r.left - c.left) / step()); if (off) go(cur + off); };
  clip.onwheel = (e) => { if (Math.abs(e.deltaY) < 30 && Math.abs(e.deltaX) < 30) return; e.preventDefault(); const now = Date.now(); if (now - (clip.__t || 0) < 450) return; clip.__t = now; go(cur + ((e.deltaX || e.deltaY) > 0 ? 1 : -1)); };
  requestAnimationFrame(() => { go(0); nav.scrollIntoView({ block: 'end' }); });
  if (!window.__gzhPageKeys) {
    window.__gzhPageKeys = true;
    document.addEventListener('keydown', (e) => {
      const c = document.querySelector('.gzh-learn-body[data-layout="one"], .gzh-learn-body[data-layout="two"]');
      if (!c?.__go || !c.isConnected || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
      if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); c.__go(1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); c.__go(-1); }
    });
    window.addEventListener('resize', () => { const c = document.querySelector('.gzh-learn-body[data-layout="one"], .gzh-learn-body[data-layout="two"]'); if (c?.isConnected) applyLayout(c, c.dataset.layout); });
  }
}

// ---------- 划线：加粗 / 下划线 / 高亮，存在 学习划线.json，不改原文件 ----------
const ANN = '学习划线.json';
const loadAnns = async (p) => (await Promise.resolve(p.readJSON(p.p(ANN))).catch(() => null)) || {};
function wrapIn(b, s, e, cls) {
  const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); const nodes = []; let pos = 0;
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { nodes.push({ n, s: pos }); pos += n.nodeValue.length; }
  for (const { n, s: ns } of nodes) {
    const ne = ns + n.nodeValue.length; const a = Math.max(s, ns), z = Math.min(e, ne);
    if (a >= z) continue;
    let mid = n; if (a > ns) mid = mid.splitText(a - ns); if (z - a < mid.nodeValue.length) mid.splitText(z - a);
    const sp = document.createElement('span'); sp.className = 'gzh-ann ' + cls; mid.before(sp); sp.append(mid);
  }
}
function findAnn(text, a) { if (!a.t) return -1; const i = a.pre ? text.indexOf(a.pre + a.t) : -1; return i >= 0 ? i + a.pre.length : text.indexOf(a.t); }
const HL_COLORS = [['yellow', '黄', 'rgba(255,208,0,.5)'], ['green', '绿', 'rgba(70,200,110,.38)'], ['blue', '蓝', 'rgba(80,160,255,.35)'], ['pink', '粉', 'rgba(255,110,165,.38)'], ['purple', '紫', 'rgba(165,110,255,.35)'], ['orange', '橙', 'rgba(255,150,40,.42)']];
const UL_COLORS = [['red', '红', '#e5484d'], ['blue', '蓝', '#3e7bfa'], ['green', '绿', '#2f9e5b'], ['orange', '橙', '#f08c00'], ['purple', '紫', '#8e4ec6'], ['ink', '黑', 'currentColor']];
const annCls = (a) => 'is-' + a.k + (a.c ? ' c-' + a.c : '') + (a.w ? ' w-' + a.w : '');
function applyAnnsTo(b, anns) { const text = b.textContent; for (const a of anns) { const s = findAnn(text, a); if (s >= 0) wrapIn(b, s, s + a.t.length, annCls(a)); } }
function selParts(content, r) {
  const out = [];
  for (const b of leafBlocks(content)) {
    if (!r.intersectsNode(b) || !b.getClientRects().length) continue;
    const t = b.textContent; let s = 0, e = t.length;
    if (b.contains(r.startContainer)) { const q = document.createRange(); q.selectNodeContents(b); q.setEnd(r.startContainer, r.startOffset); s = q.toString().length; }
    if (b.contains(r.endContainer)) { const q = document.createRange(); q.selectNodeContents(b); q.setEnd(r.endContainer, r.endOffset); e = q.toString().length; }
    if (e > s && t.slice(s, e).trim()) out.push({ b, s, e });
  }
  return out;
}
function setupAnnBar(p, content, key) {
  // 只清掉已经不在页面上的旧工具条（重复渲染时不能把新页面的删掉）
  document.querySelectorAll('.gzh-annbar').forEach((n) => { if (!n.__content?.isConnected || n.__content === content) n.remove(); });
  const bar = document.body.createDiv({ cls: 'gzh-annbar' });
  bar.__content = content;
  let range = null;
  const hide = () => { bar.removeClass('is-on'); range = null; };
  const save = async (fn) => { const all = await loadAnns(p); all[key] = fn(all[key] || []); if (!all[key].length) delete all[key]; content.__anns = all[key] || []; await p.writeText(p.p(ANN), JSON.stringify(all)); };
  const mark = async (k, opt = {}) => {
    if (!range) return;
    const pr = ttsPrefs();
    const c = k === 'h' ? (opt.c || pr.annH || 'yellow') : k === 'u' ? (opt.c || pr.annU || 'red') : '';
    const w = k === 'u' ? (opt.w ?? pr.annW ?? '') : '';
    if (k === 'h') ttsSave({ annH: c });
    if (k === 'u') ttsSave({ annU: c, annW: w });
    const parts = selParts(content, range);
    const add = parts.map(({ b, s, e }) => { const t = b.textContent; return { t: t.slice(s, e), pre: t.slice(Math.max(0, s - 12), s), k, ...(c ? { c } : {}), ...(w ? { w } : {}), at: Date.now() }; });
    parts.forEach(({ b, s, e }) => wrapIn(b, s, e, annCls({ k, c, w })));
    await save((L) => [...L, ...add]);
    window.getSelection()?.removeAllRanges(); hide();
  };
  const clear = async () => {
    if (!range) return;
    const parts = selParts(content, range);
    await save((L) => L.filter((a) => !parts.some(({ b, s, e }) => { const i = findAnn(b.textContent, a); return i >= 0 && i < e && i + a.t.length > s; })));
    for (const { b } of parts) { b.querySelectorAll('.gzh-ann').forEach((sp) => sp.replaceWith(...sp.childNodes)); b.normalize(); applyAnnsTo(b, content.__anns || []); }
    window.getSelection()?.removeAllRanges(); hide();
  };
  const btn = (parent, t, fn, c = '', title = '') => { const b = parent.createEl('button', { text: t, cls: c }); if (title) b.title = title; b.onmousedown = (e) => e.preventDefault(); b.onclick = fn; return b; };
  const r1 = bar.createDiv({ cls: 'gzh-annbar-row' });
  btn(r1, 'B', () => mark('b'), 'is-b', '加粗 ⌘B');
  r1.createSpan({ cls: 'gzh-annbar-sep' });
  r1.createSpan({ cls: 'gzh-annbar-lab', text: '高亮' });
  for (const [k, l, col] of HL_COLORS) { const b = btn(r1, '', () => mark('h', { c: k }), 'gzh-dot', l + '色高亮'); b.style.background = col; }
  r1.createSpan({ cls: 'gzh-annbar-sep' });
  btn(r1, '🔊 读这段', () => { window.__gzhTts?.readSel?.(); hide(); });
  btn(r1, '清除', clear, '', '去掉选中部分的加粗、划线、高亮');
  const r2 = bar.createDiv({ cls: 'gzh-annbar-row' });
  r2.createSpan({ cls: 'gzh-annbar-lab', text: '划线' });
  for (const [k, l, col] of UL_COLORS) { const b = btn(r2, 'U', () => mark('u', { c: k, w: '' }), 'gzh-ul', l + '色直线'); b.style.textDecorationColor = col; b.style.color = col === 'currentColor' ? '' : col; }
  r2.createSpan({ cls: 'gzh-annbar-sep' });
  for (const [k, l, col] of UL_COLORS.slice(0, 3)) { const b = btn(r2, '~', () => mark('u', { c: k, w: 'wavy' }), 'gzh-ul is-wavy', l + '色波浪线'); b.style.textDecorationColor = col; b.style.color = col; }
  const onUp = () => setTimeout(() => {
    if (!content.isConnected) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return hide();
    const r = s.getRangeAt(0);
    if (!content.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== content) return hide();
    range = r.cloneRange();
    const rc = r.getBoundingClientRect();
    bar.addClass('is-on');
    bar.style.top = (rc.top - bar.offsetHeight - 10 > 8 ? rc.top - bar.offsetHeight - 10 : rc.bottom + 10) + 'px';
    bar.style.left = Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, rc.left + rc.width / 2 - bar.offsetWidth / 2)) + 'px';
  }, 10);
  // 快捷键：选中后 ⌘B 加粗、⌘U 下划线、⌘E 高亮
  const onKey = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const k = { b: 'b', u: 'u', e: 'h' }[e.key.toLowerCase()];
    if (!k) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !content.contains(s.getRangeAt(0).commonAncestorContainer)) return;
    e.preventDefault(); e.stopPropagation();
    range = s.getRangeAt(0).cloneRange(); mark(k);
  };
  const away = (e) => { if (!bar.contains(e.target)) hide(); };
  const cleanup = () => { bar.remove(); document.removeEventListener('mousedown', away2, true); document.removeEventListener('mouseup', up2, true); document.removeEventListener('keydown', key2, true); };
  const alive = (fn) => (e) => { if (!content.isConnected) return cleanup(); fn(e); };
  const away2 = alive(away), up2 = alive(onUp), key2 = alive(onKey);
  document.addEventListener('mousedown', away2, true);
  document.addEventListener('mouseup', up2, true);
  document.addEventListener('keydown', key2, true);
}


/** 工作台是先在后台画好再整页替换的：要量尺寸、找外层面板的事，等真正挂到页面上再做 */
function whenAttached(el, fn, tries = 0) { if (el.isConnected) return fn(); if (tries > 120) return; requestAnimationFrame(() => whenAttached(el, fn, tries + 1)); }
function makePop(wrap, btn, pop) {
  btn.onclick = (e) => { e.stopPropagation(); const open = !wrap.hasClass('is-open'); document.querySelectorAll('.gzh-pop-wrap.is-open').forEach((n) => n.removeClass('is-open')); wrap.toggleClass('is-open', open); };
  const away = (e) => { if (!wrap.isConnected) return document.removeEventListener('mousedown', away, true); if (!wrap.contains(e.target)) wrap.removeClass('is-open'); };
  document.addEventListener('mousedown', away, true);
}
// ---------- 排版：背景、纸纹、字体、字号、行距、页宽（仿微信读书） ----------
const BGS = [['auto', '跟随主题', '', ''], ['white', '白', '#ffffff', '#1f1f1f'], ['paper', '米黄', '#f6efdf', '#3a3227'], ['kraft', '牛皮纸', '#e7d9bd', '#3b3022'], ['green', '护眼绿', '#cfe6d0', '#22342a'], ['gray', '浅灰', '#ebebe8', '#2a2a2a'], ['pink', '淡粉', '#f6e7e4', '#3d2b2b'], ['night', '夜间', '#1c1c1e', '#a9a9ad'], ['ink', '墨蓝', '#16202c', '#a7b3c2']];
const FONTS = [
  ['serif', '宋体', '"Songti SC","Noto Serif SC",serif'],
  ['noto', '思源宋体', '"Noto Serif SC","Source Han Serif SC",serif', 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&display=swap'],
  ['wenkai', '霞鹜文楷', '"LXGW WenKai Screen","LXGW WenKai","Kaiti SC",serif', 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaigbscreen.css'],
  ['kai', '楷体', '"Kaiti SC","STKaiti",serif'],
  ['fangsong', '仿宋', '"STFangsong","FangSong",serif'],
  ['pingfang', '苹方', '"PingFang SC",-apple-system,sans-serif'],
  ['yuan', '圆体', '"Yuanti SC","PingFang SC",sans-serif'],
  ['lanting', '兰亭黑', '"Lantinghei SC","PingFang SC",sans-serif'],
];
const WIDTHS = [['narrow', '窄', '48%', 34], ['mid', '适中', '62%', 42], ['wide', '宽', '76%', 50], ['xwide', '很宽', '88%', 64], ['full', '满屏', '100%', 0]];
const TEX = (dark) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='${dark ? '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .07 0' : '0 0 0 0 .42  0 0 0 0 .34  0 0 0 0 .22  0 0 0 .16 0'}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
function applyLook(root0, lk) {
  const bg = BGS.find((b) => b[0] === lk.bg) || BGS[0];
  // 整个工作台面板一起换底色（含顶部模块栏），离开阅读页自动恢复
  const root = root0.closest('.view-content') || root0;
  const st = root.style;
  if (root !== root0 && !root0.__lookWatch) {
    root0.__lookWatch = new MutationObserver(() => { if (!root0.isConnected) { clearLook(root); root0.__lookWatch.disconnect(); } });
    root0.__lookWatch.observe(root, { childList: true, subtree: true });
  }
  for (const v of ['--background-primary', '--background-secondary', '--background-primary-alt', '--text-normal', '--text-muted', '--text-faint', '--background-modifier-border', '--rd-surface']) st.removeProperty(v);
  st.background = ''; st.color = '';
  const dark = bg[0] === 'night' || bg[0] === 'ink';
  if (bg[2]) {
    const [, , b, f] = bg;
    st.setProperty('--background-primary', b);
    st.setProperty('--background-primary-alt', `color-mix(in srgb, ${b} 94%, ${f})`);
    st.setProperty('--background-secondary', `color-mix(in srgb, ${b} 92%, ${f})`);
    st.setProperty('--text-normal', f);
    st.setProperty('--text-muted', `color-mix(in srgb, ${f} 68%, ${b})`);
    st.setProperty('--text-faint', `color-mix(in srgb, ${f} 48%, ${b})`);
    st.setProperty('--background-modifier-border', `color-mix(in srgb, ${f} 16%, ${b})`);
    st.color = f;
  }
  const surface = (bg[2] || 'var(--background-primary)') + (lk.tex ? ', ' + TEX(dark) : '');
  st.setProperty('--rd-surface', lk.tex ? `${TEX(dark)} ${bg[2] || 'var(--background-primary)'}` : (bg[2] || 'var(--background-primary)'));
  void surface;
  st.background = 'var(--rd-surface)'; st.backgroundAttachment = 'fixed';
  const font = FONTS.find((x) => x[0] === lk.font) || FONTS[0];
  if (font[3] && !document.getElementById('gzh-font-' + font[0])) { const l = document.createElement('link'); l.id = 'gzh-font-' + font[0]; l.rel = 'stylesheet'; l.href = font[3]; document.head.appendChild(l); }
  st.setProperty('--rd-font', font[2]);
  st.setProperty('--rd-size', (lk.size || 18) + 'px');
  st.setProperty('--rd-lh', String(lk.lh || 1.9));
  const W = WIDTHS.find((w) => w[0] === lk.width) || WIDTHS[2];
  st.setProperty('--rd-w', W[2]);
  // 滚动模式一行字不宜太长：按字号算，约 W[3] 个字一行，居中
  st.setProperty('--rd-cap', W[3] ? `calc(${lk.size || 18}px * ${W[3]})` : '100%');
}
function clearLook(root) {
  for (const v of ['--background-primary', '--background-secondary', '--background-primary-alt', '--text-normal', '--text-muted', '--text-faint', '--background-modifier-border', '--rd-surface', '--rd-font', '--rd-size', '--rd-lh', '--rd-w']) root.style.removeProperty(v);
  root.style.background = ''; root.style.backgroundAttachment = ''; root.style.color = '';
}
function mountLook(bar, root, content) {
  const wrap = bar.createDiv({ cls: 'gzh-pop-wrap' });
  const btn = wrap.createEl('button', { text: 'Aa 排版', cls: 'gzh-look-btn' });
  const pop = wrap.createDiv({ cls: 'gzh-pop is-look' });
  makePop(wrap, btn, pop);
  const get = () => ({ bg: 'auto', font: 'serif', size: 18, lh: 1.9, width: 'wide', tex: false, ...(ttsPrefs().look || {}) });
  const set = (patch) => { const lk = { ...get(), ...patch }; ttsSave({ look: lk }); applyLook(root, lk); draw(); setTimeout(() => content.__go?.(0), 60); };
  const draw = () => {
    pop.empty();
    const lk = get();
    const r = (label) => { const d = pop.createDiv({ cls: 'gzh-pop-row' }); d.createSpan({ cls: 'gzh-pop-label', text: label }); return d; };
    const bgRow = r('背景');
    for (const [k, l, b, f] of BGS) {
      const s = bgRow.createEl('button', { cls: 'gzh-swatch' + (lk.bg === k ? ' is-on' : ''), attr: { title: l } });
      if (b) { s.style.background = b; s.style.color = f; s.setText('文'); } else s.setText('自动');
      s.onclick = () => set({ bg: k });
    }
    const tx = r('纸纹');
    for (const [v, l] of [[false, '无'], [true, '纸质纹理']]) { const b = tx.createEl('button', { text: l, cls: 'gzh-chipbtn' + (!!lk.tex === v ? ' is-on' : '') }); b.onclick = () => set({ tex: v }); }
    const fr = r('字体');
    for (const [k, l, fam] of FONTS) { const b = fr.createEl('button', { text: l, cls: 'gzh-chipbtn' + (lk.font === k ? ' is-on' : '') }); b.style.fontFamily = fam; b.onclick = () => set({ font: k }); }
    const sz = r('字号');
    sz.createEl('button', { text: 'A−', cls: 'gzh-chipbtn' }).onclick = () => set({ size: Math.max(13, lk.size - 1) });
    sz.createSpan({ cls: 'gzh-pop-val', text: lk.size + '' });
    sz.createEl('button', { text: 'A+', cls: 'gzh-chipbtn' }).onclick = () => set({ size: Math.min(30, lk.size + 1) });
    const lr = r('行距');
    for (const [v, l] of [[1.6, '紧'], [1.9, '适中'], [2.2, '松'], [2.5, '很松']]) { const b = lr.createEl('button', { text: l, cls: 'gzh-chipbtn' + (lk.lh === v ? ' is-on' : '') }); b.onclick = () => set({ lh: v }); }
    const wr = r('页宽');
    for (const [k, l] of WIDTHS) { const b = wr.createEl('button', { text: l, cls: 'gzh-chipbtn' + (lk.width === k ? ' is-on' : '') }); b.onclick = () => set({ width: k }); }
    const fn = FONTS.find((x) => x[0] === lk.font);
    if (fn?.[3]) pop.createDiv({ cls: 'gzh-tts-tip', text: '这个字体第一次用要联网下载，稍等几秒就会换上。' });
  };
  whenAttached(root, () => applyLook(root, get()));
  draw();
}

/** 阅读页工具条：中英视图 + 版式 + 朗读 + 划线 */
async function mountTools(p, row, content, key, onEnd) {
  PL = p;
  const prefs = ttsPrefs();
  const blocks = leafBlocks(content);
  for (const b of blocks) b.dataset.lang = langOf(b.textContent);
  const nEn = blocks.filter((b) => b.dataset.lang === 'en').length, nZh = blocks.filter((b) => b.dataset.lang === 'zh').length;
  const needTr = nEn >= 3 && nZh < nEn * 0.3;
  const bilingual = nEn >= 3 && nZh >= 3 && !needTr;
  content.__anns = (await loadAnns(p))[key] || [];
  for (const b of blocks) applyAnnsTo(b, content.__anns);
  const tools = row.createDiv({ cls: 'gzh-view' });
  if (needTr || bilingual) {
    const seg = tools.createDiv({ cls: 'gzh-seg' });
    const msg = tools.createSpan({ cls: 'gzh-tts-prog' });
    const setView = async (v) => {
      content.dataset.view = v; ttsSave({ view: v });
      seg.querySelectorAll('button').forEach((b) => b.toggleClass('is-on', b.dataset.v === v));
      content.__go?.(0);
      if (needTr && v !== 'en' && !content.__trStarted) {
        content.__trStarted = true;
        msg.setText('正在翻译…');
        const r = await translateBlocks(p, content, key, (d, t) => { msg.setText(d < t ? `正在翻译 ${d}/${t} 段` : ''); content.__go?.(0); });
        msg.setText(r.failed ? `有 ${r.total - r.done} 段没翻出来，切一下视图会重试` : '');
        if (r.failed) content.__trStarted = false;
      }
    };
    for (const [v, l] of [['bi', '对照'], ['zh', '中文'], ['en', '英文']]) { const b = seg.createEl('button', { text: l }); b.dataset.v = v; b.onclick = () => setView(v); }
    setView(prefs.view || 'bi');
  }
  const lay = tools.createDiv({ cls: 'gzh-seg' });
  const setLayout = (m) => { ttsSave({ layout: m }); lay.querySelectorAll('button').forEach((b) => b.toggleClass('is-on', b.dataset.v === m)); applyLayout(content, m); };
  for (const [v, l] of [['scroll', '滚动'], ['one', '单页'], ['two', '双页']]) { const b = lay.createEl('button', { text: l }); b.dataset.v = v; b.onclick = () => setLayout(v); }
  const root = row.closest('.gzh-learn') || row.parentElement;
  mountLook(tools, root, content);
  await mountReader(tools, content, onEnd);
  if (!content.isConnected) return;
  tools.createSpan({ cls: 'gzh-tts-tip is-inline', text: '选中文字弹出 加粗 / 下划线 / 高亮（⌘B ⌘U ⌘E）' });
  setupAnnBar(p, content, key);
  // 顶部返回栏也是吸顶的：工具条贴在它下面，不叠在一起
  whenAttached(row, () => {
  const topBar = row.closest('.gzh-learn')?.querySelector('.gzh-learn-bar');
  // 工作台顶部的模块栏也是吸顶的：返回栏贴在它下面，工具条再贴在返回栏下面
  const vc = root.closest('.view-content');
  const hdr = vc && (vc.querySelector(':scope > .gzh-top') || [...vc.children].find((c) => c !== root && !c.contains(root) && getComputedStyle(c).position === 'sticky'));
  const off = hdr ? hdr.offsetHeight : 0;
  if (topBar && getComputedStyle(topBar).position === 'sticky') { topBar.style.top = off + 'px'; row.style.top = off + topBar.offsetHeight + 'px'; }
  });
  whenAttached(content, () => setLayout(prefs.layout || 'scroll'));
}

// ---------- 书架：EPUB / PDF，和乔木 Reader 共用封面与进度 ----------
const BOOK_EXT = ['epub', 'pdf', 'mobi', 'azw3'];
function readerData(p) {
  const fs = require('fs'), path = require('path');
  const base = p.app.vault.adapter.getBasePath();
  const dir = path.join(base, p.app.vault.configDir, 'plugins', 'qiaomu-reader');
  let covers = {}, progress = {};
  try { covers = JSON.parse(fs.readFileSync(path.join(dir, 'thumb-cache.json'), 'utf8')).cache || {}; } catch (e) {}
  try { const r = JSON.parse(fs.readFileSync(path.join(base, 'reading-progress.json'), 'utf8')); progress = r.progress || r; } catch (e) {}
  return { covers, progress };
}
function scanBooks(p) {
  const { covers, progress } = readerData(p);
  return p.app.vault.getFiles().filter((f) => BOOK_EXT.includes(String(f.extension).toLowerCase()) && /^(Books|学习)\//.test(f.path) && !/_reader-rescue/.test(f.path)).map((f) => {
    const pr = progress[f.path] || {};
    return { f, path: f.path, book: true, ext: f.extension.toLowerCase(), title: f.basename, col: '书架', src: '', vid: '', cover: covers[f.path] || '', author: f.parent?.name && f.parent.name !== 'Books' ? f.parent.name : '', desc: '', hints: [], fmTags: [], added: pr.lastRead || f.stat.ctime, year: new Date(f.stat.ctime).getFullYear(), minutes: 0, pct: Number(pr.percent) || 0 };
  });
}
/** 解 EPUB：用系统自带的 unzip 读目录和章节，不装任何东西 */
const unzipCache = new Map();
function unzipRead(abs, inner) {
  return new Promise((res, rej) => require('child_process').execFile('/usr/bin/unzip', ['-p', abs, inner], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (e, out) => e ? rej(e) : res(out.toString('utf8'))));
}
async function epubSpine(abs) {
  if (unzipCache.has(abs)) return unzipCache.get(abs);
  const container = await unzipRead(abs, 'META-INF/container.xml');
  const opfPath = (container.match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error('读不出这本书的目录');
  const opf = new DOMParser().parseFromString(await unzipRead(abs, opfPath), 'application/xml');
  const dir = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
  const items = {};
  for (const it of opf.querySelectorAll('manifest > item')) items[it.getAttribute('id')] = { href: decodeURIComponent(it.getAttribute('href')), type: it.getAttribute('media-type'), props: it.getAttribute('properties') || '' };
  const spine = [...opf.querySelectorAll('spine > itemref')].map((r) => items[r.getAttribute('idref')]).filter((x) => x && /html/.test(x.type)).map((x) => dir + x.href);
  // 章节名：优先 nav.xhtml，其次 toc.ncx
  const titles = {};
  try {
    const nav = Object.values(items).find((x) => /nav/.test(x.props));
    if (nav) { const d = new DOMParser().parseFromString(await unzipRead(abs, dir + nav.href), 'text/html'); for (const a of d.querySelectorAll('nav a[href]')) titles[dir + decodeURIComponent(a.getAttribute('href')).split('#')[0]] ||= a.textContent.trim(); }
    else { const ncx = Object.values(items).find((x) => /ncx/.test(x.type)); if (ncx) { const d = new DOMParser().parseFromString(await unzipRead(abs, dir + ncx.href), 'application/xml'); for (const np of d.querySelectorAll('navPoint')) { const src = np.querySelector('content')?.getAttribute('src'); const t = np.querySelector('navLabel text')?.textContent; if (src && t) titles[dir + decodeURIComponent(src).split('#')[0]] ||= t.trim(); } } }
  } catch (e) {}
  const out = spine.map((href, i) => ({ href, title: titles[href] || '' , i }));
  unzipCache.set(abs, out);
  return out;
}
async function epubChapter(abs, href) {
  const html = await unzipRead(abs, href);
  const d = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  for (const n of d.body.querySelectorAll('h1, h2, h3, h4, p, li, blockquote')) {
    if (n.querySelector('p, li, blockquote')) continue;
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (t) blocks.push({ tag: /^H/.test(n.tagName) ? n.tagName.toLowerCase() : n.tagName === 'BLOCKQUOTE' ? 'blockquote' : 'p', text: t });
  }
  if (!blocks.length) { const t = d.body.textContent.trim(); if (t) t.split(/\n{2,}/).forEach((x) => blocks.push({ tag: 'p', text: x.trim() })); }
  return blocks;
}

async function renderBook(view, p, el, x, state) {
  const st = view.learnState;
  el.addClass('is-reading');
  const bar = el.createDiv({ cls: 'gzh-learn-bar' });
  bar.createEl('button', { text: '← 返回书架' }).onclick = () => { ttsStop(); st.open = ''; st.chapter = null; view.render(); };
  const right = bar.createDiv({ cls: 'gzh-learn-bar-r' });
  right.createEl('button', { text: '用乔木 Reader 打开', cls: 'mod-cta' }).onclick = () => { ttsStop(); p.app.workspace.getLeaf('tab').openFile(x.f); };
  const art = el.createDiv({ cls: 'gzh-learn-article' });
  if (x.ext !== 'epub') {
    const hd = art.createDiv({ cls: 'gzh-book-head' });
    if (x.cover) hd.createEl('img', { attr: { src: x.cover } });
    const info = hd.createDiv(); info.createEl('h1', { text: x.title }); info.createDiv({ cls: 'gzh-learn-meta', text: (x.pct ? `乔木 Reader 读到 ${x.pct}% · ` : '') + x.ext.toUpperCase() });
    info.createEl('p', { text: 'PDF 等格式请用乔木 Reader 打开阅读和划线。朗读目前支持 EPUB。' });
    return;
  }
  const abs = require('path').join(p.app.vault.adapter.getBasePath(), x.path);
  let spine;
  try { spine = await epubSpine(abs); } catch (e) { art.createEl('p', { text: '读不出这本书：' + (e.message || e) }); return; }
  const rec = state.items[x.path] || {};
  if (st.chapter == null) st.chapter = rec.chapter || 0;
  if (st.chapter == null || st.chapter < 0) st.chapter = 0;
  const hd = art.createDiv({ cls: 'gzh-book-head' });
  if (x.cover) hd.createEl('img', { attr: { src: x.cover } });
  const info = hd.createDiv();
  info.createEl('h1', { text: x.title });
  info.createDiv({ cls: 'gzh-learn-meta', text: `${spine.length} 章` + (x.pct ? ` · 乔木 Reader 读到 ${x.pct}%` : '') + (rec.chapter != null ? ` · 这里听到第 ${rec.chapter + 1} 章` : '') });
  const sel = info.createEl('select', { cls: 'gzh-book-toc' });
  spine.forEach((c, i) => sel.createEl('option', { value: String(i), text: `${i + 1}. ${c.title || '第 ' + (i + 1) + ' 部分'}` }));
  sel.value = String(st.chapter);
  sel.onchange = () => { ttsStop(); st.chapter = Number(sel.value); view.render(); };
  const ttsBar = art.createDiv({ cls: 'gzh-tts-row' });
  const content = art.createDiv({ cls: 'gzh-learn-body gzh-book-body' });
  const blocks = await epubChapter(abs, spine[st.chapter].href);
  for (const b of blocks) content.createEl(b.tag === 'blockquote' ? 'blockquote' : b.tag, { text: b.text });
  if (!blocks.length) content.createEl('p', { text: '（这一章没有文字，可能是插图页）' });
  // 记住听到哪一章
  const fresh = await loadState(p); fresh.items[x.path] = { ...(fresh.items[x.path] || {}), chapter: st.chapter, status: '在读', at: Date.now() }; await saveState(p, fresh);
  const nav = art.createDiv({ cls: 'gzh-learn-next' });
  const go = (k) => { ttsStop(); st.chapter = k; view.render(); };
  if (st.chapter > 0) { const d = nav.createDiv({ cls: 'gzh-learn-nextcard' }); d.createDiv({ cls: 'gzh-learn-kicker', text: '← 上一章' }); d.createDiv({ text: spine[st.chapter - 1].title || '' }); d.onclick = () => go(st.chapter - 1); } else nav.createDiv();
  if (st.chapter < spine.length - 1) { const d = nav.createDiv({ cls: 'gzh-learn-nextcard' }); d.createDiv({ cls: 'gzh-learn-kicker', text: '下一章 →' }); d.createDiv({ text: spine[st.chapter + 1].title || '' }); d.onclick = () => go(st.chapter + 1); }
  // 一章读完自动接下一章
  await mountTools(p, ttsBar, content, x.path + '#' + st.chapter, () => { if (st.chapter < spine.length - 1) { st.chapter++; st.autoplay = true; view.render(); } });
  if (st.autoplay) { st.autoplay = false; setTimeout(() => window.__gzhTts?.playAll?.(), 300); }
}

function install(p, obsidian, h) { api = obsidian; H = h || {}; }

const EXTRA_CSS = `
.gzh-learn-card{position:relative;}
.gzh-learn-carddel{position:absolute;top:6px;right:6px;z-index:2;font-size:11px;padding:2px 8px;opacity:0;transition:opacity .15s;background:var(--background-primary)!important;}
.gzh-learn-card:hover .gzh-learn-carddel{opacity:.9;}
.gzh-learn-carddel.is-armed,.gzh-learn-del.is-armed{opacity:1;background:var(--text-error)!important;color:#fff!important;}
.gzh-learn-del{color:var(--text-error);}

.gzh-tts-row{position:sticky;top:0;z-index:5;margin:10px 0 14px;}
.gzh-tts{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);box-shadow:0 2px 8px rgba(0,0,0,.06);}
.gzh-tts button,.gzh-tts select{font-size:12px;height:28px;padding:0 10px;}
.gzh-tts-prog{font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;}
.gzh-tts-tip{flex-basis:100%;font-size:11px;color:var(--text-faint);}
::highlight(gzh-tts){background-color:rgba(255,200,0,.5);color:inherit;}
.gzh-tts-block{background:rgba(255,200,0,.09);border-radius:6px;box-shadow:-8px 0 0 rgba(255,200,0,.09),8px 0 0 rgba(255,200,0,.09);}
.gzh-book-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:22px 18px;margin-top:14px;}
.gzh-book{cursor:pointer;}
.gzh-book-cv{aspect-ratio:2/3;border-radius:4px 8px 8px 4px;overflow:hidden;background:hsl(var(--learn-hue,30) 30% 88%);box-shadow:0 6px 16px rgba(0,0,0,.18),inset 4px 0 0 rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;padding:10px;text-align:center;color:#3f3f46;transition:transform .15s;}
.gzh-book:hover .gzh-book-cv{transform:translateY(-3px);}
.gzh-book-cv img{width:100%;height:100%;object-fit:cover;}
.gzh-book-t{margin-top:8px;font-size:13px;font-weight:600;line-height:1.35;}
.gzh-book-m{font-size:11px;color:var(--text-muted);}
.gzh-book-pg{height:3px;border-radius:2px;background:var(--background-modifier-border);margin-top:6px;overflow:hidden;}
.gzh-book-pg>i{display:block;height:100%;background:var(--interactive-accent);}
.gzh-book-head{display:flex;gap:22px;align-items:flex-start;margin-bottom:8px;}
.gzh-book-head img{width:120px;border-radius:4px 8px 8px 4px;box-shadow:0 6px 16px rgba(0,0,0,.18);}
.gzh-book-head h1{margin-top:0;}
.gzh-book-toc{max-width:100%;margin-top:8px;}
.gzh-book-body{font-size:17px;line-height:1.9;}
.gzh-book-body p{text-indent:2em;margin:0 0 .8em;}

.gzh-tts-row{display:flex;flex-direction:column;gap:6px;background:var(--background-primary);padding:6px 0;}
.gzh-view{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.gzh-seg{display:inline-flex;border:1px solid var(--background-modifier-border);border-radius:8px;overflow:hidden;}
.gzh-seg button{border:0!important;border-radius:0!important;box-shadow:none!important;height:26px;padding:0 12px;font-size:12px;background:var(--background-primary)!important;}
.gzh-seg button.is-on{background:var(--interactive-accent)!important;color:var(--text-on-accent)!important;}
.gzh-tts-tip.is-inline{flex-basis:auto;}
.gzh-learn-body[data-view="zh"] [data-lang="en"]{display:none!important;}
.gzh-learn-body[data-view="en"] [data-lang="zh"]{display:none!important;}
.gzh-learn-body[data-view="bi"] .gzh-tr{color:var(--text-normal);border-left:3px solid hsl(var(--learn-hue,210) 60% 60%);padding-left:10px;margin-top:-.3em;}
.gzh-learn-body[data-view="bi"] [data-lang="en"][data-tr]{color:var(--text-muted);}
.gzh-pageclip{overflow:hidden;position:relative;}

.gzh-learn-body[data-layout="one"],.gzh-learn-body[data-layout="two"]{column-fill:auto;column-gap:56px;transition:transform .25s ease;position:relative;}
.gzh-learn-body[data-layout="one"]{column-count:1;}
.gzh-learn-body[data-layout="two"]{column-count:2;column-rule:1px solid var(--background-modifier-border);}
.gzh-learn-body[data-layout="one"] img,.gzh-learn-body[data-layout="two"] img,.gzh-learn-body[data-layout] iframe{max-height:70vh;max-width:100%;break-inside:avoid;}
.gzh-learn-body[data-layout="one"] pre,.gzh-learn-body[data-layout="two"] pre{white-space:pre-wrap;break-inside:avoid;}
.gzh-pagenav{display:flex;justify-content:center;align-items:center;gap:16px;margin:10px 0 18px;}
.gzh-ann.is-b{font-weight:700;}
.gzh-ann.is-u{text-decoration:underline;text-decoration-color:var(--interactive-accent);text-decoration-thickness:2px;text-underline-offset:3px;}
.gzh-ann.is-h{border-radius:3px;}

.gzh-learn.is-reading{max-width:none!important;min-height:calc(100vh - 90px);padding:0 20px;}
.view-content:has(> .gzh-learn.is-reading) > .gzh-top{background:var(--rd-surface,var(--background-primary))!important;background-attachment:fixed!important;z-index:5;}
.gzh-learn.is-reading .gzh-learn-bar,.gzh-learn.is-reading .gzh-tts-row{background:var(--rd-surface,var(--background-primary));background-attachment:fixed;}
.gzh-learn.is-reading .gzh-learn-bar{max-width:none;margin:0 -20px;padding-left:max(20px,calc((100% - var(--rd-col,76%)) / 2 + 20px));padding-right:max(20px,calc((100% - var(--rd-col,76%)) / 2 + 20px));}
.gzh-learn.is-reading{--rd-col:var(--rd-w,76%);}
.gzh-learn.is-reading:has(.gzh-learn-body[data-layout="scroll"]){--rd-col:min(var(--rd-w,76%),var(--rd-cap,900px));}
.gzh-learn.is-reading .gzh-learn-article{max-width:var(--rd-col)!important;margin-top:14px;margin-left:auto!important;margin-right:auto!important;}
.gzh-learn-body[data-layout="scroll"] img{display:block;margin-left:auto;margin-right:auto;}
.gzh-learn.is-reading .gzh-learn-body,.gzh-learn.is-reading .gzh-learn-body.gzh-book-body{font-family:var(--rd-font,var(--learn-serif));font-size:var(--rd-size,18px);line-height:var(--rd-lh,1.9);}
.gzh-learn.is-reading .gzh-learn-video,.gzh-learn.is-reading .gzh-learn-cover{max-width:min(100%,1000px);margin-left:auto;margin-right:auto;display:block;}
.gzh-learn.is-reading .gzh-learn-article h1{font-family:var(--rd-font,var(--learn-serif));}
.gzh-tts-row{padding:8px 0;border-bottom:1px solid var(--background-modifier-border);}
.gzh-pop-wrap{position:relative;display:inline-flex;align-items:center;gap:2px;}
.gzh-pop{display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:20;min-width:300px;padding:12px 14px;border-radius:12px;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);box-shadow:0 10px 30px rgba(0,0,0,.18);flex-direction:column;gap:10px;}
.gzh-pop.is-look{left:0;right:auto;width:440px;}
.gzh-pop-wrap.is-open .gzh-pop{display:flex;}
.gzh-pop-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.gzh-pop-label{width:40px;flex-shrink:0;font-size:12px;color:var(--text-muted);}
.gzh-pop-val{min-width:28px;text-align:center;font-size:13px;}
.gzh-pop select{height:28px;font-size:12px;flex:1;}
.gzh-pop button{height:28px;padding:0 10px;font-size:12px;}
.gzh-chipbtn.is-on{background:var(--interactive-accent)!important;color:var(--text-on-accent)!important;}
.gzh-swatch{width:36px;height:36px!important;padding:0!important;border-radius:50%!important;font-size:12px!important;border:1px solid rgba(0,0,0,.12)!important;box-shadow:none!important;}
.gzh-swatch.is-on{outline:2px solid var(--interactive-accent);outline-offset:2px;}
.gzh-view > button,.gzh-pop-wrap > button{height:26px;font-size:12px;padding:0 12px;}
.gzh-tts-stop{display:none;}
.gzh-pop-wrap.is-playing .gzh-tts-stop{display:inline-flex;}
.gzh-tts-main{min-width:76px;font-variant-numeric:tabular-nums;}
.gzh-tts-caret{padding:0 8px!important;}
.gzh-tts{background:none;border:0;box-shadow:none;padding:0;}
.gzh-learn.is-reading .gzh-learn-article,.gzh-learn.is-reading .gzh-learn-article *{-webkit-user-select:text!important;user-select:text!important;}
.gzh-learn.is-reading .gzh-learn-body{cursor:text;}
.gzh-learn.is-reading .gzh-learn-article ::selection{background:rgba(40,120,255,.32)!important;color:inherit;}
.gzh-learn.is-reading .gzh-learn-article button,.gzh-learn.is-reading .gzh-learn-article select{-webkit-user-select:none!important;user-select:none!important;}
.gzh-annbar{position:fixed;z-index:9999;display:none;gap:2px;padding:4px;border-radius:10px;background:var(--background-primary);border:1px solid var(--background-modifier-border);box-shadow:0 6px 20px rgba(0,0,0,.2);}
.gzh-annbar.is-on{display:flex;}
.gzh-annbar{flex-direction:column;gap:4px;padding:6px 8px!important;}
.gzh-annbar-row{display:flex;align-items:center;gap:4px;}
.gzh-annbar-lab{font-size:11px;color:var(--text-muted);margin:0 2px 0 4px;}
.gzh-annbar-sep{width:1px;height:18px;background:var(--background-modifier-border);margin:0 4px;}
.gzh-annbar button.gzh-dot{width:20px;height:20px!important;min-width:20px;padding:0!important;border-radius:50%!important;border:1px solid rgba(0,0,0,.12)!important;}
.gzh-annbar button.gzh-ul{width:26px;padding:0!important;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;font-weight:700;background:transparent!important;}
.gzh-annbar button.gzh-ul.is-wavy{text-decoration-style:wavy;}
.gzh-ann.is-h{background:rgba(255,208,0,.5);}
.gzh-ann.is-h.c-yellow{background:rgba(255,208,0,.5);}
.gzh-ann.is-h.c-green{background:rgba(70,200,110,.38);}
.gzh-ann.is-h.c-blue{background:rgba(80,160,255,.35);}
.gzh-ann.is-h.c-pink{background:rgba(255,110,165,.38);}
.gzh-ann.is-h.c-purple{background:rgba(165,110,255,.35);}
.gzh-ann.is-h.c-orange{background:rgba(255,150,40,.42);}
.gzh-ann.is-u.c-red{text-decoration-color:#e5484d;}
.gzh-ann.is-u.c-blue{text-decoration-color:#3e7bfa;}
.gzh-ann.is-u.c-green{text-decoration-color:#2f9e5b;}
.gzh-ann.is-u.c-orange{text-decoration-color:#f08c00;}
.gzh-ann.is-u.c-purple{text-decoration-color:#8e4ec6;}
.gzh-ann.is-u.c-ink{text-decoration-color:currentColor;}
.gzh-ann.is-u.w-wavy{text-decoration-style:wavy;text-decoration-thickness:1.5px;}

.gzh-annbar button{height:28px;padding:0 10px;font-size:12px;box-shadow:none!important;}
.gzh-annbar button.is-b{font-weight:800;}
.gzh-annbar button.is-u{text-decoration:underline;}
.gzh-annbar button.is-h{background:rgba(120,200,255,.35)!important;}
`;
function ensureStyle() { let st = document.getElementById('gzh-learn-extra'); if (!st) { st = document.createElement('style'); st.id = 'gzh-learn-extra'; document.head.appendChild(st); } if (st.textContent !== EXTRA_CSS) st.textContent = EXTRA_CSS; }

async function render(view, p, el) {
  ttsStop();
  ensureStyle();
  el.addClass('gzh-learn');
  const st = view.learnState ||= { col: '全部', topic: '', tag: '', year: '', status: '全部', q: '', sort: 'new', shown: PAGE, open: '' };
  const state = await loadState(p);
  const notes = scan(p);
  autoClassify(view, p, notes, state);
  let books = [];
  try { books = scanBooks(p); } catch (e) {}
  const all = [...notes, ...books];
  if (st.open) {
    const it = all.find((x) => x.path === st.open);
    if (it?.book) return renderBook(view, p, el, it, state);
    if (it) return renderReader(view, p, el, it, state, notes);
    st.open = '';
  }
  renderFront(view, p, el, all, state);
}

// ---------- 首页 ----------
function renderFront(view, p, el, all, state) {
  const st = view.learnState;
  const week = Date.now() - 7 * 864e5;
  const head = el.createDiv({ cls: 'gzh-learn-mast' });
  const tl = head.createDiv({ cls: 'gzh-learn-masthead' });
  tl.createEl('div', { cls: 'gzh-learn-kicker', text: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) });
  tl.createEl('h1', { text: '学习' });
  const unread = all.filter((x) => status(state, x.path) === '未读').length;
  const pending = all.filter((x) => !topicOf(state, x)).length;
  tl.createDiv({ cls: 'gzh-learn-sub', text: `本地知识库 · ${all.length} 篇 · 未读 ${unread} · 本周新增 ${all.filter((x) => x.added > week).length}` + (p.busy.has('learn-ai') ? ` · AI 正在分类（还剩 ${pending} 篇）` : pending ? ` · ${pending} 篇待分类` : '') });
  const tools = head.createDiv({ cls: 'gzh-learn-tools' });
  const q = tools.createEl('input', { type: 'search', value: st.q, attr: { placeholder: '搜标题、标签、作者' } });
  q.oninput = () => { st.q = q.value; st.shown = PAGE; draw(); };
  const rnd = tools.createEl('button', { text: '随机读一篇' });
  rnd.onclick = () => { const pool = filtered().filter((x) => status(state, x.path) !== '读完'); const x = pool[Math.floor(Math.random() * pool.length)]; if (x) { st.open = x.path; view.render(); } };
  // 存进学习：贴链接
  // 乔木剪藏最近一次存进来是什么时候：太久没动静多半是 Chrome 没加载扩展
  {
    const clips = all.filter((x) => x.path.startsWith(CLIP + '/'));
    const last = clips.reduce((m, x) => Math.max(m, x.f.stat.ctime), 0);
    const hrs = last ? (Date.now() - last) / 36e5 : Infinity;
    const line = el.createDiv({ cls: 'gzh-learn-sub', text: last ? `乔木剪藏：最近一次存进来是 ${hrs < 1 ? '刚刚' : hrs < 48 ? Math.round(hrs) + ' 小时前' : Math.round(hrs / 24) + ' 天前'}（存到 学习/剪藏）` : '乔木剪藏还没存进来过（存到 学习/剪藏）' });
    if (hrs > 72) line.appendText('。点了剪藏没反应的话，先看 Chrome 扩展页里乔木剪藏还在不在；重启 Chrome 后消失过一次，原因是重复的扩展记录，10 月 16 日已修好。');
  }
  const add = el.createDiv({ cls: 'gzh-learn-add' });
  const inp = add.createEl('input', { type: 'text', attr: { placeholder: '贴 YouTube、文章或 X 链接，存进学习（YouTube 会带上字幕全文）' } });
  const sb = add.createEl('button', { text: '存进学习', cls: 'mod-cta' });
  sb.onclick = async () => {
    const u = inp.value.trim(); if (!u) return;
    sb.disabled = true; sb.setText('正在读取…');
    try { const f = await saveLink(p, u); inp.value = ''; new api.Notice('已存进学习：' + f.basename); view.render(); }
    catch (e) { new api.Notice('没存成：' + (e.message || e), 8000); }
    finally { sb.disabled = false; sb.setText('存进学习'); }
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') sb.onclick(); };

  // 栏目：学习下所有一级文件夹（空的也显示，方便你往里放）
  const cols = {};
  for (const x of all) cols[x.col] = (cols[x.col] || 0) + 1;
  const folders = (p.app.vault.getAbstractFileByPath(ROOT)?.children || []).filter((c) => c.children && c.name !== '剪藏').map((c) => c.name);
  const names = [...new Set(['书架', 'YouTube', '公众号', '文章', ...Object.keys(cols), ...folders])];
  const nav = el.createDiv({ cls: 'gzh-learn-nav' });
  for (const c of ['全部', ...names]) {
    const n = c === '全部' ? all.length : cols[c] || 0;
    const b = nav.createEl('button', { text: `${c} ${n}`, cls: 'gzh-learn-tab' + (st.col === c ? ' is-on' : '') });
    if (c !== '全部') b.style.setProperty('--learn-hue', hue(c));
    b.onclick = () => { Object.assign(st, { col: c, topic: '', tag: '', year: '', shown: PAGE }); view.render(); };
  }
  const inCol = all.filter((x) => st.col === '全部' || x.col === st.col);
  // 主题（AI 分类）
  const topics = {};
  for (const x of inCol) { const t = topicOf(state, x); if (t) topics[t] = (topics[t] || 0) + 1; }
  if (Object.keys(topics).length) {
    const tn = el.createDiv({ cls: 'gzh-learn-nav is-small' });
    tn.createSpan({ cls: 'gzh-learn-label', text: '主题' });
    for (const [t, n] of [['', inCol.length], ...Object.entries(topics).sort((a, b) => b[1] - a[1])]) {
      const b = tn.createEl('button', { text: (t || '全部') + ' ' + n, cls: 'gzh-learn-chip' + (st.topic === t ? ' is-on' : '') });
      b.onclick = () => { st.topic = t; st.shown = PAGE; view.render(); };
    }
  }
  // 年份（内容多的栏目才有用）
  const years = [...new Set(inCol.map((x) => x.year))].sort((a, b) => b - a);
  const fn = el.createDiv({ cls: 'gzh-learn-nav is-small' });
  if (years.length > 1 && inCol.length > 40) {
    fn.createSpan({ cls: 'gzh-learn-label', text: '年份' });
    for (const y of ['', ...years]) {
      const b = fn.createEl('button', { text: y || '全部', cls: 'gzh-learn-chip' + (String(st.year) === String(y) ? ' is-on' : '') });
      b.onclick = () => { st.year = y; st.shown = PAGE; view.render(); };
    }
    fn.createSpan({ cls: 'gzh-learn-sep' });
  }
  for (const s of ['全部', '未读', '在读', '读完', '收藏']) {
    const b = fn.createEl('button', { text: s, cls: 'gzh-learn-chip' + (st.status === s ? ' is-on' : '') });
    b.onclick = () => { st.status = s; st.shown = PAGE; view.render(); };
  }
  for (const [k, l] of [['new', '新的在前'], ['old', '早的在前']]) {
    const b = fn.createEl('button', { text: l, cls: 'gzh-learn-chip' + (st.sort === k ? ' is-on' : '') });
    b.onclick = () => { st.sort = k; view.render(); };
  }
  // 标签云
  const tagCount = {};
  for (const x of inCol) for (const t of tagsOf(state, x)) tagCount[t] = (tagCount[t] || 0) + 1;
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 30);
  if (topTags.length) {
    const tg = el.createDiv({ cls: 'gzh-learn-tags' });
    tg.createSpan({ cls: 'gzh-learn-label', text: '标签' });
    for (const [t, n] of topTags) {
      const b = tg.createEl('button', { text: '#' + t + ' ' + n, cls: 'gzh-learn-tag' + (st.tag === t ? ' is-on' : '') });
      b.onclick = () => { st.tag = st.tag === t ? '' : t; st.shown = PAGE; view.render(); };
    }
  }

  const filtered = () => {
    const kw = st.q.trim().toLowerCase().replace(/^#/, '');
    const L = inCol.filter((x) => (!st.topic || topicOf(state, x) === st.topic)
      && (!st.year || x.year === Number(st.year))
      && (!st.tag || tagsOf(state, x).includes(st.tag))
      && (st.status === '全部' || (st.status === '收藏' ? rec(state, x.path).star : status(state, x.path) === st.status))
      && (!kw || (x.title + ' ' + x.author + ' ' + x.src + ' ' + x.col + ' ' + topicOf(state, x) + ' ' + tagsOf(state, x).join(' ') + ' ' + x.hints.join(' ')).toLowerCase().includes(kw)));
    return L.sort((a, b) => st.sort === 'old' ? a.added - b.added : b.added - a.added);
  };
  const body = el.createDiv();
  const draw = () => {
    body.empty();
    const L = filtered();
    if (!L.length) { body.createDiv({ cls: 'gzh-empty', text: inCol.length ? '没有符合条件的笔记。' : st.col === '书架' ? '书架还是空的。把 EPUB / PDF 放进 Books 文件夹（乔木 Reader 的书库）就会出现在这里。' : st.col === '全部' ? '学习目录还是空的。' : `「${st.col}」还没有内容。往 学习/${st.col === 'YouTube' || st.col === '文章' || st.col === '公众号' ? '剪藏' : st.col} 放笔记，或在上面贴链接存进来。` }); return; }
    if (st.col === '全部' && !st.topic && !st.tag && st.status === '全部' && !st.q) {
      const reading = all.filter((x) => status(state, x.path) === '在读').sort((a, b) => (rec(state, b.path).at || 0) - (rec(state, a.path).at || 0)).slice(0, 4);
      if (reading.length) {
        const sec = body.createDiv({ cls: 'gzh-learn-section' });
        sec.createEl('h3', { text: '继续阅读' });
        const row = sec.createDiv({ cls: 'gzh-learn-row' });
        for (const x of reading) card(view, p, row, x, state, 'is-mini');
      }
    }
    if (st.col === '书架') {
      const shelf = body.createDiv({ cls: 'gzh-book-shelf' });
      for (const x of L.slice(0, st.shown)) bookCard(view, shelf, x, state, p);
      if (L.length > st.shown) { const more = body.createEl('button', { text: `再看 ${Math.min(PAGE, L.length - st.shown)} 本`, cls: 'gzh-learn-more' }); more.onclick = () => { st.shown += PAGE; draw(); }; }
      return;
    }
    const [hero, ...rest] = L;
    const front = body.createDiv({ cls: 'gzh-learn-front' });
    card(view, p, front, hero, state, 'is-hero');
    const side = front.createDiv({ cls: 'gzh-learn-side' });
    for (const x of rest.slice(0, 4)) card(view, p, side, x, state, 'is-side');
    const grid = body.createDiv({ cls: 'gzh-learn-grid' });
    for (const x of rest.slice(4, st.shown)) card(view, p, grid, x, state, '');
    if (L.length > st.shown + 1) {
      const more = body.createEl('button', { text: `再看 ${Math.min(PAGE, L.length - st.shown - 1)} 篇（共 ${L.length} 篇）`, cls: 'gzh-learn-more' });
      more.onclick = () => { st.shown += PAGE; draw(); };
    }
  };
  draw();
}

function bookCard(view, parent, x, state, p) {
  const st = view.learnState;
  const b = parent.createDiv({ cls: 'gzh-book' });
  b.style.setProperty('--learn-hue', hue(x.title));
  const cv = b.createDiv({ cls: 'gzh-book-cv' });
  if (x.cover) cv.createEl('img', { attr: { src: x.cover, loading: 'lazy' } }); else cv.setText(x.title);
  b.createDiv({ cls: 'gzh-book-t', text: x.title });
  const r = rec(state, x.path);
  b.createDiv({ cls: 'gzh-book-m', text: [x.author, x.ext.toUpperCase(), x.pct ? `读到 ${x.pct}%` : r.chapter != null ? `第 ${r.chapter + 1} 章` : '未读'].filter(Boolean).join(' · ') });
  if (x.pct) b.createDiv({ cls: 'gzh-book-pg' }).createEl('i').style.width = Math.min(100, x.pct) + '%';
  b.onclick = () => { st.open = x.path; st.chapter = null; view.render(); };
  b.addClass('gzh-learn-card');
  const d = b.createEl('button', { text: '删除', cls: 'gzh-learn-carddel' });
  d.title = '移到废纸篓';
  confirmBtn(d, '删除', async () => { await removeNote(p, x); new api.Notice('已删除：' + x.title + '（在废纸篓里能找回）'); view.render(); });
  return b;
}
function card(view, p, parent, x, state, cls) {
  if (x.book) return bookCard(view, parent, x, state, p);
  const st = view.learnState;
  const c = parent.createDiv({ cls: 'gzh-learn-card ' + cls });
  c.style.setProperty('--learn-hue', hue(x.col));
  const s = status(state, x.path);
  if (s === '读完') c.addClass('is-done');
  const fig = cls === 'is-side' ? null : c.createDiv({ cls: 'gzh-learn-fig' + (x.vid ? ' is-video' : '') });
  const setCover = (u) => { if (!fig || !u) return false; const im = fig.createEl('img', { attr: { src: u, referrerpolicy: 'no-referrer', loading: 'lazy' } }); im.onerror = () => { im.remove(); typeCover(); }; return true; };
  const typeCover = () => { if (fig && !fig.querySelector('img')) { fig.addClass('is-type'); fig.setText(x.title.slice(0, 1)); } };
  const kick = c.createDiv({ cls: 'gzh-learn-kicker' });
  kick.createSpan({ text: topicOf(state, x) || x.col });
  if (s !== '未读') kick.createSpan({ cls: 'gzh-learn-st', text: s });
  if (rec(state, x.path).star) kick.createSpan({ text: '★' });
  c.createEl(cls === 'is-hero' ? 'h2' : 'h4', { text: x.title });
  const ex = c.createDiv({ cls: 'gzh-learn-excerpt' });
  c.createDiv({ cls: 'gzh-learn-meta', text: [x.author || (x.vid ? '' : domain(x.src)), fmtDate(x.added), `约 ${x.minutes} 分钟`].filter(Boolean).join(' · ') });
  const tg = tagsOf(state, x).slice(0, 3);
  if (tg.length && cls !== 'is-mini') { const t = c.createDiv({ cls: 'gzh-learn-cardtags' }); for (const s2 of tg) t.createSpan({ text: '#' + s2 }); }
  const dg = state.digest[x.path];
  const hadCover = setCover(x.cover);
  if (cls !== 'is-mini') {
    if (dg?.oneLine) ex.setText(dg.oneLine);
    else if (x.desc) ex.setText(x.desc.slice(0, cls === 'is-hero' ? 160 : 90));
    else if (x.hints.length) ex.setText(x.hints.slice(0, 3).join(' / '));
  }
  if ((cls !== 'is-mini' && !ex.textContent) || (fig && !hadCover)) {
    p.app.vault.cachedRead(x.f).then((t) => {
      if (cls !== 'is-mini' && !ex.textContent) { const pl = plain(t); ex.setText(pl.slice(0, cls === 'is-hero' ? 180 : 90) + (pl.length > 90 ? '…' : '')); }
      if (fig && !hadCover && !setCover(firstImage(t))) typeCover();
    }).catch(() => typeCover());
  }
  if (cls !== 'is-mini') {
    const d = c.createEl('button', { text: '删除', cls: 'gzh-learn-carddel' });
    d.title = '移到废纸篓';
    confirmBtn(d, '删除', async () => { await removeNote(p, x); new api.Notice('已删除：' + x.title); view.render(); });
  }
  c.onclick = () => { st.open = x.path; view.render(); };
  return c;
}

/** 删除：移到系统废纸篓（不是永久删除，Finder 废纸篓里还能找回），同时清掉阅读状态 */
async function removeNote(p, x) {
  await p.app.vault.trash(x.f, true);
  const fresh = await loadState(p);
  delete fresh.items[x.path]; delete fresh.digest[x.path];
  await saveState(p, fresh);
}
/** 两次点击确认：第一次变红提示，3 秒内再点才真删 */
function confirmBtn(btn, label, fn) {
  let armed = false, timer = null;
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (!armed) { armed = true; btn.addClass('is-armed'); btn.setText('再点一次确认删除'); timer = setTimeout(() => { armed = false; btn.removeClass('is-armed'); btn.setText(label); }, 3000); return; }
    clearTimeout(timer); btn.disabled = true;
    try { await fn(); } catch (er) { new api.Notice('没删成：' + (er.message || er), 8000); btn.disabled = false; }
  };
}

async function setRec(p, state, path, patch) {
  // 先读最新的再改，避免和后台分类同时写时互相覆盖
  const fresh = await loadState(p);
  fresh.items[path] = Object.assign({}, fresh.items[path] || {}, patch, { at: Date.now() });
  await saveState(p, fresh);
  Object.assign(state, fresh);
}

// ---------- 阅读页 ----------
async function renderReader(view, p, el, x, state, all) {
  const st = view.learnState;
  if (status(state, x.path) === '未读') await setRec(p, state, x.path, { status: '在读' });
  el.addClass('is-reading');
  const bar = el.createDiv({ cls: 'gzh-learn-bar' });
  bar.createEl('button', { text: '← 返回学习' }).onclick = () => { st.open = ''; view.render(); };
  const right = bar.createDiv({ cls: 'gzh-learn-bar-r' });
  const btn = (t, fn, c = '') => { const b = right.createEl('button', { text: t, cls: c }); b.onclick = async () => { b.disabled = true; try { await fn(b); } catch (e) { new api.Notice(String(e.message || e), 8000); } finally { b.disabled = false; } }; return b; };
  const r = rec(state, x.path);
  btn(r.star ? '★ 已收藏' : '☆ 收藏', async () => { await setRec(p, state, x.path, { star: !r.star }); view.render(); });
  btn(status(state, x.path) === '读完' ? '标为在读' : '✓ 读完了', async () => { await setRec(p, state, x.path, { status: status(state, x.path) === '读完' ? '在读' : '读完' }); view.render(); }, status(state, x.path) === '读完' ? '' : 'mod-cta');
  btn('AI 导读', async (b) => { b.setText('正在读…'); await digest(p, state, x); view.render(); });
  // YouTube 剪藏没带上字幕（乔木剪藏的助手字幕出错时会这样）：工作台自己去取字幕补在文末
  if (x.vid && H.youtubeText && !/^#{1,3}\s*(Transcript|字幕|文字稿)/m.test(await p.app.vault.cachedRead(x.f))) {
    btn('补字幕', async (b) => {
      b.setText('正在取字幕…');
      const { body } = await H.youtubeText('https://www.youtube.com/watch?v=' + x.vid);
      if (!body || body.length < 200) throw new Error('这个视频没取到字幕');
      await p.app.vault.append(x.f, '\n\n## 字幕（工作台补）\n\n' + body.trim() + '\n');
      new api.Notice('字幕已补在文末');
      view.render();
    });
  }
  const text = await p.app.vault.cachedRead(x.f);
  const material = () => (x.src ? x.src + '\n\n' : '') + '《' + x.title + '》\n' + plain(text).slice(0, 20000);
  if (H.openProcessModal) btn('做成 X 帖子', async () => H.openProcessModal(p, material()));
  if (H.openLongModal) btn('写成公众号文章', async () => H.openLongModal(p, material()));
  btn('在 Obsidian 打开', async () => p.app.workspace.getLeaf('tab').openFile(x.f));
  const del = right.createEl('button', { text: '删除', cls: 'gzh-learn-del' });
  del.title = '移到废纸篓，Finder 的废纸篓里还能找回';
  confirmBtn(del, '删除', async () => {
    const same = all.filter((y) => y.col === x.col).sort((a, b) => b.added - a.added);
    const i = same.findIndex((y) => y.path === x.path);
    const next = same[i + 1] || same[i - 1];
    await removeNote(p, x);
    new api.Notice('已删除：' + x.title + '（在废纸篓里能找回）');
    st.open = ''; void next;
    view.render();
  });
  if (x.src && /^https?:/.test(x.src)) { const a = right.createEl('a', { text: x.vid ? '在 YouTube 看 ↗' : '原文 ↗', href: x.src }); a.setAttr('target', '_blank'); }

  const art = el.createDiv({ cls: 'gzh-learn-article' });
  art.style.setProperty('--learn-hue', hue(x.col));
  if (x.vid && x.col === 'YouTube') {
    art.createEl('iframe', { cls: 'gzh-learn-video', attr: { src: `https://www.youtube.com/embed/${x.vid}?rel=0`, title: x.title, allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: '' } });
  } else if (x.cover) {
    const cv = art.createDiv({ cls: 'gzh-learn-cover' + (x.vid ? ' is-video' : '') });
    const im = cv.createEl('img', { attr: { src: x.cover.replace('hqdefault', 'maxresdefault'), referrerpolicy: 'no-referrer' } });
    im.onerror = () => { if (!im.src.includes('hqdefault') && x.vid) im.src = x.cover; else cv.remove(); };
    if (x.src) cv.onclick = () => window.open(x.src);
  }
  art.createDiv({ cls: 'gzh-learn-kicker', text: [x.col, topicOf(state, x), x.author].filter(Boolean).join(' · ') });
  art.createEl('h1', { text: x.title });
  art.createDiv({ cls: 'gzh-learn-meta', text: [x.vid ? '' : domain(x.src), fmtDate(x.added), `约 ${x.minutes} 分钟读完`].filter(Boolean).join(' · ') });

  // 主题和标签
  const tagBox = art.createDiv({ cls: 'gzh-learn-tagedit' });
  const tsel = tagBox.createEl('select');
  const pool = x.col === '曲曲' ? QUQU_TOPICS : GENERAL_TOPICS;
  const curT = topicOf(state, x);
  for (const t of ['', ...new Set([...pool, curT].filter(Boolean))]) tsel.createEl('option', { value: t, text: t || '主题：未分类' });
  tsel.value = curT;
  tsel.onchange = async () => { await setRec(p, state, x.path, { topic: tsel.value }); view.render(); };
  for (const t of tagsOf(state, x)) {
    const chip = tagBox.createSpan({ cls: 'gzh-learn-tag is-chip', text: '#' + t });
    const del = chip.createSpan({ cls: 'gzh-learn-x', text: '×' });
    del.onclick = async () => {
      const rr = rec(state, x.path);
      await setRec(p, state, x.path, { tags: (rr.tags || []).filter((y) => y !== t), hidden: [...new Set([...(rr.hidden || []), t])] });
      view.render();
    };
  }
  const known = [...new Set(all.flatMap((y) => tagsOf(state, y)))].sort();
  const dl = tagBox.createEl('datalist', { attr: { id: 'gzh-learn-tags' } });
  for (const t of known.slice(0, 300)) dl.createEl('option', { value: t });
  const ti = tagBox.createEl('input', { type: 'text', attr: { placeholder: '+ 加标签，回车', list: 'gzh-learn-tags' } });
  ti.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    const v = ti.value.trim().replace(/^#/, ''); if (!v) return;
    const rr = rec(state, x.path);
    await setRec(p, state, x.path, { tags: [...new Set([...(rr.tags || []), v])], hidden: (rr.hidden || []).filter((y) => y !== v) });
    view.render();
  };

  const dg = state.digest[x.path];
  if (dg) {
    const box = art.createDiv({ cls: 'gzh-learn-digest' });
    box.createEl('b', { text: 'AI 导读' });
    if (dg.oneLine) box.createEl('p', { text: dg.oneLine });
    if (dg.points?.length) { const ul = box.createEl('ul'); for (const t of dg.points) ul.createEl('li', { text: t }); }
    if (dg.use) box.createEl('p', { cls: 'gzh-learn-use', text: '我可以怎么用：' + dg.use });
  }
  const ttsRow = art.createDiv({ cls: 'gzh-tts-row' });
  const content = art.createDiv({ cls: 'gzh-learn-body markdown-rendered' });
  let t0 = strip(text).replace(/^\s*#\s+.+\n/, '');
  // 顶部已经放了播放器/封面，正文里那个重复的视频嵌入去掉
  if (x.vid) t0 = t0.replace(/^\s*!\[[^\]]*\]\(https?:\/\/(www\.)?(youtube\.com|youtu\.be)[^)]*\)\s*\n?/m, '');
  await api.MarkdownRenderer.render(p.app, t0.length > 250000 ? t0.slice(0, 250000) + '\n\n（太长，后面的内容请在 Obsidian 里打开看）' : t0, content, x.path, view);
  await mountTools(p, ttsRow, content, x.path);
  const same = all.filter((y) => y.col === x.col).sort((a, b) => b.added - a.added);
  const i = same.findIndex((y) => y.path === x.path);
  const nb = art.createDiv({ cls: 'gzh-learn-next' });
  for (const [lab, y] of [['← 上一篇', same[i - 1]], ['下一篇 →', same[i + 1]]]) {
    if (!y) { nb.createDiv(); continue; }
    const d = nb.createDiv({ cls: 'gzh-learn-nextcard' });
    d.createDiv({ cls: 'gzh-learn-kicker', text: lab });
    d.createDiv({ text: y.title });
    d.onclick = () => { st.open = y.path; view.render(); };
  }
}

// ---------- AI ----------
function parseJ(raw) { const s = String(raw || ''); const m = s.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : s); }
const cheap = (p) => p.settings.models.cheap || p.settings.models.translate;

async function digest(p, state, x) {
  const text = plain(await p.app.vault.cachedRead(x.f)).slice(0, 12000);
  if (text.length < 80) throw new Error('这篇正文太短，没什么可导读的');
  const raw = await p.llm.generate(cheap(p), {
    system: '用户在做 AI 方向的中文自媒体（公众号、X）。你是他的阅读助手，用中文回答，只输出 JSON。',
    prompt: '读下面这篇笔记，输出 {"oneLine":"一句话说清它讲什么（40字内）","points":["3到5个要点，每条一句话，具体，带关键数字或例子"],"use":"对 用户 做内容或工作可以怎么用（1到2句，具体）"}。\n\n' + text,
    timeoutMs: 180000, effort: 'low',
  });
  const j = parseJ(raw);
  const fresh = await loadState(p); Object.assign(state, fresh);
  state.digest[x.path] = { oneLine: String(j.oneLine || ''), points: (j.points || []).map(String).slice(0, 5), use: String(j.use || ''), at: Date.now() };
  await saveState(p, state);
}

/** 后台给还没分类的笔记打主题和标签：每批 30 篇，用最便宜的模型 */
function autoClassify(view, p, all, state) {
  if (p.busy.has('learn-ai') || p.settings.learnAutoTag === false) return;
  const todo = all.filter((x) => !rec(state, x.path).ai && !rec(state, x.path).topic);
  if (!todo.length) return;
  p.busy.add('learn-ai');
  (async () => {
    try {
      // 剪藏先分（新收进来的），曲曲这种大栏目后分
      todo.sort((a, b) => (a.col === 'YouTube' || a.col === '文章' ? 0 : 1) - (b.col === 'YouTube' || b.col === '文章' ? 0 : 1) || b.added - a.added);
      for (let i = 0; i < todo.length; i += 30) {
        const batch = todo.slice(i, i + 30);
        const groups = {};
        for (const x of batch) (groups[x.col === '曲曲' ? 'ququ' : 'gen'] ||= []).push(x);
        for (const [g, xs] of Object.entries(groups)) {
          const lines = [];
          for (const [k, x] of xs.entries()) {
            let hint = x.hints.slice(0, 6).join('；') || x.desc;
            if (!hint) { try { hint = plain(await p.app.vault.cachedRead(x.f)).slice(0, 220); } catch (e) {} }
            lines.push(`${k}｜${x.title}｜${String(hint || '').slice(0, 260)}`);
          }
          const topics = g === 'ququ' ? QUQU_TOPICS : GENERAL_TOPICS;
          const raw = await p.llm.generate(cheap(p), {
            system: '你给个人知识库的笔记分类打标签。只输出 JSON。',
            prompt: `下面每行是一篇笔记：序号｜标题｜摘要。给每篇选 1 个主题（只能从这里选：${topics.join('、')}），再给 2 到 4 个具体标签（2 到 6 个字，名词为主，比如人物、工具、概念、场景，不要和主题重复，不要太泛）。\n输出 {"items":[{"i":序号,"topic":"主题","tags":["标签"]}]}\n\n` + lines.join('\n'),
            timeoutMs: 180000, effort: 'low',
          });
          let j; try { j = parseJ(raw); } catch (e) { continue; }
          const fresh = await loadState(p);
          for (const r of j.items || []) {
            const x = xs[Number(r.i)]; if (!x) continue;
            const topic = topics.includes(r.topic) ? r.topic : '';
            fresh.items[x.path] = Object.assign({}, fresh.items[x.path] || {}, { ai: { topic, tags: (r.tags || []).map(String).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 4), at: Date.now() } });
          }
          await saveState(p, fresh);
          Object.assign(state, fresh);
        }
        p.refreshViews();
      }
    } catch (e) { console.warn('学习：自动分类失败', e); }
    finally { p.busy.delete('learn-ai'); p.refreshViews(); }
  })();
}

// ---------- 从别处存进学习 ----------
/** 存一条内容进 学习/剪藏：{title, url, text, from, tags} */
/** 同一个链接已经存过就直接返回那份笔记，不重复存 */
function findBySource(p, url) {
  const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/([?&])(utm_\w+|chksm|scene|sessionid|key|ascene|uin|devicetype|version|lang|exportkey|pass_ticket|wx_header|nettype|abtest_cookie|countrycode|clicktime|enterid|realreporttime|poc_token|from|share_source|si)=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/\/$/, '');
  const key = norm(url); if (!key) return null;
  const wx = /mp\.weixin\.qq\.com\/s\/([\w-]+)/.exec(String(url));
  const hit = scan(p).find((x) => x.src && (norm(x.src) === key || (wx && String(x.src).includes(wx[1]))));
  return hit?.f || null;
}
async function saveToLearn(p, o) {
  const app = p.app;
  if (!app.vault.getAbstractFileByPath(CLIP)) await app.vault.createFolder(CLIP).catch(() => {});
  const vid = ytId(o.url);
  const today = new Date().toISOString().slice(0, 10);
  const fm = ['---', `title: ${JSON.stringify(o.title || '未命名')}`, `source: ${JSON.stringify(o.url || '')}`, `created: ${today}`,
    o.author ? `author: ${JSON.stringify(o.author)}` : '', vid ? `image: ${JSON.stringify(ytThumb(vid))}` : o.image ? `image: ${JSON.stringify(o.image)}` : '',
    `来自: ${JSON.stringify(o.from || '工作台')}`, 'tags:', ...(o.tags || []).map((t) => `  - ${JSON.stringify(t)}`), '---', ''].filter((l) => l !== '').join('\n');
  let path = `${CLIP}/${safeName(o.title)}.md`;
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${CLIP}/${safeName(o.title)} ${n}.md`;
  return app.vault.create(path, fm + '\n# ' + (o.title || '未命名') + '\n\n' + String(o.text || '').trim() + '\n');
}

async function saveLink(p, url) {
  if (ytId(url) && H.youtubeText) {
    const { m, body } = await H.youtubeText(url);
    return saveToLearn(p, { title: m.title || url, url: m.link || url, author: String(m.show || '').replace(/^YouTube：/, ''), text: body, from: '学习·贴链接' });
  }
  if (!H.fetchMaterial) throw new Error('读取链接的功能没接上');
  const r = await H.fetchMaterial(url);
  if (!r || r.ok === false || !r.text) throw new Error('读不到这个链接的正文');
  const title = r.title || (r.text.split('\n').find((l) => l.trim()) || url).replace(/^#+\s*/, '').slice(0, 80);
  return saveToLearn(p, { title, url, text: r.text, from: '学习·贴链接', image: firstImage(r.text) });
}

module.exports = { install, render, scan, findBySource, plain, firstImage, columnOf, isNoise, saveToLearn, saveLink, ytId, QUQU_TOPICS, GENERAL_TOPICS };
