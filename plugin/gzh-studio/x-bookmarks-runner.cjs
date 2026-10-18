// X 收藏读取与取消收藏。用和「推送 X 长文」同一个独立 Chrome 会话（~/.gzh-studio/x-article-browser），
// 不碰你日常用的 Chrome，不读取或保存密码。只做两件事：读收藏列表、按清单取消收藏。
// 用法：node x-bookmarks-runner.cjs job.json
//   job = {mode:'fetch'|'remove'|'login', known:[已导入的 id], ids:[要取消的 id], max:300}
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright-core');
const emit=(o)=>process.stdout.write(JSON.stringify(o)+'\n');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let ctx;

/** 从 Bookmarks 接口返回里取出帖子和下一页游标（页面里和这里共用） */
function parseBookmarks(json){
  const out=[];let cursor=null;
  const ins=json?.data?.bookmark_timeline_v2?.timeline?.instructions||json?.data?.bookmark_timeline?.timeline?.instructions||[];
  for(const i of ins){
    for(const e of (i.entries||(i.entry?[i.entry]:[]))){
      const c=e.content||{};
      if(c.cursorType==='Bottom'||/^cursor-bottom/.test(e.entryId||'')){cursor=c.value||cursor;continue;}
      let r=c.itemContent?.tweet_results?.result;if(!r)continue;
      if(r.__typename==='TweetWithVisibilityResults')r=r.tweet;
      const lg=r?.legacy;if(!lg)continue;
      const u=r.core?.user_results?.result||{};
      const sn=u.core?.screen_name||u.legacy?.screen_name||'';
      let text=r.note_tweet?.note_tweet_results?.result?.text||lg.full_text||'';
      for(const x of lg.entities?.urls||[])if(x.url&&x.expanded_url)text=text.split(x.url).join(x.expanded_url);
      for(const m of lg.extended_entities?.media||lg.entities?.media||[])if(m.url)text=text.split(m.url).join('').trim();
      const id=lg.id_str||r.rest_id;
      out.push({tweet_id:id,username:sn,name:u.core?.name||u.legacy?.name||'',url:`https://x.com/${sn}/status/${id}`,text,created_at:lg.created_at?new Date(lg.created_at).toISOString():'',
        favorite_count:lg.favorite_count||0,retweet_count:lg.retweet_count||0,reply_count:lg.reply_count||0,bookmark_count:lg.bookmark_count||0,view_count:Number(r.views?.count||0),
        media_urls:(lg.extended_entities?.media||[]).map(m=>m.type==='photo'?m.media_url_https:(m.video_info?.variants||[]).filter(v=>v.content_type==='video/mp4').sort((a,b)=>(b.bitrate||0)-(a.bitrate||0))[0]?.url||m.media_url_https).filter(Boolean),
        quoted:r.quoted_status_result?.result?.legacy?.full_text||''});
    }
  }
  return {items:out,cursor};
}

async function openBookmarks(headless){
  const profile=path.join(os.homedir(),'.gzh-studio','x-article-browser');fs.mkdirSync(profile,{recursive:true,mode:0o700});
  // X 会拒绝带 HeadlessChrome 标记的请求：后台模式用普通 Chrome 的 UA；还被拒就换成屏幕外的正常窗口再试一次
  const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const open=async(hl)=>{
    ctx=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:hl,viewport:{width:1200,height:900},...(hl?{userAgent:UA}:{}),args:['--disable-blink-features=AutomationControlled',...(hl?[]:['--window-position=-2400,-2400'])]});
    const page=ctx.pages()[0]||await ctx.newPage();page.setDefaultTimeout(30000);
    let captured=null;
    page.on('request',req=>{const u=req.url();if(!captured&&/\/i\/api\/graphql\/[^/]+\/Bookmarks\?/.test(u))captured={url:u,headers:req.headers()};});
    await page.goto('https://x.com/i/bookmarks',{waitUntil:'domcontentloaded'});
    return {page,getCaptured:()=>captured};
  };
  try{return await open(headless);}
  catch(e){
    if(!headless)throw e;
    try{await ctx.close();}catch(_){}
    return await open(false);
  }
}
const needLogin=(page)=>{const u=new URL(page.url());return /\/(login|i\/flow|i\/jf\/onboarding|account\/access)/.test(u.pathname)||/mode=login|redirect_after_login/.test(u.search);};

async function waitForApi(page,getCaptured,ms){
  const t0=Date.now();
  while(Date.now()-t0<ms){if(getCaptured())return getCaptured();if(needLogin(page))return null;await sleep(500);}
  return getCaptured();
}

async function fetchAll(job){
  let {page,getCaptured}=await openBookmarks(true);
  let cap=await waitForApi(page,getCaptured,25000);
  if(!cap&&!needLogin(page)){
    // 后台模式没拿到：换成屏幕外的正常 Chrome 窗口再试一次（X 对无界面浏览器经常不给数据）
    try{await ctx.close();}catch(_){}
    ({page,getCaptured}=await openBookmarks(false));
    cap=await waitForApi(page,getCaptured,30000);
  }
  if(!cap&&!needLogin(page)){
    const txt=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    if(/Sign in|Log in|登录|注册|Sign up/i.test(txt.slice(0,3000))&&!/Bookmarks|书签/.test(txt.slice(0,3000))){emit({needLogin:true});return;}
  }
  if(!cap){
    if(job.mode!=='login'&&!needLogin(page)){
      // 留一张截图和页面地址，方便排查到底卡在哪
      let shot='';try{shot=path.join(os.homedir(),'.gzh-studio','x-bookmarks-last.png');await page.screenshot({path:shot});}catch(_){}
      const snippet=await page.evaluate(()=>(document.body?.innerText||'').slice(0,200)).catch(()=>'');
      emit({error:'收藏页没加载出来（地址：'+page.url()+'；页面开头：'+snippet.replace(/\s+/g,' ')+'）',shot});return;
    }
    emit({needLogin:true});return;
  }
  const u=new URL(cap.url),qid=u.pathname.split('/')[4],features=u.searchParams.get('features')||'{}',fieldToggles=u.searchParams.get('fieldToggles');
  const baseVars=JSON.parse(u.searchParams.get('variables')||'{}');
  const headers=Object.fromEntries(Object.entries(cap.headers).filter(([k])=>/^(authorization|x-csrf-token|x-twitter-[a-z-]+|x-client-transaction-id|accept-language)$/i.test(k)));
  const known=new Set(job.known||[]),max=job.max||300,all=[];let cursor=null,pages=0,stopAtKnown=false;
  while(pages<30&&all.length<max){
    const vars={...baseVars,count:20,includePromotedContent:false};if(cursor)vars.cursor=cursor;else delete vars.cursor;
    const qs=new URLSearchParams({variables:JSON.stringify(vars),features});if(fieldToggles)qs.set('fieldToggles',fieldToggles);
    const res=await page.evaluate(async([url,headers])=>{const r=await fetch(url,{headers,credentials:'include'});return {status:r.status,text:await r.text()};},[`https://x.com/i/api/graphql/${qid}/Bookmarks?${qs}`,headers]);
    if(res.status===429){emit({warn:'X 限流了，先导入已经读到的'});break;}
    if(res.status!==200){emit({error:'读取收藏失败：HTTP '+res.status,detail:res.text.slice(0,200)});break;}
    const {items,cursor:next}=parseBookmarks(JSON.parse(res.text));pages++;
    if(!items.length)break;
    for(const it of items){if(known.has(it.tweet_id)){stopAtKnown=true;continue;}if(!all.some(x=>x.tweet_id===it.tweet_id))all.push(it);}
    if(stopAtKnown&&items.every(it=>known.has(it.tweet_id)))break;
    if(!next||next===cursor)break;cursor=next;await sleep(800);
  }
  emit({ok:true,items:all,pages});
}

async function findDeleteQid(page){
  return page.evaluate(async()=>{
    const urls=[...new Set([...document.scripts].map(s=>s.src).concat(performance.getEntriesByType('resource').map(e=>e.name)).filter(u=>/abs\.twimg\.com\/.+\.js/.test(u)))];
    urls.sort((a,b)=>(/\/main\./.test(b)?1:0)-(/\/main\./.test(a)?1:0));
    for(const u of urls){try{const t=await (await fetch(u)).text();const m=t.match(/queryId:"([\w-]+)",operationName:"DeleteBookmark"/);if(m)return m[1];}catch(e){}}
    return null;
  });
}

async function removeAll(job){
  let {page,getCaptured}=await openBookmarks(true);
  const cap=await waitForApi(page,getCaptured,25000);
  if(!cap){emit(needLogin(page)?{needLogin:true}:{error:'收藏页没加载出来'});return;}
  const headers=Object.fromEntries(Object.entries(cap.headers).filter(([k])=>/^(authorization|x-csrf-token|x-twitter-[a-z-]+|accept-language)$/i.test(k)));headers['content-type']='application/json';
  const qid=await findDeleteQid(page);
  const done=[],failed=[];
  for(const id of job.ids||[]){
    let ok=false;
    if(qid){
      const r=await page.evaluate(async([qid,id,headers])=>{const r=await fetch(`https://x.com/i/api/graphql/${qid}/DeleteBookmark`,{method:'POST',headers,credentials:'include',body:JSON.stringify({variables:{tweet_id:id},queryId:qid})});return {status:r.status,text:await r.text()};},[qid,id,headers]);
      ok=r.status===200&&/Done|tweet_bookmark_delete/.test(r.text);
      if(r.status===429){failed.push(...(job.ids||[]).filter(x=>!done.includes(x)&&x!==id),id);emit({warn:'X 限流了，剩下的下次再取消'});break;}
    }
    if(!ok){
      // 接口没找到时，退回到在页面上点「取消收藏」按钮
      try{const a=page.locator(`article:has(a[href*="/status/${id}"])`).first();await a.scrollIntoViewIfNeeded({timeout:5000});await a.locator('[data-testid="removeBookmark"]').click({timeout:5000});ok=true;}catch(e){}
    }
    (ok?done:failed).push(id);await sleep(500);
  }
  emit({ok:true,removed:done,failed,api:!!qid});
}

async function login(){
  const profile=path.join(os.homedir(),'.gzh-studio','x-article-browser');fs.mkdirSync(profile,{recursive:true,mode:0o700});
  ctx=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:null});
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto('https://x.com/i/bookmarks',{waitUntil:'domcontentloaded'});
  emit({status:'login',message:'浏览器已打开，请在里面登录 X。登录后看到收藏页就会自动关闭。'});
  const t0=Date.now();
  while(Date.now()-t0<10*60*1000){await sleep(1500);try{if(/\/i\/bookmarks/.test(page.url())&&await page.locator('[data-testid="primaryColumn"]').count()){await sleep(2000);emit({ok:true,loggedIn:true});return;}}catch(e){}}
  emit({error:'10 分钟内没完成登录'});
}

async function main(){
  const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  if(job.mode==='login')return login();
  if(job.mode==='remove')return removeAll(job);
  return fetchAll(job);
}
module.exports={parseBookmarks};
if(require.main===module)main().catch(e=>{emit({error:String(e&&e.message||e).slice(0,300)});process.exitCode=1;}).finally(async()=>{if(ctx)await ctx.close().catch(()=>{});});
