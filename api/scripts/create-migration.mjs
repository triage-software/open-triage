#!/usr/bin/env node
/* Creates the worker-increment migration with `prisma migrate diff` (no shadow
 * DB, no interactive prompt — safe for agents and CI). Usage:
 *   node scripts/create-migration.mjs <migration_name>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const apiDir = path.resolve(new URL('.', import.meta.url).pathname, '..');
const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/i.test(name)) {
  console.error('usage: node scripts/create-migration.mjs <migration_name>');
  process.exit(1);
}

const dir = path.join(apiDir, 'prisma', 'migrations', name);
if (existsSync(dir)) {
  console.error(`migration ${name} already exists`);
  process.exit(1);
}

const sql = execFileSync(
  process.execPath,
  [
    path.join(apiDir, 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate', 'diff',
    '--from-migrations', path.join(apiDir, 'prisma', 'migrations'),
    '--to-schema-datamodel', path.join(apiDir, 'prisma', 'schema.prisma'),
    '--shadow-database-url', process.env.SHADOW_DATABASE_URL ?? '',
    '--script',
  ],
  { encoding: 'utf8', cwd: apiDir },
);

if (!sql.trim()) {
  console.error('prisma reports no schema changes — nothing to migrate');
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'migration.sql'), sql);
writeFileSync(
  path.join(apiDir, 'prisma', 'migrations', 'migration_lock.toml'),
  readFileSync(path.join(apiDir, 'prisma', 'migrations', 'migration_lock.toml')),
);
console.log(`migration created: prisma/migrations/${name}/migration.sql`);
console.log(sql);