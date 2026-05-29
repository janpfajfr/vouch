# Security Policy

`vouch` is a dependency-security tool, so we take vulnerabilities in `vouch` itself
seriously. This policy covers the `@vouchjs/vouch` package and this repository.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/janpfajfr/vouch/security/advisories/new)
(Security → Advisories → Report a vulnerability).

Please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal repo or command sequence is ideal),
- the `vouch` version (`vouch --version`) and your Node.js version.

We aim to acknowledge a report within **5 business days** and to ship a fix or a
mitigation plan for confirmed issues as quickly as is practical for a single-maintainer
project. We'll credit reporters who want it.

## Scope

In scope:

- the CLI and library in this repository,
- the published `@vouchjs/vouch` npm package.

Out of scope (by design — see [`THREAT_MODEL.md`](THREAT_MODEL.md)):

- `vouch` does not *scan* dependencies for vulnerabilities; per-package malware/typosquatting
  detection is explicitly not a goal.
- `vouch` records decisions; it does not authorize them. The authorization is the PR/MR review
  on your platform. A forged `addedBy` (it comes from `git config`, which is self-asserted) is
  a documented limitation, not a vulnerability.

## Supported versions

During `0.x`, only the latest published version receives security fixes.
