#!/usr/bin/env node
import fs from 'node:fs/promises'; import path from 'node:path'; import {randomUUID} from 'node:crypto';
process.env.IMERMCP_ENABLE_IMERTERM='1'; process.env.IMERMCP_IMERTERM_HOST_EXE=process.env.IMERMCP_TEST_IMERTERM_HOST_EXE; process.env.IMERMCP_IMERTERM_LOCAL_ROOT=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const {handleImerTermTool}=await import('../dist/imermcp-local/imerterm-tools.js'); const body=r=>r.structuredContent??JSON.parse(r.content.map(x=>x.text??'').join('\n')); const call=async(n,a={})=>body(await handleImerTermTool(n,a));
const id=randomUUID(), root=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const admitted=await call('imerterm_run_powershell',{task_id:id,created_at_utc:new Date().toISOString(),project_id:'imermcp-c2-e2e',target_id:'p53-c2-e2e',mutation_class:'NONE',capability:'POWERSHELL_EXEC',working_directory:path.join(root,'work'),script:"Write-Output 'RECOVERY_OK'; exit 0",timeout_ms:10000,graceful_stop_ms:1000,max_raw_output_bytes:65536,execution_mode:'ASYNC',admission_timeout_ms:2000});
if(admitted.status!=='ADMITTED') throw new Error('not admitted'); const done=await call('imerterm_task_wait',{task_id:id,poll_seconds:1,wait_timeout_seconds:10}); if(done.task.state!=='SUCCEEDED') throw new Error('not succeeded');
await fs.writeFile(path.join(root,'recovery-task-id.txt'),id,'utf8'); console.log(id);