import os from 'os'; import path from 'path'; import fs from 'fs';
const HOME=os.homedir();
const CLI=path.resolve('node_modules/@github/copilot-win32-x64/copilot.exe');
const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
function walk(d,n){if(n>=5||!fs.existsSync(d))return[];let e;try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return[]}const o=[];for(const x of e){if(!x.isDirectory())continue;if(x.name==='skills')o.push(path.join(d,x.name));else o.push(...walk(path.join(d,x.name),n+1))}return o}
const dirs=[path.join(HOME,'.claude','skills'),path.join(HOME,'.agents','skills'),...walk(path.join(HOME,'.claude','plugins','cache'),0)].filter(d=>fs.existsSync(d));
console.log('CLI:',CLI); console.log('dirs:',dirs.length);
const ID='probe144-'+Date.now();
const COMMON={model:'claude-sonnet-4.6',onPermissionRequest:approveAll,clientName:'vscode-copilot-cli',streaming:true,skillDirectories:dirs};
const P='Use your skill tool to load the skill named "brainstorming". Reply with exactly FOUND if it loaded, or exactly NOTFOUND if no such skill is available to you. Do not explain.';
const txt=r=>typeof r==='string'?r:(r?.content??JSON.stringify(r));
for (const [label,mk] of [['create',c=>c.createSession({sessionId:ID,...COMMON})],['resume',c=>c.resumeSession(ID,{...COMMON})]]) {
  const c=new CopilotClient({cliPath:CLI,cwd:process.cwd(),autoStart:true});
  try{ const s=await mk(c); const r=await s.sendAndWait({prompt:P}); const t=txt(r);
    console.log(label+':', /FOUND/.test(t)&&!/NOTFOUND/.test(t)?'FOUND':'NOTFOUND'); }
  catch(e){ console.log(label+': ERROR', e.message); }
  finally{ try{await c.stop()}catch{} }
}
fs.rmSync(path.join(HOME,'.copilot','session-state',ID),{recursive:true,force:true});
