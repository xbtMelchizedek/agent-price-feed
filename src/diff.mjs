// Turn two justweight snapshots into alert events. Pure: no I/O, no clock. Everything an event says is read
// from the snapshots, with the source URL of the row it came from.
import { createHash } from 'node:crypto';
import { iuOf, fromPico, toPico, bps } from './decimal.mjs';

export const KINDS = ['price-drop', 'price-rise', 'cheapest-change', 'new-offer', 'new-model', 'new-venue', 'removed-offer', 'flop-listing', 'flop-watch', 'source-down', 'source-back'];
const DEFAULTS = { minChangeBps: 200, maxEventsPerRun: 150 };

export const offerKey = (o) => `${o.provider}|${o.network ?? ''}|${o.model}`;
/** Model family: lowercased, without the provider's ":fp4"-style suffix. */
export const family = (model) => String(model).toLowerCase().split(':')[0];

/** Compact state kept between runs: one price per offer, each source's health, the Flop watch stage. */
export function stateOf(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.offers) || !Array.isArray(snapshot.sources) || typeof snapshot.generatedAt !== 'string') {
    throw new Error('not a justweight snapshot (needs generatedAt, offers[], sources[])');
  }
  const offers = {};
  for (const o of snapshot.offers) {
    if (typeof o?.provider !== 'string' || typeof o?.model !== 'string' || typeof o?.unit !== 'string') continue;
    const iu = iuOf(o.inPer1M, o.outPer1M);
    const eff = o.effective ? iuOf(o.effective.inPer1M, o.effective.outPer1M) : null;
    offers[offerKey(o)] = {
      provider: o.provider, network: o.network ?? null, model: o.model, unit: o.unit,
      inPer1M: o.inPer1M ?? null, outPer1M: o.outPer1M ?? null,
      iu: iu === null ? null : fromPico(iu), effectiveIu: eff === null ? null : fromPico(eff), source: o.source ?? null,
    };
  }
  const sources = {};
  for (const s of snapshot.sources) if (typeof s?.id === 'string') sources[s.id] = { ok: s.ok === true, url: s.url ?? null };
  return { snapshotAt: snapshot.generatedAt, offers, sources, flopStage: snapshot.flop?.watch?.stage ?? null, flopDetail: snapshot.flop?.watch?.detail ?? null };
}

const isFlop = (o) => o.provider.startsWith('flop');
const realNetwork = (o) => isFlop(o) && o.network !== null && o.network !== 'devnet';

function sourceOk(state, url) {
  if (!url) return true;
  const s = Object.values(state.sources).find((x) => x.url === url);
  return s ? s.ok : true; // rows with no fetched source (e.g. local) are static
}

function cheapestByFamily(state) {
  const best = {};
  for (const [k, o] of Object.entries(state.offers)) {
    if (o.unit !== 'USD' || o.iu === null) continue;
    const f = family(o.model);
    const p = o.iu;
    const cur = best[f];
    if (!cur || cmp(p, cur.iu) < 0 || (cmp(p, cur.iu) === 0 && k < cur.key)) best[f] = { key: k, iu: p, n: (cur?.n ?? 0) + 1, provider: o.provider, source: o.source };
    else cur.n += 1;
  }
  return best;
}
// Compare two decimal strings exactly.
const cmp = (a, b) => { const x = toPico(a), y = toPico(b); return x < y ? -1 : x > y ? 1 : 0; };

const money = (unit, v) => (unit === 'USD' ? `$${v}` : `${v} ${unit}`);
const pct = (b) => `${b > 0 ? '+' : ''}${(b / 100).toFixed(1)}%`;

/**
 * Events between two states. `prev` null means this is the first run: no events (a baseline, not a flood).
 * @returns {{events: object[], truncated: number}}
 */
export function diff(prev, next, opts = {}) {
  const { minChangeBps, maxEventsPerRun } = { ...DEFAULTS, ...opts };
  if (!prev || prev.snapshotAt === next.snapshotAt) return { events: [], truncated: 0 };
  const at = next.snapshotAt;
  const ev = [];
  const push = (e) => ev.push({ at, ...e, id: createHash('sha256').update(JSON.stringify([at, e.kind, e.key ?? e.subject])).digest('hex').slice(0, 16) });

  // Sources first: they decide which removals and additions are real.
  for (const [id, s] of Object.entries(next.sources)) {
    const was = prev.sources[id];
    if (was?.ok && !s.ok) push({ kind: 'source-down', subject: id, title: `${id} did not answer`, summary: `Rows from ${id} are held at their last price until it answers again.`, source: s.url });
    if (was && !was.ok && s.ok) push({ kind: 'source-back', subject: id, title: `${id} is answering again`, summary: `${id} answered after being down.`, source: s.url });
  }

  const prevProviders = new Set(Object.values(prev.offers).map((o) => o.provider));
  const prevFamilies = new Set(Object.values(prev.offers).map((o) => family(o.model)));
  const newProviders = new Set();
  const newFamilies = new Set();
  for (const [k, o] of Object.entries(next.offers)) {
    const p = prev.offers[k];
    if (!p) {
      // A Flop listing outside devnet is always news, even when its explorer was down last run.
      if (realNetwork(o)) { push({ kind: 'flop-listing', key: k, provider: o.provider, model: o.model, unit: o.unit, after: o.iu, title: `Flop ${o.network} lists ${o.model}`, summary: `${o.provider} on ${o.network}: ${o.model} at ${money(o.unit, o.iu ?? '?')} per IU.`, source: o.source }); continue; }
      if (!sourceOk(prev, o.source)) continue; // its source was down last time: the row is back, not new
      if (!prevProviders.has(o.provider) && !newProviders.has(o.provider)) {
        newProviders.add(o.provider);
        push({ kind: 'new-venue', key: k, provider: o.provider, model: o.model, unit: o.unit, after: o.iu, title: `New venue: ${o.provider}`, summary: `${o.provider} appears, first row ${o.model} at ${money(o.unit, o.iu ?? '?')} per IU.`, source: o.source });
      } else if (!prevFamilies.has(family(o.model)) && !newFamilies.has(family(o.model))) {
        newFamilies.add(family(o.model));
        push({ kind: 'new-model', key: k, provider: o.provider, model: o.model, unit: o.unit, after: o.iu, title: `New model: ${family(o.model)}`, summary: `${family(o.model)} first listed by ${o.provider} at ${money(o.unit, o.iu ?? '?')} per IU.`, source: o.source });
      } else {
        push({ kind: 'new-offer', key: k, provider: o.provider, model: o.model, unit: o.unit, after: o.iu, title: `${o.provider} now serves ${o.model}`, summary: `${money(o.unit, o.iu ?? '?')} per IU.`, source: o.source });
      }
      continue;
    }
    if (p.iu === null || o.iu === null || p.unit !== o.unit) continue;
    const a = toPico(p.iu), b = toPico(o.iu);
    if (a === b || a === 0n) continue;
    const change = bps(a, b);
    if (Math.abs(change) < minChangeBps) continue;
    push({
      kind: change < 0 ? 'price-drop' : 'price-rise', key: k, provider: o.provider, model: o.model, unit: o.unit, before: p.iu, after: o.iu, changeBps: change,
      title: `${o.model} on ${o.provider} ${change < 0 ? 'down' : 'up'} ${pct(change)}`,
      summary: `${money(o.unit, p.iu)} → ${money(o.unit, o.iu)} per IU (in ${p.inPer1M}→${o.inPer1M}, out ${p.outPer1M}→${o.outPer1M} per 1M tokens).`, source: o.source,
    });
  }
  for (const [k, p] of Object.entries(prev.offers)) {
    if (next.offers[k] || !sourceOk(next, p.source)) continue;
    push({ kind: 'removed-offer', key: k, provider: p.provider, model: p.model, unit: p.unit, before: p.iu, title: `${p.provider} dropped ${p.model}`, summary: `The source answered without this row (was ${money(p.unit, p.iu ?? '?')} per IU).`, source: p.source });
  }

  const cb = cheapestByFamily(prev), cn = cheapestByFamily(next);
  for (const [f, n] of Object.entries(cn)) {
    const p = cb[f];
    if (!p || p.key === n.key || n.n < 2) continue;
    push({ kind: 'cheapest-change', key: n.key, subject: f, provider: n.provider, model: f, unit: 'USD', before: p.iu, after: n.iu,
      title: `Cheapest ${f}: ${n.provider}`, summary: `Was ${p.provider} at $${p.iu}, now ${n.provider} at $${n.iu} per IU (list price, ${n.n} USD offers).`, source: n.source });
  }

  if (prev.flopStage !== next.flopStage) {
    push({ kind: 'flop-watch', subject: 'flop-watch', before: prev.flopStage, after: next.flopStage, title: `Flop testnet watcher: ${prev.flopStage ?? 'none'} → ${next.flopStage ?? 'none'}`, summary: next.flopDetail ?? '', source: 'https://xbtmelchizedek.github.io/justweight/' });
  }

  // Most useful first if a run is huge (e.g. a provider reprices everything at once).
  const rank = (e) => KINDS.indexOf(e.kind);
  ev.sort((x, y) => rank(x) - rank(y) || Math.abs(y.changeBps ?? 0) - Math.abs(x.changeBps ?? 0) || (x.key ?? '').localeCompare(y.key ?? ''));
  const truncated = Math.max(0, ev.length - maxEventsPerRun);
  return { events: ev.slice(0, maxEventsPerRun), truncated };
}
