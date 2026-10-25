import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const name = `open-triage-auth-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
let started = false;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout?.trim();
}
try {
  run('docker', ['run', '--detach', '--rm', '--name', name,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', 'POSTGRES_USER=auth_test', '--env', 'POSTGRES_DB=auth_test',
    '--env', 'POSTGRES_PASSWORD', 'postgres:16-alpine'],
    { env: { ...process.env, POSTGRES_PASSWORD: password } });
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'auth_test'], { stdio: 'ignore' });
    if (result.status === 0) { ready = true; break; }
    await setTimeout(500);
  }
  if (!ready) throw new Error('Test PostgreSQL did not become ready');
  const port = run('docker', ['port', name, '5432/tcp']).split(':').at(-1);
  const env = { ...process.env,
    DATABASE_URL: `postgresql://auth_test:${password}@127.0.0.1:${port}/auth_test`,
    SESSION_SECRET: randomBytes(32).toString('hex'),
  };
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const files = readdirSync(new URL('./integration/', import.meta.url)).filter((file) => file.endsWith('.test.ts')).map((file) => `test/integration/${file}`);
  const tests = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { cwd, env, stdio: 'inherit' });
  process.exitCode = tests.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
}
