import assert from 'node:assert/strict';
import { evaluateImerMcpDirectTerminalRoute } from '../dist/imermcp-local/rdc-effect-route.js';

const prior = process.env.IMERMCP_ENABLE_IMERTERM;
try {
  delete process.env.IMERMCP_ENABLE_IMERTERM;
  assert.deepEqual(evaluateImerMcpDirectTerminalRoute(['shutdown']), { route_required: false });

  process.env.IMERMCP_ENABLE_IMERTERM = '1';
  const shutdown = evaluateImerMcpDirectTerminalRoute(['shutdown']);
  assert.equal(shutdown.route_required, true);
  assert.equal(shutdown.reason_code, 'IMERTERM_ROUTE_REQUIRED');
  assert.ok(shutdown.next_allowed_tools.includes('imerterm_run_powershell'));

  const ssh = evaluateImerMcpDirectTerminalRoute(['ssh']);
  assert.equal(ssh.route_required, true);
  assert.ok(ssh.next_allowed_tools.includes('imerterm_run_ssh'));
  assert.deepEqual(evaluateImerMcpDirectTerminalRoute(['python']), { route_required: false });
  console.log('PASS ImerMCP direct governed effects require ImerTerm route');
} finally {
  if (prior === undefined) delete process.env.IMERMCP_ENABLE_IMERTERM;
  else process.env.IMERMCP_ENABLE_IMERTERM = prior;
}
