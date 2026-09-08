const { copyFileSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const dist = join(root, 'tools/launcher/dist');
const config = join(root, 'tools/launcher/sea-config.json');
const blob = join(dist, 'sea-prep.blob');
const output = join(root, 'Michikusa.exe');
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

if (process.platform !== 'win32') {
  throw new Error('Michikusa.exe는 Windows에서 빌드하세요.');
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  throw new Error(`Node 22+가 필요합니다. current: ${process.version}`);
}

mkdirSync(dist, { recursive: true });
rmSync(blob, { force: true });
rmSync(output, { force: true });

console.log(`[launcher:build] Node ${process.version}`);
console.log('[launcher:build] SEA preparation blob 생성');
run(process.execPath, ['--experimental-sea-config', config]);

console.log('[launcher:build] node.exe 복사');
copyFileSync(process.execPath, output);

console.log('[launcher:build] launcher script 주입');
const postjectCommand = [
  'pnpm exec postject',
  quoteForCmd(output),
  'NODE_SEA_BLOB',
  quoteForCmd(blob),
  '--sentinel-fuse',
  fuse,
].join(' ');
run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', postjectCommand]);

console.log(`\n[launcher:build] 완료: ${output}`);
console.log('[launcher:build] .\\Michikusa.exe 더블클릭 또는 실행');
