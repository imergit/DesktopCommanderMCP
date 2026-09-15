import assert from 'node:assert/strict';
import path from 'node:path';

const prior = process.env.IMERMCP_CONFIG_FILE;
try {
  const expected = path.resolve('test', '.tmp-imermcp', 'config.json');
  process.env.IMERMCP_CONFIG_FILE = expected;
  const moduleUrl = new URL(`../dist/config.js?isolation=${Date.now()}`, import.meta.url);
  const { CONFIG_FILE, TOOL_CALL_FILE } = await import(moduleUrl.href);
  assert.equal(CONFIG_FILE, expected);
  assert.equal(TOOL_CALL_FILE, path.join(path.dirname(expected), 'claude_tool_call.log'));
  console.log('PASS ImerMCP config file override isolates Desktop Commander state');
} finally {
  if (prior === undefined) delete process.env.IMERMCP_CONFIG_FILE;
  else process.env.IMERMCP_CONFIG_FILE = prior;
}
