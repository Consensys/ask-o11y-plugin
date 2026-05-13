#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const reactDetectVersion = '0.6.4';
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  '-y',
  `@grafana/react-detect@${reactDetectVersion}`,
  'detect19',
  '--pluginRoot',
  '.',
  '--distDir',
  'dist',
  '--json',
  '--noErrorExitCode',
];

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

if (result.error || result.status !== 0) {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status || 1);
}

const jsonStart = result.stdout.indexOf('{');
const jsonEnd = result.stdout.lastIndexOf('}');

if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  console.error('React 19 validation did not emit JSON output.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout.slice(jsonStart, jsonEnd + 1));
} catch (error) {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  console.error(`Failed to parse React 19 validation JSON: ${error.message}`);
  process.exit(1);
}

const sourceIssues = Object.values(report.sourceCodeIssues || {}).flat();
const dependencyIssues = report.dependencyIssues || [];

const isAllowedDependencyIssue = (issue) => {
  const packageNames = issue.packageNames || [];
  const rootDependencies = issue.rootDependencies || [];

  return (
    issue.pattern === 'propTypes' &&
    packageNames.length === 1 &&
    packageNames[0] === 'react-resizable' &&
    rootDependencies.length === 1 &&
    rootDependencies[0] === '@grafana/scenes'
  );
};

const allowedDependencyIssues = dependencyIssues.filter(isAllowedDependencyIssue);
const actionableDependencyIssues = dependencyIssues.filter((issue) => !isAllowedDependencyIssue(issue));

if (allowedDependencyIssues.length > 0) {
  console.warn(
    'React 19 validation ignored known transitive warning: react-resizable propTypes bundled by @grafana/scenes.'
  );
}

if (sourceIssues.length === 0 && actionableDependencyIssues.length === 0) {
  console.log('React 19 validation passed.');
  if (allowedDependencyIssues.length > 0) {
    console.log(`Ignored ${allowedDependencyIssues.length} known transitive dependency warning(s).`);
  }
  process.exit(0);
}

console.error('React 19 validation failed with actionable issue(s):');
console.error(
  JSON.stringify(
    {
      sourceCodeIssues: report.sourceCodeIssues || {},
      dependencyIssues: actionableDependencyIssues,
    },
    null,
    2
  )
);
process.exit(1);
