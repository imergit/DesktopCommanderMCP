import type { ServerResult } from '../types.js';
import { materializeFile, MaterializationError, startMaterializationJanitor } from './file-materialization.js';

export const MATERIALIZE_FILE_TOOL = 'imermcp_materialize_file';

export function sanitizeMaterializationTrackingArgs(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return {};
  const args = rawArgs as Record<string, unknown>;
  return {
    request_id: args.request_id,
    project_id: args.project_id,
    artifact_id: args.artifact_id,
    destination_name: args.destination_name,
    expected_byte_length: args.expected_byte_length,
    expected_sha256: args.expected_sha256,
    source_kind: args.bytes_base64 !== undefined ? 'INLINE_BASE64' : 'LOCAL_AUTHORIZED_FILE',
  };
}

export function getFileMaterializationTools(): any[] {
  startMaterializationJanitor();
  return [{
    name: MATERIALIZE_FILE_TOOL,
    description: 'Materialize authorized bytes or an authorized P53-local source into bounded verified host-local bytes. Returns a verified LOCAL_FILE reference; execution/staging authority remains with ImerTerm.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', minLength: 1, maxLength: 128 },
        project_id: { type: 'string', minLength: 1, maxLength: 128 },
        artifact_id: { type: 'string', minLength: 1, maxLength: 128 },
        destination_name: { type: 'string', minLength: 1, maxLength: 255 },
        bytes_base64: { type: 'string', description: 'Bounded inline bytes. Mutually exclusive with source_path.' },
        source_path: { type: 'string', description: 'Authorized local source reference. Mutually exclusive with bytes_base64.' },
        expected_byte_length: { type: 'integer', minimum: 0 },
        expected_sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      },
      required: ['request_id', 'project_id', 'artifact_id', 'destination_name', 'expected_byte_length', 'expected_sha256'],
      additionalProperties: false,
    },
    annotations: { title: 'ImerMCP Materialize File', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }];
}
function jsonResult(body: Record<string, unknown>, isError = false): ServerResult {
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, ...(isError ? { isError: true } : {}) };
}

export async function handleFileMaterializationTool(rawArgs: unknown): Promise<ServerResult> {
  try {
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) throw new MaterializationError('INVALID_REQUEST', 'Tool arguments must be an object.');
    const materialized = await materializeFile(rawArgs as Record<string, unknown>);
    return jsonResult(materialized as unknown as Record<string, unknown>);
  } catch (error) {
    const code = error instanceof MaterializationError ? error.code : 'MATERIALIZATION_ERROR';
    const body: Record<string, unknown> = {
      schema: 'imermcp.materialization_error/1',
      error_class: code,
      message: error instanceof MaterializationError ? error.message : 'Materialization failed closed due to an internal filesystem error.',
      retryable: ['QUOTA_EXCEEDED', 'SOURCE_CHANGED'].includes(code),
      next_allowed_action: code === 'SOURCE_CHANGED'
        ? 'Re-observe the authorized source, compute a fresh size/hash and retry the same request_id only if the intended bytes are unchanged.'
        : 'Correct the rejected materialization precondition; do not bypass the ImerMCP boundary.',
    };
    return jsonResult(body, true);
  }
}
