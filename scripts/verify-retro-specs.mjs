#!/usr/bin/env node
/**
 * Verify the retro-spec set in specs/retro/.
 *
 * Checks:
 *  1. Every spec directory is linked from specs/retro/README.md.
 *  2. Every spec has the required sections and a `Last verified` commit.
 *  3. Every backticked `path:line` reference exists and resolves.
 *  4. Every numbered behaviour rule carries exactly one coverage tag.
 *  5. No unresolved template placeholders remain.
 *
 * Usage: node scripts/verify-retro-specs.mjs [--quiet] [--review]
 *   --review  also regenerate specs/retro/REVIEW.md (the ASSUMED + GAP queue)
 * Exit code: 0 when clean, 1 when a check fails.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RETRO_DIR = join(ROOT, 'specs', 'retro');
const INDEX = join(RETRO_DIR, 'README.md');
const QUIET = process.argv.includes('--quiet');
const REVIEW = process.argv.includes('--review');
const reviewItems = new Map();

const REQUIRED_SECTIONS = [
  'Purpose',
  'Actors and RBAC',
  'Contract',
  'Behaviour Rules',
  'Invariants',
  'Failure Modes',
  'Data and Persistence',
  'Observability',
  'Evidence Index',
  'Known Gaps',
];

const TAGS = ['VERIFIED', 'ASSUMED', 'GAP'];
const SPEC_DIR_RE = /^\d{3}-[a-z0-9-]+$/;
const EVIDENCE_RE = /`([A-Za-z0-9_./@-]+\.(?:go|ts|tsx|js|mjs|cjs|json|ya?ml|md|sh|css))(?::(\d+))?`/g;
const PLACEHOLDER_RE = /\[(?:FEATURE|DATE|CAPABILITY NAME|NNN-slug|commit-sha|e\.g\.|Describe|Rule\.|action|Team|team)/;

const errors = [];
const stats = { specs: 0, rules: 0, verified: 0, assumed: 0, gap: 0, pointers: 0 };

function fail(spec, message) {
  errors.push(`${spec}: ${message}`);
}

function lineCount(absPath) {
  return readFileSync(absPath, 'utf8').split('\n').length;
}

if (!existsSync(RETRO_DIR) || !statSync(RETRO_DIR).isDirectory()) {
  console.error('No specs/retro/ directory found. Run from the repository root.');
  process.exit(1);
}

const indexContent = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';
if (!indexContent) {fail('README.md', 'missing specs/retro/README.md');}

const specDirs = readdirSync(RETRO_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && SPEC_DIR_RE.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (specDirs.length === 0) {fail('README.md', 'no spec directories match NNN-slug');}

for (const dir of specDirs) {
  const specPath = join(RETRO_DIR, dir, 'spec.md');
  stats.specs += 1;

  if (!existsSync(specPath)) {
    fail(dir, 'missing spec.md');
    continue;
  }

  if (!indexContent.includes(dir)) {
    fail(dir, 'not linked from specs/retro/README.md');
  }

  const content = readFileSync(specPath, 'utf8');
  const lines = content.split('\n');

  if (PLACEHOLDER_RE.test(content)) {
    fail(dir, 'unresolved template placeholder left in the spec');
  }

  if (!/^\*\*Last verified\*\*:\s*`[0-9a-f]{7,40}`/m.test(content)) {
    fail(dir, 'missing or malformed `Last verified` commit');
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, 'm').test(content)) {
      fail(dir, `missing section "## ${section}"`);
    }
  }

  const rulesStart = content.search(/^##\s+Behaviour Rules\s*$/m);
  const rulesEnd = rulesStart === -1 ? -1 : content.indexOf('\n## ', rulesStart + 1);
  const rulesBlock =
    rulesStart === -1 ? '' : content.slice(rulesStart, rulesEnd === -1 ? undefined : rulesEnd);

  for (const line of rulesBlock.split('\n')) {
    if (!/^\d+\.\s/.test(line)) {continue;}
    stats.rules += 1;
    const found = TAGS.filter((tag) => new RegExp(`\\b${tag}\\b`).test(line));
    if (found.length !== 1) {
      fail(dir, `rule without exactly one coverage tag: "${line.slice(0, 80)}..."`);
      continue;
    }
    if (found[0] === 'VERIFIED') {stats.verified += 1;}
    if (found[0] === 'ASSUMED') {stats.assumed += 1;}
    if (found[0] === 'GAP') {stats.gap += 1;}
    if (found[0] !== 'VERIFIED') {
      if (!reviewItems.has(dir)) {reviewItems.set(dir, []);}
      reviewItems.get(dir).push({ tag: found[0], text: line.trim() });
    }
  }

  for (const match of content.matchAll(EVIDENCE_RE)) {
    const [, path, lineNumber] = match;
    // Bare filenames and URL paths are prose, not evidence pointers.
    if (path.startsWith('http') || path.startsWith('/') || !path.includes('/')) {continue;}
    const absPath = join(ROOT, path);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) {
      fail(dir, `evidence path does not exist: ${path}`);
      continue;
    }
    stats.pointers += 1;
    if (!lineNumber) {continue;}
    const total = lineCount(absPath);
    if (Number(lineNumber) < 1 || Number(lineNumber) > total) {
      fail(dir, `evidence line out of range: ${path}:${lineNumber} (file has ${total} lines)`);
      continue;
    }
    const target = readFileSync(absPath, 'utf8').split('\n')[Number(lineNumber) - 1];
    if (!target || target.trim() === '') {
      fail(dir, `evidence points at a blank line: ${path}:${lineNumber}`);
    }
  }
}

if (!QUIET) {
  console.log(`Retro-specs: ${stats.specs}`);
  console.log(`Behaviour rules: ${stats.rules} (VERIFIED ${stats.verified}, ASSUMED ${stats.assumed}, GAP ${stats.gap})`);
  console.log(`Evidence pointers checked: ${stats.pointers}`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found:\n`);
  for (const error of errors) {console.error(`  - ${error}`);}
  console.error(`\nRun node scripts/verify-retro-specs.mjs after the fix.`);
  process.exit(1);
}

if (!QUIET) {console.log('\nAll retro-spec checks passed.');}

if (REVIEW) {
  const head = [
    '# Retro-Spec Review Queue',
    '',
    'Generated by `node scripts/verify-retro-specs.mjs --review`. Do not edit by hand.',
    '',
    'Every `ASSUMED` row needs a confirm or a veto. Every `GAP` row needs a yes or a no on whether it becomes a forward spec.',
    '',
    `Totals: ${stats.assumed} ASSUMED, ${stats.gap} GAP, ${stats.verified} VERIFIED (no review needed).`,
    '',
  ];
  const body = [];
  for (const dir of [...reviewItems.keys()].sort()) {
    body.push(`## ${dir}`, '');
    for (const item of reviewItems.get(dir)) {
      body.push(`- **${item.tag}** ${item.text}`, '');
    }
  }
  writeFileSync(join(RETRO_DIR, 'REVIEW.md'), [...head, ...body].join('\n'));
  if (!QUIET) {console.log(`Wrote specs/retro/REVIEW.md (${stats.assumed + stats.gap} items).`);}
}
