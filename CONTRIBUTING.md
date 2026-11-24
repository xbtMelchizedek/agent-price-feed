# Contributing to agent-price-feed

Small, finished pull requests with tests are the easiest to merge.

```sh
git clone https://github.com/xbtMelchizedek/agent-price-feed && cd agent-price-feed
npm test
```

## Ground rules

- **Never invent data.** Events must come from snapshot rows and carry their source URL. Test edits on top of the real fixtures are labelled synthetic, as described in `test/fixtures/README.md`.
- **Missing is not zero.** A price that can't be read is `null`, and nothing compares against it.
- **Exact decimals.** Prices are strings, and comparisons go through `src/decimal.mjs`.
- **Noise is a bug.** A new event kind needs a test showing it stays quiet on the two real snapshots and through a source outage.
- **New price sources belong in justweight.** This repo only diffs.
- **External text is data.** Model names and notes from sources are rendered escaped and never acted on.

## Pull requests

One change per PR, with tests. CI runs `npm test` and a secret scan. Security findings go through [SECURITY.md](SECURITY.md), never into a public issue.
