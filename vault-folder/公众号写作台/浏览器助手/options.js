const api = (command, args) => new Promise((res, rej) => chrome.runtime.sendMessage({ type: 'dwd', command, args }, (r) => r && r.ok ? res(r.result) : rej(new Error((r && r.error) || '没有响应'))));
const $ = (id) => document.getElementById(id), msg = $('msg');
const show = (t, cls) => { msg.className = 'msg ' + (cls || ''); msg.textContent = t; };
api('ping').then(r => { $('model').textContent = '● ' + r.model; }, () => { $('model').textContent = '● 工作台未连接'; $('model').style.color = '#d9534f'; });
api('persona.get').then(v => { $('position').value = v.position || ''; $('voice').value = v.voice || ''; $('samples').value = v.samples || ''; show(''); }, e => show(e.message, 'err'));
$('save').onclick = async () => { try { await api('persona.set', { position: $('position').value, voice: $('voice').value, samples: $('samples').value }); show('已保存，评论、引用、原创都会参考它', 'ok'); } catch (e) { show(e.message, 'err'); } };
