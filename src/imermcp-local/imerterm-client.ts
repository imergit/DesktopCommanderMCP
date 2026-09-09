import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 512 * 1024;

export class ImerTermAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly nativeResponse?: Record<string, unknown>,
    public readonly exitCode?: number | null,
  ) {
    super(message);
    this.name = 'ImerTermAdapterError';
  }
}

interface ImerTermConfig {
  hostExe: string;
  localRoot: string;
}
function resolveConfig(): ImerTermConfig {
  const hostExe = process.env.IMERMCP_IMERTERM_HOST_EXE?.trim();
  const localRoot = process.env.IMERMCP_IMERTERM_LOCAL_ROOT?.trim();
  if (!hostExe || !localRoot) {
    throw new ImerTermAdapterError('CONFIG_MISSING', 'ImerTerm adapter requires IMERMCP_IMERTERM_HOST_EXE and IMERMCP_IMERTERM_LOCAL_ROOT.');
  }
  if (!path.isAbsolute(hostExe) || !path.isAbsolute(localRoot)) {
    throw new ImerTermAdapterError('CONFIG_INVALID', 'ImerTerm adapter paths must be absolute.');
  }
  return { hostExe: path.normalize(hostExe), localRoot: path.normalize(localRoot) };
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('response is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ImerTermAdapterError('INVALID_RESPONSE_JSON', `ImerTerm returned invalid JSON: ${String(error)}`);
  }
}
async function invokeHost(argv: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const config = resolveConfig();
  try {
    await access(config.hostExe);
  } catch {
    throw new ImerTermAdapterError('HOST_NOT_FOUND', `ImerTerm.Host executable not found: ${config.hostExe}`);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(config.hostExe, argv, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, IMERTERM_LOCAL_ROOT: config.localRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let captured = 0;
    let boundedFailure: ImerTermAdapterError | null = null;
    const capture = (target: Buffer[], chunk: Buffer) => {
      captured += chunk.length;
      if (captured > MAX_CAPTURE_BYTES && !boundedFailure) {
        boundedFailure = new ImerTermAdapterError('OUTPUT_LIMIT', `ImerTerm CLI output exceeded ${MAX_CAPTURE_BYTES} bytes.`);
        child.kill();
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    const timer = setTimeout(() => {
      if (!boundedFailure) boundedFailure = new ImerTermAdapterError('TIMEOUT', `ImerTerm CLI exceeded ${timeoutMs} ms.`);
      child.kill();
    }, timeoutMs);
    timer.unref();
    child.once('error', error => {
      clearTimeout(timer);
      reject(new ImerTermAdapterError('SPAWN_FAILED', `ImerTerm CLI spawn failed: ${error.message}`));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (boundedFailure) return reject(boundedFailure);
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        let nativeResponse: Record<string, unknown> | undefined;
        if (out) {
          try { nativeResponse = parseJsonObject(out); } catch {}
        }
        return reject(new ImerTermAdapterError(
          'CLI_EXIT_NONZERO',
          `ImerTerm CLI exited ${String(code)}${err ? `: ${err}` : ''}`,
          nativeResponse,
          code,
        ));
      }
      if (!out) return reject(new ImerTermAdapterError('EMPTY_RESPONSE', 'ImerTerm CLI returned no JSON response.'));
      try {
        resolve(parseJsonObject(out));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function invokeWithJsonFile(flag: string, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > MAX_REQUEST_BYTES) {
    throw new ImerTermAdapterError('REQUEST_TOO_LARGE', `ImerTerm request exceeded ${MAX_REQUEST_BYTES} bytes.`);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'imermcp-imerterm-'));
  const requestPath = path.join(dir, `${randomUUID()}.json`);
  try {
    await writeFile(requestPath, json, { encoding: 'utf8', flag: 'wx' });
    return await invokeHost([flag, requestPath], timeoutMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function isImerTermEnabled(): boolean {
  return process.env.IMERMCP_ENABLE_IMERTERM === '1';
}

export async function getImerTermCapabilities(): Promise<Record<string, unknown>> {
  return await invokeHost(['--local-cli-capabilities']);
}

export async function dispatchImerTerm(payload: unknown, timeoutMs?: number): Promise<Record<string, unknown>> {
  return await invokeWithJsonFile('--local-cli-dispatch-file', payload, timeoutMs);
}

export async function controlImerTerm(payload: unknown, timeoutMs?: number): Promise<Record<string, unknown>> {
  return await invokeWithJsonFile('--local-cli-control-file', payload, timeoutMs);
}
