# Changelog

## 0.1.0 (2026-11-24)

First release.

- Diffs justweight snapshots into 11 event kinds: price drop or rise (2% or more, exact decimals, per IU), cheapest-route change per model family, new venue, model or offer, removed offer, Flop listing outside devnet, Flop watcher stage change, and source down or back.
- Noise rules: the first run is a baseline, a source outage is one event, a huge run is capped (most useful kinds first), older snapshots are ignored, and a failed read of the previous state fails the build instead of resetting history.
- Publishes JSON Feed 1.1, RSS 2.0, `events.json`, `latest.json` and `state.json` to GitHub Pages every 2 hours, with no secrets and no commits.
- CLI `events` (filters, exit 0/1/2), `kinds`, `build`. MCP server with one tool, `price_alerts`.
- Live page with kind filters and search.
- 10 tests on two real snapshots plus labelled synthetic edits. No dependencies.
