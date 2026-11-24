# agent-price-feed

Inference price alerts for AI agents. The feed answers one question: what changed since your agent last looked?

Every two hours it diffs the [justweight](https://github.com/xbtMelchizedek/justweight) snapshot, which covers Flop, Pearl, Venice, Chutes (Bittensor), every OpenRouter provider and local models. It publishes what changed as JSON Feed, RSS, a CLI and an MCP tool. Each event carries exact before and after prices and links the page or API it was read from.

**Live:** https://xbtmelchizedek.github.io/agent-price-feed/ · [feed.json](https://xbtmelchizedek.github.io/agent-price-feed/feed.json) · [feed.xml](https://xbtmelchizedek.github.io/agent-price-feed/feed.xml)

## Quickstart

```sh
npx -y github:xbtMelchizedek/agent-price-feed events --kind price-drop,cheapest-change --model qwen3.8
```

Node 22 or later. The command exits 0 when something matched and 1 when nothing did, so a cron line like `… events --since "$LAST" && notify` just works.

## Events

All prices are per **IU**: 750k input + 250k output tokens of that model, at list price. OpenRouter's effective price stays in the snapshot.

| Kind | When |
|---|---|
| `price-drop`, `price-rise` | An offer's IU price moved by 2% or more. |
| `cheapest-change` | The cheapest USD offer for a model family moved to a different venue or provider. Families need 2 or more offers. |
| `new-venue`, `new-model`, `new-offer` | A provider, model family, or provider × model pair appeared. |
| `removed-offer` | Its source answered without that row. |
| `flop-listing` | A Flop gateway outside devnet lists a model. This is the "testnet is live" alert. |
| `flop-watch` | justweight's testnet watcher changed stage, e.g. `explorer-down` → `no-models` → `filled`. |
| `source-down`, `source-back` | A price source stopped or started answering. |

Noise rules:
- **The first run is a baseline**, so you don't get a flood of 700 "new" events.
- **A source outage is one event.** Rows from a down source aren't reported as removed, and they aren't reported as new when the source comes back.
- **One huge run is capped at 150 events**, most useful kinds first. The cut is recorded as `run.truncated`.
- **The feed never goes backwards.** An older snapshot (from a cache or a rollback) is ignored.
- **History is never reset by a flaky read.** The build reads the previous state from the live site. Any error except a 404 fails the build, and the old site stays up.

Two real snapshots 19 minutes apart give zero events; that's in the tests.

## Agents

```sh
agent-price-feed events [--since <ISO>] [--kind a,b] [--model <text>] [--provider <text>] [--max-iu-usd <amount>] [--feed <url|dir>]
agent-price-feed kinds
agent-price-feed mcp
```

As an MCP server it provides one tool, `price_alerts`, with the same filters:

```json
{ "mcpServers": { "price-feed": { "command": "npx", "args": ["-y", "github:xbtMelchizedek/agent-price-feed", "mcp"] } } }
```

As a library:

```js
import { stateOf, diff, alerts } from 'agent-price-feed';
const { events } = diff(stateOf(oldSnapshot), stateOf(newSnapshot), { minChangeBps: 100 });
const recent = await alerts({ kind: 'flop-listing' }); // reads the live feed
```

To pair alerts with spending, [agent-spendcap](https://github.com/xbtMelchizedek/agent-spendcap) caps what an agent may spend once it decides to switch.

## Run your own feed

```sh
git clone https://github.com/xbtMelchizedek/agent-price-feed && cd agent-price-feed
npm test
node src/cli.mjs build --snapshot <url|file> --prev <your-site>/data/ --out _site && node scripts/build-web.mjs
```

`build` writes these files:

| File | Contents |
|---|---|
| `_site/data/state.json` | One price per offer, the next run's baseline |
| `_site/data/events.json` | Up to 500 kept events |
| `_site/data/latest.json` | This run's events |
| `_site/feed.json` | JSON Feed 1.1 |
| `_site/feed.xml` | RSS 2.0 |

The Pages workflow does this every 2 hours, 30 minutes after justweight rebuilds. It needs no secrets and commits nothing.

## Limits

- The feed is only as good as justweight's sources. A source missing from the snapshot is a missing source here too, never a price of zero.
- It reads list prices, not your negotiated, cached or batch rates.
- An event is about 0–2 hours behind the source page, plus Pages caching (about 10 minutes).

## Part of the agent inference kit

Small tools that each do one job and work together. Use any one on its own.

- [justweight](https://github.com/xbtMelchizedek/justweight): one price table for every inference venue (Flop, Pearl, Venice, Chutes, each OpenRouter provider, local) in one unit, with each price linked to its source.
- [justweight `infer`](https://github.com/xbtMelchizedek/justweight#infer-route-one-call-with-caps-and-a-receipt): an MCP tool that routes one call to the cheapest venue meeting your privacy floor, under hard spend caps, and returns chained receipts.
- [agent-price-feed](https://github.com/xbtMelchizedek/agent-price-feed) (this repo): alerts by JSON Feed, RSS, CLI and MCP when those prices move, a cheaper route appears, or Flop lists a model.
- [agent-spendcap](https://github.com/xbtMelchizedek/agent-spendcap): a budget policy for agents: holds before each call, settlement from real usage, a hash-chained ledger, and a drop-in fetch for OpenAI-compatible APIs.
- [agent-cost-proxy](https://github.com/xbtMelchizedek/agent-cost-proxy): one command, a local proxy for coding agents that records each call's real cost and the cheapest listed price for the same tokens, with optional caps.
- [flop-receipt-root](https://github.com/xbtMelchizedek/flop-receipt-root): proves a Flop compute settlement to an EVM contract without a bridge, and checks one receipt offline.
- [flop-spend](https://github.com/xbtMelchizedek/flop-spend): has an address spent on Flop inference yet? Settled spend per address, re-read on chain, as a CLI, MCP tool and dashboard.

## Develop

`npm test` runs 10 tests on two real snapshots plus labelled synthetic edits (see `test/fixtures/README.md`). Dependencies: none. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

MIT. The page uses Arc UI foundation tokens (MIT, see `web/arc/LICENSE`).
