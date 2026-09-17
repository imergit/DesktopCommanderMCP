import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, link, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ROOT = 'C:\\ProgramData\\ImerMCP\\materialized';
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 512 * 1024 * 1024;
const DEFAULT_RETENTION_SECONDS = 3600;
const DEFAULT_SWEEP_INTERVAL_SECONDS = 300;
const MAX_SWEEP_ENTRIES = 4096;
const MAX_REQUEST_ID_LENGTH = 128;
const HASH_RE = /^[0-9a-f]{64}$/i;

export class MaterializationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MaterializationError';
  }
}

type MaterializeArgs = {
  request_id: string;
  project_id: string;
  artifact_id: string;
  destination_name: string;
  source_path?: string;
  bytes_base64?: string;
  expected_sha256?: string;
  expected_byte_length?: number;
};
type MaterializationResult = {
  schema: 'imermcp.materialized_file/1';
  status: 'MATERIALIZED' | 'ALREADY_MATERIALIZED';
  request_id: string;
  project_id: string;
  artifact_id: string;
  local_file: {
    source_kind: 'LOCAL_FILE';
    source_path: string;
    byte_length: number;
    sha256: string;
  };
  cleanup: {
    owner: 'IMERMCP';
    temporary: 'REMOVED_ON_FAILURE_OR_SUCCESS';
    final: 'TTL_BOUNDED';
    expires_at_utc: string;
    sweep_interval_seconds: number;
  };
};

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new MaterializationError('CONFIG_INVALID', `${name} must be a positive integer.`);
  return value;
}
function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new MaterializationError('INVALID_REQUEST', `${key} is required.`);
  return value;
}

function isWindowsReservedName(value: string): boolean {
  const stem = value.split('.')[0]?.toUpperCase() ?? '';
  return ['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$'].includes(stem) || /^COM[1-9]$/.test(stem) || /^LPT[1-9]$/.test(stem);
}

function safeToken(value: string, label: string): string {
  if (value.length > MAX_REQUEST_ID_LENGTH || value === '.' || value === '..' || value.endsWith('.') || isWindowsReservedName(value) || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new MaterializationError('PATH_REJECTED', `${label} contains forbidden path syntax.`);
  }
  return value;
}

function safeLeaf(value: string): string {
  if (value.length > 255 || value === '.' || value === '..' || value.endsWith('.') || value.endsWith(' ') || isWindowsReservedName(value) || /[\x00-\x1f\\/:*?"<>|]/.test(value)) {
    throw new MaterializationError('PATH_REJECTED', 'destination_name must be one safe filesystem leaf name.');
  }
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function allowedProjects(): Set<string> {
  const raw = process.env.IMERMCP_MATERIALIZATION_PROJECTS?.trim();
  if (!raw) throw new MaterializationError('AUTHORIZATION_CONFIG_MISSING', 'IMERMCP_MATERIALIZATION_PROJECTS is required.');
  return new Set(raw.split(',').map(x => x.trim()).filter(Boolean));
}

function materializationRoot(): string {
  const root = process.env.IMERMCP_MATERIALIZATION_ROOT?.trim() || DEFAULT_ROOT;
  if (!path.isAbsolute(root)) throw new MaterializationError('CONFIG_INVALID', 'Materialization root must be absolute.');
  return path.normalize(root);
}

function sourceRoots(): string[] {
  const raw = process.env.IMERMCP_MATERIALIZATION_SOURCE_ROOTS?.trim();
  if (!raw) return [];
  return raw.split(path.delimiter).map(x => x.trim()).filter(Boolean).map(x => {
    if (!path.isAbsolute(x)) throw new MaterializationError('CONFIG_INVALID', 'Authorized source roots must be absolute.');
    return path.normalize(x);
  });
}

async function ensureNoSymlink(p: string): Promise<void> {
  const s = await lstat(p);
  if (s.isSymbolicLink()) throw new MaterializationError('REPARSE_ESCAPE', 'Symbolic/reparse path rejected by materialization policy.');
}
async function realAuthorizedSource(sourcePath: string): Promise<string> {
  if (!path.isAbsolute(sourcePath)) throw new MaterializationError('SOURCE_REJECTED', 'source_path must be absolute.');
  const roots = sourceRoots();
  if (roots.length === 0) throw new MaterializationError('AUTHORIZATION_CONFIG_MISSING', 'No authorized source roots are configured.');
  const sourceReal = await realpath(path.normalize(sourcePath));
  await ensureNoSymlink(sourcePath);
  for (const root of roots) {
    await access(root, fsConstants.R_OK);
    const rootReal = await realpath(root);
    await ensureNoSymlink(root);
    if (isWithin(rootReal, sourceReal)) return sourceReal;
  }
  throw new MaterializationError('SOURCE_NOT_AUTHORIZED', 'source_path is outside authorized source roots.');
}

function strictBase64(value: string): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new MaterializationError('INVALID_BASE64', 'bytes_base64 is not canonical Base64.');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new MaterializationError('INVALID_BASE64', 'bytes_base64 failed canonical round-trip validation.');
  return decoded;
}
async function sourceBytes(args: MaterializeArgs, maxFileBytes: number): Promise<{ bytes: Buffer; kind: 'INLINE_BASE64' | 'LOCAL_AUTHORIZED_FILE' }> {
  const hasInline = args.bytes_base64 !== undefined;
  const hasPath = args.source_path !== undefined;
  if (hasInline === hasPath) throw new MaterializationError('INVALID_REQUEST', 'Exactly one of bytes_base64 or source_path is required.');
  if (hasInline) {
    const maxInline = Math.min(envPositiveInt('IMERMCP_MATERIALIZATION_MAX_INLINE_BYTES', 256 * 1024), maxFileBytes);
    const bytes = strictBase64(args.bytes_base64!);
    if (bytes.length > maxInline) throw new MaterializationError('FILE_TOO_LARGE', `Inline bytes exceed ${maxInline}.`);
    return { bytes, kind: 'INLINE_BASE64' };
  }
  const source = await realAuthorizedSource(args.source_path!);
  const handle = await open(source, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new MaterializationError('SOURCE_REJECTED', 'Authorized source must be a regular file.');
    if (before.size > maxFileBytes) throw new MaterializationError('FILE_TOO_LARGE', `Source exceeds ${maxFileBytes}.`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) throw new MaterializationError('SOURCE_CHANGED', 'Source changed while being materialized.');
    return { bytes, kind: 'LOCAL_AUTHORIZED_FILE' };
  } finally {
    await handle.close();
  }
}
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileIdentity(filePath: string): Promise<{ byte_length: number; sha256: string }> {
  const s = await stat(filePath);
  if (!s.isFile()) throw new MaterializationError('DESTINATION_INVALID', 'Materialized destination is not a regular file.');
  const bytes = await readFile(filePath);
  if (bytes.length !== s.size) throw new MaterializationError('DESTINATION_CHANGED', 'Destination changed while being verified.');
  return { byte_length: bytes.length, sha256: sha256(bytes) };
}

async function aggregateBytes(filesDir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(filesDir)) {
    if (name.startsWith('.imer-materialize-')) continue;
    const p = path.join(filesDir, name);
    const s = await lstat(p);
    if (s.isSymbolicLink()) throw new MaterializationError('REPARSE_ESCAPE', `Unexpected reparse entry in materialization root: ${name}`);
    if (!s.isFile()) throw new MaterializationError('DESTINATION_INVALID', `Unexpected non-file in materialization root: ${name}`);
    total += s.size;
  }
  return total;
}
type Receipt = {
  schema: 'imermcp.materialization_receipt/1';
  request_id: string;
  project_id: string;
  artifact_id: string;
  destination_name: string;
  byte_length: number;
  sha256: string;
  expires_at_utc: string;
};

function receiptName(requestId: string): string {
  return `${createHash('sha256').update(requestId, 'utf8').digest('hex')}.json`;
}

async function readReceipt(receiptPath: string): Promise<Receipt | null> {
  try {
    const raw = await readFile(receiptPath, 'utf8');
    const value = JSON.parse(raw) as Receipt;
    if (value.schema !== 'imermcp.materialization_receipt/1' || !value.expires_at_utc || !Number.isFinite(Date.parse(value.expires_at_utc))) throw new Error('bad schema');
    return value;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw new MaterializationError('RECEIPT_INVALID', 'Existing materialization receipt is invalid.');
  }
}
async function atomicPublishBytes(bytes: Buffer, finalPath: string): Promise<void> {
  const dir = path.dirname(finalPath);
  const tempPath = path.join(dir, `.imer-materialize-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(tempPath, 'wx');
    created = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(tempPath, finalPath);
  } catch (error: any) {
    if (error?.code === 'EEXIST') throw new MaterializationError('DESTINATION_EXISTS', 'Destination already exists.');
    throw error;
  } finally {
    if (created) await rm(tempPath, { force: true });
  }
}

async function atomicPublishReceipt(receipt: Receipt, receiptPath: string): Promise<void> {
  const temp = `${receiptPath}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', flag: 'wx' });
  try { await link(temp, receiptPath); } catch (error: any) { if (error?.code !== 'EEXIST') throw error; } finally { await rm(temp, { force: true }); }
}

async function sweepProject(projectRoot: string, retentionSeconds: number): Promise<void> {
  const cutoff = Date.now() - retentionSeconds * 1000;
  const filesDir = path.join(projectRoot, 'files');
  const receiptsDir = path.join(projectRoot, '.receipts');
  try {
    for (const name of (await readdir(filesDir)).slice(0, MAX_SWEEP_ENTRIES)) {
      const p = path.join(filesDir, name);
      const s = await lstat(p);
      if (s.isFile() && s.mtimeMs <= cutoff) await rm(p, { force: true });
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  try {
    for (const name of (await readdir(receiptsDir)).slice(0, MAX_SWEEP_ENTRIES)) {
      if (!name.endsWith('.json')) continue;
      const p = path.join(receiptsDir, name);
      const receipt = await readReceipt(p);
      if (receipt && Date.parse(receipt.expires_at_utc) <= Date.now()) await rm(p, { force: true });
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
}

let materializationTail: Promise<void> = Promise.resolve();
async function withMaterializationLock<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const prior = materializationTail;
  materializationTail = prior.then(() => gate, () => gate);
  await prior.catch(() => undefined);
  try { return await operation(); } finally { release(); }
}

async function sweepConfiguredProjectsUnlocked(): Promise<void> {
  const raw = process.env.IMERMCP_MATERIALIZATION_PROJECTS?.trim();
  if (!raw) return;
  const root = materializationRoot();
  const retention = envPositiveInt('IMERMCP_MATERIALIZATION_RETENTION_SECONDS', DEFAULT_RETENTION_SECONDS);
  for (const project of raw.split(',').map(x => x.trim()).filter(Boolean).slice(0, 64)) {
    await sweepProject(path.join(root, safeToken(project, 'project_id')), retention);
  }
}

let janitorStarted = false;
export function startMaterializationJanitor(): void {
  if (janitorStarted) return;
  janitorStarted = true;
  let intervalSeconds = DEFAULT_SWEEP_INTERVAL_SECONDS;
  try { intervalSeconds = envPositiveInt('IMERMCP_MATERIALIZATION_SWEEP_INTERVAL_SECONDS', DEFAULT_SWEEP_INTERVAL_SECONDS); } catch { /* materializeFile will surface invalid config */ }
  const sweep = () => withMaterializationLock(sweepConfiguredProjectsUnlocked);
  const timer = setInterval(() => { void sweep().catch(() => undefined); }, intervalSeconds * 1000);
  timer.unref();
  void sweep().catch(() => undefined);
}

async function result(
  status: MaterializationResult['status'], args: MaterializeArgs, finalPath: string,
  identity: { byte_length: number; sha256: string }, retentionSeconds: number, sweepIntervalSeconds: number,
): Promise<MaterializationResult> {
  const fileStat = await stat(finalPath);
  const expiresAt = new Date(fileStat.mtimeMs + retentionSeconds * 1000).toISOString();
  return {
    schema: 'imermcp.materialized_file/1', status,
    request_id: args.request_id, project_id: args.project_id, artifact_id: args.artifact_id,
    local_file: { source_kind: 'LOCAL_FILE', source_path: finalPath, ...identity },
    cleanup: {
      owner: 'IMERMCP', temporary: 'REMOVED_ON_FAILURE_OR_SUCCESS', final: 'TTL_BOUNDED',
      expires_at_utc: expiresAt, sweep_interval_seconds: sweepIntervalSeconds,
    },
  };
}

function validateExpected(args: MaterializeArgs, identity: { byte_length: number; sha256: string }): void {
  if (!HASH_RE.test(args.expected_sha256 ?? '')) throw new MaterializationError('INVALID_REQUEST', 'expected_sha256 is required and must be 64 hexadecimal characters.');
  if (!Number.isSafeInteger(args.expected_byte_length) || (args.expected_byte_length ?? -1) < 0) throw new MaterializationError('INVALID_REQUEST', 'expected_byte_length is required and must be a non-negative integer.');
  if (identity.byte_length !== args.expected_byte_length) throw new MaterializationError('LENGTH_MISMATCH', 'Materialized byte length does not match expected_byte_length.');
  if (identity.sha256 !== args.expected_sha256!.toLowerCase()) throw new MaterializationError('HASH_MISMATCH', 'Materialized SHA-256 does not match expected_sha256.');
}

async function materializeFileUnlocked(rawArgs: Record<string, unknown>): Promise<MaterializationResult> {
  const args = rawArgs as MaterializeArgs;
  args.request_id = safeToken(requiredString(rawArgs, 'request_id'), 'request_id');
  args.project_id = safeToken(requiredString(rawArgs, 'project_id'), 'project_id');
  args.artifact_id = safeToken(requiredString(rawArgs, 'artifact_id'), 'artifact_id');
  args.destination_name = safeLeaf(requiredString(rawArgs, 'destination_name'));
  if (!allowedProjects().has(args.project_id)) throw new MaterializationError('PROJECT_DENIED', 'project_id is not authorized for materialization.');
  const maxFileBytes = envPositiveInt('IMERMCP_MATERIALIZATION_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
  const maxAggregateBytes = envPositiveInt('IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES', DEFAULT_MAX_AGGREGATE_BYTES);
  const retentionSeconds = envPositiveInt('IMERMCP_MATERIALIZATION_RETENTION_SECONDS', DEFAULT_RETENTION_SECONDS);
  const sweepIntervalSeconds = envPositiveInt('IMERMCP_MATERIALIZATION_SWEEP_INTERVAL_SECONDS', DEFAULT_SWEEP_INTERVAL_SECONDS);
  const root = materializationRoot();
  const projectRoot = path.join(root, args.project_id);
  const filesDir = path.join(projectRoot, 'files');
  const receiptsDir = path.join(projectRoot, '.receipts');
  await mkdir(filesDir, { recursive: true });
  await mkdir(receiptsDir, { recursive: true });
  for (const owned of [root, projectRoot, filesDir, receiptsDir]) await ensureNoSymlink(owned);
  await sweepProject(projectRoot, retentionSeconds);
  const rootReal = await realpath(root);
  const filesReal = await realpath(filesDir);
  const receiptsReal = await realpath(receiptsDir);
  if (!isWithin(rootReal, filesReal) || !isWithin(rootReal, receiptsReal)) throw new MaterializationError('REPARSE_ESCAPE', 'Materialization directories escaped configured root.');

  const finalPath = path.join(filesReal, args.destination_name);
  const receiptPath = path.join(receiptsReal, receiptName(args.request_id));
  const existingReceipt = await readReceipt(receiptPath);
  if (existingReceipt && (existingReceipt.project_id !== args.project_id || existingReceipt.artifact_id !== args.artifact_id || existingReceipt.destination_name !== args.destination_name)) {
    throw new MaterializationError('INTENT_COLLISION', 'request_id is already bound to a different materialization intent.');
  }
  const source = await sourceBytes(args, maxFileBytes);
  const intended = { byte_length: source.bytes.length, sha256: sha256(source.bytes) };
  validateExpected(args, intended);
  if (existingReceipt && (existingReceipt.byte_length !== intended.byte_length || existingReceipt.sha256 !== intended.sha256)) {
    throw new MaterializationError('INTENT_COLLISION', 'request_id retry supplied different bytes.');
  }

  let existing: { byte_length: number; sha256: string } | null = null;
  let existingMtimeMs: number | null = null;
  try {
    existing = await fileIdentity(finalPath);
    existingMtimeMs = (await stat(finalPath)).mtimeMs;
    if (existing.byte_length !== intended.byte_length || existing.sha256 !== intended.sha256) throw new MaterializationError('DESTINATION_COLLISION', 'Destination exists with different bytes.');
  } catch (error: any) {
    if (error instanceof MaterializationError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existingReceipt && !existing) throw new MaterializationError('INCOMPLETE_NO_REPLAY', 'request_id is durably bound but its materialized file is absent; do not replay the effect automatically.');
  if (!existing) {
    const currentBytes = await aggregateBytes(filesReal);
    if (currentBytes + intended.byte_length > maxAggregateBytes) throw new MaterializationError('QUOTA_EXCEEDED', `Project materialization quota ${maxAggregateBytes} would be exceeded.`);
  }

  const fileExpiresMs = (existingMtimeMs ?? Date.now()) + retentionSeconds * 1000;
  const receipt: Receipt = {
    schema: 'imermcp.materialization_receipt/1', request_id: args.request_id, project_id: args.project_id,
    artifact_id: args.artifact_id, destination_name: args.destination_name, ...intended,
    expires_at_utc: new Date(fileExpiresMs + sweepIntervalSeconds * 1000).toISOString(),
  };
  if (!existingReceipt) {
    await atomicPublishReceipt(receipt, receiptPath);
    const bound = await readReceipt(receiptPath);
    if (!bound || bound.artifact_id !== args.artifact_id || bound.destination_name !== args.destination_name || bound.sha256 !== intended.sha256 || bound.byte_length !== intended.byte_length) {
      throw new MaterializationError('INTENT_COLLISION', 'request_id was concurrently bound to a different materialization intent.');
    }
  }
  if (existing) return await result('ALREADY_MATERIALIZED', args, finalPath, existing, retentionSeconds, sweepIntervalSeconds);

  try {
    await atomicPublishBytes(source.bytes, finalPath);
  } catch (error) {
    if (!(error instanceof MaterializationError) || error.code !== 'DESTINATION_EXISTS') throw error;
    const concurrent = await fileIdentity(finalPath);
    if (concurrent.byte_length !== intended.byte_length || concurrent.sha256 !== intended.sha256) throw new MaterializationError('DESTINATION_COLLISION', 'Concurrent destination exists with different bytes.');
    return await result('ALREADY_MATERIALIZED', args, finalPath, concurrent, retentionSeconds, sweepIntervalSeconds);
  }
  const verified = await fileIdentity(finalPath);
  if (verified.byte_length !== intended.byte_length || verified.sha256 !== intended.sha256) {
    await rm(finalPath, { force: true });
    throw new MaterializationError('FINAL_VERIFY_FAILED', 'Atomic publication did not preserve verified bytes.');
  }
  const persisted = await readReceipt(receiptPath);
  if (!persisted || persisted.sha256 !== verified.sha256 || persisted.byte_length !== verified.byte_length) throw new MaterializationError('RECEIPT_VERIFY_FAILED', 'Materialization receipt failed read-back verification.');
  return await result('MATERIALIZED', args, finalPath, verified, retentionSeconds, sweepIntervalSeconds);
}


export async function materializeFile(rawArgs: Record<string, unknown>): Promise<MaterializationResult> {
  const snapshot = { ...rawArgs };
  return withMaterializationLock(() => materializeFileUnlocked(snapshot));
}
