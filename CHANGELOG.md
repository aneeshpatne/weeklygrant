# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

## 1.2.4

- Added bundled official pricing for `gpt-6-astra` (short-context $10 / $50, long-context $20 / $75, Fast 2x).
- Raised the packed npm size budget from 20 KB to 22 KB after the README grew.

## 1.2.3

- Added independent detection and estimation for the Codex five-hour quota window. Reports now include the maximum five-hour API-equivalent spend and its percentage of the estimated weekly grant (for example, 100% of the five-hour window can be shown as 16% of weekly capacity).
- Added strict CLI argument validation for unknown flags, missing values, duplicate options, and conflicting `--days`/`--all` usage.
- Added scan diagnostics for malformed JSONL records and unreadable session files without changing the normal quiet output.
- Made the persisted star-nudge configuration atomic and owner-readable only.
- Added packaged-artifact smoke testing to CI, covering installation, version/help output, JSON redaction, and an empty Codex home.

## 1.2.2

- Grant estimator v2 recovers token-counter resets, uses request-level long-context pricing, isolates quota streams, detects low-usage weekly resets, and robustly rejects divergent slices.
- Bundled official pricing is now the deterministic default; `--refresh-prices` opt-in only fills unknown models, and estimates scan 30 days unless `--all` or `--days` is supplied.
- Published JavaScript is minified and tree-shaken with a package-size budget while retaining zero runtime dependencies.
- Thank-you screen shows a static THANK YOU ASCII banner and stops timers while the dashboard is idle.

## 1.2.1

- Session JSONL scan peeks each line's event type and skips conversation payloads instead of `JSON.parse`-ing them, so large `response_item` / `item_completed` lines no longer dominate startup.

## 1.2.0

- npm Trusted Publishing via `.github/workflows/release.yml` (OIDC, no `NPM_TOKEN`); provenance is generated automatically on tagged releases.
- Headline estimate is now the pooled API-cost / matched-quota ratio instead of a median of small slices, so early-week noise and post-reset dips no longer dominate.
- Grant graph X-axis is wall-clock time, and lines break at weekly quota resets instead of connecting the previous week to the first new-week sample.
- Grant, quota, and cost graphs fill each weekly reset gap with a dense magenta dotted band.
- Star-nudge quit screen has an animated dotted star, a thank-you, and a boxed repo link.

## 1.1.0

- Zero runtime dependencies: the Ink/React TUI is now a small Node-builtin renderer.
- npm package no longer ships TypeScript declaration files, source maps, or extra markdown docs.
- `weeklygrant version` reads `package.json` from the package root, so published installs print the version.
- Low-confidence TUI still graphs measured history when two or more points exist; the headline estimate stays a dash until medium or high confidence.
- Estimation is linear in log events: prefix-sum cost windows, a single file mtime, overlapped pricing fetch, and usage-series built only for `usage`/`--json`.

## 1.0.7

- TUI quit (q / Esc / Ctrl+C) can show a GitHub star reminder, with n to hide it next time.

## 1.0.6

- npm publishes from GitHub Actions with provenance (signed build, source commit, and transparency log).

## 1.0.5

- README rewritten as a product landing page, architecture overview, and contributor guide.

## 1.0.4

- Usage TUI time range is now `-`/`+` instead of `[`/`]`.

## 1.0.3

- Interactive `weeklygrant usage` dashboard with per-model token and API-value graphs.
- Cumulative per-model usage series on the estimate report.
- Low- and no-confidence TUI estimates are now replaced by a warning splash
  screen with measurement guidance and an in-place rescan action.

## 1.0.2

- README badges and expanded usage docs.
- TUI headline label is now estimated weekly API value.
- New quota epochs no longer inherit the previous epoch's confidence or graph.
- `weeklygrant usage` summarizes token usage and API-equivalent value by model.

## 1.0.1

### Added

- Local Codex session scanning and weekly API-equivalent grant estimation.
- Ink TUI with responsive Braille graphs and an animated worker-thread loader.
- JSON, custom-home, file-age, offline pricing, and path-redaction options.
- Pricing-source and rate-card-mode reporting.
- Privacy, security, contribution, disclaimer, and non-affiliation documentation.
- Node.js 22 CI, syntax checking, tests, and package validation.
- TypeScript source, typed tests, declaration output, and an ESM build pipeline.
- npm repository metadata and `npx weeklygrant` as the no-install entry point.

## 1.0.0

- Initial CLI scaffold.
