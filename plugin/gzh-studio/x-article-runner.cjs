// 独立 Chrome 会话。只操作草稿，不点击 Publish，不调用非公开发布 API。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright-core');
const input=process.argv[2];
let ctx, state={}, statePath;
const emit=(message,extra={})=>process.stdout.write(JSON.stringify({message,...extra})+'\n');
function save(extra){ Object.assign(state,extra,{updatedAt:new Date().toISOString()});fs.writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600}); }
const norm=s=>s.replace(/\s+/g,'').normalize('NFC');
const articleText=body=>body.evaluate(e=>[...e.querySelectorAll('[data-block="true"]')].filter(b=>b.getAttribute('contenteditable')!=='false').map(b=>b.textContent).join('\n'));
async function main(){
  const job=JSON.parse(fs.readFileSync(input,'utf8'));statePath=path.join(path.dirname(input),'state.json');
  if(fs.existsSync(statePath))state=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(state.url){emit('已有草稿，请打开检查；为保护你在 X 上的修改，不会自动覆盖。',{status:'review',url:state.url});return;}
  if(state.phase==='creating'){throw new Error('上次创建结果未知。请先到 X 草稿列表检查，避免重复创建。');}
  for(const a of [job.cover,...job.assets.filter(x=>x.kind==='image')].filter(Boolean)){
    const {createHash}=require('node:crypto');
    if(createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')!==a.sha256)throw new Error('图片已修改，请重新打开推送窗口。');
  }
  const profile=path.join(os.homedir(),'.gzh-studio','x-article-browser');fs.mkdirSync(profile,{recursive:true,mode:0o700});
  ctx=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:null,permissions:['clipboard-read','clipboard-write'],acceptDownloads:false});
  const page=ctx.pages()[0]||await ctx.newPage();page.setDefaultTimeout(20000);
  await page.goto('https://x.com/compose/articles',{waitUntil:'domcontentloaded'});
  emit('浏览器已打开。首次使用请登录 X，登录完成后会自动继续。',{status:'login'});
  const create=page.getByRole('button',{name:/^(create|创建|撰写)$/i});
  try{await create.waitFor({state:'visible',timeout:600000});}catch{throw new Error('未找到 Article 创建入口。请检查登录状态或账号权限，再重试。');}
  save({phase:'creating',fingerprint:job.fingerprint});
  await create.click();
  const title=page.getByPlaceholder(/^(Add a title|添加标题|添加一个标题)$/i);
  await title.waitFor({state:'visible'});
  const preview=page.getByRole('link',{name:/^(Preview|预览)$/});
  const href=await preview.getAttribute('href');
  if(!/^\/compose\/articles\/edit\/\d+\/preview$/.test(href||''))throw new Error('无法确认新草稿地址，已停止。请到 X 草稿列表检查。');
  const url='https://x.com'+href.replace(/\/preview$/,'');save({url,phase:'filling'});emit('已创建草稿，正在填写标题和正文。',{url,status:'running'});
  await title.fill(job.title);
  const body=page.getByTestId('composer');
  if((await body.innerText()).trim())throw new Error('新草稿正文不是空白，已停止以免覆盖。');
  const expected=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');return d.body.textContent;},job.html);
  await page.evaluate(async html=>{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'})})]);},job.html);
  await body.click();await body.press(process.platform==='darwin'?'Meta+V':'Control+V');
  await page.waitForFunction(expected=>document.querySelector('[data-testid="composer"]')?.textContent?.replace(/\s+/g,'').normalize('NFC')===expected, norm(expected));
  save({phase:'text-filled'});
  if(job.cover){
    emit('正在上传封面。');
    const chooserPromise=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:/^(Add photos or video|添加照片或视频)$/}).click();
    await (await chooserPromise).setFiles(job.cover.path);
    // X 可能显示裁剪对话框；只允许明确的应用按钮。
    const apply=page.getByRole('button',{name:/^(Apply|应用)$/});
    await apply.waitFor({state:'visible',timeout:15000}).catch(()=>{});
    if(await apply.isVisible())await apply.click();
    await page.getByRole('button',{name:/^(Remove photo|移除照片|删除照片)$/}).waitFor({state:'visible',timeout:60000});
    save({phase:'cover-filled'});
  }
  let inserted=0;
  for(const item of [...job.assets].reverse()){
    emit(item.kind==='image'?`正在插入正文图片（${inserted+1}）。`:'正在插入分隔线。');
    const marker=body.getByText(item.marker,{exact:true});
    if(await marker.count()!==1)throw new Error('图片定位标记异常，已停止。');
    await marker.click();
    // 使用 Selection 定位完整标记，只选择这一段，避免全选正文。
    await marker.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(r);});
    await page.keyboard.press('Backspace');
    const before=await body.locator('img').count();
    await page.getByRole('button',{name:/^(Add Media|添加媒体)$/}).click();
    if(item.kind==='image'){
      await page.getByRole('menuitem',{name:/^(Media|媒体)$/}).click();
      const chooserPromise=page.waitForEvent('filechooser');
      await page.getByRole('dialog').getByRole('button',{name:/^(Add photos or video|添加照片或视频)$/}).click();
      await (await chooserPromise).setFiles(item.path);
      await page.waitForFunction(n=>document.querySelector('[data-testid="composer"]')?.querySelectorAll('img').length>n,before,{timeout:60000});
      inserted++;
    }else await page.getByRole('menuitem',{name:/^(Divider|分隔线|分割线)$/}).click();
    save({phase:'media-filled',inserted});
  }
  const expectedText=norm(job.assets.reduce((s,a)=>s.split(a.marker).join(''),expected));
  if(norm(await articleText(body))!==expectedText)throw new Error('正文校验不一致，保留草稿供检查。');
  if(await body.locator('img').count()<job.assets.filter(a=>a.kind==='image').length)throw new Error('正文图片数量不完整。');
  emit('等待 X 保存，随后重新打开草稿核对。');
  await page.waitForTimeout(5000);
  await page.goto(url,{waitUntil:'domcontentloaded'});await title.waitFor({state:'visible'});
  if(await title.inputValue()!==job.title)throw new Error('标题尚未保存到 X，请检查草稿。');
  await body.waitFor({state:'visible'});
  if(norm(await articleText(body))!==expectedText)throw new Error('重新打开后正文不一致，请检查草稿。');
  if(await body.locator('img').count()<job.assets.filter(a=>a.kind==='image').length)throw new Error('重新打开后正文图片数量不完整。');
  if(job.cover && !await page.getByRole('button',{name:/^(Remove photo|移除照片|删除照片)$/}).isVisible())throw new Error('封面未保存，请检查草稿。');
  save({phase:'complete',fingerprint:job.fingerprint});emit('草稿已保存并重新打开核对，请检查排版后自行发布。',{status:'complete',url});
}
process.on('SIGTERM',async()=>{emit('已停止；已创建的草稿保留在 X。',{status:'stopped',url:state.url});if(ctx)await ctx.close().catch(()=>{});process.exit(0);});
main().catch(e=>{emit(e.message,{status:'error',url:state.url});process.exitCode=1;}).finally(async()=>{if(ctx)await ctx.close().catch(()=>{});});
