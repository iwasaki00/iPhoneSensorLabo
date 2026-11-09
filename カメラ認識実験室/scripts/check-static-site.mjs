import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const html = await readFile(new URL('index.html', dist), 'utf8');
const paths = ['index.html', 'vision-worker.js', 'assets-manifest.json'];
for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(!reference.startsWith('/') && !reference.endsWith('.ts'), `静的配信できない参照: ${reference}`);
  paths.push(reference);
}
for (const path of paths) assert.ok((await stat(new URL(path, dist))).isFile(), `配布ファイルがありません: ${path}`);
const manifest = JSON.parse(await readFile(new URL('assets-manifest.json', dist), 'utf8'));
for (const file of manifest.files) {
  const bytes = await readFile(new URL(file.path, dist));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `配布アセット不一致: ${file.path}`);
}
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(new URL(entry.name + '/', directory), path + '/'));
    else result.push('dist/' + path);
  }
  return result;
}
const cwd = fileURLToPath(root);
const repository = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', windowsHide: true });
if (repository.status === 0) {
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd, input: (await files(dist)).join('\0') + '\0', encoding: 'utf8', windowsHide: true
  });
  assert.ok(ignored.status === 0 || ignored.status === 1, ignored.stderr || 'Git除外設定の確認に失敗しました');
  assert.equal(ignored.status, 1, `配布ファイルがGit管理対象外です: ${ignored.stdout.replaceAll('\0', ', ')}`);
}
console.log('Static distribution verified: HTML, worker, pinned assets, Git ignore rules');
