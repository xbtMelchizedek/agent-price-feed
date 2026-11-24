import { toPico } from './decimal.mjs';

// Render events as JSON Feed 1.1 and RSS 2.0, and merge a run's events into the kept history.
export const SITE = 'https://xbtmelchizedek.github.io/agent-price-feed/';
export const HISTORY = 500;

/** New events first, then the old ones, deduped by id, capped. */
export function mergeHistory(oldEvents, newEvents, cap = HISTORY) {
  const seen = new Set();
  const out = [];
  for (const e of [...newEvents, ...oldEvents]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length === cap) break;
  }
  return out;
}

export function jsonFeed(events, { site = SITE } = {}) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'agent-price-feed: inference price alerts',
    home_page_url: site,
    feed_url: `${site}feed.json`,
    description: 'Price drops, new venues and models, and Flop listings across Flop, Pearl, Venice, Chutes, OpenRouter and local, from the justweight snapshot. 1 IU = 750k input + 250k output tokens.',
    items: events.map((e) => ({
      id: e.id,
      url: `${site}#${e.id}`,
      external_url: e.source ?? undefined,
      title: e.title,
      content_text: e.summary,
      date_published: e.at,
      tags: [e.kind, e.provider, e.model].filter(Boolean),
      _agent_price_feed: e,
    })),
  };
}

const x = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function rss(events, { site = SITE, builtAt } = {}) {
  const items = events.map((e) => `  <item>
    <guid isPermaLink="false">${x(e.id)}</guid>
    <title>${x(e.title)}</title>
    <link>${x(`${site}#${e.id}`)}</link>
    <description>${x(e.summary)}${e.source ? x(` Source: ${e.source}`) : ''}</description>
    <category>${x(e.kind)}</category>
    <pubDate>${new Date(e.at).toUTCString()}</pubDate>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>agent-price-feed: inference price alerts</title>
  <link>${x(site)}</link>
  <atom:link href="${x(`${site}feed.xml`)}" rel="self" type="application/rss+xml"/>
  <description>Price drops, new venues and models, and Flop listings for AI inference, from the justweight snapshot.</description>
  <lastBuildDate>${new Date(builtAt ?? Date.now()).toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

/** Filter for agents: since (ISO), kinds, provider/model substring, max IU price in USD. */
export function filterEvents(events, { since, kinds, model, provider, maxIuUsd } = {}) {
  const t = since ? Date.parse(since) : null;
  if (since && Number.isNaN(t)) throw new Error(`since: not a date: ${since}`);
  const cap = maxIuUsd === undefined ? null : toPico(String(maxIuUsd));
  if (maxIuUsd !== undefined && cap === null) throw new Error(`max-iu-usd: not a decimal amount: ${maxIuUsd}`);
  return events.filter((e) =>
    (t === null || Date.parse(e.at) > t)
    && (!kinds?.length || kinds.includes(e.kind))
    && (!model || String(e.model ?? '').toLowerCase().includes(model.toLowerCase()))
    && (!provider || String(e.provider ?? '').toLowerCase().includes(provider.toLowerCase()))
    && (cap === null || (e.unit === 'USD' && toPico(e.after) !== null && toPico(e.after) <= cap)));
}
