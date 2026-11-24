import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stateOf, diff, iuOf, fromPico, toPico, jsonFeed, rss, mergeHistory, filterEvents, build, KINDS } from '../src/index.mjs';
import { main, makeHandler } from '../src/cli.mjs';

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const A = fx('snapshot_2026-11-24T2024Z.json');
const B = fx('snapshot_2026-11-24T2043Z.json');
const later = (snap, mutate) => { const s = structuredClone(snap); s.generatedAt = '2026-11-24T22:24:53.363Z'; mutate(s); return s; };
const find = (s, provider, model) => s.offers.find((o) => o.provider === provider && o.model === model);
const kinds = (r) => r.events.map((e) => e.kind);

test('decimal: IU price is exact', () => {
  assert.equal(fromPico(iuOf('0.075', '0.3')), '0.13125');
  assert.equal(fromPico(iuOf('0.02882882', '0.299686733')), '0.09654329825');
  assert.equal(iuOf('free', '1'), null);
  assert.equal(toPico('1e-3'), null);
});

test('real data: two real snapshots 19 minutes apart give no noise; a first run is a baseline', () => {
  const a = stateOf(A);
  assert.equal(Object.keys(a.offers).length, 719);
  assert.deepEqual(diff(a, stateOf(B)).events, []);
  assert.deepEqual(diff(null, a).events, []);
  assert.deepEqual(diff(a, a).events, []);
  assert.throws(() => stateOf({ offers: [] }), /not a justweight snapshot/);
});

test('synthetic: price moves past the threshold, with exact before/after and the source', () => {
  const s = later(A, (x) => {
    Object.assign(find(x, 'openrouter', 'thinkingmachines/inkling-2-mini'), { inPer1M: '0.06', outPer1M: '0.24' }); // -20%
    Object.assign(find(x, 'openrouter', 'mistralai/pixtral-large-2502'), { inPer1M: '2.02' }); // +0.5%: below threshold
  });
  const r = diff(stateOf(A), stateOf(s));
  assert.deepEqual(kinds(r), ['price-drop']);
  const e = r.events[0];
  assert.equal(e.before, '0.13125');
  assert.equal(e.after, '0.105');
  assert.equal(e.changeBps, -2000);
  assert.equal(e.source, 'https://openrouter.ai/api/v1/models');
  assert.equal(diff(stateOf(A), stateOf(s), { minChangeBps: 10 }).events.length, 2);
});

test('synthetic: new venue, new model, new offer, removal, cheapest change, flop listing and watcher', () => {
  const base = stateOf(A);
  const fam = 'thinkingmachines/inkling-2-mini';
  const cheapest = Object.values(base.offers).filter((o) => o.unit === 'USD' && o.iu && o.model.split(':')[0] === fam).sort((x, y) => (toPico(x.iu) < toPico(y.iu) ? -1 : 1))[0];
  const s = later(A, (x) => {
    x.offers.push({ provider: 'newvenue', network: null, model: 'qwen/qwen3.8-27b', unit: 'USD', inPer1M: '0.1', outPer1M: '0.4', notes: [], source: 'https://example.invalid/new' });
    x.offers.push({ provider: 'venice', network: null, model: 'acme/brand-new-1b', unit: 'USD', inPer1M: '0.01', outPer1M: '0.02', notes: [], source: 'https://api.venice.ai/api/v1/models' });
    x.offers.push({ provider: 'chutes-bittensor', network: null, model: 'mistralai/pixtral-large-2502', unit: 'USD', inPer1M: '1', outPer1M: '3', notes: [], source: 'https://llm.chutes.ai/v1/models' });
    x.offers.push({ provider: 'venice', network: null, model: `${fam}:cheap`, unit: 'USD', inPer1M: '0.000001', outPer1M: '0.000001', notes: [], source: 'https://api.venice.ai/api/v1/models' });
    x.offers.push({ provider: 'flop-testnet-gateway', network: 'testnet', model: 'qwen/qwen3.8-27b', unit: 'FLOP', inPer1M: '3', outPer1M: '9', notes: [], source: 'https://testnet.flopscan.io/api/models' });
    x.offers = x.offers.filter((o) => !(o.provider === 'openrouter' && o.model === 'mistralai/pixtral-large-2502'));
    x.flop.watch = { stage: 'filled', filled: 1, detail: 'synthetic' };
  });
  const r = diff(base, stateOf(s));
  assert.deepEqual(new Set(kinds(r)), new Set(['new-venue', 'new-model', 'new-offer', 'removed-offer', 'cheapest-change', 'flop-listing', 'flop-watch']));
  const cc = r.events.find((e) => e.kind === 'cheapest-change' && e.subject === fam);
  assert.equal(cc.before, cheapest.iu);
  assert.equal(cc.after, '0.000001');
  assert.equal(r.events.find((e) => e.kind === 'flop-listing').after, '4.5');
  assert.equal(r.events.find((e) => e.kind === 'flop-watch').before, 'explorer-down');
  assert.ok(r.events.every((e) => /^[0-9a-f]{16}$/.test(e.id) && e.at === s.generatedAt && e.title));
});

test('synthetic: a source that goes down is one event, not hundreds of removals; coming back is not hundreds of additions', () => {
  const down = later(A, (x) => {
    x.sources.find((s) => s.id === 'venice').ok = false;
    x.offers = x.offers.filter((o) => o.provider !== 'venice');
  });
  const r1 = diff(stateOf(A), stateOf(down));
  assert.deepEqual(kinds(r1), ['source-down']);
  const back = structuredClone(A); back.generatedAt = '2026-11-25T00:24:53.363Z';
  assert.deepEqual(kinds(diff(stateOf(down), stateOf(back))), ['source-back']);
});

test('synthetic: a huge run is capped, most useful kinds first', () => {
  const s = later(A, (x) => { for (const o of x.offers) if (o.unit === 'USD' && o.inPer1M !== '0') { o.inPer1M = fromPico(toPico(o.inPer1M) * 2n); } });
  const r = diff(stateOf(A), stateOf(s), { maxEventsPerRun: 20 });
  assert.equal(r.events.length, 20);
  assert.ok(r.truncated > 100);
  assert.ok(r.events.every((e) => e.kind === 'price-rise' || e.kind === 'cheapest-change'));
});

test('feeds: JSON Feed 1.1 and RSS are well formed and escaped; history merges and caps', () => {
  const ev = [{ id: 'a1', at: '2026-11-24T22:24:53.363Z', kind: 'price-drop', title: 'x <b>&', summary: 'y', provider: 'p', model: 'm', unit: 'USD', after: '0.1', source: 'https://s' }];
  const jf = jsonFeed(ev);
  assert.equal(jf.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(jf.items[0].external_url, 'https://s');
  const x = rss(ev, { builtAt: '2026-11-24T22:30:00Z' });
  assert.match(x, /<title>x &lt;b&gt;&amp;<\/title>/);
  assert.match(x, /<pubDate>Tue, 24 Nov 2026 22:24:53 GMT<\/pubDate>/);
  assert.deepEqual(mergeHistory([{ id: 'b' }, { id: 'a' }], [{ id: 'a' }, { id: 'c' }], 3).map((e) => e.id), ['a', 'c', 'b']);
  assert.equal(filterEvents(ev, { maxIuUsd: '0.1', kinds: ['price-drop'], model: 'M' }).length, 1);
  assert.equal(filterEvents(ev, { maxIuUsd: '0.09' }).length, 0);
  assert.equal(filterEvents(ev, { since: '2026-11-24T22:24:53.363Z' }).length, 0);
  assert.throws(() => filterEvents(ev, { since: 'yesterday' }), /not a date/);
});

test('build: baseline, then diff carries history; older snapshots and missing history are refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apf-'));
  const w = (n, s) => { const f = join(dir, n); require_write(f, s); return f; };
  const s0 = w('s0.json', A);
  const s1 = w('s1.json', later(A, (x) => Object.assign(find(x, 'openrouter', 'thinkingmachines/inkling-2-mini'), { inPer1M: '0.06', outPer1M: '0.24' })));
  const m0 = await build({ snapshot: s0, prev: join(dir, 'none'), out: join(dir, 'site0'), now: () => new Date('2026-11-24T21:00:00Z') });
  assert.equal(m0.run.kind, 'baseline');
  const m1 = await build({ snapshot: s1, prev: join(dir, 'site0', 'data'), out: join(dir, 'site1') });
  assert.deepEqual([m1.run.kind, m1.run.newEvents], ['diff', 1]);
  const m2 = await build({ snapshot: s0, prev: join(dir, 'site1', 'data'), out: join(dir, 'site2') });
  assert.equal(m2.run.kind, 'older-snapshot');
  const ev2 = JSON.parse(readFileSync(join(dir, 'site2', 'data', 'events.json'), 'utf8'));
  assert.equal(ev2.events.length, 1, 'history kept');
  assert.equal(ev2.snapshotAt, '2026-11-24T22:24:53.363Z', 'never goes backwards');
  for (const f of ['feed.json', 'feed.xml', 'data/latest.json', 'data/state.json']) assert.ok(existsSync(join(dir, 'site1', f)), f);
  w('broken/state.json', JSON.parse(readFileSync(join(dir, 'site1', 'data', 'state.json'), 'utf8')));
  await assert.rejects(build({ snapshot: s1, prev: join(dir, 'broken'), out: join(dir, 'site3') }), /refusing to reset history/);
  const failing = async () => ({ status: 503, ok: false });
  await assert.rejects(build({ snapshot: s1, prev: 'https://example.invalid/data/', out: join(dir, 'site4'), fetchImpl: failing }), /HTTP 503/);
});

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
function require_write(f, obj) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(obj)); }

test('cli and mcp: events filter a local feed through an npx-style symlink; exit codes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apf-cli-'));
  const s0 = join(dir, 's0.json'); require_write(s0, A);
  const s1 = join(dir, 's1.json'); require_write(s1, later(A, (x) => Object.assign(find(x, 'openrouter', 'thinkingmachines/inkling-2-mini'), { inPer1M: '0.06', outPer1M: '0.24' })));
  await build({ snapshot: s0, prev: join(dir, 'x'), out: join(dir, 'a') });
  await build({ snapshot: s1, prev: join(dir, 'a', 'data'), out: join(dir, 'b') });
  const link = join(dir, 'agent-price-feed');
  symlinkSync(fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), link);
  const run = (...a) => spawnSync(process.execPath, [link, ...a, '--feed', join(dir, 'b', 'data')], { encoding: 'utf8' });
  const hit = run('events', '--kind', 'price-drop', '--model', 'inkling');
  assert.equal(hit.status, 0, hit.stdout + hit.stderr);
  assert.equal(JSON.parse(hit.stdout).events[0].after, '0.105');
  assert.equal(run('events', '--kind', 'new-venue').status, 1);
  assert.equal(run('events', '--kind', 'bogus').status, 2);
  const h = makeHandler({ feed: join(dir, 'b', 'data') });
  assert.equal((await h({ id: 1, method: 'tools/list' })).result.tools[0].name, 'price_alerts');
  const r = await h({ id: 2, method: 'tools/call', params: { name: 'price_alerts', arguments: { kinds: ['price-drop'], maxIuUsd: '0.2' } } });
  assert.equal(JSON.parse(r.result.content[0].text).count, 1);
  assert.equal(KINDS.length, 11);
  const out = [];
  assert.equal(await main([], { out: (s) => out.push(s) }), 2);
});
