#!/usr/bin/env node
// Keep .github/llm-review-questions.json in step with the upstream analyzer.
//
// The Grafana catalog runs the plugin-validator's `llmreview` pass, which asks a
// fixed question list about src/ and pkg/. We keep a local copy so the review
// can run inside the coding harness with no API key and no CI secret. Upstream
// changes the list without notice, so drift must be visible.
//
//   npm run review:sync           report drift, exit 1 when there is any
//   npm run review:sync -- --write  rewrite the `questions` array from upstream
//
// Only `questions` is managed here. `projectQuestions` are ours and never
// touched.

import { readFileSync, writeFileSync } from 'fs';

const UPSTREAM =
  'https://raw.githubusercontent.com/grafana/plugin-validator/main/pkg/analysis/passes/llmreview/llmreview.go';
const FILE = '.github/llm-review-questions.json';

function extractQuestions(src, varName) {
  const start = src.indexOf(`var ${varName} = []llmvalidate.LLMQuestion{`);
  if (start === -1) {throw new Error(`cannot find var ${varName} in the upstream source`);}
  const end = src.indexOf('\n}\n', start);
  if (end === -1) {throw new Error(`cannot find the end of var ${varName}`);}
  const body = src.slice(start, end);
  const out = [];
  const re = /Question:\s+"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    out.push(JSON.parse(`"${match[1]}"`));
  }
  if (out.length === 0) {throw new Error(`no questions found in var ${varName}`);}
  return out;
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

async function main() {
  const write = process.argv.includes('--write');
  const local = JSON.parse(readFileSync(FILE, 'utf8'));

  const response = await fetch(UPSTREAM);
  if (!response.ok) {throw new Error(`${UPSTREAM} answered ${response.status}`);}
  const src = await response.text();

  const upstream = [
    ...extractQuestions(src, 'Questions').map((question) => ({ question, blocking: true })),
    ...extractQuestions(src, 'OptionalQuestions').map((question) => ({ question, blocking: false })),
  ];

  const localByText = new Map(local.questions.map((entry) => [normalize(entry.question), entry]));
  const upstreamTexts = new Set(upstream.map((entry) => normalize(entry.question)));

  const missing = upstream.filter((entry) => !localByText.has(normalize(entry.question)));
  const stale = local.questions.filter((entry) => !upstreamTexts.has(normalize(entry.question)));

  if (write) {
    local.questions = upstream.map((entry) => ({
      id: localByText.get(normalize(entry.question))?.id ?? `upstream-${normalize(entry.question).slice(0, 40)}`,
      blocking: entry.blocking,
      expectedAnswer: 'no',
      question: entry.question,
    }));
    local.syncedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(FILE, `${JSON.stringify(local, null, 2)}\n`);
    console.log(`review:sync wrote ${local.questions.length} questions from upstream.`);
    return;
  }

  if (missing.length === 0 && stale.length === 0) {
    console.log(`review:sync: ${local.questions.length} questions match upstream.`);
    return;
  }

  for (const entry of missing) {
    console.error(`upstream only (${entry.blocking ? 'blocking' : 'optional'}): ${entry.question}`);
  }
  for (const entry of stale) {
    console.error(`local only (${entry.id}): ${entry.question}`);
  }
  console.error(`\n${missing.length + stale.length} drift(s). Run \`npm run review:sync -- --write\` and commit.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`review:sync failed: ${error.message}`);
  process.exit(1);
});
