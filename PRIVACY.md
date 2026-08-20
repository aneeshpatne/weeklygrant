# Privacy

Last updated: August 20, 2026.

weeklygrant is a local command-line tool. It reads Codex JSONL session files from
`CODEX_HOME`, `~/.codex`, or a path explicitly supplied with `--home`. It uses
token counts, model identifiers, service tiers, timestamps, and rate-limit
observations to calculate a local estimate.

## Data handling

- Session contents and calculated usage data remain on the machine running the
  command. weeklygrant does not upload them.
- The project contains no telemetry, analytics, advertising, tracking, user
  accounts, cookies, or unique identifiers.
- weeklygrant does not create its own usage database or retain a copy of session
  contents. npm/Bun and the operating system may maintain their normal package,
  DNS, or network caches independently of this project.
- If you press `n` on the optional GitHub star reminder, weeklygrant writes
  `hideStarNudge: true` to `~/.config/weeklygrant/config.json` (or
  `$XDG_CONFIG_HOME/weeklygrant/config.json`, or `$WEEKLYGRANT_CONFIG`). That
  file is not created until you opt out, and it stores only that preference.
- `--json` output contains calculated usage metadata and the resolved Codex home
  path. Use `--redact` to replace that path before storing or sharing the output.

## Network request

Unless `--no-network` is used, weeklygrant sends a GET request to
`https://models.dev/api.json` to retrieve public model pricing. The request does
not include session contents, token counts, quota observations, local paths, or
calculated results. As with any network request, the destination and intervening
infrastructure may observe ordinary connection metadata such as an IP address,
request time, and user agent. The destination's own privacy terms apply.

If the request fails or times out, weeklygrant uses its bundled rate cards. Use
`--no-network` to prevent the request entirely.

## Security

Codex session files may contain sensitive prompts or responses even though this
tool extracts only limited accounting fields. Protect the files with appropriate
filesystem permissions, do not run weeklygrant with elevated privileges, and
review JSON output before sharing it.

## Non-affiliation

weeklygrant is independent and unofficial. It is not affiliated with, endorsed
by, sponsored by, or associated with OpenAI, Codex, models.dev, or any other
company mentioned by the project. All names and trademarks belong to their
respective owners.

Material changes to this statement will update the date above and be recorded in
the changelog.
