<div align="center">

# weeklygrant

**See the API-equivalent dollar value of your weekly Codex grant — from the logs already on your machine.**

[![npm](https://img.shields.io/npm/v/weeklygrant)](https://www.npmjs.com/package/weeklygrant)
[![npm downloads](https://img.shields.io/npm/dm/weeklygrant.svg)](https://www.npmjs.com/package/weeklygrant)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Ink](https://img.shields.io/badge/UI-Ink-61DAFB?logo=react&logoColor=000)](https://github.com/vadimdemedes/ink)
[![CI](https://img.shields.io/github/actions/workflow/status/aneeshpatne/weeklygrant/ci.yml?branch=main)](https://github.com/aneeshpatne/weeklygrant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/aneeshpatne/weeklygrant)](LICENSE)

</div>

## Run it

Published on [npm](https://www.npmjs.com/package/weeklygrant). No install or configuration required:

```bash
npx weeklygrant
```

Want the model-by-model breakdown instead?

```bash
npx weeklygrant usage
```

Other useful commands:

```bash
npx weeklygrant --json                  # complete machine-readable report
npx weeklygrant --days 30               # scan files modified in the last 30 days
npx weeklygrant --no-network            # use bundled prices only
npx weeklygrant --home /path/to/.codex  # scan a different Codex home
npx weeklygrant --json --redact         # hide your local Codex home path
npx weeklygrant version                 # print the installed version
```

Requires Node.js 22 or newer and local Codex session logs. By default, weeklygrant
looks in `CODEX_HOME` and then `~/.codex`.

## What you get

In a terminal, `npx weeklygrant` opens an interactive dashboard showing:

- estimated weekly API value;
- confidence in the estimate;
- weekly quota used and time until reset;
- grant, quota, and observed-cost graphs.

Use `←`/`→` to switch graphs, `↑`/`↓` to change the time range, and `q` or
Escape to quit.

`npx weeklygrant usage` opens a per-model usage dashboard. Use `↑`/`↓` to select
a model, `←`/`→` to change the metric, and `-`/`+` to change the time range.

When output is piped or redirected, weeklygrant automatically prints compact
text instead of the interactive UI. Pass `--json` for the full report.

## What the number means

weeklygrant reads token counters and weekly quota observations from your local
Codex JSONL session files. It prices the observed token deltas at public API
rates, compares that cost with changes in your reported weekly quota, and fits
an estimated full-week value.

The result is a **planning estimate**, not a Codex bill, credit balance, or
subscription term. It can be less reliable when:

- only a small amount of quota has moved;
- logs are missing or spread across other machines;
- a model has no known public price;
- prices or rounded quota observations change.

Low- and no-confidence estimates are withheld in the interactive UI until there
is enough reliable quota movement. If there is already enough history to graph,
the dashboard still renders quota and cost series and shows the estimate as a
dash. Press `r` to rescan.

> [!WARNING]
> weeklygrant is independent and unofficial. It is not affiliated with,
> endorsed by, or associated with OpenAI, Codex, or models.dev. Do not use its
> estimate as the sole reason for a purchase or cancellation decision.

## Privacy and networking

Session contents stay on your machine. weeklygrant has no telemetry, analytics,
accounts, advertising, or local usage database, and it writes nothing to your
session directory.

Unless you pass `--no-network`, it makes one GET request to
`https://models.dev/api.json` for current public pricing. The request does not
include session contents and times out after four seconds; bundled rate cards
are used if it fails. See [PRIVACY.md](PRIVACY.md) for the full data-handling
description.

`--json` includes the resolved Codex home path. Use `--redact` before sharing
the output. Codex session files may contain prompts even though weeklygrant only
reads accounting fields; handle the original files carefully.

## How it works

```mermaid
flowchart LR
  Home[Local Codex logs] --> Parse[Token deltas and quota]
  Parse --> Price[Price observed tokens]
  Cards[models.dev or bundled rates] --> Price
  Price --> Fit[Fit weekly API value]
  Parse --> Fit
  Fit --> Output{Output}
  Output -->|Interactive terminal| TUI[Dashboard]
  Output -->|Pipe or --json| Report[Text or JSON]
```

The scanner recursively reads `sessions/` and `archived_sessions/` under the
resolved Codex home. `--days` filters files by modification time. Invalid JSONL
lines are skipped, and unknown models remain unpriced rather than being assigned
a guessed rate.

Token counters are cumulative, so weeklygrant prices the difference between
events: uncached input, cached input, and billed output. It splits quota history
into epochs when a weekly reset is detected, ignores small downward jitter, and
derives the headline from a weighted median of recent valid cost/quota pairs.
Confidence is based on the number of valid pairs, quota coverage, and agreement
between recent fitted values.

The interactive estimate runs in a worker thread so the dashboard remains
responsive while files are scanned. The full JSON report also includes pricing
sources, rate-card mode, scanned-file and event counts, measurement pairs,
dashboard series, and the resolved Codex home.

## Develop locally

```bash
git clone https://github.com/aneeshpatne/weeklygrant.git
cd weeklygrant
npm ci
npm run dev
```

Run the checks before submitting a change:

```bash
npm test
npm run check
npm run build
npm pack --dry-run
```

The project uses TypeScript, Node.js 22+, React, and Ink. The estimator lives in
`src/lib/codex-grant.ts`; CLI and TUI code lives in `src/bin/`. Tests use Node's
built-in test runner through tsx. Contribution and synthetic-fixture guidelines
are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Release history is in [CHANGELOG.md](CHANGELOG.md), and security
issues can be reported using [SECURITY.md](SECURITY.md).

---

<div align="center">
  Local JSONL, public prices, a weekly API-equivalent number — and nothing uploaded.
</div>
