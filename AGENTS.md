# Agent Dependency Rules

Agents MUST NOT run:

- `npm install <package>` / `npm install`
- `pnpm add <package>`
- `yarn add <package>`
- `bun add <package>`

Instead, agents MUST use:

    npx @vouchjs/vouch <package>        # or, installed: vouch <package>
    npx @vouchjs/vouch <package> -D     # dev dependency

Before adding a dependency, the agent MUST explain:

1. Why the dependency is needed.
2. Why existing dependencies cannot solve it.
3. Whether a Node.js / browser built-in can solve it.
4. Whether the package runs install-time scripts.
5. Whether the version is old enough.
6. What risk the dependency introduces.

If `vouch` blocks the package, the agent MUST NOT bypass it with
`--force-with-reason` to merely silence the gate. The agent should instead propose a safer
alternative.

`vouch` records a decision; it does not grant approval. An agent records a dependency with
`vouch <pkg>` (explaining *why* first) — the recorded `addedBy` is attribution, not
authorization. The actual approval is the human's PR/MR review, with the ledger entry visible
in the diff. An agent MUST NOT mark a risky dependency as acceptable on a human's behalf; its
job is to surface the decision, not to make it.

If `check` reports that a dependency gained a CVE since it was recorded, the agent MUST NOT
silently accept it with `vouch acknowledge`. Surface it to a human, who fixes it, removes it,
or — judging the risk acceptable — runs `vouch acknowledge <pkg> --reason "<why>"`, which is
visible in the committed ledger and the PR diff.
