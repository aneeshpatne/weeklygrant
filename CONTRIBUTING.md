# Contributing

Contributions are welcome. By participating, you agree to keep fixtures and bug
reports free of real prompts, credentials, session logs, and personal data.

## Development

Requirements: Node.js 22 or newer and npm or Bun. The committed lockfile is
`package-lock.json`.

```bash
npm ci
npm test
npm run check
npm run build
npm run dev -- --home /path/to/synthetic/.codex
```

Add tests for estimator changes, especially pricing, reset detection, interval
pairing, and privacy-sensitive output. Use synthetic JSONL fixtures only. Keep
`--json` stable and non-interactive, and ensure the TUI remains usable in narrow
terminals. The interactive UI is `src/bin/term.ts` plus `src/bin/tui.ts` and must
stay free of runtime dependencies.

Before submitting a change, run tests, type checks, a build, and
`npm run check:size`.
Explain user-visible changes and update `CHANGELOG.md` when appropriate.
