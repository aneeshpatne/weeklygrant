# weeklygrant

```
weeklygrant/
├─ src/
│  ├─ bin/
│  │  ├─ cli.ts
│  │  ├─ estimate-worker.ts
│  │  └─ tui.tsx
│  └─ lib/
│     └─ codex-grant.ts
├─ test/
│  └─ codex-grant.test.ts
├─ tsconfig.json
├─ package.json
└─ README.md
```

## Run

```bash
weeklygrant                         # estimate from ~/.codex
weeklygrant --json                  # full machine-readable report
weeklygrant --home /path/to/.codex  # scan another Codex home
weeklygrant --days 30               # limit files by modification time
weeklygrant --no-network            # use bundled prices; make no requests
weeklygrant --json --redact         # hide the local Codex home path
weeklygrant version
```

The headline is a local planning estimate: token deltas from Codex session JSONL
files are priced at public API-equivalent rates and paired with changes in the
reported weekly quota percentage. It is not a Codex bill or credit balance.

In an interactive terminal, the default command opens an Ink dashboard with an
animated loading state and grant, quota, and observed-cost graphs. Use `←`/`→`
to change graphs, `↑`/`↓` to change the time range, and `q` or Escape to quit.
Piped output stays plain text; `--json` is always machine-readable.

## Privacy and network access

Session files are read locally and their contents are not uploaded. By default,
weeklygrant makes a GET request to `https://models.dev/api.json` to refresh public
model prices; no session contents or token data are included in that request. Use
`--no-network` to use only bundled pricing. The project has no telemetry,
analytics, advertising, or user accounts and does not create a usage database.

JSON output includes the resolved Codex home path. Use `--redact` before sharing
output if that path is sensitive. See [PRIVACY.md](PRIVACY.md) for the complete
data-handling statement and [SECURITY.md](SECURITY.md) for security reporting.

## Disclaimer and non-affiliation

weeklygrant is an independent, unofficial project. It is not affiliated with,
endorsed by, sponsored by, or associated with OpenAI, Codex, models.dev, or any
other company or product mentioned in this repository. Names and trademarks
belong to their respective owners.

Estimates are local, API-equivalent planning values—not invoices, credit
balances, official grant values, financial advice, or representations of any
subscription's terms. Results may be incomplete or inaccurate because of price
changes, rounded or delayed quota data, unknown models, missing logs, and usage
on other clients or machines. Do not make purchasing or budgeting decisions from
this estimate alone.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development instructions and
[CHANGELOG.md](CHANGELOG.md) for release history.

Link the command locally with:

```bash
npm ci
npm run build
npm link
weeklygrant
```
