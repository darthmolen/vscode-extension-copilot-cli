import { join } from 'node:path';
import { existsSync } from 'node:fs';
const REPO='/home/smolen/dev/vscode-copilot-cli-extension-lane-a';
const cli=join(REPO,'node_modules/@github/copilot-linux-x64/copilot');
const sdk=await import('@github/copilot-sdk');
const c=new sdk.CopilotClient({logLevel:'error',connection:{kind:'stdio',path:cli,args:[]},workingDirectory:REPO});
await c.start();
const parent=await c.createSession({clientName:'p2',streaming:false,onPermissionRequest:()=>({kind:'approve-once'})});
// emitStart: does a STARTED detached session get listed / resumed?
const opened=await c.rpc.sessions.open({kind:'create',emitStart:true,options:{workingDirectory:REPO,detachedFromSpawningParentSessionId:parent.sessionId}});
const id=opened?.sessionId??opened?.id;
console.log('opened(emitStart):',id, JSON.stringify(opened).slice(0,120));
const dir=join(process.env.HOME,'.copilot','session-state',id);
console.log('.detached marker :', existsSync(join(dir,'.detached')));
console.log('events.jsonl     :', existsSync(join(dir,'events.jsonl')));
for (const [label,params] of [['includeDetached:true',{includeDetached:true}],['default',{}]]) {
  const r=await c.rpc.sessions.list(params);
  const rows=r?.sessions??r?.metadata??r??[];
  const arr=Array.isArray(rows)?rows:[];
  const hit=arr.find(x=>(x?.sessionId??x?.id)===id);
  console.log(`list ${label.padEnd(20)} rows=${arr.length} contains=${!!hit}${hit?' isDetached='+JSON.stringify(hit.isDetached):''}`);
}
try { const r=await c.resumeSession(id,{clientName:'p2c',streaming:false,onPermissionRequest:()=>({kind:'approve-once'})}); console.log('resume           : OK', r.sessionId); await r.destroy(); }
catch(e){ console.log('resume           : FAILED —', e.message.slice(0,90)); }
try{await parent.destroy();}catch{}
await c.stop();
