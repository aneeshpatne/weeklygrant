# Security policy

## Supported versions

Security fixes are applied to the latest released version of weeklygrant.

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's GitHub
Security Advisory "Report a vulnerability" flow. Do not open a public issue for
an unpatched vulnerability and do not include real Codex session files, prompts,
credentials, access tokens, or other personal data in a report.

Include the affected version, operating system, Node.js version, reproduction
steps using synthetic data, and the security impact. You should receive an
initial response within seven days. A disclosure timeline will be coordinated
after the report is reproduced and assessed.

## Scope and safe use

weeklygrant requires read access to the selected Codex home. It should not be run
as root or with elevated privileges. Use `--no-network` when operating in a
restricted environment and `--redact` before sharing machine-readable reports.

Dependency vulnerabilities should include evidence that the vulnerable path is
reachable in weeklygrant, not only an automated scanner result.
