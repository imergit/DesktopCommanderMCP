#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const { server } = await import('../dist/server.js');
const { installFileMaterializationBoundary } = await import('../dist/imermcp-local/file-materialization-registration.js');
const { installBusinessGoldBoundary } = await import('../dist/imermcp-local/business-gold-registration.js');

installFileMaterializationBoundary(server);
installFileMaterializationBoundary(server);
installBusinessGoldBoundary(server);
installBusinessGoldBoundary(server);

const handlers = server._requestHandlers;
const list = handlers.get('tools/list');
const call = handlers.get('tools/call');
assert.equal(typeof list, 'function');
assert.equal(typeof call, 'function');

const listed = await list({ method: 'tools/list', params: {} }, {});
const c4Names = listed.tools
  .map(tool => tool.name)
  .filter(name => name === 'imermcp_business_capabilities' || name === 'imermcp_business_compose');
assert.deepEqual(c4Names.sort(), ['imermcp_business_capabilities', 'imermcp_business_compose']);
assert.equal(listed.tools.filter(tool => tool.name === 'imermcp_materialize_file').length, 1);

const plan = await call({
  method: 'tools/call',
  params: {
    name: 'imermcp_business_compose',
    arguments: { family: 'project_git_operations', operation: 'GIT_COMMIT_GOVERNED' },
  },
}, {});
assert.equal(plan.isError, undefined);
assert.equal(plan.structuredContent.status, 'COMPOSED_NO_EFFECT');
assert.equal(plan.structuredContent.route.provider, 'GITHUB_CONNECTOR');

const delegated = await call({ method: 'tools/call', params: { name: 'list_devices', arguments: {} } }, {});
assert.equal(delegated.isError, undefined);
assert.ok(Array.isArray(JSON.parse(delegated.content[0].text)));

const report = {
  schema: 'imermcp.c4_registration_report/1',
  status: 'PASS',
  business_tool_count: c4Names.length,
  c3_materialization_tool_count: 1,
  prior_handler_delegation: 'PASS',
  duplicate_install: 'IDEMPOTENT',
  compose_effect: 'NONE',
};
const reportPath = process.env.IMERMCP_C4_REGISTRATION_REPORT ?? 'c4-registration-report.json';
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log('C4_REGISTRATION_PASS');
