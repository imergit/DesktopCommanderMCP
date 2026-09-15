import assert from 'node:assert/strict';

const prior = process.env.IMERMCP_ENABLE_IMERTERM;
try {
  process.env.IMERMCP_ENABLE_IMERTERM = '1';
  const url = new URL(`../dist/ui/resources.js?imermcp=${Date.now()}`, import.meta.url);
  const { listUiResources, readUiResource } = await import(url.href);
  const resources = listUiResources();
  assert.equal(resources.length, 2);
  assert.ok(resources.every((resource) => resource.name.startsWith('ImerMCP ')));

  for (const resource of resources) {
    const result = await readUiResource(resource.uri);
    const content = result.contents[0];
    assert.deepEqual(content._meta.ui.csp.connectDomains, []);
    assert.deepEqual(content._meta.ui.csp.resourceDomains, []);
    assert.match(content.text, /ImerMCP/);
  }
  console.log('PASS ImerMCP UI branding + restrictive empty-domain CSP metadata');
} finally {
  if (prior === undefined) delete process.env.IMERMCP_ENABLE_IMERTERM;
  else process.env.IMERMCP_ENABLE_IMERTERM = prior;
}
