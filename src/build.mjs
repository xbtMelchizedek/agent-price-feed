// One feed build: read the justweight snapshot and the previously published state, diff, write the site's data.
// The previous state comes from the live site itself, so CI keeps no state of its own and commits nothing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateOf, diff } from './diff.mjs';
import { mergeHistory, jsonFeed, rss, SITE } from './feed.mjs';

export const SNAPSHOT_URL = 'https://xbtmelchizedek.github.io/justweight/data/snapshot.json';
export const PREV_URL = `${SITE}data/`;

const isUrl = (s) => /^https:\/\//.test(s);

/** Read JSON from an https URL or a file. Returns null only for "not there" (404 / ENOENT); anything else throws. */
export async function readJson(where, { fetchImpl = globalThis.fetch } = {}) {
  if (isUrl(where)) {
    const r = await fetchImpl(where, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${where}: HTTP ${r.status}`);
    return r.json();
  }
  if (/^http:\/\//.test(where)) throw new Error(`${where}: https only`);
  try {
    return JSON.parse(readFileSync(where, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** A file inside a base that is either an https URL or a directory. */
export const inBase = (base, f) => (isUrl(base) ? new URL(f, base.endsWith('/') ? base : `${base}/`).href : join(base, f));

export async function build({ snapshot = SNAPSHOT_URL, prev = PREV_URL, out = '_site', fetchImpl, now = () => new Date(), site = SITE } = {}) {
  const snap = await readJson(snapshot, { fetchImpl });
  if (!snap) throw new Error(`${snapshot}: not found`);
  const next = stateOf(snap);
  const prevState = await readJson(inBase(prev, 'state.json'), { fetchImpl });
  const prevEvents = prevState ? await readJson(inBase(prev, 'events.json'), { fetchImpl }) : null;
  if (prevState && !prevEvents) throw new Error('previous state.json exists but events.json does not: refusing to reset history');
  const history = prevEvents?.events ?? [];

  let state = next;
  let run;
  if (prevState && Date.parse(next.snapshotAt) < Date.parse(prevState.snapshotAt)) {
    state = prevState; // an older snapshot (cache, rollback): never go backwards
    run = { kind: 'older-snapshot', newEvents: 0, truncated: 0 };
  } else {
    const { events, truncated } = diff(prevState, next);
    run = { kind: prevState ? (prevState.snapshotAt === next.snapshotAt ? 'same-snapshot' : 'diff') : 'baseline', newEvents: events.length, truncated, events };
  }
  const merged = mergeHistory(history, run.events ?? []);
  const builtAt = now().toISOString();
  const meta = { builtAt, snapshotAt: state.snapshotAt, snapshotUrl: isUrl(snapshot) ? snapshot : null, run: { kind: run.kind, newEvents: run.newEvents, truncated: run.truncated } };

  mkdirSync(join(out, 'data'), { recursive: true });
  writeFileSync(join(out, 'data', 'state.json'), JSON.stringify(state));
  writeFileSync(join(out, 'data', 'events.json'), JSON.stringify({ ...meta, events: merged }, null, 1));
  writeFileSync(join(out, 'data', 'latest.json'), JSON.stringify({ ...meta, events: run.events ?? [] }, null, 1));
  writeFileSync(join(out, 'feed.json'), JSON.stringify(jsonFeed(merged.slice(0, 100), { site }), null, 1));
  writeFileSync(join(out, 'feed.xml'), rss(merged.slice(0, 100), { site, builtAt }));
  return meta;
}
