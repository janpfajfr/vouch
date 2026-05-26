# V2 Ideas for `you-shall-not-add`

A Gandalf-style dependency gate for Node.js projects and coding agents.

This document contains V2 product ideas for the project after the MVP is working.

The MVP focuses on:

- `safe-add <package>`
- pre-install dependency review
- npm package age checks
- install-script detection
- basic trust signals
- dependency blast-radius warnings
- agent-safe dependency rules
- CI checks to catch bypasses

V2 should build on that and make the tool more useful, more configurable, and more fun.

---

## V2 Theme

The V2 direction:

> Make Gandalf configurable, educational, and able to judge the current security posture of a project.

Main ideas:

- choose how strict Gandalf should be
- check how secure the current repo is
- suggest practical improvements
- check pinned dependencies
- measure agent-safety
- generate a fun Middle-earth-style certificate
- generate README badges
- keep a dependency decision audit log

---

# 1. Gandalf Strictness Levels

Allow projects to choose how strict Gandalf should be.

Example commands:

```bash
safe-add react --strictness grey
safe-add react --strictness white
safe-add react --strictness balrog
```

Alternative:

```bash
gandalf safe-add react --mode grey
gandalf safe-add react --mode white
gandalf safe-add react --mode balrog
```

Possible modes:

```txt
Hobbit Mode        = friendly warnings, fewer blocks
Gandalf the Grey   = balanced secure defaults
Gandalf the White  = stricter security rules
Balrog Mode        = block almost everything risky
```

Example config:

```json
{
  "strictness": "gandalf-the-grey"
}
```

Strictness could control:

- minimum package age
- whether install scripts are blocked or only warned
- whether dependencies must be pinned
- whether transitive dependencies are reviewed
- whether deprecated packages are blocked
- whether packages without provenance are blocked
- whether packages with many dependencies require approval
- whether agents can override decisions
- whether packages with missing repository/license are allowed
- whether package-manager version must be pinned
- whether CI security checks are required

---

## Suggested Strictness Mapping

### Hobbit Mode

Friendly mode for small projects or prototypes.

```txt
- warn on packages newer than 24h
- warn on install scripts
- warn on missing repository/license
- allow semver ranges
- allow overrides
- focus on education
```

### Gandalf the Grey

Balanced default mode.

```txt
- block packages newer than 24h
- block install scripts by default
- warn on packages newer than 7 days
- warn on missing repository/license
- warn on high dependency count
- warn on unpinned dependency ranges
- require reason for override
```

### Gandalf the White

Strict mode for production projects.

```txt
- block packages newer than 7 days
- block install scripts
- require exact pinned versions for dependencies
- require approval for packages with many dependencies
- block deprecated packages
- require dependency approval record for risky packages
- require AGENTS.md dependency rules
- require CI dependency checks
- require packageManager field in package.json
```

### Balrog Mode

Paranoid mode.

```txt
- no new dependencies without approval
- no install scripts
- no unpinned versions
- no packages with weak metadata
- no packages without repository/license
- no deprecated packages
- no packages with suspicious name similarity
- no packages without provenance when available
- no override without explicit approval file
- CI must block all bypasses
```

---

# 2. Project Security Posture Check

Add a command that checks how secure the current project is.

Possible commands:

```bash
safe-add doctor
gandalf doctor
gandalf audit
gandalf posture
```

Example output:

```txt
Security posture: 72/100

Good:
✓ pnpm lockfile exists
✓ minimumReleaseAge is enabled
✓ install scripts are disabled
✓ CI uses frozen lockfile

Needs attention:
⚠ Some dependencies are not pinned
⚠ 3 packages have install scripts
⚠ 5 dependencies were published less than 7 days ago
⚠ package manager version is not pinned
⚠ no dependency approval policy found
⚠ no AGENTS.md dependency rules found
```

The tool should check:

- `packageManager` is pinned in `package.json`
- lockfile exists
- dependencies are pinned
- `minimumReleaseAge` is configured
- `.npmrc` has `ignore-scripts=true`
- CI uses `--frozen-lockfile`
- CI uses `--ignore-scripts`
- `pnpm audit` or equivalent runs in CI
- dependency approval file exists
- `AGENTS.md` exists
- suspicious lifecycle scripts exist in dependency tree
- deprecated packages exist
- high-risk packages exist
- very new packages exist
- Renovate or Dependabot config exists
- package-publishing settings are safe, if the repo publishes a package
- npm provenance is configured, if relevant
- no `latest` or `*` dependency ranges are used
- no broad agent instruction like “install whatever package you need” exists

---

# 3. Actionable Security Recommendations

After the posture check, Gandalf should tell the user what to fix next.

The output should be practical, not only a score.

Example output:

```txt
Recommended next steps:

1. Add packageManager to package.json
   Why: prevents agents and CI from using a different package manager version.

2. Enable pnpm minimumReleaseAge
   Why: avoids installing freshly published malicious versions.

3. Disable install scripts by default
   Why: install scripts can execute arbitrary code during dependency installation.

4. Add AGENTS.md rules
   Why: prevents coding agents from bypassing safe-add.
```

Possible command:

```bash
gandalf doctor --fix
```

Potential auto-fixes:

- add `.npmrc`
- add `pnpm-workspace.yaml`
- add `.safe-dep.json`
- add `AGENTS.md`
- add `docs/dependency-policy.md`
- add GitHub Actions workflow
- add GitLab CI example
- add dependency approval file
- add README badges

Example auto-fix output:

```txt
Gandalf can fix 4 issues automatically:

✓ Add .npmrc with ignore-scripts=true
✓ Add pnpm-workspace.yaml with minimumReleaseAge
✓ Add AGENTS.md dependency rules
✓ Add GitHub Actions dependency-security workflow

Run:

gandalf doctor --fix
```

---

# 4. Middle-earth Security Certificate

Generate a funny certificate after the project passes checks.

Possible command:

```bash
gandalf certify
```

Example output:

```txt
The Council of Elrond has reviewed this repository.

Project: my-node-app
Security posture: 91/100
Strictness: Gandalf the White
Status: Approved for the road to Mordor

This repository has:
✓ minimumReleaseAge enabled
✓ install scripts blocked
✓ frozen lockfile in CI
✓ agent dependency rules
✓ dependency approval policy
✓ no freshly published packages

Certificate generated: security-certificate.md
```

Possible generated files:

```txt
security-certificate.md
security-certificate.html
security-certificate.svg
security-certificate.pdf
```

Visual style:

```txt
Old parchment
Middle-earth / fantasy style
Seal of the Council
Fantasy border
Fake wax seal
“Thou shall not install unknown packages”
```

Example certificate title:

```md
# Certificate of Dependency Stewardship

Issued by the Council of Elrond to:

**my-node-app**

For demonstrating vigilance against malicious packages, reckless agents, and the shadow of the npm registry.
```

Example certificate body:

```md
## Certificate of Dependency Stewardship

By the authority of the Council of Elrond, this repository is hereby recognized for maintaining a guarded path through the wild lands of the npm registry.

Project: **my-node-app**

Strictness: **Gandalf the White**

Security posture: **91/100**

This repository has demonstrated:

- delay against freshly published packages
- blocked install-time scripts
- frozen lockfile checks in CI
- dependency approval records
- agent dependency rules
- no reckless `pnpm add` without review

Let it be known:

> One does not simply install unknown packages.

Issued on: 2026-05-24
```

---

# 5. Badges

Generate README badges.

Example Markdown:

```md
![Gandalf Mode](https://img.shields.io/badge/Gandalf-White-brightgreen)
![Dependency Gate](https://img.shields.io/badge/safe--add-enabled-brightgreen)
![Install Scripts](https://img.shields.io/badge/install--scripts-blocked-brightgreen)
![Agent Safe](https://img.shields.io/badge/agent--safe-yes-brightgreen)
```

Possible badges:

```txt
Gandalf: Hobbit / Grey / White / Balrog
safe-add: enabled
minimumReleaseAge: enabled
install scripts: blocked
agent-safe: yes
security posture: 91/100
dependency gate: active
lockfile: frozen
```

Possible command:

```bash
gandalf badges
```

Example output:

```txt
Add this to your README:

![Gandalf Mode](...)
![Dependency Gate](...)
![Install Scripts](...)
![Agent Safe](...)
```

---

# 6. Pinned Dependencies Check

Add a check for dependency pinning.

Possible command:

```bash
gandalf check pinned
```

Check for risky ranges:

```json
{
  "dependencies": {
    "some-package": "^1.2.3",
    "another-package": "~2.0.0",
    "risky-package": "latest",
    "very-risky-package": "*"
  }
}
```

Possible rules:

```txt
WARN on ^ ranges
WARN on ~ ranges
BLOCK latest
BLOCK *
ALLOW exact versions
```

Strictness-based behavior:

```txt
Hobbit Mode:
- warn on latest
- allow semver ranges

Gandalf the Grey:
- block latest
- warn on semver ranges

Gandalf the White:
- block latest
- warn strongly on semver ranges
- prefer exact versions

Balrog Mode:
- require exact versions everywhere
```

Example output:

```txt
Pinned dependency check:

BLOCK:
- risky-package uses "latest"
- very-risky-package uses "*"

WARN:
- some-package uses "^1.2.3"
- another-package uses "~2.0.0"

Recommended:
Use exact versions for production dependencies.
```

---

# 7. Agent Behavior Score

Since this project is agent-focused, add a score for how safe the repo is for coding agents.

Possible command:

```bash
gandalf agent-check
```

Checks:

- `AGENTS.md` exists
- direct `pnpm add` is forbidden in instructions
- direct `npm install` is forbidden in instructions
- direct `yarn add` is forbidden in instructions
- direct `bun add` is forbidden in instructions
- `safe-add` is documented
- dependency policy exists
- CI catches bypasses
- install scripts are disabled
- package manager is pinned
- lockfile is required
- override policy exists
- no broad instruction like “install any library you need” exists
- dependency changes require explanation
- risky package override requires human approval

Example output:

```txt
Agent safety score: 83/100

Good:
✓ AGENTS.md exists
✓ Agents are instructed to use safe-add
✓ CI checks dependency changes
✓ packageManager is pinned

Needs attention:
⚠ No explicit rule forbidding npm install
⚠ No override policy for blocked packages
⚠ No dependency approval file found
```

Example recommendations:

```txt
Recommended AGENTS.md addition:

Agents must not run npm install, pnpm add, yarn add, or bun add directly.
Use safe-add <package> and explain why the dependency is needed.
```

---

# 8. Gandalf Explain Mode

Make the tool educational.

Possible commands:

```bash
gandalf explain install-scripts
gandalf explain minimum-release-age
gandalf explain pinned-dependencies
gandalf explain lockfile
gandalf explain typosquatting
gandalf explain dependency-confusion
gandalf explain provenance
```

Example:

```txt
Install scripts are risky because npm packages can execute code during installation.
A malicious postinstall script can read environment variables, tokens, SSH keys, and CI secrets.
```

Example:

```txt
minimumReleaseAge delays installation of newly published package versions.
This gives the ecosystem time to detect and remove malicious releases before they enter your project.
```

Example:

```txt
Pinned dependencies reduce surprise upgrades.
A dependency range like ^1.2.3 allows newer compatible versions, but a compromised maintainer could publish a malicious 1.2.4 that your install picks up later.
```

This is good for developers who are in a hurry or do not fully know the risk.

---

# 9. Dependency Journey / Audit Log

Track dependency decisions over time.

Possible file:

```txt
.security/gandalf-log.json
```

Example:

```json
[
  {
    "package": "date-fns",
    "version": "4.1.0",
    "decision": "allowed",
    "risk": "low",
    "addedAt": "2026-05-24T16:00:00Z",
    "reason": "Needed for date formatting"
  },
  {
    "package": "cool-random-parser",
    "version": "1.0.3",
    "decision": "blocked",
    "risk": "high",
    "reason": "Version too new and has postinstall script"
  }
]
```

Benefits:

- CI can verify that dependency changes went through `safe-add`
- reviewers can see why a dependency was added
- risky overrides are documented
- agent behavior is traceable
- security decisions are auditable

Possible command:

```bash
gandalf log
```

Example output:

```txt
Dependency decision log:

2026-05-24 date-fns@4.1.0
Decision: allowed
Risk: low
Reason: Needed for date formatting

2026-05-24 cool-random-parser@1.0.3
Decision: blocked
Risk: high
Reason: Version too new and has postinstall script
```

---

# 10. Fun Naming for Commands

Possible command names:

```bash
gandalf guard
gandalf doctor
gandalf audit
gandalf posture
gandalf certify
gandalf explain
gandalf inspect react
gandalf safe-add react
gandalf you-shall-not-add react
```

Possible strictness names:

```txt
hobbit
gandalf-grey
gandalf-white
balrog
mordor
council-of-elrond
```

Suggested serious mapping:

```txt
friendly    → Hobbit Mode
balanced    → Gandalf the Grey
strict      → Gandalf the White
paranoid    → Balrog Mode
```

---

# 11. Possible CLI Design

Top-level commands:

```bash
gandalf safe-add <package>
gandalf inspect <package>
gandalf doctor
gandalf doctor --fix
gandalf check pinned
gandalf agent-check
gandalf explain <topic>
gandalf certify
gandalf badges
gandalf log
```

Alias:

```bash
safe-add <package>
you-shall-not-add <package>
```

Example package scripts:

```json
{
  "scripts": {
    "safe-add": "gandalf safe-add",
    "deps:doctor": "gandalf doctor",
    "deps:agent-check": "gandalf agent-check",
    "deps:certify": "gandalf certify"
  }
}
```

---

# 12. Suggested V2 Config

Possible `.safe-dep.json`:

```json
{
  "strictness": "gandalf-the-grey",
  "minimumVersionAgeHours": 24,
  "warnVersionAgeHours": 168,
  "blockInstallScripts": true,
  "requirePinnedDependencies": false,
  "blockLatestVersionRange": true,
  "blockStarVersionRange": true,
  "maxDirectDependenciesBeforeWarn": 20,
  "maxDirectDependenciesBeforeBlock": 100,
  "requireAgentRules": true,
  "requireCiChecks": true,
  "allowScopedPackages": ["@your-org/*"],
  "certificate": {
    "enabled": true,
    "format": ["md", "svg"]
  },
  "knownAlternatives": {
    "uuid": "Use crypto.randomUUID() if possible",
    "left-pad": "Use String.prototype.padStart()",
    "node-fetch": "Use built-in fetch in Node 18+",
    "moment": "Prefer date-fns or Intl APIs"
  }
}
```

---

# 13. Research Questions for the Agent

Research and propose the best implementation strategy for the following V2 items.

## Gandalf Strictness

Questions:

```txt
What strictness levels should exist?
Which checks should be controlled by strictness?
Should strictness affect only warnings/blocks or also generated config?
How should strictness work in CI?
Should project-level strictness be overrideable per command?
```

Expected output:

```txt
Recommended strictness model
Default strictness level
Config structure
CLI flags
CI behavior
```

---

## Security Posture Check

Questions:

```txt
What should gandalf doctor check?
Which checks can be implemented without network calls?
Which checks require npm registry data?
Which checks require GitHub/GitLab metadata?
How should the score be calculated?
How can the score avoid being misleading?
```

Expected output:

```txt
List of posture checks
Scoring model
Example output
Auto-fix candidates
False-positive concerns
```

---

## Pinned Dependencies

Questions:

```txt
Should exact dependency versions be required?
Should exact versions be required only in production dependencies?
How does this interact with pnpm-lock.yaml?
Are semver ranges acceptable if frozen lockfile is used?
Should "latest" and "*" always be blocked?
```

Expected output:

```txt
Recommended policy for dependency pinning
Strictness-based behavior
CI rule proposal
README explanation
```

---

## Agent-Safety Score

Questions:

```txt
What should be checked in AGENTS.md?
How can we detect unsafe agent instructions?
How can CI detect that agent bypassed safe-add?
Should safe-add write an audit file?
How should overrides be represented?
```

Expected output:

```txt
Agent-safety scoring model
Recommended AGENTS.md rules
Audit log format
CI bypass detection strategy
```

---

## Certificate Generation

Questions:

```txt
Should the certificate be markdown, HTML, SVG, or PDF?
Can we generate a nice old parchment-style SVG without external dependencies?
Should the certificate include score, strictness, timestamp, and passed checks?
Should it be committed to the repo or generated in CI?
```

Expected output:

```txt
Recommended certificate formats
Example certificate content
Example visual style
Implementation approach
```

---

## Badges

Questions:

```txt
Should badges be static shields.io URLs?
Should Gandalf generate local SVG badges?
Should badges reflect current posture score?
Can CI update badges automatically?
```

Expected output:

```txt
Recommended badge strategy
Example badges
How to generate them
How to keep them up to date
```

---

# 14. V2 Success Criteria

V2 is successful if:

```txt
Projects can choose their Gandalf strictness level
Developers can run one command to see how secure the repo is
The tool gives practical next steps, not only warnings
Dependency pinning is checked
Agent-safety is measured
CI can catch bypasses
A Middle-earth certificate can be generated
README badges can show the project’s dependency safety status
The output remains fun but still useful
```

---

# 15. Recommended Priority for V2

Suggested implementation order:

```txt
1. gandalf doctor
2. strictness levels
3. pinned dependency check
4. agent-check
5. audit log
6. doctor --fix
7. badges
8. certificate
9. explain mode
```

Reasoning:

- `doctor` makes the tool useful even without adding a dependency.
- strictness levels make it adaptable to different teams.
- pinned dependency check is security-relevant and easy to implement.
- agent-check reinforces the project’s main differentiator.
- audit log helps CI detect bypasses.
- badges and certificate are fun, but should come after the core security value.
- explain mode improves education and adoption.

---

# 16. README V2 Preview Section

Suggested README section:

```md
## V2 Preview

Future versions will add:

- Gandalf strictness levels:
  - Hobbit Mode
  - Gandalf the Grey
  - Gandalf the White
  - Balrog Mode

- `gandalf doctor`
  - checks how secure your project is
  - gives a security posture score
  - recommends what to fix next

- `gandalf agent-check`
  - checks whether your repo is safe for coding agents
  - validates `AGENTS.md`
  - warns if agents can bypass dependency rules

- `gandalf check pinned`
  - detects `latest`, `*`, `^`, and `~` dependency ranges
  - recommends safer dependency pinning

- `gandalf certify`
  - generates a Middle-earth-style security certificate

- README badges
  - Gandalf mode
  - dependency gate status
  - install-script policy
  - agent-safety status
```

---

# 17. Tagline Ideas

Possible taglines:

```txt
A tiny Gandalf for your dependency graph.
One does not simply add unknown packages.
A dependency gate for humans and coding agents.
Keeping Balrogs out of your lockfile.
A pre-install bouncer for npm packages.
For when your coding agent tries to summon a Balrog from npm.
```

Favorite:

```txt
A tiny Gandalf for your dependency graph.
```

Alternative:

```txt
Keeping Balrogs out of your lockfile.
```
