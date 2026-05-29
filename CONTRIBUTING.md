# Contributing to vouch

Thanks for your interest in improving `vouch`. This is a small, deliberately
**zero-runtime-dependency** project — contributions are welcome, with that constraint in mind.

## Ground rules

- **No runtime dependencies.** `vouch` ships with `"dependencies": {}` and is built on Node.js
  built-ins. A PR that adds a runtime dependency will not be merged unless it is exceptional
  and discussed first in an issue. Dev dependencies (TypeScript, `@types/node`) are fine.
- **Discuss large changes first.** Open an issue before a substantial feature or refactor so we
  agree on direction before you invest time.
- **Keep the tool honest.** `vouch` *records* decisions; it does not *authorize* them. Features
  must not blur that line (see [`THREAT_MODEL.md`](THREAT_MODEL.md)).

## Development

Requirements: **Node.js 21+** for local development (the test script uses Node's built-in
glob). The published package supports Node 18+ at runtime.

```bash
npm ci          # install dev dependencies
npm run build   # compile TypeScript to dist/
npm test        # type-check + run the test suite (node:test)
```

## Pull requests

- Add or update tests for any behavior change — the suite uses `node:test` with dependency
  injection, so most logic is testable without network access.
- Run `npm test` and make sure it's green before opening the PR.
- Keep commits focused; match the existing style (the codebase favors small, pure functions
  and explicit types).
- Update the README and `THREAT_MODEL.md` when you change user-facing behavior.

## Reporting bugs

Open an issue with a minimal reproduction, the `vouch --version` output, and your Node.js
version. For **security** issues, follow [`SECURITY.md`](SECURITY.md) instead of opening a
public issue.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
