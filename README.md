# weeklygrant

```
weeklygrant/
├─ bin/
│  └─ cli.js
├─ package.json
└─ README.md
```

## Run

```bash
node bin/cli.js                         # estimate from ~/.codex
node bin/cli.js --json                  # full machine-readable report
node bin/cli.js --home /path/to/.codex  # scan another Codex home
node bin/cli.js --days 30               # limit files by modification time
node bin/cli.js version
```

The headline is a local planning estimate: token deltas from Codex session JSONL
files are priced at public API-equivalent rates and paired with changes in the
reported weekly quota percentage. It is not a Codex bill or credit balance.

Link the command locally with:

```bash
npm link
weeklygrant
```
