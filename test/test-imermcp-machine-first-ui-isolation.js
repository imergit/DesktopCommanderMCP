import assert from 'node:assert/strict';

process.env.IMERMCP_ENABLE_IMERTERM = '1';
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error('IMERMCP_MUST_NOT_FETCH_DESKTOP_COMMANDER_FLAGS');
};

const { featureFlagManager } = await import('../dist/utils/feature-flags.js');
const { shouldShowMcpUiPreviews } = await import('../dist/utils/mcp-ui-ab-test.js');

await featureFlagManager.initialize();
assert.equal(fetchCalls, 0, 'ImerMCP mode must not fetch external Desktop Commander feature flags');
assert.equal(await shouldShowMcpUiPreviews(), false, 'ImerMCP mode must not advertise MCP UI output templates');

console.log('IMERMCP_MACHINE_FIRST_UI_ISOLATION_PASS');
