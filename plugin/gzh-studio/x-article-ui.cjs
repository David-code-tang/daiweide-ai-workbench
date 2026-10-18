const fs=require('node:fs'),path=require('node:path');
const {buildPayload,hash}=require('./x-article-export.cjs');
async function open(p,file,{Modal,Notice,bodyOf,resolve,which,loginEnv}){
  const md=await p.app.vault.read(file);
  const fm=p.app.metadataCache.getFileCache(file)?.frontmatter||{};
  const modal=new Modal(p.app);modal.titleEl.setText('推送到 X Article 草稿');
  const el=modal.contentEl;
  el.createEl('p',{text:'自动填写标题、带格式的正文、封面和正文图片。完成后停在草稿，检查后由你在 X 点击发布。'});
  el.createEl('label',{text:'Article 标题'});
  const title=el.createEl('input',{type:'text',value:(md.match(/^# (.+)$/m)||[])[1]||file.basename});title.style.width='100%';title.maxLength=100;
  const status=el.createEl('p',{text:'正在检查文章…'});
  const summary=el.createDiv();
  const row=el.createDiv();
  const start=row.createEl('button',{text:'自动填入 X Article 草稿',cls:'mod-cta'});start.disabled=true;
  const stop=row.createEl('button',{text:'停止'});stop.disabled=true;
  const view=row.createEl('button',{text:'打开已有草稿'});view.hidden=true;
  el.createEl('p',{text:'首次运行会打开专用 Chrome 窗口，请登录 X。登录状态只保存在本机。请不要在自动填入期间编辑这个窗口；失败后会保留草稿，避免重复创建。',cls:'gzh-muted'});
  const dir=path.join(p.workDir(),'x-article',hash(p.vaultBase()+'\n'+file.path).slice(0,24));
  const statePath=path.join(dir,'state.json');
  let payload,child,url;
  const showUrl=value=>{if(/^https:\/\/x\.com\/compose\/articles\/edit\/\d+$/.test(value||'')){url=value;view.hidden=false;view.onclick=()=>p.x.open(url);}};
  try{
    if(fm['X Article草稿']){showUrl(fm['X Article草稿']);if(url){status.setText('这篇文章已有 X 草稿，可在已登录的浏览器中继续编辑。');start.hidden=true;}}
    if(fs.existsSync(statePath)){
      const old=JSON.parse(fs.readFileSync(statePath,'utf8'));showUrl(old.url);
      if(old.url){status.setText('这篇文章已有 X 草稿，可直接打开检查。不会自动覆盖 X 中的修改，也不会重复新建。');start.hidden=true;}
      else if(old.phase==='creating'){status.setText('上次创建结果尚未确认，请先检查 X 草稿列表，避免重复创建。');start.hidden=true;view.hidden=false;view.onclick=()=>p.x.open('https://x.com/compose/articles');}
    }
    const resolveAsset=ref=>{const f=resolve(p,ref,file.path);return f?path.join(p.vaultBase(),f.path):null;};
    payload=await buildPayload({title:title.value,body:bodyOf(md).body,cover:typeof fm['封面']==='string'?fm['封面']:null,resolveAsset,vaultRoot:p.vaultBase()});
    summary.setText(`封面：${payload.cover?'已指定':'未指定'} · 正文图片：${payload.assets.filter(a=>a.kind==='image').length} 张`);
    if(!url&&!start.hidden)status.setText('检查通过。点击后将内容填入 X 的草稿编辑器。');
    start.disabled=false;
    start.onclick=async()=>{
      if(p._xArticleTask)return new Notice('已有 X Article 任务正在执行，请等待完成。');
      if(await p.app.vault.read(file)!==md)return new Notice('文章已有修改，请关闭窗口重新打开，确保推送最新正文。');
      const reservation={};p._xArticleTask=reservation;
      start.disabled=true;title.disabled=true;
      try{
        payload=await buildPayload({title:title.value,body:bodyOf(md).body,cover:typeof fm['封面']==='string'?fm['封面']:null,resolveAsset,vaultRoot:p.vaultBase()});
        const node=await which('node');if(!node)throw new Error('未找到 Node.js，请先安装 Node.js 20 或更新版本。');
        fs.mkdirSync(dir,{recursive:true,mode:0o700});const input=path.join(dir,'input.json');fs.writeFileSync(input,JSON.stringify(payload),{mode:0o600});
        child=require('node:child_process').spawn(node,[path.join(__dirname,'x-article-runner.cjs'),input],{env:await loginEnv(),stdio:['ignore','pipe','pipe']});
        p._xArticleTask=child;stop.disabled=false;status.setText('正在启动专用 Chrome…');
        let buffer='',err='',terminal=false;
        child.stdout.on('data',data=>{buffer+=data.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{
          const result=JSON.parse(line);status.setText(result.message);showUrl(result.url);
          if(['complete','review','error','stopped'].includes(result.status)){terminal=true;new Notice(result.message,10000);}
          if(result.status==='complete')p.x.open(result.url);
        }catch{}}});
        child.stderr.on('data',d=>{err=(err+d.toString()).slice(-1500);});
        const finished=()=>{if(p._xArticleTask===child)p._xArticleTask=null;stop.disabled=true;start.disabled=!!url;title.disabled=false;};
        child.on('error',e=>{status.setText('启动失败：'+e.message);terminal=true;finished();});
        child.on('exit',code=>{if(!terminal)status.setText('任务已中断，请先检查 X 草稿列表。'+(err?' '+err.slice(-500):''));finished();});
      }catch(e){if(p._xArticleTask===reservation)p._xArticleTask=null;status.setText(e.message);start.disabled=false;title.disabled=false;}
    };
    stop.onclick=()=>{if(child){child.kill('SIGTERM');status.setText('正在停止，已有草稿会保留。');stop.disabled=true;}};
  }catch(e){status.setText('暂时不能推送：'+e.message);}
  modal.open();
}
module.exports={open};
