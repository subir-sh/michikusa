const { existsSync, readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const WEB_URL = 'http://localhost:3000';
const HEALTH_URL = 'http://localhost:4000/health';
const STARTUP_TIMEOUT_MS = 90_000;

let devProcess = null;
let shuttingDown = false;

function findRepoRoot() {
  const candidates = [
    dirname(process.execPath),
    process.cwd(),
    resolve(__dirname, '../..'),
  ];

  for (const candidate of [...new Set(candidates)]) {
    const packagePath = join(candidate, 'package.json');
    if (!existsSync(packagePath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (pkg.name === 'michikusa') return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    'Michikusa repo root를 찾지 못했습니다. Michikusa.exe를 repo 최상위에 두고 실행하세요.',
  );
}

async function isReady(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  const browser = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', WEB_URL], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  browser.unref();
}

function killDevTree() {
  if (!devProcess?.pid || devProcess.exitCode !== null) return;

  spawnSync(
    'taskkill.exe',
    ['/PID', String(devProcess.pid), '/T', '/F'],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (reason) console.log(`\n[launcher] ${reason}`);
  console.log('[launcher] Michikusa dev processes를 종료합니다...');
  killDevTree();
  process.exit(exitCode);
}

async function waitUntilReady() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (devProcess?.exitCode !== null) {
      throw new Error(`pnpm dev가 먼저 종료되었습니다. exit code: ${devProcess.exitCode}`);
    }

    const [webReady, serverReady] = await Promise.all([
      isReady(WEB_URL),
      isReady(HEALTH_URL),
    ]);

    if (webReady && serverReady) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error('90초 안에 web/server가 준비되지 않았습니다. 위 dev 로그를 확인하세요.');
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('이 launcher는 Windows 개발 환경용입니다.');
  }

  const repoRoot = findRepoRoot();

  if (process.argv.includes('--check')) {
    console.log(`[launcher] OK: ${repoRoot}`);
    return;
  }

  if (!existsSync(join(repoRoot, 'node_modules'))) {
    throw new Error('node_modules가 없습니다. repo 루트에서 pnpm install을 먼저 실행하세요.');
  }

  if (!existsSync(join(repoRoot, 'apps/server/.env'))) {
    console.warn('[launcher] warning: apps/server/.env가 없습니다.');
  }
  if (!existsSync(join(repoRoot, 'apps/web/.env.local'))) {
    console.warn('[launcher] warning: apps/web/.env.local이 없습니다.');
  }

  const [webBusy, serverBusy] = await Promise.all([
    isReady(WEB_URL),
    isReady(HEALTH_URL),
  ]);

  if (webBusy || serverBusy) {
    throw new Error(
      '3000 또는 4000 포트에 이미 프로세스가 실행 중입니다. 기존 pnpm dev를 먼저 종료하세요.',
    );
  }

  console.log('道草 Michikusa');
  console.log(`[launcher] repo: ${repoRoot}`);
  console.log('[launcher] pnpm dev를 시작합니다...');

  devProcess = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm dev'], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  });

  devProcess.once('error', (error) => {
    console.error(`[launcher] pnpm dev 실행 실패: ${error.message}`);
    shutdown('launcher를 종료합니다.', 1);
  });

  devProcess.once('exit', (code) => {
    if (shuttingDown) return;
    console.error(`\n[launcher] pnpm dev가 종료되었습니다. exit code: ${code ?? 'unknown'}`);
    shutdown('launcher를 종료합니다.', code ?? 1);
  });

  await waitUntilReady();

  console.log(`[launcher] Ready: ${WEB_URL}`);
  console.log('[launcher] 브라우저를 엽니다.');
  console.log('[launcher] 이 창을 닫거나 Ctrl+C를 누르면 web/server도 함께 종료됩니다.');
  openBrowser();

  process.stdin.resume();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(signal, () => shutdown(`${signal} 수신`));
  } catch {
    // Some signals are not available on every platform.
  }
}

process.on('exit', () => {
  if (!shuttingDown) killDevTree();
});

process.on('uncaughtException', (error) => {
  console.error(`[launcher] ${error.stack ?? error.message}`);
  shutdown('예상하지 못한 오류', 1);
});

process.on('unhandledRejection', (error) => {
  console.error(`[launcher] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  shutdown('예상하지 못한 오류', 1);
});

void main().catch((error) => {
  console.error(`[launcher] ${error instanceof Error ? error.message : String(error)}`);
  shutdown('시작 실패', 1);
});
