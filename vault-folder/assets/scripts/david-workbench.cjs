#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const vault=path.resolve(__dirname,'../..');
const api=require(path.join(vault,'公众号写作台','工作台接口.cjs'));
const dir=api.socketDir(vault),argv=process.argv.slice(2);
const print=v=>process.stdout.write(JSON.stringify(v,null,2)+'\n');
async function main(){const command=argv.shift()||'help';if(['help','--help','-h'].includes(command)){print({usage:'node assets/scripts/david-workbench.cjs <命令> [JSON参数或 --args-file 参数文件] [--wait 秒]',examples:['status','topics.list {"stage":"准备中"}','draft.read {"path":"公众号写作台/稿件/文章.md"}','x.list {"postDate":"2026-10-13"}','x.add --args-file /tmp/x-add.json','x.update --args-file /tmp/x-update.json','x.remove --args-file /tmp/x-remove.json','x.today','x.fill-library {"count":5} --wait 60','x.generate --wait 60','x.write-candidates --wait 60','x.convert {"postDate":"2026-10-13","id":"x-…","format":"thread"}','x.rewrite --args-file /tmp/x-rewrite.json','radar.list','radar.refresh {"batch":"18:00"}','radar.complete {"date":"2026-10-13","id":"…"}','growth.set {"count":180}','library.reminders','job <任务编号>'],commands:api.commands});return;}
 if(command==='job'){const id=argv[0];if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('任务编号无效');const f=path.join(dir,id+'.result.json');if(!fs.existsSync(f)){print({id,status:'pending'});return;}const r=JSON.parse(fs.readFileSync(f,'utf8'));print(r);if(r.status==='failed')process.exitCode=1;return;}
 if(!Object.hasOwn(api.commands,command))throw Error('未知命令，请运行 help');
 const wi=argv.indexOf('--wait');let wait=10;if(wi>=0){wait=Number(argv[wi+1]);argv.splice(wi,2);}if(!Number.isFinite(wait)||wait<0||wait>60)throw Error('--wait 须为 0 至 60 秒');
 const ai=argv.indexOf('--args-file');let args;if(ai>=0){const file=argv[ai+1];if(!file)throw Error('--args-file 缺少路径');args=JSON.parse(fs.readFileSync(file,'utf8'));argv.splice(ai,2);if(argv.length)throw Error('JSON 参数与 --args-file 只能选一个');}else{args=argv.length?JSON.parse(argv[0]):{};if(argv.length>1)throw Error('参数请作为一个 JSON 对象传入');}
 let bridge;try{bridge=JSON.parse(fs.readFileSync(path.join(dir,'bridge.json'),'utf8'));}catch{}if(!bridge||Date.now()-bridge.at>10000)throw Error('插件接口未连接。请打开 Obsidian 并重载戴卫得AI工作台插件。');
 const id=crypto.randomUUID(),f=path.join(dir,id+'.result.json');api.atomic(path.join(dir,id+'.request.json'),{id,at:Date.now(),command,args});
 const until=Date.now()+wait*1000;do{if(fs.existsSync(f)){const r=JSON.parse(fs.readFileSync(f,'utf8'));if(['completed','failed'].includes(r.status)){print(r);if(r.status==='failed')process.exitCode=1;return;}}await new Promise(r=>setTimeout(r,250));}while(Date.now()<until);
 print({id,status:fs.existsSync(f)?'running':'pending',next:'node assets/scripts/david-workbench.cjs job '+id});
}
main().catch(e=>{print({status:'failed',error:e.message});process.exitCode=1;});
