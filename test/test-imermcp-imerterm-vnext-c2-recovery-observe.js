#!/usr/bin/env node
import fs from 'node:fs/promises'; import path from 'node:path';
process.env.IMERMCP_ENABLE_IMERTERM='1'; process.env.IMERMCP_IMERTERM_HOST_EXE=process.env.IMERMCP_TEST_IMERTERM_HOST_EXE; process.env.IMERMCP_IMERTERM_LOCAL_ROOT=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const {handleImerTermTool}=await import('../dist/imermcp-local/imerterm-tools.js'); const body=r=>r.structuredContent??JSON.parse(r.content.map(x=>x.text??'').join('\n'));
const root=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT, id=(await fs.readFile(path.join(root,'recovery-task-id.txt'),'utf8')).trim();
const shown=body(await handleImerTermTool('imerterm_task_show',{task_id:id})); if(shown.task.task_id!==id||shown.task.state!=='SUCCEEDED'||shown.task.terminal!==true) throw new Error('durable re-observation failed');
console.log('PASS restart/recovery preserves terminal task state and identity'); console.log('CHECKS=1 FAILURES=0'); console.log('IMERMCP_VNEXT_C2_RECOVERY_PASS');