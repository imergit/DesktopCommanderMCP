import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { materializeFile } from '../dist/imermcp-local/file-materialization.js';

const base = 'D:\\052.imermcp-c3-materialization-e2e';
process.env.IMERMCP_MATERIALIZATION_ROOT = path.join(base, 'materialized');
process.env.IMERMCP_MATERIALIZATION_SOURCE_ROOTS = path.join(base, 'authorized-source');
process.env.IMERMCP_MATERIALIZATION_PROJECTS = 'c3test';
const bytes = Buffer.from('import hashlib\nprint("C3_IMERMCP_TO_IMERTERM_STAGE_OK")\n', 'utf8');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const result = await materializeFile({
  request_id: 'req-imerterm-composition-v1',
  project_id: 'c3test',
  artifact_id: 'entry',
  destination_name: 'c3-stage-entry.py',
  bytes_base64: bytes.toString('base64'),
  expected_byte_length: bytes.length,
  expected_sha256: sha256,
});
await fs.writeFile('c3-imerterm-composition-input.json', `${JSON.stringify({ ...result, expected_marker: 'C3_IMERMCP_TO_IMERTERM_STAGE_OK' }, null, 2)}\n`, 'utf8');
