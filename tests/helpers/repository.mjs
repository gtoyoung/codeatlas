import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function makeRepo() {
  const path = await mkdtemp(join(tmpdir(), 'ai-dev-handoff-test-'));
  const expectedParent = resolve(tmpdir());

  await execFileAsync('git', ['init', '--quiet', path], { windowsHide: true });

  return {
    path,
    async run(args) {
      return execFileAsync('git', ['-C', path, ...args], {
        windowsHide: true,
        encoding: 'utf8',
      });
    },
    async cleanup() {
      const resolvedPath = resolve(path);
      if (!resolvedPath.startsWith(`${expectedParent}\\`) || !resolvedPath.includes('ai-dev-handoff-test-')) {
        throw new Error('UNSAFE_TEST_CLEANUP');
      }
      await rm(resolvedPath, { recursive: true, force: true });
    },
  };
}
