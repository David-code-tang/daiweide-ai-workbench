'use strict';
// 戴卫得AI工作台 · 浏览器 X 创作助手的本地接口（v2）
// 只监听 127.0.0.1，只接受浏览器扩展来的请求；网页本身（x.com 等）发来的请求一律拒绝。
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=51888,VERSION=2;
const EXT_ORIGIN=/^(chrome-extension|safari-web-extension|moz-extension):\/\/[a-z0-9.-]+$/i;
const MAT_FILE=p=>p.p('X','浏览器素材.json');
const PERSONA_FILE=p=>p.p('X','我的表达习惯.md');
const LOG_FILE=p=>p.p('X','浏览器助手日志.jsonl');
const clean=s=>String(s||'').replace(/[「」『』]/g,'').trim();
const isZh=s=>{const t=String(s||'');const zh=(t.match(/[一-鿿]/g)||[]).length;const en=(t.match(/[A-Za-z]{2,}/g)||[]).length;return zh>=6||zh>en;};
const short=ref=>String(ref||'').replace(/^(codex|claude):/,'');

function log(p,obj){try{fs.appendFileSync(path.resolve(p.vaultBase(),LOG_FILE(p)),JSON.stringify({at:new Date().toISOString(),...obj})+'\n');}catch(e){}}
function kit(p){const k=p.xKit;if(!k)throw Error('工作台插件版本过旧，请彻底退出并重开 Obsidian');return k;}
function str(v,name,max=20000,need=false){if(v===undefined||v===null||v===''){if(need)throw Error(name+' 必填');return '';}if(typeof v!=='string')throw Error(name+' 必须是文字');return v.slice(0,max);}
function post(a){return {url:str(a.url,'url',500),author:str(a.author,'author',60).replace(/^@?/,'@'),name:str(a.name,'name',80),text:str(a.text,'text',9000,true),quoted:str(a.quoted,'quoted',4000),followers:Number.isFinite(+a.followers)&&a.followers!==null?+a.followers:null,metrics:str(a.metrics,'metrics',200)};}
function postBlock(t){return [`作者：${t.name?t.name+' ':''}${t.author}${t.followers!=null?`（${t.followers} 粉）`:''}`,t.url?`链接：${t.url}`:'',t.metrics?`数据：${t.metrics}`:'',`正文：\n${t.text}`,t.quoted?`\n【它引用的帖子】\n${t.quoted}`:''].filter(Boolean).join('\n');}

// ---- 人设：账号定位 / 表达习惯 / 写过的内容，存在一个 Markdown 里，Obsidian 里也能直接改 ----
const SECS=[['position','账号定位'],['voice','表达习惯'],['samples','写过的内容']];
async function readPersona(p){let md='';try{md=await p.readText(PERSONA_FILE(p))||'';}catch(e){}
 const out={position:'',voice:'',samples:''};const re=/^##\s+(.+)$/gm;const heads=[];let m;while((m=re.exec(md)))heads.push({t:m[1].trim(),i:m.index,e:m.index+m[0].length});
 heads.forEach((h,k)=>{const body=md.slice(h.e,k+1<heads.length?heads[k+1].i:md.length).trim();if(/定位/.test(h.t))out.position=body;else if(/写过|样例|帖子/.test(h.t))out.samples=(out.samples?out.samples+'\n\n':'')+body;else out.voice=(out.voice?out.voice+'\n\n':'')+body;});
 if(!heads.length)out.voice=md.trim();return out;}
async function writePersona(p,a){const v={position:str(a.position,'position',4000),voice:str(a.voice,'voice',6000),samples:str(a.samples,'samples',12000)};
 await p.ensureFolder(p.p('X'));await p.writeText(PERSONA_FILE(p),SECS.map(([k,t])=>`## ${t}\n${v[k].trim()}\n`).join('\n'));return {saved:true};}
async function personaBlock(p){const v=await readPersona(p);const parts=[];
 if(v.position)parts.push('【用户 的账号定位】\n'+v.position.slice(0,2000));
 if(v.voice)parts.push('【用户 的表达习惯】\n'+v.voice.slice(0,3000));
 if(v.samples)parts.push('【用户 写过的内容，只学语气和节奏，不要照抄】\n'+v.samples.slice(0,5000));
 return parts.length?'\n\n'+parts.join('\n\n'):'';}

async function llm(p,model,system,prompt,timeoutMs,tag){
 const t0=Date.now();log(p,{step:'model-start',tag,model});
 try{const raw=await p.llm.generate(model,{system,prompt,effort:'low',timeoutMs});log(p,{step:'model-done',tag,model,seconds:Math.round((Date.now()-t0)/1000)});return kit(p).parseJSON(raw);}
 catch(e){log(p,{step:'model-failed',tag,model,seconds:Math.round((Date.now()-t0)/1000),error:String(e.message||e)});
  if(/超时/.test(String(e.message)))throw Error('模型 '+Math.round(timeoutMs/1000)+' 秒没有返回，可能 Codex 正忙或卡住了，稍后再试');throw e;}}
const items=(j,k='text')=>(j.items||[]).map(x=>({angle:clean(x.angle),text:clean(x[k]||x.text||x.reply)})).filter(x=>x.text);

async function comments(p,a){
 const t=post(a),zh=isZh(t.text),idea=str(a.idea,'idea',600);
 const prompt=`${postBlock(t)}\n\n给这条帖子写 3 条不同角度的评论，让 用户 挑一条发。\n角度依次是：补充信息（补一个具体用法、细节或数据）、表达判断（说出自己的看法）、轻松接话（自然口语，可以短）。\n语言：${zh?'原帖是中文，评论用中文':'原帖是英文，评论用英文（自然口语，不要翻译腔）'}\n只用原帖里有的事实，不编经历和数字，不要每条都用问句结尾。\n${idea?`用户 想表达的意思：${idea}\n`:''}只输出 JSON：{"items":[{"angle":"补充信息","text":"评论正文"}]}`;
 const model=a.model||p.settings.models.xReply;
 const r=items(await llm(p,model,kit(p).xReplySystem(p)+await personaBlock(p),prompt,90e3,'comments'));
 if(r.length<3)throw Error('模型只给了 '+r.length+' 条，再点一次试试');return {lang:zh?'zh':'en',items:r,model:short(model)};}

async function quotes(p,a){
 const t=post(a),mode=a.mode==='summary'?'summary':'opinion',idea=str(a.idea,'idea',1500),k=kit(p);
 const prompt=`${postBlock(t)}\n\n用户 要引用转发（Quote）这条帖子，写 3 版配文给他挑。\n${mode==='summary'?'方向：先替读者把原帖提炼清楚（讲了什么、为什么值得看），再带一句 用户 的判断。':'方向：结合 用户 的账号定位写观点型配文。'}\n三版角度依次是：一句话短评、提炼要点、观点延伸。\n${idea?`用户 自己的想法（必须围绕它写）：${idea}\n`:''}要求：用中文；配文里自然地 @${t.author.replace(/^@/,'')}；直接、像真人，不加免责声明，不写「信息来源」。\n只输出 JSON：{"items":[{"angle":"一句话短评","text":"配文"}]}`;
 const model=a.model||p.settings.models.x;
 const r=items(await llm(p,model,k.xWritingSystem(k.xWritingStyle(p))+await personaBlock(p),prompt,120e3,'quotes'));
 if(!r.length)throw Error('没有生成配文，再点一次试试');return {items:r,model:short(model)};}

async function loadMats(p){try{const j=await p.readJSON(MAT_FILE(p));return j&&Array.isArray(j.items)?j:{items:[]};}catch(e){return {items:[]};}}
async function save(p,a){
 const t=post(a),id=(t.url.match(/status\/(\d+)/)||[])[1]||crypto.randomUUID();
 const m=await loadMats(p);
 if(m.items.some(i=>i.id===id))return {id,duplicate:true,total:m.items.filter(i=>!i.used).length};
 m.items.unshift({id,...t,note:str(a.note,'note',1000),savedAt:new Date().toISOString(),used:false});
 m.items=m.items.slice(0,500);await p.ensureFolder(p.p('X'));await p.writeJSON(MAT_FILE(p),m);
 let library=false;try{const ext=p.x.libExt(),store=new ext.Store(p);if(/status\/\d+/.test(t.url)){const row={tweet_id:id,username:t.author.replace(/^@/,''),name:t.name,text:t.text,url:t.url,created_at:new Date().toISOString()};await store.import(ext.parseImport(JSON.stringify([row]),'浏览器素材.json'),{fileName:'浏览器素材-'+p.today()+'.json',raw:JSON.stringify([row])});library=true;}}catch(e){log(p,{step:'library-import-failed',error:String(e.message||e)});}
 p.refreshViews();return {id,total:m.items.filter(i=>!i.used).length,library};}
async function materials(p,a){const m=await loadMats(p);return {items:m.items.filter(i=>a.all===true||!i.used).slice(0,100).map(i=>({id:i.id,author:i.author,name:i.name,url:i.url,text:i.text.slice(0,400),note:i.note,followers:i.followers,savedAt:i.savedAt,used:i.used}))};}
async function removeMat(p,a){const m=await loadMats(p);m.items=m.items.filter(i=>i.id!==String(a.id));await p.writeJSON(MAT_FILE(p),m);return {total:m.items.filter(i=>!i.used).length};}
async function news(p,a){const f=await p.loadFeed(),q=str(a.query,'query',80).toLowerCase(),since=Date.now()-((+a.hours||48)*36e5);
 const it=(f?.items||[]).filter(i=>(!i.d||Date.parse(i.d)>since)&&(!q||JSON.stringify(i).toLowerCase().includes(q))).sort((x,y)=>(y.heat||0)-(x.heat||0)||(y.hs||0)-(x.hs||0)).slice(0,+a.limit||30);
 return {updatedAt:f?.updatedAt,items:it.map(i=>({id:i.id,title:i.t,summary:i.s,url:i.u,source:String(i.src||'').replace(/^AIHOT · /,''),date:i.d}))};}

async function original(p,a){
 const ids=(Array.isArray(a.materialIds)?a.materialIds:[]).map(String),nids=(Array.isArray(a.newsIds)?a.newsIds:[]).map(String);
 const links=(Array.isArray(a.links)?a.links:[]).map(String).filter(u=>/^https?:\/\//.test(u)).slice(0,3);
 const idea=str(a.idea,'idea',3000),lang=a.lang==='en'?'en':'zh',k=kit(p);
 const m=await loadMats(p),mats=m.items.filter(i=>ids.includes(i.id));
 const f=nids.length?await p.loadFeed():null,ns=(f?.items||[]).filter(i=>nids.includes(i.id));
 if(!mats.length&&!ns.length&&!links.length&&!idea)throw Error('至少选一条热点或素材、贴一个链接，或写一句你的想法');
 const linkTexts=[];for(const u of links){const t0=Date.now();try{const r=await Promise.race([k.fetchMaterial(p.x.http,u),new Promise((_,rej)=>setTimeout(()=>rej(Error('读取超时')),25e3))]);linkTexts.push(`【链接】${u}\n${String(r.text||'').slice(0,5000)}`);}catch(e){linkTexts.push(`【链接】${u}（没读到全文）`);}log(p,{step:'read-link',url:u,seconds:Math.round((Date.now()-t0)/1000)});}
 const material=[...linkTexts,...mats.map((x,i)=>`【素材${i+1}】${x.author} ${x.url}\n${x.text}${x.note?`\n用户 的批注：${x.note}`:''}`),...ns.map((x,i)=>`【热点${i+1}】${x.t}（${x.src}）${x.u}\n${x.s||''}`)].join('\n\n');
 const prompt=`${material?`材料：\n${material}\n\n`:''}${idea?`用户 的想法（核心观点，必须写进去）：${idea}\n\n`:''}把上面的内容写成 用户 自己的 3 条原创推文建议，不是转述某一条。三条角度依次是：明确判断（亮出观点）、可操作方法（读者看完能照做）、趋势影响（这件事接下来意味着什么）。\n要求：${lang==='en'?'用英文写':'用中文写'}；每条是可以直接发的单条推文；博主素材要用自己的话重写，不搬原句；信息不充分就写短一点，不编造事实；不加免责声明，不写「信息来源」。\n只输出 JSON：{"items":[{"angle":"明确判断","text":"推文正文"}]}`;
 const model=a.model||p.settings.models.x;
 const r=items(await llm(p,model,k.xWritingSystem(k.xWritingStyle(p))+await personaBlock(p),prompt,180e3,'original'));
 if(!r.length)throw Error('没有写出草稿，再点一次试试');return {items:r,used:mats.map(x=>x.id),model:short(model)};}

async function queue(p,a,execute){
 const day=p.today(),list=await execute(p,'x.list',{postDate:day}),h=list.versions[day].hash;
 const kind=['single','thread','article'].includes(a.kind)?a.kind:'single';
 const args={postDate:day,expectedHash:h,text:str(a.text,'text',25000,true),kind,arche:str(a.arche,'arche',40)||'浏览器助手',source:a.source&&typeof a.source==='object'?Object.fromEntries(['url','tweetUrl','author','title'].filter(k=>typeof a.source[k]==='string'&&a.source[k]).map(k=>[k,a.source[k]])):undefined,parts:kind==='thread'&&Array.isArray(a.parts)?a.parts.map(String):undefined,title:str(a.title,'title',200)||undefined};
 for(const k of Object.keys(args))if(args[k]===undefined)delete args[k];
 const r=await execute(p,'x.add',args);
 const used=(Array.isArray(a.usedMaterials)?a.usedMaterials:[]).map(String);
 if(used.length){const m=await loadMats(p);for(const i of m.items)if(used.includes(i.id))i.used=true;await p.writeJSON(MAT_FILE(p),m);}
 return {id:r.id,postDate:day};}
async function overview(p,execute){const t=await execute(p,'x.today',{});return {date:t.date,posted:t.posted,postTarget:t.postTarget,replied:t.replied,replyTarget:t.replyTarget,growth:{current:t.growth.current,goal:t.growth.goal,needPerDay:t.growth.needPerDay,daysLeft:t.growth.daysLeft},waiting:t.posts.filter(i=>i.status==='ready').length};}

const LONG=new Set(['comments','quotes','original']);

const MOBILE_HTML=`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>戴卫得助手</title>
<style>
:root{--fg:#14211b;--mut:#7d8a84;--line:#e7ece9;--soft:#f4f7f5;--ac:#1f6f4a;--mint:#d7f3e3}
@media (prefers-color-scheme:dark){:root{--fg:#e8efeb;--mut:#8e9b95;--line:#2a332f;--soft:#1b2320;--ac:#5fd39a;--mint:#1f3a2d}body{background:#0f1412}}
*{box-sizing:border-box}body{margin:0;color:var(--fg);background:#fff;font:16px/1.55 -apple-system,"PingFang SC",sans-serif;padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
h1{font-size:18px;margin:4px 0 12px}.mut{color:var(--mut);font-size:13px}
.src{background:var(--soft);border-radius:14px;padding:12px 14px;margin:10px 0;white-space:pre-wrap}.src b{display:block;margin-bottom:4px}
.row{display:flex;gap:8px;margin:10px 0}.row>*{flex:1}
button,.btn{appearance:none;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:12px;padding:11px 10px;font:inherit;font-size:15px;text-align:center;text-decoration:none;display:block}
.pri{background:var(--mint);border-color:transparent;font-weight:700}
input,textarea{width:100%;border:1px solid var(--line);border-radius:12px;padding:11px 12px;font:inherit;background:transparent;color:var(--fg)}
.card{border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0}.tag{font-size:12px;color:var(--ac);font-weight:700}
.card textarea{border:none;padding:6px 0;min-height:80px;resize:vertical}
.acts{display:flex;flex-wrap:wrap;gap:6px}.acts>*{flex:1 1 30%;padding:9px 6px;font-size:14px}
.err{color:#d9534f}.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--ac);border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}
</style></head><body>
<h1>戴卫得助手</h1>
<div id="pick"><div class="row"><input id="u" placeholder="贴 X 帖子链接"><button id="paste" style="flex:0 0 84px">粘贴</button></div><button class="pri" id="load">读取帖子</button></div>
<div id="tw"></div><div id="ops" hidden>
<textarea id="idea" rows="2" placeholder="你的想法（可选）：比如这个思路普通人也能用"></textarea>
<div class="row"><button class="pri" data-op="comments">评论灵感</button><button data-op="save">存为素材</button></div>
<div class="row"><button data-op="opinion">引用·结合我的观点</button><button data-op="summary">引用·先提炼原帖</button></div>
</div><div id="msg" class="mut"></div><div id="out"></div>
<script>
const K=new URLSearchParams(location.search).get('k');let T=null;
const $=s=>document.querySelector(s),esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(command,args){const r=await fetch('/m/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:K,command,args})});const j=await r.json().catch(()=>({}));if(r.status===202&&j.job){const t0=Date.now();while(Date.now()-t0<3e5){await new Promise(o=>setTimeout(o,2000));const s=await api('job',{id:j.job});if(s.status==='completed')return s.result;if(s.status==='failed')throw Error(s.error||'生成失败');}throw Error('等了 5 分钟还没好，电脑上的模型可能卡住了');}if(!r.ok)throw Error(j.error||('出错了 '+r.status));return j.result;}
const busy=t=>{$('#msg').className='mut';$('#msg').innerHTML='<span class="spin"></span>'+esc(t)};const fail=e=>{$('#msg').className='err';$('#msg').textContent=String(e.message||e)};const ok=t=>{$('#msg').className='mut';$('#msg').textContent=t};
async function load(u){u=(u||'').match(/https?:\\/\\/\\S+/)?.[0]||u;if(!u)return;busy('正在读帖子…');try{T=await api('tweet',{url:u});$('#tw').innerHTML='<div class="src"><b>@'+esc(T.author)+'</b>'+esc(T.text)+'</div>';$('#ops').hidden=false;$('#pick').hidden=true;ok(T.metrics||'');}catch(e){fail(e)}}
$('#load').onclick=()=>load($('#u').value.trim());
$('#paste').onclick=async()=>{try{const t=await navigator.clipboard.readText();$('#u').value=t;load(t)}catch(e){fail('读不到剪贴板，请长按输入框粘贴')}};
const post=()=>({url:T.url,author:T.author,name:'',text:T.text,metrics:T.metrics});
const replyUrl=v=>'https://x.com/intent/post?in_reply_to='+T.id+'&text='+encodeURIComponent(v);
const quoteUrl=v=>'https://x.com/intent/post?text='+encodeURIComponent(v)+'&url='+encodeURIComponent(T.url);
function cards(items,kind){$('#out').innerHTML=items.map((it,i)=>'<div class="card">'+(it.angle?'<div class="tag">'+esc(it.angle)+'</div>':'')+'<textarea data-i="'+i+'">'+esc(it.text)+'</textarea><div class="acts"><button data-a="copy">复制</button><a class="btn pri" data-a="go" href="#">'+(kind==='reply'?'去 X 回复（已填好）':'去 X 引用（已填好）')+'</a>'+(kind==='quote'?'<button data-a="queue">放进工作台待发</button>':'')+'</div></div>').join('');
 $('#out').querySelectorAll('.card').forEach(c=>{const ta=c.querySelector('textarea');
  c.querySelector('[data-a=copy]').onclick=async e=>{try{await navigator.clipboard.writeText(ta.value);e.target.textContent='已复制'}catch(er){ta.select();document.execCommand('copy');e.target.textContent='已复制'}};
  c.querySelector('[data-a=go]').onclick=e=>{e.preventDefault();navigator.clipboard?.writeText(ta.value).catch(()=>{});location.href=kind==='reply'?replyUrl(ta.value):quoteUrl(ta.value)};
  const q=c.querySelector('[data-a=queue]');if(q)q.onclick=async e=>{e.target.disabled=true;try{const r=await api('queue',{text:ta.value,kind:'single',arche:'引用转发',source:{tweetUrl:T.url,author:'@'+T.author,title:T.text.slice(0,60)}});e.target.textContent='已放进 '+r.postDate}catch(er){e.target.disabled=false;fail(er)}};});}
document.querySelectorAll('[data-op]').forEach(b=>b.onclick=async()=>{const op=b.dataset.op,idea=$('#idea').value.trim();$('#out').innerHTML='';
 try{if(op==='save'){busy('正在存…');const r=await api('save',{...post(),note:idea});ok(r.duplicate?'这条之前存过了':'已存进素材库');return;}
  if(op==='comments'){busy('正在写评论（约 20 秒）…');const r=await api('comments',{...post(),idea});ok('挑一条，改完点「去 X 回复」，到 X 里点发布');cards(r.items,'reply');return;}
  busy('正在写引用配文（约 30 秒）…');const r=await api('quotes',{...post(),mode:op,idea});ok('挑一条，改完点「去 X 引用」，到 X 里点发布');cards(r.items,'quote');}catch(e){fail(e)}});
const u0=new URLSearchParams(location.search).get('u');if(u0)load(u0);
</script></body></html>`;

function install(p,execute){
 const jobs=new Map();
 const handlers={
  ping:async()=>{const m=await loadMats(p);return {ok:true,version:VERSION,handle:p.settings.xHandle,model:short(p.settings.models.xReply),models:{comments:short(p.settings.models.xReply),writing:short(p.settings.models.x)},materials:m.items.filter(i=>!i.used).length};},
  comments:a=>comments(p,a),quotes:a=>quotes(p,a),original:a=>original(p,a),
  save:a=>save(p,a),materials:a=>materials(p,a),'materials.remove':a=>removeMat(p,a),news:a=>news(p,a),queue:a=>queue(p,a,execute),
  'persona.get':()=>readPersona(p),'persona.set':a=>writePersona(p,a),
  'voice.get':async()=>{const v=await readPersona(p);return {text:v.voice,path:PERSONA_FILE(p)};},
  job:async a=>{const j=jobs.get(String(a.id||''));if(!j)throw Error('任务找不到了（可能 Obsidian 重开过），请再点一次');return {...j,seconds:Math.round((Date.now()-j.startedAt)/1000)};},
  overview:()=>overview(p,execute),'growth.set':a=>execute(p,'growth.set',{count:a.count}),
  // X 收藏：扩展每分钟来问要不要读／取消，读完把帖子交回来（用的是 Chrome 里已登录的 X）
  'bookmarks.want':async()=>{if(!p.x?.bmWant)throw Error('工作台插件版本过旧，请重新加载 Obsidian');return p.x.bmWant();},
  'bookmarks.ingest':async a=>{if(a.items!==undefined&&!Array.isArray(a.items))throw Error('items 必须是数组');return p.x.bmIngest({items:(a.items||[]).slice(0,700),error:a.error?String(a.error).slice(0,300):'',quiet:!!a.quiet,deep:!!a.deep,complete:!!a.complete});},
  'bookmarks.list':async a=>{const x=p.x,rec=x.bmLoad(),all=Object.entries(rec.items||{}).map(([id,v])=>({id,...v})).sort((m,n)=>String(n.importedAt||'').localeCompare(String(m.importedAt||'')));const q=str(a.query,'query',80).toLowerCase();const live=a.all?all:all.filter(i=>!i.removedAt);const hit=q?live.filter(i=>(i.text+' '+i.author).toLowerCase().includes(q)):live;return {total:all.length,moved:all.filter(i=>i.removedAt).length,lastRun:rec.lastRun||'',pending:all.filter(i=>!i.removedAt).length,waiting:!!x._bmWantFetch,autoRemove:!!p.settings.xBookmarkAutoRemove,nextRemoveAt:(x._bmWantRemove&&x._bmWantRemove.length)?Date.now()+60e3:((x._bmAutoRmAt||0)+5*60e3),items:hit.slice(0,Math.min(+a.limit||60,200))};},
  'bookmarks.sync':async()=>{await p.x.importBookmarks(true);return {queued:true};},
  // 公众号草稿箱：内容工作台排好版的稿子，交给扩展用 Chrome 里登录的公众号后台存草稿
  'wechat.want':async()=>{const j=p.cwModule&&p.cwModule.wechatWant();return j?{id:j.id,title:j.title}:null;},
  'wechat.get':async a=>{const j=p.cwModule&&p.cwModule.wechatGet(String(a.id||''));if(!j)throw Error('这个推送任务找不到了');return j;},
  'wechat.done':async a=>{if(!p.cwModule)throw Error('内容工作台没加载');return p.cwModule.wechatDone({id:String(a.id||''),ok:!!a.ok,url:str(a.url,'url',600),appmsgid:str(a.appmsgid,'appmsgid',60),error:str(a.error,'error',600),cover:str(a.cover,'cover',300)});},
  'bookmarks.removed':async a=>p.x.bmRemoved({removed:Array.isArray(a.removed)?a.removed.map(String):[],failed:Array.isArray(a.failed)?a.failed.map(String):[]})};
 const send=(res,code,obj,origin)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8',...(origin?{'access-control-allow-origin':origin,'vary':'origin'}:{})});res.end(JSON.stringify(obj));};
 const server=http.createServer((req,res)=>{
  const origin=req.headers.origin||'';
  if(!EXT_ORIGIN.test(origin))return send(res,403,{error:'只接受浏览器助手扩展的请求'});
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST','access-control-allow-headers':'content-type','access-control-max-age':'600'});return res.end();}
  const u=new URL(req.url,'http://127.0.0.1');
  if(req.method==='GET'&&u.pathname.startsWith('/job/')){const j=jobs.get(decodeURIComponent(u.pathname.slice(5)));return send(res,j?200:404,j?{...j,seconds:Math.round((Date.now()-j.startedAt)/1000)}:{error:'任务不存在'},origin);}
  if(req.method!=='POST'||u.pathname!=='/cmd')return send(res,404,{error:'未知接口'},origin);
  if(!/application\/json/.test(req.headers['content-type']||''))return send(res,415,{error:'需要 JSON'},origin);
  let body='';req.on('data',c=>{body+=c;if(body.length>4e6)req.destroy();});
  req.on('end',async()=>{let q;try{q=JSON.parse(body||'{}');}catch(e){return send(res,400,{error:'JSON 格式不对'},origin);}
   const h=handlers[q.command];if(!h)return send(res,400,{error:'未知命令：'+q.command},origin);
   const args=q.args&&typeof q.args==='object'&&!Array.isArray(q.args)?q.args:{};
   if(LONG.has(q.command)){const id=crypto.randomUUID(),t0=Date.now();jobs.set(id,{id,status:'running',startedAt:t0});
    for(const [k,v] of jobs)if(Date.now()-v.startedAt>36e5)jobs.delete(k);
    log(p,{step:'job-start',command:q.command,job:id});
    h(args).then(r=>{jobs.set(id,{id,status:'completed',result:r,startedAt:t0});log(p,{step:'job-done',command:q.command,job:id,seconds:Math.round((Date.now()-t0)/1000)});},
     e=>{jobs.set(id,{id,status:'failed',error:String(e.message||e),startedAt:t0});log(p,{step:'job-failed',command:q.command,job:id,seconds:Math.round((Date.now()-t0)/1000),error:String(e.message||e)});});
    return send(res,202,{job:id},origin);}
   try{send(res,200,{result:await h(args)},origin);}catch(e){send(res,400,{error:String(e.message||e)},origin);}
  });
 });
 server.on('error',e=>{console.error('浏览器助手接口启动失败（端口 '+PORT+'）',e);log(p,{step:'server-error',error:String(e.message||e)});});
 server.listen(PORT,'127.0.0.1',()=>log(p,{step:'server-start',version:VERSION}));
 p.register(()=>server.close());

 // ---- 手机助手：在 iPhone 的 X App 里点「分享 → 戴卫得助手」（快捷指令），手机浏览器里出评论/引用/存素材 ----
 // 只接受局域网 / Tailscale 地址，且必须带密钥；密钥存在电脑的 ~/.gzh-studio/mobile-token（使用说明里会写出含密钥的地址）。
 try{
  const os=require('os'),MPORT=51889;
  const tokFile=path.join(os.homedir(),'.gzh-studio','mobile-token');
  let TOKEN='';try{TOKEN=fs.readFileSync(tokFile,'utf8').trim();}catch(e){}
  if(!/^[a-f0-9]{24,}$/.test(TOKEN)){TOKEN=crypto.randomBytes(12).toString('hex');try{fs.mkdirSync(path.dirname(tokFile),{recursive:true,mode:0o700});fs.writeFileSync(tokFile,TOKEN,{mode:0o600});}catch(e){}}
  const privateIp=ip=>{ip=String(ip||'').replace(/^::ffff:/,'');return ip==='127.0.0.1'||ip==='::1'||/^10\./.test(ip)||/^192\.168\./.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)||/^f[cd]/i.test(ip)||/^fe80/i.test(ip);};
  const MOBILE_OK=new Set(['comments','quotes','save','queue','job']);
  const idOf=u=>(String(u||'').match(/status(?:es)?\/(\d+)/)||[])[1]||'';
  const hosts=()=>{const out=[];const hn=os.hostname().replace(/\.local$/,'');out.push(hn+'.local');for(const list of Object.values(os.networkInterfaces()))for(const i of list||[])if(i.family==='IPv4'&&!i.internal&&privateIp(i.address))out.push(i.address);return [...new Set(out)];};
  const msend=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj));};
  const mserver=http.createServer((req,res)=>{
   if(!privateIp(req.socket.remoteAddress))return msend(res,403,{error:'只接受家里网络或 Tailscale 里的设备'});
   const u=new URL(req.url,'http://x');
   if(req.method==='GET'&&(u.pathname==='/m'||u.pathname==='/m/')){
    if(u.searchParams.get('k')!==TOKEN){res.writeHead(403,{'content-type':'text/plain; charset=utf-8'});return res.end('密钥不对：请用「手机助手使用说明」里的地址');}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(MOBILE_HTML);
   }
   if(req.method!=='POST'||u.pathname!=='/m/api')return msend(res,404,{error:'未知接口'});
   let body='';req.on('data',c=>{body+=c;if(body.length>2e5)req.destroy();});
   req.on('end',async()=>{
    let q;try{q=JSON.parse(body||'{}');}catch(e){return msend(res,400,{error:'JSON 格式不对'});}
    if(q.k!==TOKEN)return msend(res,403,{error:'密钥不对'});
    const args=q.args&&typeof q.args==='object'?q.args:{};
    try{
     if(q.command==='tweet'){const id=idOf(args.url);if(!id)throw Error('这不是一条 X 帖子的链接');const t=await kit(p).fetchTweet(p.x.http,id);if(!t||!t.text)throw Error('读不到这条帖子（可能是私密账号）');return msend(res,200,{result:{id,url:'https://x.com/'+String(t.author||'').replace(/^@/,'')+'/status/'+id,author:String(t.author||'').replace(/^@/,''),text:t.text,metrics:t.metrics||''}});}
     if(!MOBILE_OK.has(q.command))return msend(res,400,{error:'手机上不支持这个操作'});
     const h=handlers[q.command];
     if(LONG.has(q.command)){const id=crypto.randomUUID(),t0=Date.now();jobs.set(id,{id,status:'running',startedAt:t0});log(p,{step:'job-start',command:q.command,job:id,from:'mobile'});
      h(args).then(r=>jobs.set(id,{id,status:'completed',result:r,startedAt:t0}),e=>jobs.set(id,{id,status:'failed',error:String(e.message||e),startedAt:t0}));return msend(res,202,{job:id});}
     msend(res,200,{result:await h(args)});
    }catch(e){msend(res,400,{error:String(e.message||e)});}
   });
  });
  mserver.on('error',e=>log(p,{step:'mobile-error',error:String(e.message||e)}));
  mserver.listen(MPORT,'0.0.0.0',()=>{
   log(p,{step:'mobile-start'});
   const urls=hosts().map(h=>`http://${h}:${MPORT}/m?k=${TOKEN}`);
   const guide=`# 手机助手使用说明\n\n在 iPhone 的 X App 里刷到想评论 / 引用 / 存素材的帖子：点「分享」→「戴卫得助手」，手机浏览器会打开助手页面，出 3 条评论或引用建议，一键复制，或者直接跳回 X 并把文字填好（发布还是你自己点）。\n\n> 手机要和电脑在同一个 Wi-Fi（或者都装了 Tailscale），电脑上的 Obsidian 要开着。\n\n## 你的助手地址（含密钥，别发给别人）\n\n${urls.map(x=>'- '+x).join('\n')}\n\n第一个（.local）在家里 Wi-Fi 下最稳；连不上就试后面的 IP。\n\n## 一次性设置：做一个「分享到快捷指令」（2 分钟）\n\n1. iPhone 打开「快捷指令」App → 右上角「+」新建。\n2. 点顶部名字，改成「戴卫得助手」；点底部「ⓘ」→ 打开「在共享表单中显示」，类型只勾「URL」和「文本」。\n3. 添加操作「URL」，内容填：\n   \`${urls[0]}&u=\`，然后在末尾插入变量「快捷指令输入」。\n4. 再添加操作「打开 URL」（它会自动用上一步的 URL）。\n5. 完成。以后在 X App 里点帖子的「分享」→ 往右滑到「更多」→ 选「戴卫得助手」。\n\n也可以不用快捷指令：手机 Safari 打开上面的地址，点「分享 → 添加到主屏幕」，以后复制帖子链接后打开它，页面会自动读剪贴板里的链接。\n`;
   try{fs.writeFileSync(path.resolve(p.vaultBase(),p.p('手机助手使用说明.md')),guide);}catch(e){}
  });
  p.register(()=>mserver.close());
 }catch(e){log(p,{step:'mobile-error',error:String(e.message||e)});}

 return {port:PORT,server,handlers};
}
module.exports={install,PORT,isZh,EXT_ORIGIN,readPersona};
