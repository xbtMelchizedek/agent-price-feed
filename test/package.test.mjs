import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('package: bin, exports and files resolve; version matches the changelog', async () => {
  const bin = new URL(`../${pkg.bin['agent-price-feed']}`, import.meta.url);
  assert.match(readFileSync(bin, 'utf8'), /^#!\/usr\/bin\/env node/);
  const lib = await import('agent-price-feed');
  for (const k of ['stateOf', 'diff', 'jsonFeed', 'rss', 'filterEvents', 'build', 'alerts']) assert.equal(typeof lib[k], 'function', k);
  for (const f of pkg.files) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
  assert.match(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), new RegExp(`## ${pkg.version.replaceAll('.', '\\.')} `));
});
