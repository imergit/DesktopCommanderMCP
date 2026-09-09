import assert from 'assert';
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { execFileSync } from 'child_process';
import { readFile } from '../dist/tools/filesystem.js';
import { configManager } from '../dist/config-manager.js';

function assertExclusiveOpen(filePath) {
  const escaped = filePath.replace(/'/g, "''");
  const script = `$ErrorActionPreference='Stop'; $fs=[IO.File]::Open('${escaped}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $fs.Dispose(); Write-Output 'EXCLUSIVE_OPEN_PASS'`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  assert.match(output, /EXCLUSIVE_OPEN_PASS/);
}

async function run() {
  if (process.platform !== 'win32') {
    console.log('SKIP: Windows exclusive-handle regression fixture');
    return;
  }
  const original = await configManager.getConfig();
  const originalAllowed = original.allowedDirectories;
  const tmpDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'dc-read-handle-')));
  const tmpFile = path.join(tmpDir, 'sample.txt');
  await fsp.writeFile(tmpFile, Array.from({ length: 20 }, (_, i) => `line-${String(i + 1).padStart(2, '0')}`).join('\n') + '\n');  try {
    await configManager.setValue('allowedDirectories', [tmpDir]);
    const result = await readFile(tmpFile, { offset: 2, length: 3 });
    const text = typeof result.content === 'string' ? result.content : result.content.toString('utf8');
    assert.match(text, /line-03/);
    assert.match(text, /line-05/);
    assertExclusiveOpen(tmpFile);

    const largeFile = path.join(tmpDir, 'large.txt');
    const line = 'x'.repeat(63) + '\n';
    await fsp.writeFile(largeFile, line.repeat(180000));
    await readFile(largeFile, { offset: 2000, length: 3 });
    assertExclusiveOpen(largeFile);

    console.log('PASS: partial and deep-offset reads release Windows file handles before returning');
  } finally {
    await configManager.setValue('allowedDirectories', originalAllowed);
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
