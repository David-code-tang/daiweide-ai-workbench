const $ = (id) => document.getElementById(id);
const api = (command, args) => new Promise((res, rej) => chrome.runtime.sendMessage({ type: 'dwd', command, args }, (r) => r && r.ok ? res(r.result) : rej(new Error((r && r.error) || '没有响应'))));
function show(o) {
  $('p').textContent = `${o.posted}/${o.postTarget}`; $('r').textContent = `${o.replied}/${o.replyTarget}`;
  $('f').textContent = o.growth.current ?? '–'; $('fs').textContent = o.growth.needPerDay ? `粉丝 · 日需+${o.growth.needPerDay}` : '粉丝';
  $('msg').textContent = `待发 ${o.waiting} 条 · 离 ${o.growth.goal} 粉还剩 ${o.growth.daysLeft} 天`;
}
api('ping').then(r => $('model').textContent = '● ' + r.model, () => { $('model').textContent = '● 工作台未连接'; $('model').style.color = '#d9534f'; });
api('overview').then(show, (e) => { $('msg').className = 'msg err'; $('msg').textContent = e.message; });
$('save').onclick = async () => { const n = parseInt($('cnt').value, 10); if (!(n >= 0)) return; try { await api('growth.set', { count: n }); show(await api('overview')); $('cnt').value = ''; } catch (e) { $('msg').className = 'msg err'; $('msg').textContent = e.message; } };
$('orig').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:\/\/(mobile\.)?(x|twitter)\.com\//.test(tab.url || '')) { chrome.tabs.sendMessage(tab.id, { type: 'dwd-open-original' }); window.close(); }
  else chrome.tabs.create({ url: 'https://x.com/home' });
};
$('opt').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
