import fs from 'fs';
import path from 'path';

// Grafana requires every CSS keyframe name to be scoped to the plugin. The CSS
// modules build runs in global mode and postcss skips @keyframes, so the names
// reach the page as-is and can collide with Grafana's own animations.
const PREFIX = 'ask-o11y-';
const SRC = path.resolve(__dirname, '..');

function cssModuleFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') {
        continue;
      }
      cssModuleFiles(full, acc);
    } else if (entry.name.endsWith('.module.css')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('plugin CSS keyframes', () => {
  const files = cssModuleFiles(SRC);

  it('finds at least one CSS module', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s uses only prefixed keyframe names', (file) => {
    const css = fs.readFileSync(file, 'utf8');
    const names = [...css.matchAll(/@keyframes\s+([A-Za-z_-][\w-]*)/g)].map((m) => m[1]);
    const unscoped = names.filter((name) => !name.startsWith(PREFIX));
    expect(unscoped).toEqual([]);
  });
});
