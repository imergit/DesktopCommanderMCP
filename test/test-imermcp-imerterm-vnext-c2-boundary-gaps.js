#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
process.env.IMERMCP_ENABLE_IMERTERM='1';
process.env.IMERMCP_IMERTERM_HOST_EXE=process.env.IMERMCP_TEST_IMERTERM_HOST_EXE;
process.env.IMERMCP_IMERTERM_LOCAL_ROOT=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const { handleImerTermTool } = await import('../dist/imermcp-local/imerterm-tools.js');
const body=r=>r.structuredContent??JSON.parse(r.content.map(x=>x.text??'').join('\n'));
const call=async(n,a={})=>body(await handleImerTermTool(n,a));
const root=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const host=process.env.IMERMCP_TEST_IMERTERM_HOST_EXE;
const project='imermcp-c2-e2e', target='p53-c2-e2e', work=path.join(root,'work');
const base=(id,script,extra={})=>({task_id:id,created_at_utc:new Date().toISOString(),project_id:project,target_id:target,mutation_class:'NONE',capability:'POWERSHELL_EXEC',working_directory:work,script,timeout_ms:15000,graceful_stop_ms:1000,max_raw_output_bytes:65536,execution_mode:'ASYNC',admission_timeout_ms:2000,...extra});
async function rawControl(payload){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'c2-cross-ingress-'));
  const file=path.join(dir,'control.json'); await fs.writeFile(file,JSON.stringify(payload));
  try{return await new Promise((resolve,reject)=>{const p=spawn(host,['--local-cli-control-file',file],{shell:false,env:{...process.env,IMERTERM_LOCAL_ROOT:root}});let o='',e='';p.stdout.on('data',x=>o+=x);p.stderr.on('data',x=>e+=x);p.on('error',reject);p.on('close',c=>c===0?resolve(JSON.parse(o)):reject(new Error(`control exit=${c} stderr=${e}`)));});}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
let checks=0; const pass=x=>{checks++;console.log('PASS '+x);};const beforeMarker=path.join(work,'cancel-before-effect.txt'); await fs.rm(beforeMarker,{force:true});
const beforeId=randomUUID(); const before=await call('imerterm_run_powershell',base(beforeId,`Start-Sleep -Seconds 5; Set-Content -LiteralPath '${beforeMarker.replaceAll('\\','\\\\')}' -Value EFFECT; exit 0`));
assert.equal(before.status,'ADMITTED'); const rawCancel=await rawControl({schema:'imerterm.local_control/1',operation:'TASK_CANCEL',task_id:beforeId});
assert.equal(rawCancel.task?.task_id,beforeId); const beforeDone=await call('imerterm_task_wait',{task_id:beforeId,poll_seconds:1,wait_timeout_seconds:10});
assert.equal(beforeDone.task.terminal,true); assert.equal(await fs.stat(beforeMarker).then(()=>true,()=>false),false); pass('cross-ingress cancel before effect prevents effect');
const afterMarker=path.join(work,'cancel-after-effect.txt'); await fs.rm(afterMarker,{force:true});
const afterId=randomUUID(); const after=await call('imerterm_run_powershell',base(afterId,`Set-Content -LiteralPath '${afterMarker.replaceAll('\\','\\\\')}' -Value EFFECT; Start-Sleep -Seconds 4; exit 0`));
assert.equal(after.status,'ADMITTED'); for(let i=0;i<20;i++){if(await fs.stat(afterMarker).then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,100));}
assert.equal(await fs.stat(afterMarker).then(()=>true,()=>false),true); const afterCancel=await rawControl({schema:'imerterm.local_control/1',operation:'TASK_CANCEL',task_id:afterId});
assert.equal(afterCancel.task?.task_id,afterId); const afterDone=await call('imerterm_task_wait',{task_id:afterId,poll_seconds:1,wait_timeout_seconds:10}); assert.equal(afterDone.task.terminal,true); pass('cross-ingress cancel after effect never creates second effect authority');
const outId=randomUUID(); const out=await call('imerterm_run_powershell',base(outId,"'X'*200000 | Write-Output; exit 0",{max_raw_output_bytes:1024})); assert.equal(out.status,'ADMITTED');
const outDone=await call('imerterm_task_wait',{task_id:outId,poll_seconds:1,wait_timeout_seconds:10}); assert.equal(outDone.task.terminal,true); assert.notEqual(outDone.task.state,'SUCCEEDED'); pass('output bound fails closed at ImerTerm authority');
const huge='A'.repeat(600000); const hugeResp=await handleImerTermTool('imerterm_run_powershell',base(randomUUID(),`Write-Output '${huge}'; exit 0`)); assert.equal(hugeResp.isError,true); const hugeBody=body(hugeResp); assert.equal(hugeBody.error_class,'REQUEST_TOO_LARGE'); pass('request bound rejects oversized adapter payload pre-effect');
const list=await call('imerterm_task_list',{project_id:project,limit:100}); const listJson=JSON.stringify(list.task_list); assert.ok(!/secret|script|raw_output|standardoutput/i.test(listJson));
const journal=await call('imerterm_task_journal',{task_id:afterId}); const journalJson=JSON.stringify(journal.task_journal); assert.ok(!/secret|script|raw_output|standardoutput/i.test(journalJson)); pass('LIST/JOURNAL do not leak payloads or secrets');
console.log(`CHECKS=${checks} FAILURES=0`); console.log('IMERMCP_VNEXT_C2_BOUNDARY_GAPS_PASS');