import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { materializeFile, MaterializationError } from '../dist/imermcp-local/file-materialization.js';
import { getFileMaterializationTools, handleFileMaterializationTool, sanitizeMaterializationTrackingArgs } from '../dist/imermcp-local/file-materialization-tools.js';

const base = 'D:\\052.imermcp-c3-materialization-e2e';
const root = path.join(base, 'materialized');
const sourceRoot = path.join(base, 'authorized-source');
const outsideRoot = path.join(base, 'outside-source');
process.env.IMERMCP_MATERIALIZATION_ROOT = root;
process.env.IMERMCP_MATERIALIZATION_SOURCE_ROOTS = sourceRoot;
process.env.IMERMCP_MATERIALIZATION_PROJECTS = 'c3test';
process.env.IMERMCP_MATERIALIZATION_MAX_INLINE_BYTES = String(256 * 1024);
process.env.IMERMCP_MATERIALIZATION_MAX_FILE_BYTES = String(1024 * 1024);
process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES = String(2 * 1024 * 1024);

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const make = (request, dest, bytes, extra = {}) => ({
  request_id: request, project_id: 'c3test', artifact_id: `artifact-${request}`,
  destination_name: dest, bytes_base64: bytes.toString('base64'),
  expected_byte_length: bytes.length, expected_sha256: hash(bytes), ...extra,
});
async function expectCode(fn, code) {
  try { await fn(); assert.fail(`expected ${code}`); }
  catch (error) { assert(error instanceof MaterializationError); assert.equal(error.code, code); }
}

await fs.rm(base, { recursive: true, force: true });
await fs.mkdir(sourceRoot, { recursive: true });
await fs.mkdir(outsideRoot, { recursive: true });
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: String(error?.stack ?? error) }); }
};

await check('tool-schema', async () => {
  const tools = getFileMaterializationTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'imermcp_materialize_file');
  assert.equal(tools[0].annotations.destructiveHint, false);
});

const alpha = Buffer.from('C3-alpha\n', 'utf8');
await check('inline-materialize', async () => {
  const r = await materializeFile(make('req-alpha', 'alpha.txt', alpha));
  assert.equal(r.status, 'MATERIALIZED');
  assert.equal(r.local_file.sha256, hash(alpha));
  assert.deepEqual(await fs.readFile(r.local_file.source_path), alpha);
});
await check('exact-retry-no-second-effect', async () => {
  const r = await materializeFile(make('req-alpha', 'alpha.txt', alpha));
  assert.equal(r.status, 'ALREADY_MATERIALIZED');
});

await check('divergent-retry-bytes-fail-closed', async () => {
  const changed = Buffer.from('C3-changed\n');
  await expectCode(() => materializeFile(make('req-alpha', 'alpha.txt', changed)), 'INTENT_COLLISION');
});

await check('divergent-retry-destination-fail-closed', async () => {
  await expectCode(() => materializeFile(make('req-alpha', 'alpha-2.txt', alpha)), 'INTENT_COLLISION');
});

await check('same-destination-same-bytes-new-request', async () => {
  const r = await materializeFile(make('req-alpha-peer', 'alpha.txt', alpha));
  assert.equal(r.status, 'ALREADY_MATERIALIZED');
});

await check('same-destination-different-bytes-collision', async () => {
  const beta = Buffer.from('beta');
  await expectCode(() => materializeFile(make('req-alpha-collision', 'alpha.txt', beta)), 'DESTINATION_COLLISION');
});

await check('traversal-absolute-and-windows-aliases-rejected', async () => {
  await expectCode(() => materializeFile(make('req-traversal', '..\\escape.txt', alpha)), 'PATH_REJECTED');
  await expectCode(() => materializeFile(make('req-absolute', 'C:\\escape.txt', alpha)), 'PATH_REJECTED');
  for (const [i, name] of ['NUL', 'CON.txt', 'COM1.log', 'trail.', 'trail '].entries()) {
    await expectCode(() => materializeFile(make(`req-win-${i}`, name, alpha)), 'PATH_REJECTED');
  }
});
await check('hash-and-length-verification', async () => {
  await expectCode(() => materializeFile(make('req-badhash', 'badhash.txt', alpha, { expected_sha256: '0'.repeat(64) })), 'HASH_MISMATCH');
  await expectCode(() => materializeFile(make('req-badlen', 'badlen.txt', alpha, { expected_byte_length: alpha.length + 1 })), 'LENGTH_MISMATCH');
});

await check('zero-byte-materialization', async () => {
  const empty = Buffer.alloc(0);
  const r = await materializeFile(make('req-zero', 'zero.bin', empty));
  assert.equal(r.status, 'MATERIALIZED');
  assert.equal(r.local_file.byte_length, 0);
  assert.equal(r.local_file.sha256, hash(empty));
});

await check('max-file-boundary-and-plus-one', async () => {
  const prevInline = process.env.IMERMCP_MATERIALIZATION_MAX_INLINE_BYTES;
  const prevFile = process.env.IMERMCP_MATERIALIZATION_MAX_FILE_BYTES;
  try {
    process.env.IMERMCP_MATERIALIZATION_MAX_INLINE_BYTES = '16';
    process.env.IMERMCP_MATERIALIZATION_MAX_FILE_BYTES = '16';
    const atLimit = Buffer.alloc(16, 0x41);
    const overLimit = Buffer.alloc(17, 0x42);
    const accepted = await materializeFile(make('req-max16', 'max16.bin', atLimit));
    assert.equal(accepted.local_file.byte_length, 16);
    await expectCode(() => materializeFile(make('req-max17', 'max17.bin', overLimit)), 'FILE_TOO_LARGE');
  } finally {
    process.env.IMERMCP_MATERIALIZATION_MAX_INLINE_BYTES = prevInline;
    process.env.IMERMCP_MATERIALIZATION_MAX_FILE_BYTES = prevFile;
  }
});
await check('authorized-local-reference', async () => {
  const source = path.join(sourceRoot, 'source.bin');
  const bytes = crypto.randomBytes(4096);
  await fs.writeFile(source, bytes);
  const r = await materializeFile({
    request_id: 'req-source', project_id: 'c3test', artifact_id: 'artifact-source', destination_name: 'source.bin',
    source_path: source, expected_byte_length: bytes.length, expected_sha256: hash(bytes),
  });
  assert.equal(r.status, 'MATERIALIZED');
  assert.equal(r.local_file.sha256, hash(bytes));
});

await check('large-authorized-file-within-envelope', async () => {
  const source = path.join(sourceRoot, 'large.bin');
  const bytes = crypto.randomBytes(768 * 1024);
  await fs.writeFile(source, bytes);
  const r = await materializeFile({
    request_id: 'req-large', project_id: 'c3test', artifact_id: 'artifact-large', destination_name: 'large.bin',
    source_path: source, expected_byte_length: bytes.length, expected_sha256: hash(bytes),
  });
  assert.equal(r.status, 'MATERIALIZED');
  assert.equal(r.local_file.byte_length, bytes.length);
  assert.equal(r.local_file.sha256, hash(bytes));
});
await check('unauthorized-source-rejected', async () => {
  const outside = path.join(outsideRoot, 'outside.bin');
  const bytes = Buffer.from('outside');
  await fs.writeFile(outside, bytes);
  await expectCode(() => materializeFile({
    request_id: 'req-outside', project_id: 'c3test', artifact_id: 'artifact-outside', destination_name: 'outside.bin',
    source_path: outside, expected_byte_length: bytes.length, expected_sha256: hash(bytes),
  }), 'SOURCE_NOT_AUTHORIZED');
});
await check('junction-escape-rejected', async () => {
  const outsideDir = path.join(outsideRoot, 'junction-target');
  const junction = path.join(sourceRoot, 'junction');
  await fs.mkdir(outsideDir, { recursive: true });
  const bytes = Buffer.from('junction-escape');
  await fs.writeFile(path.join(outsideDir, 'escape.bin'), bytes);
  await fs.symlink(outsideDir, junction, 'junction');
  await expectCode(() => materializeFile({
    request_id: 'req-junction', project_id: 'c3test', artifact_id: 'artifact-junction', destination_name: 'junction.bin',
    source_path: path.join(junction, 'escape.bin'), expected_byte_length: bytes.length, expected_sha256: hash(bytes),
  }), 'SOURCE_NOT_AUTHORIZED');
});

await check('concurrent-exact-duplicate', async () => {
  const bytes = Buffer.from('concurrent-duplicate');
  const args = make('req-concurrent', 'concurrent.bin', bytes);
  const pair = await Promise.all([materializeFile(args), materializeFile(args)]);
  assert(pair.some(x => x.status === 'MATERIALIZED'));
  assert(pair.every(x => ['MATERIALIZED', 'ALREADY_MATERIALIZED'].includes(x.status)));
});

await check('interrupted-before-final-publish-fails-closed', async () => {
  const bytes = Buffer.from('interrupted-before-publish');
  const args = make('req-interrupted', 'interrupted.bin', bytes);
  const filesDir = path.join(root, 'c3test', 'files');
  const receiptsDir = path.join(root, 'c3test', '.receipts');
  const finalPath = path.join(filesDir, args.destination_name);
  const partialPath = path.join(filesDir, '.imer-materialize-interrupted.tmp');
  const receiptPath = path.join(receiptsDir, `${hash(Buffer.from(args.request_id, 'utf8'))}.json`);
  await fs.writeFile(partialPath, bytes.subarray(0, 5));
  await fs.writeFile(receiptPath, `${JSON.stringify({
    schema: 'imermcp.materialization_receipt/1', request_id: args.request_id, project_id: args.project_id,
    artifact_id: args.artifact_id, destination_name: args.destination_name, byte_length: bytes.length,
    sha256: hash(bytes), expires_at_utc: new Date(Date.now() + 60000).toISOString(),
  })}\n`, 'utf8');
  await expectCode(() => materializeFile(args), 'INCOMPLETE_NO_REPLAY');
  await assert.rejects(() => fs.stat(finalPath), error => error?.code === 'ENOENT');
  assert.equal((await fs.stat(partialPath)).isFile(), true);
  await fs.rm(partialPath, { force: true });
  await fs.rm(receiptPath, { force: true });
  const recovered = await materializeFile(args);
  assert.equal(recovered.status, 'MATERIALIZED');
});
await check('lost-response-retry', async () => {
  const bytes = Buffer.from('lost-response');
  const args = make('req-lost', 'lost.bin', bytes);
  await materializeFile(args); // response intentionally discarded
  const observed = await materializeFile(args);
  assert.equal(observed.status, 'ALREADY_MATERIALIZED');
  await expectCode(() => materializeFile({ ...args, destination_name: 'lost-second.bin' }), 'INTENT_COLLISION');
});
await check('project-authorization-denied', async () => {
  const args = { ...make('req-denied', 'denied.bin', alpha), project_id: 'not-authorized' };
  await expectCode(() => materializeFile(args), 'PROJECT_DENIED');
});

await check('quota-fails-before-durable-intent', async () => {
  const previous = process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES;
  const bytes = Buffer.from('quota');
  const args = make('req-quota', 'quota.bin', bytes);
  try {
    process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES = '1';
    await expectCode(() => materializeFile(args), 'QUOTA_EXCEEDED');
  } finally {
    process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES = previous;
  }
  const recovered = await materializeFile(args);
  assert.equal(recovered.status, 'MATERIALIZED');
});

await check('concurrent-aggregate-quota-is-serialized', async () => {
  const quotaRoot = path.join(base, 'quota-race');
  const previousRoot = process.env.IMERMCP_MATERIALIZATION_ROOT;
  const previousQuota = process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES;
  try {
    process.env.IMERMCP_MATERIALIZATION_ROOT = quotaRoot;
    process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES = '10';
    const a = Buffer.from('123456');
    const b = Buffer.from('abcdef');
    const settled = await Promise.allSettled([
      materializeFile(make('race-a', 'race-a.bin', a)),
      materializeFile(make('race-b', 'race-b.bin', b)),
    ]);
    assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
    const rejected = settled.find(x => x.status === 'rejected');
    assert(rejected && rejected.reason instanceof MaterializationError);
    assert.equal(rejected.reason.code, 'QUOTA_EXCEEDED');
    const filesDir = path.join(quotaRoot, 'c3test', 'files');
    const names = await fs.readdir(filesDir);
    let total = 0;
    for (const name of names) total += (await fs.stat(path.join(filesDir, name))).size;
    assert(total <= 10);
  } finally {
    process.env.IMERMCP_MATERIALIZATION_ROOT = previousRoot;
    process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES = previousQuota;
  }
});

await check('handler-and-tracking-do-not-echo-input-bytes', async () => {
  const secret = Buffer.from('SUPER_SECRET_SENTINEL');
  const args = make('req-secret', 'secret.bin', secret);
  const response = await handleFileMaterializationTool(args);
  const text = JSON.stringify(response);
  assert.equal(text.includes('SUPER_SECRET_SENTINEL'), false);
  assert.equal(text.includes(secret.toString('base64')), false);
  const tracked = sanitizeMaterializationTrackingArgs({ ...args, source_path: 'D:\\secret\\credential.bin' });
  const trackedText = JSON.stringify(tracked);
  assert.equal(trackedText.includes(secret.toString('base64')), false);
  assert.equal(trackedText.includes('credential.bin'), false);
  assert.equal('bytes_base64' in tracked, false);
  assert.equal('source_path' in tracked, false);
});

await check('no-partial-temp-files', async () => {
  const files = await fs.readdir(path.join(root, 'c3test', 'files'));
  assert.equal(files.some(x => x.startsWith('.imer-materialize-')), false);
});
const failures = results.filter(x => x.status !== 'PASS');
const report = {
  schema: 'imermcp.c3_materialization_test_report/1',
  total: results.length,
  pass: results.length - failures.length,
  fail: failures.length,
  results,
};
await fs.writeFile('c3-materialization-test-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;
