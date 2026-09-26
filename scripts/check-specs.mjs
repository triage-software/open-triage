// SDD conventions check (spec ids, registry, acceptance criteria) — run with: node scripts/check-specs.mjs
// Advisory: review tooling reads it; not part of the validation gate (see .ai/specs/README.md).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const STATUSES = ['draft', 'in-review', 'accepted', 'in-progress', 'implemented', 'superseded', 'rejected'];
const AC_OPTIONAL = new Set(['accepted', 'implemented', 'superseded', 'rejected']); // pre-SDD specs stay grandfathered
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'data']);
const README = '.ai/specs/README.md';

const problems = [];
const warnings = [];

// -- spec files: architecture specs (id-prefixed filename) + dated feature specs -------------
function listSpecFiles() {
  const specs = [];
  const arch = 'docs/architecture';
  if (existsSync(arch)) {
    for (const f of readdirSync(arch)) {
      if (/^SPEC-\d{4}-.+\.md$/.test(f)) specs.push(join(arch, f));
    }
  }
  const specsDir = '.ai/specs';
  if (existsSync(specsDir)) {
    for (const f of readdirSync(specsDir)) {
      if (/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f)) specs.push(join(specsDir, f));
    }
  }
  return specs;
}

// -- registry --------------------------------------------------------------------------------
const registry = new Map(); // id -> { file, status, title, owner, line }
if (!existsSync(README)) {
  problems.push(`${README} missing — the registry is the source of truth for spec ids`);
} else {
  const lines = readFileSync(README, 'utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    const m = line.match(/^\|\s*(SPEC-\d{4})\s*\|(.+)\|(.+)\|(.+)\|(.+)\|(.+)\|$/);
    if (!m) continue;
    const [, id, title, file, status, , owner] = m.map((c) => c.trim());
    if (registry.has(id)) problems.push(`${README}:${i + 1} duplicate registry row for ${id}`);
    registry.set(id, { file: file.replace(/`/g, ''), status: status.toLowerCase(), title, owner, line: i + 1 });
  }
  if (registry.size === 0) problems.push(`${README} has no spec rows — every allocated id needs a row`);
  for (const [id, row] of registry) {
    if (!STATUSES.includes(row.status)) {
      problems.push(`${README}:${row.line} ${id} has unknown status "${row.status}" (one of ${STATUSES.join(', ')})`);
    }
    if (row.status !== 'rejected' && !existsSync(row.file)) {
      problems.push(`${README}:${row.line} ${id} points at missing file ${row.file}`);
    }
    if (!row.title || !row.owner) problems.push(`${README}:${row.line} ${id} row needs title and owner`);
  }
}

// -- spec headers -----------------------------------------------------------------------------
const headerIds = new Map(); // id -> file
for (const path of listSpecFiles()) {
  const rel = relative('.', path);
  const head = readFileSync(path, 'utf8').split('\n').slice(0, 30);
  // Architecture specs carry the id in the H1 ("# SPEC-NNNN: …"); dated specs carry a metadata line.
  const idLine = head.find((l) => /^Id:\s*SPEC-\d{4}\b/.test(l));
  const h1 = head.find((l) => /^#\s+SPEC-\d{4}\b/.test(l));
  const isArch = /docs\/architecture\//.test(rel);
  if (!idLine && !(isArch && h1)) {
    problems.push(`${rel}: no spec id (expected "Id: SPEC-NNNN · Status: …" under the H1, or an H1 "# SPEC-NNNN: …" for architecture specs)`);
    continue;
  }
  const id = idLine ? idLine.match(/^Id:\s*(SPEC-\d{4})/)[1] : h1.match(/^#\s+(SPEC-\d{4})/)[1];
  if (headerIds.has(id)) problems.push(`${rel}: ${id} already claimed by ${headerIds.get(id)}`);
  headerIds.set(id, rel);

  const status = (head.join('\n').match(/Status:\s*([a-z-]+)/i) || [])[1]?.toLowerCase();
  if (!status || !STATUSES.includes(status)) {
    problems.push(`${rel}: header Status missing or outside the vocabulary (${STATUSES.join(', ')})`);
  } else if (!registry.has(id)) {
    problems.push(`${rel}: ${id} (${status}) has no registry row in ${README}`);
  } else if (registry.get(id).status !== status) {
    problems.push(`${rel}: header status "${status}" differs from registry status "${registry.get(id).status}" (registry is the source of truth)`);
  }

  const body = readFileSync(path, 'utf8');
  const hasAc = /^## +Acceptance criteria/m.test(body) && /AC-\d{2}/.test(body);
  if (!hasAc && !AC_OPTIONAL.has(status)) {
    problems.push(`${rel}: no "## Acceptance criteria" block with AC-NN rows (mandatory per ${README})`);
  } else if (!hasAc) {
    warnings.push(`${rel}: ${status} without an Acceptance criteria block (grandfathered pre-SDD spec — backfill on the next material edit)`);
  }
}
for (const [id, row] of registry) {
  if (row.status !== 'rejected' && !headerIds.has(id) && !row.file.startsWith('docs/architecture/')) {
    warnings.push(`${README}:${row.line} ${id} row has no matching spec header (dated specs must carry "Id: ${id}")`);
  }
}

// -- dangling references ----------------------------------------------------------------------
function walkTop(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(entry) || (entry.startsWith('.') && entry !== '.ai')) continue;
      walkTop(p, out);
    } else if (entry.endsWith('.md')) {
      const rel = relative('.', p);
      if (!out.includes(rel)) out.push(rel);
    }
  }
  return out;
}
const refFiles = [...new Set([...walkTop('.'), ...walkTop('docs'), ...walkTop('.ai')])]
  .filter((f) => f !== README && !f.startsWith('.ai/skills/')); // conventions docs and skill overrides may cite examples
for (const f of refFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(/SPEC-\d{4}/g)) {
    if (!registry.has(m[0])) problems.push(`${f}: references ${m[0]}, which is not in the registry`);
  }
}

console.log(`specs: ${headerIds.size} with headers, registry rows: ${registry.size}`);
if (warnings.length) console.log('warnings:', warnings);
console.log('problems:', problems.length ? problems : 'none');
process.exit(problems.length ? 1 : 0);
