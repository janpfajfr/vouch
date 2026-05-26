# Agent Dependency Rules

Agents MUST NOT run:

- `npm install <package>` / `npm install`
- `pnpm add <package>`
- `yarn add <package>`
- `bun add <package>`

Instead, agents MUST use:

    npx vouch <package>        # or, installed: vouch <package>
    npx vouch <package> -D     # dev dependency

Before adding a dependency, the agent MUST explain:

1. Why the dependency is needed.
2. Why existing dependencies cannot solve it.
3. Whether a Node.js / browser built-in can solve it.
4. Whether the package runs install-time scripts.
5. Whether the version is old enough.
6. What risk the dependency introduces.

If `vouch` blocks the package, the agent MUST NOT bypass it with
`--force-with-reason` to merely silence the gate. A `reason` is attribution, not
authorization: a high-risk dependency only passes CI once a human adds
`approvedBy` to its ledger entry. The agent should instead propose a safer
alternative.

If `check` reports that a dependency gained a CVE since approval, the agent MUST NOT
silently re-acknowledge it. Re-approval (`vouch reapprove <pkg> --approved-by "<name>"`)
records a human's name as authorization and is visible in the committed ledger. The agent
should surface the advisory to a human, not clear the gate on their behalf.
