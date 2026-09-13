import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function git(repo, args) {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', repo, '--no-pager', ...args],
    {
      encoding: 'buffer',
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  );

  return stdout;
}

export async function resolveCommit(repo, ref) {
  if (!ref || ref.startsWith('-') || ref.includes('\0')) {
    throw new Error('INVALID_REF');
  }

  const output = await git(repo, [
    'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`,
  ]);
  const oid = output.toString('ascii').trim();

  if (!/^[a-f0-9]+$/.test(oid)) {
    throw new Error('INVALID_OID');
  }

  return oid;
}
