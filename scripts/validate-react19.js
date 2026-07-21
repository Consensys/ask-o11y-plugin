#!/usr/bin/env node

const { mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync, readFileSync } = require('node:fs');
const { dirname, join, relative } = require('node:path');
const { spawnSync } = require('node:child_process');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pluginId = require('../src/plugin.json').id;
const tempDir = mkdtempSync(join(process.cwd(), '.react19-'));
const pluginRoot = join(tempDir, pluginId);
const archivePath = join(tempDir, `${pluginId}.zip`);

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function scanArtifact() {
  const issues = [];
  // Only scan compiled .js output, not .js.map. Source maps embed the original,
  // pre-bundling source of every dependency in `sourcesContent` for debugging
  // purposes only (never executed by the browser) - a dependency that authors its
  // source with the automatic JSX runtime (a completely valid, React 17+ stable API)
  // will legitimately contain the literal string 'react/jsx-runtime' there even
  // though our webpack alias (see webpack.config.ts) guarantees the compiled bundle
  // never actually imports/requires that module at runtime.
  const files = listFiles('dist').filter((file) => /\.js$/.test(file));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('react/jsx-runtime') || content.includes('react/jsx-dev-runtime')) {
      issues.push(`${file}: contains react/jsx-runtime`);
    }
    if (content.includes('react-resizable') && (content.includes('prop-types') || content.includes('propTypes'))) {
      issues.push(`${file}: contains react-resizable propTypes code`);
    }
  }

  return issues;
}

function copyReactCompatibilityFiles() {
  mkdirSync(pluginRoot, { recursive: true });

  for (const file of listFiles('dist')) {
    if (file === join('dist', 'plugin.json') || /\.(?:js|js\.map)$/.test(file)) {
      const destination = join(pluginRoot, relative('dist', file));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(file, destination);
    }
  }
}

try {
  const artifactIssues = scanArtifact();
  if (artifactIssues.length > 0) {
    console.error('React 19 artifact scan failed:');
    for (const issue of artifactIssues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  copyReactCompatibilityFiles();

  const zipResult = spawnSync('zip', ['-qr', archivePath, pluginId], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  if (zipResult.status !== 0) {
    process.stdout.write(zipResult.stdout || '');
    process.stderr.write(zipResult.stderr || '');
    process.exit(zipResult.status || 1);
  }

  const result = spawnSync(
    command,
    [
      '-y',
      '@grafana/plugin-validator@latest',
      '-jsonOutput',
      '-analyzer',
      'reactcompat',
      '-sourceCodeUri',
      'file://.',
      archivePath,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    console.error(`Failed to parse React 19 validator output: ${error.message}`);
    process.exit(1);
  }

  // Findings that @grafana/react-detect itself documents as commonly being false
  // positives (see the Grafana 12.x -> 13.x migration guide's "Common dependency
  // issues" section) once the jsx-runtime fix has been applied. We apply that fix
  // globally via the `react/jsx-runtime$` / `react/jsx-dev-runtime$` webpack aliases
  // in webpack.config.ts (self-contained shim, not the docs' plain `externals`
  // recipe), so every dependency's automatic-JSX-runtime import - including these -
  // is verified to never reach the compiled .js output (see scanArtifact() above).
  // Re-verify this allowlist whenever a listed dependency's major version changes.
  const knownFalsePositives = [{ name: 'react-19-dep-jsxRuntimeImport', detailIncludes: '@floating-ui/react' }];

  const reactCompatibilityIssues = (report['plugin-validator']?.reactcompat || []).filter((issue) => {
    const matchedEntry = knownFalsePositives.find(
      (entry) => issue.Name === entry.name && issue.Detail?.includes(entry.detailIncludes)
    );
    if (matchedEntry) {
      console.log(`Ignoring known false-positive react-detect finding: ${issue.Name} (${matchedEntry.detailIncludes})`);
    }
    return !matchedEntry;
  });

  if (reactCompatibilityIssues.length > 0) {
    console.error('React 19 validator reported compatibility issues.');
    process.exit(1);
  }

  process.exit(0);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
