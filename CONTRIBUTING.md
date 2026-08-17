# Contributing

Contributions are welcome. By participating, you agree to keep fixtures and bug
reports free of real prompts, credentials, session logs, and personal data.

## Development

Requirements: Node.js 22 or newer and npm or Bun.

```bash
bun install
npm test
npm run check
node bin/cli.js --home /path/to/synthetic/.codex --no-network
```

Add tests for estimator changes, especially pricing, reset detection, interval
pairing, and privacy-sensitive output. Use synthetic JSONL fixtures only. Keep
`--json` stable and non-interactive, and ensure the TUI remains usable in narrow
terminals.

Before submitting a change, run tests, syntax checks, and `npm pack --dry-run`.
Explain user-visible changes and update `CHANGELOG.md` when appropriate.
