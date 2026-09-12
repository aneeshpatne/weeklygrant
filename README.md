# weeklygrant

Estimate the API-equivalent value of a weekly Codex grant from local session logs.

[![npm version](https://img.shields.io/npm/v/weeklygrant)](https://www.npmjs.com/package/weeklygrant)
[![total downloads](https://img.shields.io/npm/dt/weeklygrant.svg)](https://www.npmjs.com/package/weeklygrant)
[![CI](https://img.shields.io/github/actions/workflow/status/aneeshpatne/weeklygrant/ci.yml?branch=main)](https://github.com/aneeshpatne/weeklygrant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/aneeshpatne/weeklygrant)](LICENSE)

```bash
npx weeklygrant             # interactive dashboard, or text when piped
npx weeklygrant usage       # per-model tokens and API-equivalent value
npx weeklygrant --json      # complete machine-readable report
```

Requires Node.js 22 or newer and local Codex JSONL sessions. No account, server,
telemetry, runtime dependencies, or default network requests.

## Reading the result

The estimate prices token usage and compares that cost with observed quota
movement. For example, $1 of matched usage over 2 quota points implies a $50
API-equivalent grant at that usage mix. This is a planning estimate, not a Codex
bill, credit balance, guaranteed spending maximum, or subscription entitlement.

An early estimate appears after the first usable interval and is explicitly
labeled low confidence. Medium confidence requires at least two matched
intervals, five quota points, and a reasonably consistent fit; high confidence
requires five intervals, twenty points, and a tighter fit. Each reset starts a
fresh fit. Historical estimates are not silently substituted for a new window.

When no dollar estimate is possible, measured quota and cost remain available.
The dashboard explains whether logs, quota movement, prices, or a more stable
fit are missing. Missing prices are not treated as free usage: affected intervals
are excluded from estimation. Local logs cannot account for usage on other
devices or provide a complete account-wide bill.

The dashboard also shows reset timing, observed cost, confidence, and an
independent five-hour estimate when that quota window is recorded. Peak and
average comparisons require at least two stable epochs, each spanning twelve
hours and twenty quota points.

## Options

| Option | Behavior |
| --- | --- |
| `--home <path>` | Use a specific Codex home; defaults to `CODEX_HOME` or `~/.codex`. |
| `--days <n>` | Include usage and quota observations from the last `n` days. |
| `--all` | Scan all available history. |
| `--json` | Print the report, diagnostics, pricing sources, and model series. |
| `--redact` | Hide the Codex home path in output. |
| `--refresh-prices` | Make an optional request to models.dev for unknown models. |
| `--help`, `--version` | Show help or the installed version. |

Estimate mode defaults to 30 days. Usage and JSON modes default to all history.
The scanner visits `sessions/` and `archived_sessions/`, skips files older than
the requested range, and reads earlier counters in included files to establish
correct deltas before filtering event timestamps.

Bundled pricing works offline. Optional price refresh cannot replace bundled
cards or their dated snapshots. Unrecognized model variants remain unpriced.
Use `--redact` before sharing JSON, which otherwise includes the local home path.

## Keyboard controls

| View | Controls |
| --- | --- |
| Estimate | Left/right: graph; up/down: range; `r`: rescan. |
| Usage | Up/down: model; left/right: metric; `-`/`+`: range; `r`: rescan. |
| Error or insufficient data | `r`: retry the scan. |
| Any view | `q` or Escape: quit; Ctrl-C: exit immediately. |

The optional exit reminder offers `s` to open the repository and `n` to hide the
reminder permanently. Idle screens do not run animation timers.

## Implementation

TypeScript and Node.js built-ins handle streaming JSONL parsing, bundled rate
cards, prefix-sum cost windows, quota reset detection, and robust pooled fitting.
The interactive dashboard runs estimation in a worker; text and JSON use the
same estimator. The scanner prices and collects records one file at a time,
skips conversation payloads, and reuses cost indexes for weekly and five-hour
fits. Malformed accounting records and unreadable files appear in JSON diagnostics.

```
src/bin/    CLI, terminal renderer, dashboard, worker
src/lib/    Parsing, pricing, estimation, charts, configuration
test/       Synthetic regression tests
scripts/    Published-package smoke test and size budget
```

## Development

```bash
npm ci
npm run dev
npm test
npm run check
npm run build
npm run check:size
npm run check:package
```

Published bundles have no runtime dependencies and must stay below 22 KB packed
and 60 KB unpacked. CI verifies tests, types, the build, installed-package
behavior, size budgets, and dependency auditing. Matching version tags publish
through npm trusted publishing.

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) ·
[Privacy](PRIVACY.md) · [Security](SECURITY.md) · [MIT License](LICENSE)
