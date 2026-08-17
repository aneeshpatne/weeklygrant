# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

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
