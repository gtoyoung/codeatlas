import { scanCommit } from '../modules/repository/scan.mjs';

const [repo, ref = 'HEAD'] = process.argv.slice(2);

try {
  if (!repo) throw new Error('USAGE');

  const report = await scanCommit(repo, ref);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const code = error?.code === 'ENOENT' ? 'GIT_NOT_FOUND' : 'SCAN_FAILED';
  const detail = error?.message === 'USAGE'
    ? 'usage: scan <repo-path> [ref]'
    : 'unable to scan repository or ref';
  process.stderr.write(`${code}: ${detail}\n`);
  process.exitCode = 1;
}
