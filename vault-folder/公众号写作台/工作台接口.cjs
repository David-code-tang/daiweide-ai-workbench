'use strict';
// CLI 与插件共享业务方法，仅处理当前用户的本地请求，不开放网络端口。
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const socketDir=root=>path.join(os.tmpdir(),'david-workbench-'+process.getuid()+'-'+hash(fs.realpathSync(root)).slice(0,16));
const commands={
 'status':{}, 'topics.list':{stage:'可选，选题／准备中／已发布',query:'可选'},
 'topics.update':{key:'必填，选题编号',stage:'可选，选题／准备中',category:'可选',color:'可选，#RRGGBB'},
 'topics.create-draft':{date:'YYYY-MM-DD',id:'选题编号'},
 'topics.generate':{model:'可选，模型引用'},
 'draft.read':{path:'库内稿件路径'},
 'draft.set-outline':{path:'库内稿件路径',text:'新大纲',expectedHash:'draft.read 返回的 hash'},
 'draft.set-body':{path:'库内稿件路径',text:'新正文',expectedHash:'draft.read 返回的 hash'},
 'draft.write':{path:'库内稿件路径',expectedHash:'draft.read 返回的 hash',model:'可选，模型引用'},
 'feed.list':{query:'可选',limit:'默认 30，最多 200'}, 'feed.refresh':{},
 'x.list':{postDate:'可选，YYYY-MM-DD；额外返回该日版本（包括尚无文件的日期）'},
 'x.add':{postDate:'必填，YYYY-MM-DD',expectedHash:'必填，x.list 返回的 versions[postDate].hash',text:'必填，非空正文',bj:'可选，北京时间 HH:mm，默认 17:00',kind:'可选，single／thread／article，默认 single',arche:'可选，默认 工具教程型',source:'可选，对象，仅 url、tweetUrl、author、title',parts:'可选，串帖非空字符串数组，至少两条',title:'可选',outline:'可选，非空字符串数组',five:'可选，对象，仅 promise、scene、entry、evidence、keep',imagePrompt:'可选'},
 'x.update':{postDate:'必填，原队列日期，不跨日移动',id:'必填，待发帖子编号',expectedHash:'必填，当天最新 hash',text:'可选，替换正文',bj:'可选，替换北京时间 HH:mm',kind:'可选，single／thread／article',arche:'可选',source:'可选，完整替换来源对象',parts:'可选，完整替换串帖数组',title:'可选',outline:'可选，完整替换数组',five:'可选，完整替换对象',imagePrompt:'可选'},
 'x.remove':{postDate:'必填，原队列日期',id:'必填，待发帖子编号',expectedHash:'必填，当天最新 hash'},
 'x.complete':{date:'YYYY-MM-DD',id:'帖子编号，用户确实已发布后调用'},
 'x.today':{},
 'x.generate':{model:'可选，模型引用；从信息流热点补一批候选（引用转发为主，新闻最多 2 条）'},
 'x.run-guide':{date:'必填',id:'必填；给跑效果类帖子写具体跑法（完整提示词+步骤）'},
 'x.run':{date:'必填',id:'必填；让 GPT 照跑法代跑，结果换成配图'},
 'bookmarks.import':{},
 'bookmarks.pending':{},
 'bookmarks.remove':{ids:'可选，要取消收藏的帖子 id 数组；不填就取消全部已导入的'},
 'x.news':{count:'可选，默认 5，最多 10',model:'可选，模型引用；从英文一手源挑新消息写成中文行业快讯并配原帖截图'},
 'x.source-shot':{date:'必填',id:'必填，帖子 id；把配图换成原帖截图（关键句标红）'},
 'x.fill-library':{count:'可选，默认 5，最多 10',model:'可选，模型引用；从博主素材库挑高收藏未用内容改写成原创'},
 'x.write-candidates':{model:'可选，模型引用；把待写候选依次写成帖子'},
 'x.convert':{postDate:'必填',id:'必填',format:'必填，quote／reply／single／thread／article（博主素材只能 single／thread／article）',model:'可选'},
 'x.rewrite':{postDate:'必填',id:'必填',instruction:'必填，怎么改；可带链接，会读取原帖和链接内容',model:'可选'},
 'x.restore':{postDate:'必填',id:'必填，把已归档或不发了的帖子放回今天'},
 'radar.list':{all:'可选，true 时包含往日未回'},
 'radar.refresh':{batch:'可选，13:00／18:00／22:00，默认当前批次',model:'可选'},
 'radar.update':{date:'必填，雷达日期',id:'必填，原帖 id',reply:'必填，新的回复文字'},
 'radar.complete':{date:'必填',id:'必填，用户确实已回复后调用'},
 'radar.remove':{date:'必填',id:'必填，不合适的回复拿掉（可在雷达页放回）'},
 'growth.get':{},
 'growth.set':{count:'必填，今天的粉丝数',date:'可选，默认今天'},
 'library.reminders':{},
 'x.fetch-hot':{}
};
function atomic(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);}
function region(md,name){const a='%% '+name+'开始 %%',b='%% '+name+'结束 %%',from=md.indexOf(a),to=md.indexOf(b,from+a.length);if(from<0||to<from)throw Error(name+'标记缺失或不完整');return {from:from+a.length,to,text:md.slice(from+a.length,to)};}
function replaceRegion(md,name,text){const r=region(md,name);return md.slice(0,r.from)+'\n'+text.trim()+'\n'+md.slice(r.to);}
function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('日期无效');return s;}
function hasDirtyCanvas(p,file){return p.app.workspace.getLeavesOfType('gzh-body-canvas').some(l=>l.view.file?.path===file.path&&l.view.cm&&l.view.cm.state.doc.toString()!==l.view.base);}
function draftFile(p,value){if(typeof value!=='string'||!value.endsWith('.md'))throw Error('请提供库内 Markdown 稿件路径');const full=path.resolve(p.vaultBase(),value),base=path.resolve(p.vaultBase());if(!full.startsWith(base+path.sep))throw Error('路径不能越出知识库');const rel=path.relative(base,full).split(path.sep).join('/');if(!rel.startsWith(p.p('稿件')+'/'))throw Error('仅允许工作台稿件目录');const f=p.app.vault.getAbstractFileByPath(rel);if(!f)throw Error('稿件不存在');return f;}
async function backup(p,file,md){const dest=p.p('版本','CLI-'+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'-'+file.name);await p.writeText(dest,md);return dest;}
// X 的原始 mutateDay 是异步读改写，没有 CAS。这里同步完成校验、备份与原子替换，
// 不在临界区 await，避免插件 UI／CLI 在同一事件循环内插入写入。
function xSnapshot(p,day){
 const rel=p.x.dayPath(date(day)),file=path.resolve(p.vaultBase(),rel);
 let raw=null;try{raw=fs.readFileSync(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const value=raw===null?{date:day,generatedAt:new Date().toISOString(),model:'CLI',items:[],pool:[]}:JSON.parse(raw);
 if(value.date!==day||!Array.isArray(value.items)||!Array.isArray(value.pool))throw Error('X 队列格式无效');
 return {rel,file,raw,value,hash:hash(raw===null?'null':raw),exists:raw!==null};
}
function xArgs(command,a){
 for(const key of Object.keys(a))if(!Object.hasOwn(commands[command],key))throw Error('未知字段：'+key);
 if(a.postDate!==undefined)date(a.postDate);
 if(command==='x.list')return;
 date(a.postDate);
 if(typeof a.expectedHash!=='string'||! /^[a-f0-9]{64}$/.test(a.expectedHash))throw Error('expectedHash 必须来自 x.list 的当天版本');
 if(command!=='x.add'&&(typeof a.id!=='string'||!a.id.trim()))throw Error('id 必须是非空字符串');
 for(const key of ['text','bj','kind','arche','title','imagePrompt'])if(a[key]!==undefined&&typeof a[key]!=='string')throw Error(key+' 必须是字符串');
 if((command==='x.add'||a.text!==undefined)&&!a.text?.trim())throw Error('text 不能为空');
 if(a.bj!==undefined&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.bj))throw Error('bj 必须是北京时间 HH:mm');
 if(a.kind!==undefined&&!['single','thread','article'].includes(a.kind))throw Error('kind 无效');
 if(a.arche!==undefined&&!a.arche.trim())throw Error('arche 不能为空');
 for(const key of ['parts','outline'])if(a[key]!==undefined&&(!Array.isArray(a[key])||!a[key].length||a[key].some(v=>typeof v!=='string'||!v.trim())))throw Error(key+' 必须是非空字符串数组');
 for(const [key,fields] of [['source',['url','tweetUrl','author','title']],['five',['promise','scene','entry','evidence','keep']]]){
  if(a[key]===undefined)continue;
  if(!a[key]||typeof a[key]!=='object'||Array.isArray(a[key]))throw Error(key+' 必须是对象');
  for(const [field,value] of Object.entries(a[key])){
   if(!fields.includes(field))throw Error('未知字段：'+key+'.'+field);
   if(typeof value!=='string')throw Error(key+'.'+field+' 必须是字符串');
   if(['url','tweetUrl'].includes(field)&&value){let u;try{u=new URL(value);}catch{}if(!u||!['https:','http:'].includes(u.protocol))throw Error(key+'.'+field+' 必须是 HTTP(S) 链接');}
  }
 }
 if(command==='x.update'&&!Object.keys(a).some(k=>!['postDate','id','expectedHash'].includes(k)))throw Error('至少提供一个替换字段');
}
function xWrite(p,command,a){
 xArgs(command,a);
 const s=xSnapshot(p,a.postDate);
 if(s.hash!==a.expectedHash)throw Error('X 队列已变化，请重新 x.list 后再操作');
 const changes=Object.fromEntries(Object.entries(a).filter(([k])=>!['postDate','id','expectedHash'].includes(k)));
 let item,index;
 if(command==='x.add')item={id:'x-'+crypto.randomUUID(),kind:'single',arche:'工具教程型',bj:'17:00',source:{},status:'ready',issues:[],...changes};
 else{
  const matches=s.value.items.filter(i=>i.id===a.id);
  if(matches.length!==1)throw Error('待发帖子不存在或 id 不唯一');
  item=matches[0];index=s.value.items.indexOf(item);
  if(['posted','skipped','archived'].includes(item.status))throw Error('只能操作待发帖子');
  if(command==='x.update'){
   item={...item,...changes};
   if(item.kind==='thread'&&a.text!==undefined&&a.parts===undefined&&Array.isArray(item.parts))item.parts=[a.text,...item.parts.slice(1)];
   if(item.kind==='thread'&&a.parts!==undefined&&a.text===undefined)item.text=a.parts[0];
  }
 }
 if(command!=='x.remove'){
  if(item.kind==='thread'&&(!Array.isArray(item.parts)||item.parts.length<2||item.parts[0]!==item.text))throw Error('串帖至少两条 parts，且 text 必须等于首条');
  if(item.kind!=='thread'&&item.parts!==undefined)throw Error('parts 仅适用于串帖');
  if(command==='x.add')s.value.items.push(item);else s.value.items[index]=item;
 }else s.value.items.splice(index,1);
 const dest=p.p('版本','CLI-X-'+Date.now()+'-'+crypto.randomUUID()+'-'+a.postDate+'.json');
 const backupFile=path.resolve(p.vaultBase(),dest);
 fs.mkdirSync(path.dirname(backupFile),{recursive:true});
 // 不存在的队列用 JSON null 记录；已有文件逐字备份，包含候补与已发记录。
 fs.writeFileSync(backupFile,s.raw===null?'null\n':s.raw,{encoding:'utf8',mode:0o600,flag:'wx'});
 if(xSnapshot(p,a.postDate).hash!==s.hash)throw Error('备份期间 X 队列已变化，未覆盖；备份：'+dest);
 fs.mkdirSync(path.dirname(s.file),{recursive:true});
 atomic(s.file,s.value);
 const result={id:item.id,postDate:a.postDate,hash:hash(JSON.stringify(s.value,null,2)),backup:dest,...(command==='x.remove'?{removedFromQueue:true}:{item:{...item,postDate:a.postDate}})};
 p.refreshViews();return result;
}
async function execute(p,command,a={}){
 if(!Object.hasOwn(commands,command))throw Error('未知命令：'+command);
 if(!a||Array.isArray(a)||typeof a!=='object')throw Error('参数必须是 JSON 对象');
 if(command==='status')return {name:'戴卫得AI工作台',version:2,date:p.today(),root:p.settings.root,busy:[...p.busy],commands};
 if(command==='topics.list'){const board=await p.loadProjectBoard();const rows=await p.projectRows(board);return rows.filter(r=>!board.entries[r.key]?.deleted&&(!a.stage||r.stage===a.stage)&&(!a.query||r.title.includes(a.query))).map(r=>({key:r.key,title:r.title,category:r.category,stage:r.stage,path:r.file?.path||null,color:board.entries[r.key]?.color||null}));}
 if(command==='topics.update'){const board=await p.loadProjectBoard(),r=(await p.projectRows(board)).find(r=>r.key===a.key);if(!r)throw Error('选题不存在');if(a.stage&&!['选题','准备中'].includes(a.stage))throw Error('只能设置选题或准备中，已发布不可推断');if(r.published)throw Error('已发布作品不能通过此命令改动');if(a.color&&!/^#[0-9a-f]{6}$/i.test(a.color))throw Error('颜色须为 #RRGGBB');if(a.category!==undefined&&(typeof a.category!=='string'||!a.category.trim()))throw Error('分类不能为空');await p.updateProjectBoard(b=>{b.entries[a.key]={...b.entries[a.key],...(a.stage?{stage:a.stage}:{}),...(a.category?{category:a.category}:{}),...(a.color?{color:a.color}:{})};});p.refreshViews();return {key:a.key,updated:true};}
 if(command==='topics.create-draft'){const {file}=await p.ensureTopicDocument(date(a.date),a.id);p.refreshViews();return {path:file.path};}
 if(command==='topics.generate'){if(p.busy.has('topics'))throw Error('选题生成正在进行');const before=JSON.stringify(await p.loadTopics(p.today()));await p.generateTopics(false,a.model);const after=await p.loadTopics(p.today());if(JSON.stringify(after)===before)throw Error('未生成新选题，请查看工作台错误提示');return after;}
 if(command.startsWith('draft.')){const file=draftFile(p,a.path),md=await p.app.vault.read(file);if(command==='draft.read')return {path:file.path,hash:hash(md),outline:region(md,'大纲').text,body:region(md,'正文').text,unsavedCanvas:hasDirtyCanvas(p,file)};
  if(hasDirtyCanvas(p,file))throw Error('画布有未保存修改，请先保存或处理冲突，再调用 CLI');
  if(a.expectedHash!==hash(md))throw Error('稿件已变化，请重新 draft.read 后再操作');
  if(command==='draft.write'&&!region(md,'大纲').text.trim())throw Error('大纲为空');
  if(command!=='draft.write'&&typeof a.text!=='string')throw Error('text 必须是文字');
  const saved=await backup(p,file,md);
  if(command==='draft.write'){if(p.cliDraftWriting)throw Error('已有正文生成任务');p.cliDraftWriting=true;try{await p.writeDraft(file,a.model);const next=await p.app.vault.read(file);if(region(next,'正文').text===region(md,'正文').text)throw Error('正文未更新，请查看工作台错误提示；旧稿备份：'+saved);return {path:file.path,hash:hash(next),backup:saved};}finally{p.cliDraftWriting=false;}}
  let next;await p.app.vault.process(file,current=>{if(hash(current)!==a.expectedHash)throw Error('保存期间稿件已变化，未覆盖');next=replaceRegion(current,command==='draft.set-outline'?'大纲':'正文',a.text);return next;});p.refreshViews();return {path:file.path,hash:hash(next),backup:saved};
 }
 if(command==='feed.list'){const f=await p.loadFeed();const limit=a.limit===undefined?30:Number(a.limit);if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('limit 须为 1 至 200');return {updatedAt:f?.updatedAt,items:(f?.items||[]).filter(i=>!a.query||JSON.stringify(i).toLowerCase().includes(String(a.query).toLowerCase())).slice(0,limit)};}
 if(command==='feed.refresh'){if(p.busy.has('feed'))throw Error('信息流正在刷新');const before=(await p.loadFeed())?.updatedAt;await p.refreshFeedNow(false);const f=await p.loadFeed();if(!f||f.updatedAt===before)throw Error('信息流未刷新，请查看工作台错误提示');return {updatedAt:f.updatedAt,count:f.items?.length};}
 if(command==='x.list'){
  xArgs(command,a);
  const t=await p.x.loadPostTimeline(),days=new Set([...t.items,...t.pool].map(i=>i.postDate));
  const dir=path.dirname(path.resolve(p.vaultBase(),p.x.dayPath(p.today())));
  if(fs.existsSync(dir))for(const name of fs.readdirSync(dir))if(/^\d{4}-\d{2}-\d{2}\.json$/.test(name))days.add(name.slice(0,10));
  if(a.postDate)days.add(a.postDate);
  const items=[],pool=[],versions={};
  for(const day of [...days].sort()){
   const s=xSnapshot(p,day);versions[day]={hash:s.hash,path:s.rel,exists:s.exists};
   items.push(...s.value.items.filter(i=>!['posted','skipped','archived'].includes(i.status)).map(i=>xAnnotate(p,{...i,postDate:day})));
   pool.push(...s.value.pool.map(i=>({...i,postDate:day})));
  }
  return {items,pool,versions};
 }
 if(['x.add','x.update','x.remove'].includes(command))return p.x._dayQueue?p.x._dayQueue(()=>xWrite(p,command,a)):xWrite(p,command,a);
 if(command==='x.today'){
  const t=await p.x.loadPostTimeline(),radar=await p.x.loadRadarTimeline(),today=p.today(),s=p.settings;
  const postedOn=i=>(i.publication&&i.publication.date)||(i.postedAt?p.today(new Date(i.postedAt)):'');
  const live=t.items.filter(i=>!['skipped','archived'].includes(i.status)&&(i.status!=='posted'||postedOn(i)===today)).map(i=>xAnnotate(p,i));
  const comments=radar.filter(c=>c.radarDate===today&&['ready','replied'].includes(c.status)).map(c=>({date:c.radarDate,id:c.id,author:c.author,url:c.url,batch:c.batch||null,status:c.status,reply:c.reply,alts:c.alts,text:(c.text||'').slice(0,300)}));
  return {date:today,posted:live.filter(i=>i.status==='posted').length,postTarget:s.xDailyPosts||12,replied:comments.filter(c=>c.status==='replied').length,replyTarget:s.xReplies||30,growth:growth(p),posts:live,comments};
 }
 if(command==='x.generate'){if(p.busy.has('x'))throw Error('热点候选正在生成');await p.x.generateDay(a.model||p.settings.models.x);return {done:true,today:(await p.x.loadDay(p.today()))?.items.filter(i=>i.status==='candidate').length||0};}
 if(command==='x.run-guide'){if(!a.date||!a.id)throw Error('需要 date 和 id');return await p.x.makeRunGuide(a.date,a.id,a.model);}
 if(command==='x.run'){if(!a.date||!a.id)throw Error('需要 date 和 id');return await p.x.runForMe(a.date,a.id,a.model);}
 if(command==='bookmarks.import')return {added:await p.x.importBookmarks(true)};
 if(command==='bookmarks.pending')return p.x.bmPending();
 if(command==='bookmarks.remove'){await p.x.removeBookmarks(Array.isArray(a.ids)?a.ids.map(String):null);return {pending:p.x.bmPending().length};}
 if(command==='x.news'){const n=a.count===undefined?5:Number(a.count);if(!Number.isInteger(n)||n<1||n>10)throw Error('count 须为 1 至 10');return {added:await p.x.generateNews(n,a.model,true)};}
 if(command==='x.source-shot'){if(!a.date||!a.id)throw Error('需要 date 和 id');return {image:await p.x.sourceShot(a.date,a.id,true)};}
 if(command==='x.fill-library'){const n=a.count===undefined?5:Number(a.count);if(!Number.isInteger(n)||n<1||n>10)throw Error('count 须为 1 至 10');const before=((await p.x.loadDay(p.today()))?.items||[]).filter(i=>i.fromLibrary).length;await p.x.fillFromLibrary(n,a.model);const after=((await p.x.loadDay(p.today()))?.items||[]).filter(i=>i.fromLibrary).length;return {added:after-before};}
 if(command==='x.write-candidates'){const t=await p.x.loadPostTimeline();const c=t.items.filter(i=>i.status==='candidate');let ok=0;for(const it of c){try{await p.x.writeCandidate(it.postDate,it.id,a.model||p.settings.models.x);ok++;}catch(e){}}return {total:c.length,written:ok};}
 if(command==='x.convert'||command==='x.rewrite'||command==='x.restore'){
  date(a.postDate);if(typeof a.id!=='string')throw Error('id 必填');
  const d=await p.x.loadDay(a.postDate),it=d?.items.find(i=>i.id===a.id);if(!it)throw Error('帖子不存在');
  if(command==='x.restore'){if(!['archived','skipped'].includes(it.status))throw Error('这条不在归档或不发了里');await p.x.mutateDay(a.postDate,dd=>{const t=dd.items.find(i=>i.id===a.id);if(t){t.status=t.text?'ready':'candidate';t.pinned=true;}});return {restored:true};}
  if(it.status!=='ready'&&it.status!=='candidate')throw Error('只能改待发帖子');
  if(command==='x.convert'){if(!['quote','reply','single','thread','article'].includes(a.format))throw Error('format 无效');const lib=it.fromLibrary||it.materialId||p.x.libHandles().has(String(it.source?.author||'').toLowerCase());if(lib&&['quote','reply'].includes(a.format))throw Error('博主素材只能改写成原创（single／thread／article），不能直接引用或回复');if(['quote','reply'].includes(a.format)&&!it.source?.tweetUrl)throw Error('这条没有原帖链接');await p.x.convertFormat(a.postDate,a.id,a.format,a.model||p.settings.models.x);}
  else{if(typeof a.instruction!=='string'||!a.instruction.trim())throw Error('instruction 必填');await p.x.edit(a.postDate,a.id,a.instruction,a.model||p.settings.models.x);}
  const nd=await p.x.loadDay(a.postDate);return {item:xAnnotate(p,{...nd.items.find(i=>i.id===a.id),postDate:a.postDate})};
 }
 if(command==='radar.list'){const r=await p.x.loadRadarTimeline(),today=p.today();return r.filter(c=>c.status==='ready'&&(a.all===true||c.radarDate===today)).map(c=>({date:c.radarDate,id:c.id,author:c.author,url:c.url,batch:c.batch||null,why:c.why,reply:c.reply,alts:c.alts,text:(c.text||'').slice(0,600)}));}
 if(command==='radar.refresh'){if(p.busy.has('radar'))throw Error('评论雷达正在找帖子');if(a.batch!==undefined&&!['13:00','18:00','22:00'].includes(a.batch))throw Error('batch 只能是 13:00／18:00／22:00');const before=(await p.x.loadRadar(p.today()))?.items.length||0;await p.x.refreshRadar(a.model||p.settings.models.xRadarFind||p.settings.models.xReply,undefined,true,a.batch||'');const after=(await p.x.loadRadar(p.today()))?.items.length||0;return {added:after-before};}
 if(command==='radar.update'||command==='radar.complete'||command==='radar.remove'){
  date(a.date);if(typeof a.id!=='string')throw Error('id 必填');
  const d=await p.x.loadRadar(a.date);if(!d?.items.some(i=>i.id===a.id))throw Error('评论不存在');
  if(command==='radar.update'&&(typeof a.reply!=='string'||!a.reply.trim()))throw Error('reply 不能为空');
  await p.x.mutateRadar(a.date,dd=>{const t=dd.items.find(i=>i.id===a.id);if(!t)return;if(command==='radar.update')t.reply=a.reply.trim();if(command==='radar.complete'){t.status='replied';t.repliedAt=new Date().toISOString();}if(command==='radar.remove'){t.status='skipped';t.deletedAt=new Date().toISOString();}});
  return {ok:true};
 }
 if(command==='growth.get')return growth(p);
 if(command==='growth.set'){const n=Number(a.count);if(!Number.isInteger(n)||n<0)throw Error('count 须为非负整数');const day=a.date===undefined?p.today():date(a.date);p.settings.xFollowers={...(p.settings.xFollowers||{}),[day]:n};await p.saveSettings();p.refreshViews();return growth(p);}
 if(command==='x.fetch-hot'){const r=await p.x.runXFetch();if(!r)throw Error('正在抓取中');if(r.error)throw Error(r.error);return r;}
 if(command==='library.reminders'){const ext=p.x.libExt();return new ext.Store(p).reminders().map(r=>({handle:r.handle,eligible:r.eligible,days:r.days,low:r.low,due:r.due}));}
 if(command==='x.complete'){date(a.date);const day=await p.x.loadDay(a.date);if(!day?.items.some(i=>i.id===a.id))throw Error('帖子不存在');await p.x.markPosted(a.date,a.id,true);return {removedFromQueue:true};}
}
function xAnnotate(p,it){let plan=null,format=null;try{const pl=p.x.planOf(it);plan={key:pl.key,label:pl.short,title:pl.title,tip:pl.tip};format=p.x.formatOf(it);}catch(e){}return {...it,format,plan};}
function growth(p){const log=p.settings.xFollowers||{},dates=Object.keys(log).sort(),goal=p.settings.xGoal||10000,goalDate=p.settings.xGoalDate||'2026-11-13';const cur=dates.length?log[dates[dates.length-1]]:null;const daysLeft=Math.max(1,Math.ceil((Date.parse(goalDate+'T12:00:00')-Date.parse(p.today()+'T12:00:00'))/864e5));return {goal,goalDate,current:cur,lastRecorded:dates[dates.length-1]||null,daysLeft,needPerDay:cur===null?null:Math.ceil(Math.max(0,goal-cur)/daysLeft),log};}
function install(p){const dir=socketDir(p.vaultBase());fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);let running=false,closed=false;
 const heartbeat=()=>atomic(path.join(dir,'bridge.json'),{pid:process.pid,at:Date.now(),version:1,root:p.vaultBase()});heartbeat();
 const tick=async()=>{if(running||closed)return;running=true;try{for(const name of fs.readdirSync(dir).filter(n=>/^[0-9a-f-]{36}\.request\.json$/.test(n)).sort()){const id=name.slice(0,36),out=path.join(dir,id+'.result.json');if(fs.existsSync(out))continue;let req;try{req=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));if(Date.now()-req.at>300000)throw Error('请求已过期，请重新提交');atomic(out,{id,status:'running',startedAt:Date.now()});const result=await execute(p,req.command,req.args);atomic(out,{id,status:'completed',result,finishedAt:Date.now()});}catch(e){atomic(out,{id,status:'failed',error:String(e.message||e),finishedAt:Date.now()});}if(closed)break;}}finally{running=false;}};
 try{const b=path.join(__dirname,'浏览器助手接口.cjs');delete require.cache[b];p.browserHelper=require(b).install(p,execute);}catch(e){console.error('浏览器助手接口加载失败',e);}
 p.registerInterval(setInterval(heartbeat,2000));p.registerInterval(setInterval(()=>tick().catch(console.error),500));p.register(()=>{closed=true;atomic(path.join(dir,'bridge.json'),{at:0,version:1});});return {dir,execute:(c,a)=>execute(p,c,a)};
}
module.exports={install,execute,commands,socketDir,hash,region,replaceRegion,atomic};
