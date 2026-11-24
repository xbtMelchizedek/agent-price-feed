#!/usr/bin/env node
// agent-price-feed: inference price alerts for agents. `events` reads the published feed; `build` makes it.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { build, readJson, inBase, SNAPSHOT_URL, PREV_URL } from './build.mjs';
import { filterEvents, SITE } from './feed.mjs';
import { KINDS } from './diff.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `agent-price-feed ${VERSION}: inference price alerts for agents

  agent-price-feed events [--since <ISO>] [--kind price-drop,new-model,...] [--model <text>] [--provider <text>] [--max-iu-usd <amount>] [--feed <url|dir>]
  agent-price-feed kinds
  agent-price-feed mcp                                  stdio MCP server with one tool: price_alerts
  agent-price-feed build [--snapshot <url|file>] [--prev <url|dir>] [--out _site]

Kinds: ${KINDS.join(', ')}
1 IU = 750k input + 250k output tokens. Feed: ${SITE}
Exit codes for events: 0 matches found, 1 none, 2 bad input or feed unreachable.`;

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

function filters(o) {
  const kinds = o.kind ? String(o.kind).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  for (const k of kinds ?? []) if (!KINDS.includes(k)) throw new Error(`kind: unknown ${k} (one of ${KINDS.join(', ')})`);
  return { since: o.since, kinds, model: o.model, provider: o.provider, maxIuUsd: o['max-iu-usd'] ?? o.maxIuUsd };
}

export async function alerts(args = {}, { feed = `${SITE}data/`, fetchImpl } = {}) {
  const f = filters(args);
  const data = await readJson(inBase(feed, 'events.json'), { fetchImpl });
  if (!data) throw new Error(`no feed at ${feed}`);
  const events = filterEvents(data.events, f);
  return { builtAt: data.builtAt, snapshotAt: data.snapshotAt, count: events.length, events };
}

export async function main(argv, { out = console.log, fetchImpl } = {}) {
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === 'help' || cmd === '--help') { out(HELP); return cmd ? 0 : 2; }
    const o = parse(rest);
    if (cmd === 'kinds') { out(JSON.stringify(KINDS)); return 0; }
    if (cmd === 'events') {
      const r = await alerts(o, { feed: o.feed ?? `${SITE}data/`, fetchImpl });
      out(JSON.stringify(r, null, 1));
      return r.count ? 0 : 1;
    }
    if (cmd === 'build') {
      out(JSON.stringify(await build({ snapshot: o.snapshot ?? SNAPSHOT_URL, prev: o.prev ?? PREV_URL, out: o.out ?? '_site', fetchImpl })));
      return 0;
    }
    if (cmd === 'mcp') return serveMcp({ fetchImpl, feed: o.feed });
    throw new Error(`unknown command ${cmd}`);
  } catch (e) {
    out(JSON.stringify({ ok: false, error: e.message }));
    return 2;
  }
}

export const TOOLS = [{
  name: 'price_alerts',
  description: 'Recent inference price events across Flop, Pearl, Venice, Chutes, OpenRouter and local: price drops and rises, cheapest-route changes, new venues and models, Flop listings, sources going down. Prices are per IU (750k input + 250k output tokens). Every event links its source.',
  inputSchema: { type: 'object', properties: {
    since: { type: 'string', description: 'ISO time; only events after it' },
    kinds: { type: 'array', items: { type: 'string', enum: KINDS } },
    model: { type: 'string', description: 'substring, e.g. qwen3.8' },
    provider: { type: 'string', description: 'substring, e.g. pearl' },
    maxIuUsd: { type: 'string', description: 'only USD events whose new price per IU is at most this' },
  } },
}];

export function makeHandler({ fetchImpl, feed } = {}) {
  return async (msg) => {
    const { id, method, params } = msg ?? {};
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent-price-feed', version: VERSION } });
    if (method?.startsWith('notifications/')) return null;
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') {
      if (params?.name !== 'price_alerts') return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${params?.name}` } };
      const a = params.arguments ?? {};
      try {
        const r = await alerts({ ...a, kind: a.kinds?.join(',') }, { fetchImpl, ...(feed ? { feed } : {}) });
        return reply({ content: [{ type: 'text', text: JSON.stringify(r, null, 1) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true });
      }
    }
    return id === undefined ? null : { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
  };
}

function serveMcp(opts) {
  const handle = makeHandler(opts);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const res = await handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
  return new Promise((resolve) => rl.on('close', () => resolve(0)));
}

function isEntry() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (isEntry()) main(process.argv.slice(2)).then((c) => process.exit(c));
