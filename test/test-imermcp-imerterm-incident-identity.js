#!/usr/bin/env node
import assert from 'node:assert/strict';
process.env.IMERMCP_ENABLE_IMERTERM='1';
delete process.env.IMERMCP_IMERTERM_HOST_EXE;
delete process.env.IMERMCP_IMERTERM_LOCAL_ROOT;
const { handleImerTermTool } = await import('../dist/imermcp-local/imerterm-tools.js');
const body = r => r.structuredContent ?? JSON.parse(r.content.map(x => x.text ?? '').join('\n'));
const base = {
  project_id:'imerterm', target_id:'p53', mutation_class:'PROJECT',
  capability:'POWERSHELL_EXEC', working_directory:'C:\\', script:"Write-Output 'NO_EFFECT'"
};
const missing = await handleImerTermTool('imerterm_run_powershell', base);
assert.equal(missing.isError, true);
assert.match(String(body(missing).message), /task_id and created_at_utc are required/);
const half = await handleImerTermTool('imerterm_run_powershell', { ...base, task_id:'11111111-1111-4111-8111-111111111111' });
assert.equal(half.isError, true);
assert.match(String(body(half).message), /must be supplied together/);
const explicitId='22222222-2222-4222-8222-222222222222';
const explicitCreated='2026-09-20T17:00:00.000Z';
const explicit = body(await handleImerTermTool('imerterm_run_powershell', {
  ...base, task_id:explicitId, created_at_utc:explicitCreated
}));
assert.equal(explicit.error_class, 'CONFIG_MISSING');
assert.equal(explicit.task_id, explicitId);
assert.equal(explicit.created_at_utc, explicitCreated);
const generated = body(await handleImerTermTool('imerterm_run_powershell', {
  ...base, mutation_class:'NONE'
}));
assert.equal(generated.error_class, 'CONFIG_MISSING');
assert.match(String(generated.task_id), /^[0-9a-f-]{36}$/i);
assert.ok(typeof generated.created_at_utc === 'string' && generated.created_at_utc.length > 0);
console.log('IMERMCP_INCIDENT_IDENTITY_PASS');
