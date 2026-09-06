<div align="center">

# weeklygrant

**Turn local Codex session history into an API-equivalent weekly grant estimate.**

A TypeScript/Node.js CLI that reads Codex JSONL logs, prices usage, and shows weekly value, quota context, confidence, graphs, and per-model usage.

[![npm version](https://img.shields.io/npm/v/weeklygrant)](https://www.npmjs.com/package/weeklygrant)
[![total downloads](https://img.shields.io/npm/dt/weeklygrant.svg)](https://www.npmjs.com/package/weeklygrant)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/aneeshpatne/weeklygrant/ci.yml?branch=main)](https://github.com/aneeshpatne/weeklygrant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/aneeshpatne/weeklygrant)](LICENSE)

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Privacy](PRIVACY.md)

</div>

---

## Overview

Codex session logs contain token counters and quota observations, but not the API-equivalent value of the weekly grant. weeklygrant turns those records into a planning estimate: a weekly headline, confidence, quota usage, reset timing, observed spend, and a five-hour window when available.

It is local-first: no account, server, database, telemetry, or default network request. The TypeScript implementation uses Node.js built-ins for the TUI, a worker thread for interactive estimation, a streaming JSONL scanner, bundled official rate cards, and optional pricing refresh for unknown models. Output can be an interactive dashboard, compact text, or JSON.

## Demo

~~~bash
npx weeklygrant
npx weeklygrant usage       # per-model dashboard
npx weeklygrant --json      # machine-readable report
~~~

## Why this project

The useful signal is fragmented across local files: cumulative token totals, model context, service tier, and quota observations across reset windows. weeklygrant accounts for counter resets, long-context pricing, quota epochs, unknown models, rounded quota movement, and unrelated quota streams in one inspectable planning view—not a Codex bill, credit balance, or subscription term.

## Engineering outcomes

| Outcome | Result |
| --- | --- |
| **Significant dependency removal** | Replaced Ink/React with a Node-builtin renderer: runtime dependencies went from **2 to 0** and lockfile package entries from **92 to 52** (**43.5% fewer**), while retaining the TUI. |
| **Significant speed-up for large histories** | Replaced repeated scans with prefix-sum cost lanes and binary-search lookups. JSONL uses **1 MiB** chunks and **256-byte** type peeking; pricing overlaps discovery and usage series are conditional. No latency benchmark is published. |
| **Significant correctness improvement across versions** | v1.2.0 added pooled fitting and reset-aware series; v1.2.1 skipped irrelevant payloads; v1.2.2 added counter-reset recovery, request-level long-context pricing, quota-stream isolation, low-usage reset detection, and divergent-slice rejection; v1.2.3 added five-hour estimation and diagnostics. |
| **Small published artifact** | v1.2.5 is **20.6 KB packed / 53.6 KB unpacked**, below enforced **22 KB / 60 KB** budgets. |
| **Verified behavior** | **57 automated tests pass** across parsing, estimation, pricing, charts, CLI, TUI, five-hour estimation, grant history, and configuration. CI also type-checks, bundles, smoke-tests, size-checks, and audits. |

## Features

| Area | What the project provides |
| --- | --- |
| **Weekly estimate** | Prices token deltas, matches cost to weekly quota movement, and reports an API-equivalent weekly value with confidence, plus how far the current week sits from the scanned peak and average. |
| **Quota-aware modeling** | Detects weekly and five-hour windows, splits resets and plan changes into epochs, ignores small downward jitter, and isolates quota IDs. |
| **Correct token accounting** | Handles cumulative counters, reset recovery, cached and uncached input, billed/reasoning output, long-context tiers, and fast-service multipliers. |
| **Interactive dashboards** | Graphs grant value, quota used, and observed cost over 24h, 7d, 30d, or all history; usage drills into token and API-value series by model. |
| **Machine-readable output** | <code>--json</code> includes estimate, pricing sources, diagnostics, scan counts, measurement data, series, model usage, and Codex home. <code>--redact</code> hides the local path. |
| **Deterministic pricing** | Bundled official pricing covers **17 model cards** and works offline. <code>--refresh-prices</code> makes one bounded <code>models.dev</code> request only to fill unknown models. |

> [!NOTE]
> The interactive headline stays hidden until the signal reaches medium or high confidence. With enough history to graph, the dashboard still shows measured quota and cost series and explains what is missing.

## From logs to result

~~~mermaid
flowchart LR
  A[Local Codex home] --> B[Find JSONL sessions]
  B --> C[mtime filter and stream]
  C --> D[Token deltas and quota]
  R[Bundled rate cards] --> E[Price tokens]
  O[Optional models.dev] -. unknown models .-> E
  D --> E
  E --> F[Split epochs and pair cost with quota]
  F --> G[Reject outliers and pool inliers]
  G --> H[Estimate report]
  H --> I{Output}
  I --> J[TUI]
  I --> K[Text]
  I --> L[JSON]
~~~

The scanner visits <code>sessions/</code> and <code>archived_sessions/</code>; invalid lines become diagnostics and unknown models stay pending. The interactive estimate defaults to 30 days; usage and JSON modes use all history unless <code>--days</code> is supplied.

## Architecture

~~~mermaid
flowchart LR
  subgraph Output
    TUI[Terminal dashboard]
    TXT[Text output]
    JSON[JSON output]
  end
  subgraph App[Application]
    CLI[CLI and argument parser]
    WORKER[Worker thread]
  end
  subgraph Core
    SCAN[JSONL scanner]
    PRICE[Pricing]
    FIT[Quota-aware estimator]
  end
  LOGS[Local Codex sessions]
  CARDS[Bundled official cards]
  OPTIONAL[models.dev]

  CLI -->|TTY| TUI
  CLI -->|non-TTY| TXT
  CLI -->|--json| JSON
  TUI --> WORKER
  WORKER --> FIT
  TXT --> FIT
  JSON --> FIT
  FIT --> SCAN
  FIT --> PRICE
  SCAN --> LOGS
  PRICE --> CARDS
  PRICE -. optional .-> OPTIONAL
~~~

The CLI validates options and selects a renderer from TTY state and flags. The TUI is worker-backed; text and JSON share the estimator. There is no server or project-owned usage database.

## Engineering decisions

| Decision | Reason | Trade-off |
| --- | --- | --- |
| **Node-built-in TUI** | Removes Ink and React without removing the dashboard. | Terminal layout, input, styling, and charts live in project code. |
| **Streaming JSONL with type peeking** | Large conversation payloads are irrelevant to accounting. | Buffering and line-state logic is more complex than a simple parse loop. |
| **Prefix-sum cost lanes** | Window totals use binary searches instead of rescanning every event. | Preprocessing retains timestamp and prefix arrays. |

## Tech stack

[TypeScript](https://www.typescriptlang.org/) on [Node.js](https://nodejs.org/) 22+, with Node.js-built-in UI, [esbuild](https://esbuild.github.io/), [tsx](https://tsx.is/), npm, and [GitHub Actions](https://github.com/features/actions).

## Project structure

~~~text
├── src/
│   ├── bin/                  # CLI, worker, terminal primitives, and TUI
│   └── lib/                  # parsing, charts, estimator, formatting, config
├── test/                     # parser, estimator, UI, and configuration tests
├── scripts/                  # package-size and artifact checks
├── .github/workflows/        # CI and release workflows
├── package.json              # metadata and commands
└── CONTRIBUTING.md           # contribution guidelines
~~~

## Requirements

- Node.js 22 or newer.
- npm for the committed lockfile; Bun is also supported for local development.
- Local Codex JSONL files under <code>CODEX_HOME</code> or <code>~/.codex</code>, or a path supplied with <code>--home</code>. Bundled pricing needs no network; <code>--refresh-prices</code> optionally accesses <code>https://models.dev/api.json</code>.

## Getting started

~~~bash
# Published package
npx weeklygrant

# From source
git clone https://github.com/aneeshpatne/weeklygrant.git
cd weeklygrant
npm ci
npm run dev

# Alternate or synthetic home
npm run dev -- --home /path/to/.codex
~~~

> [!IMPORTANT]
> <code>--refresh-prices</code> is the only mode that makes a network request. It fills unknown models but never replaces bundled official cards. Use <code>--redact</code> before sharing JSON output because the report includes the resolved Codex home path.

## Running tests

~~~bash
npm test
npm run check
npm run build
npm run check:size
npm run check:package
~~~

<code>npm test</code> covers parsing, reset recovery, pricing, quota fitting, charts, CLI validation, TUI rendering, five-hour estimates, and configuration. <code>npm run check:package</code> smoke-tests the package.

## Deployment

weeklygrant is distributed on npm as bundled <code>dist</code> output. A matching <code>v*</code> tag runs tests, type checks, builds, size validation, and version checks before publishing through npm trusted publishing and GitHub OIDC; no <code>NPM_TOKEN</code> is used.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks, synthetic fixtures, estimator tests, stable JSON, and terminal-width guidance. Keep personal data out of fixtures; security issues should follow [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).

---

<div align="center">
  TypeScript, Node.js, and inspectable local JSONL.
</div>
