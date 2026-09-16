#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.IMERMCP_ENABLE_IMERTERM='1';
process.env.IMERMCP_IMERTERM_HOST_EXE=process.env.IMERMCP_TEST_IMERTERM_HOST_EXE;
process.env.IMERMCP_IMERTERM_LOCAL_ROOT=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const { handleImerTermTool } = await import('../dist/imermcp-local/imerterm-tools.js');
const body=r=>r.structuredContent??JSON.parse(r.content.map(x=>x.text??'').join('\n'));
const call=async(name,args={})=>body(await handleImerTermTool(name,args));
const id=randomUUID(), created=new Date().toISOString();
const root=process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
const req={task_id:id,created_at_utc:created,project_id:'imermcp-c2-e2e',target_id:'p53-c2-e2e',mutation_class:'NONE',capability:'POWERSHELL_EXEC',working_directory:path.join(root,'work'),script:"Start-Sleep -Milliseconds 800; Write-Output 'LOST_RESPONSE_OK'; exit 0",timeout_ms:10000,graceful_stop_ms:1000,max_raw_output_bytes:65536,execution_mode:'ASYNC',admission_timeout_ms:2000};
await call('imerterm_run_powershell',req); // deliberately discard simulated lost MCP response
const observed=await call('imerterm_task_show',{task_id:id});
assert.equal(observed.task.task_id,id); assert.equal(observed.task.terminal,false);
const terminal=await call('imerterm_task_wait',{task_id:id,poll_seconds:1,wait_timeout_seconds:10});
assert.equal(terminal.task.task_id,id); assert.equal(terminal.task.state,'SUCCEEDED');
console.log('PASS lost admission/MCP response recovers by same task_id observation without replay');
console.log('CHECKS=1 FAILURES=0');
console.log('IMERMCP_VNEXT_C2_LOST_RESPONSE_PASS');