#!/usr/bin/env node
// Deterministic standards gate.
//
// Every rule below maps to a finding from a Grafana plugin catalog review that
// the LLM review caught and the existing gates did not. The patterns are narrow
// on purpose: this file fails the build only for defects that already escaped
// once, so a finding here is cheap to trust.
//
// Escape hatch: put `standards:ignore <reason>` on the same line. A reason is
// required, and the line shows up in review.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const root = process.cwd();
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'worktrees', 'coverage', '.claude']);

/** @type {{ id: string; test: (line: string) => string | null }[]} */
const GO_RULES = [
  {
    id: 'http-request-without-context',
    test: (line) => (/[^.\w]http\.NewRequest\(/.test(line) ? 'use http.NewRequestWithContext' : null),
  },
  {
    id: 'unbounded-read-all',
    test: (line) => (/io\.ReadAll\((?!io\.LimitReader)/.test(line) ? 'wrap the reader in io.LimitReader' : null),
  },
  {
    id: 'unbounded-drain',
    test: (line) => (/io\.Copy\(io\.Discard,\s*\w*[Bb]ody\s*\)/.test(line) ? 'bound the drain with io.LimitReader' : null),
  },
  {
    id: 'url-in-log',
    test: (line) => {
      // A log call that pairs "url" with a raw URL field leaks userinfo and
      // query credentials. Log mcp.RedactURL(...) instead.
      if (!/\b(Debug|Info|Warn|Error)\(/.test(line)) {return null;}
      return /"url",\s*(?:[a-zA-Z_][\w.]*\.)?URL\b/.test(line) ? 'log mcp.RedactURL(url) instead of the raw URL' : null;
    },
  },
  {
    id: 'response-body-in-error',
    test: (line) =>
      /fmt\.Errorf\(.*string\((?:body|data|respBody|bodyBytes)\)/.test(line)
        ? 'keep the HTTP status only; a provider body can carry credentials'
        : null,
  },
  {
    id: 'forbidden-os-environment',
    test: (line) =>
      /\bos\.(?:Getenv|LookupEnv|Environ)\b/.test(line)
        ? 'the catalog code rules forbid environment access; read config.GrafanaConfigFromContext(ctx) instead'
        : null,
  },
  {
    id: 'forbidden-filesystem-access',
    test: (line) =>
      /\bos\.(?:ReadFile|WriteFile|Open|OpenFile|Create|Remove|Rename|Stat|ReadDir)\b/.test(line)
        ? 'the catalog code rules forbid filesystem access from the plugin backend'
        : null,
  },
  {
    id: 'forbidden-syscall',
    test: (line) => (/\bsyscall\./.test(line) ? 'the catalog code rules forbid syscall access' : null),
  },
];

/** @type {{ id: string; test: (line: string) => string | null }[]} */
const CSS_RULES = [
  {
    id: 'global-keyframes',
    test: (line) => {
      const match = /@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(line);
      if (!match) {return null;}
      return match[1].startsWith('ask-o11y-')
        ? null
        : `prefix the keyframe name, got "${match[1]}" (expected "ask-o11y-${match[1]}")`;
    },
  },
];

function walk(dir, out, accept) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) {continue;}
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out, accept);
    } else if (accept(full)) {
      out.push(full);
    }
  }
  return out;
}

function scan(files, rules) {
  const problems = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('standards:ignore')) {
        if (!/standards:ignore\s+\S+/.test(line)) {
          problems.push({
            file: relative(root, file),
            line: index + 1,
            id: 'ignore-without-reason',
            message: '`standards:ignore` needs a reason',
          });
        }
        return;
      }
      for (const rule of rules) {
        const message = rule.test(line);
        if (message) {problems.push({ file: relative(root, file), line: index + 1, id: rule.id, message });}
      }
    });
  }
  return problems;
}

const goFiles = walk(join(root, 'pkg'), [], (f) => f.endsWith('.go') && !f.endsWith('_test.go'));
const cssFiles = walk(join(root, 'src'), [], (f) => f.endsWith('.module.css'));

const problems = [...scan(goFiles, GO_RULES), ...scan(cssFiles, CSS_RULES)];

if (problems.length > 0) {
  for (const p of problems) {console.error(`${p.file}:${p.line}: ${p.id}: ${p.message}`);}
  console.error(`\n${problems.length} standards problem(s). See scripts/check-standards.mjs.`);
  process.exit(1);
}

console.log(`standards: ${goFiles.length} Go files and ${cssFiles.length} CSS modules clean.`);
