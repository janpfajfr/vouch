# vouch — Foundation Simplification

## Goal

Step back and simplify `vouch` to its core purpose.

`vouch` should be small, soft, smart, and not complicated.

The core idea:

> `vouch` does not approve dependencies.  
> `vouch` records dependency decisions so PR/MR reviewers can approve them consciously.

That should be the foundation.

---

## What vouch should be

`vouch` is **not** an identity platform.

`vouch` is **not** a full security scanner.

`vouch` is **not** trying to prove that a human was at the keyboard.

`vouch` should be:

> A small CLI that makes dependency decisions visible, recorded, and reviewable.

The core promise:

> A dependency cannot enter the repo silently. Someone must explain why it was added, and risky changes must be visible in the PR/MR.

That is enough.

---

## Basic flow

### 1. Developer or agent adds a dependency

```bash
vouch esbuild
```

`vouch` checks:

```text
- Is this package already in the repo?
- Is there a built-in alternative?
- Is the version too new?
- Does it have install scripts?
- Does it have known advisories?
```

Then it writes a ledger entry.

Example:

```json
{
  "esbuild": {
    "approvedVersion": "0.28.0",
    "addedAt": "2026-05-27T10:00:00.000Z",
    "addedBy": "Jan Pfajfr <jan.pfajfr@example.com>",
    "risk": "high",
    "reason": "Needed for bundling in the demo project",
    "checks": {
      "ageHours": 1295,
      "installScripts": {
        "postinstall": "node install.js"
      }
    }
  }
}
```

Important:

> This is not final approval.  
> This is only a recorded dependency decision.

---

### 2. CI checks the ledger

```bash
vouch check
```

CI should answer only:

```text
Are all dependencies recorded?
Are risky dependencies clearly marked?
Has anything drifted since the decision?
```

If everything is okay:

```text
Dependency review: all dependencies are recorded.
```

If something is missing or risky:

```text
BLOCKED: esbuild — high-risk dependency needs review.
```

This is simple and understandable.

---

### 3. Final approval happens in GitHub or GitLab

This is the key simplification.

We should not try too hard to prove identity inside `vouch`.

The real approval already happens here:

```text
PR/MR review → approve → merge
```

So `vouch` should not pretend that a field inside JSON is strong proof.

Instead:

> The PR/MR approval is the approval.  
> The ledger is the evidence.

The reviewer sees something like this in the diff:

```diff
+ "esbuild": {
+   "risk": "high",
+   "reason": "Needed for bundling in the demo project",
+   "checks": {
+     "installScripts": {
+       "postinstall": "node install.js"
+     }
+   }
+ }
```

Then the human approves the PR/MR.

That is the cleanest model.

---

## What to cut or pause

### Cut or downgrade `approvedBy`

`approvedBy` creates confusion.

This:

```json
"approvedBy": "Jan"
```

is only a string.

An agent can write it. A script can write it. Anyone can write it.

It is not proof.

Better options:

```json
"addedBy": "Jan Pfajfr <jan.pfajfr@example.com>"
```

Meaning:

> Who ran the command or created the ledger entry.

Not:

> Who gave final approval.

Final approval belongs to the PR/MR review.

---

### Cut or pause `vouch approve`

For now, `vouch approve` probably makes the model more complicated.

It creates two approvals:

```text
vouch approve
GitHub/GitLab approve
```

Then we have to ask:

```text
Which one matters?
What if they disagree?
Can an agent run approve?
Should CI trust it?
```

That is too much for the foundation.

Better:

```text
vouch records
GitHub/GitLab approves
```

---

### Cut or postpone Phase 2 verification

GitHub review verification is interesting, but probably too much for the foundation.

It creates edge cases:

```text
CI runs before review
Review happens after CI
Agent can use gh CLI if it has credentials
GitLab behaves differently
allowedApprovers config adds complexity
```

This is probably v2.

For MVP:

```text
CI verifies the dependency ledger.
The platform verifies the human approval.
```

That is simpler and easier to explain.

---

## What to keep

Keep the parts that support the core promise:

```text
✅ dependency ledger
✅ vouch add flow
✅ check command
✅ version-age check
✅ install-script check
✅ alternatives
✅ CVE warning at install time
✅ CVE drift check
✅ CI test workflow
✅ README clarity
✅ AGENTS.md instructions
```

These are useful and aligned with the foundation.

---

## CVE drift, simplified

CVE drift is useful, but it should be framed softly.

Instead of:

```text
This dependency must have special approval state inside vouch.
```

Use:

```text
This dependency changed risk state since it was recorded.
Please review.
```

When a new CVE appears, CI can block with:

```text
BLOCKED: lodash@4.17.21 gained GHSA-xxxx since it was recorded.
Update it, remove it, or review this PR with the risk visible.
```

The human then fixes it, removes it, or approves the PR/MR knowingly.

Again:

> PR/MR approval is the approval.

---

## The three states

The foundation should have only three states.

### 1. Recorded

The dependency exists in the ledger.

```text
OK
```

---

### 2. Unrecorded

The dependency exists in `package.json` but not in the ledger.

```text
BLOCKED
```

Example message:

```text
lodash is in package.json but not in .security/dependency-approvals.json.
Use: vouch lodash
```

---

### 3. Needs review

The dependency is recorded, but something about it needs human attention.

Examples:

```text
esbuild has install scripts.
lodash gained a new advisory.
package was recorded at version 1.2.3 but package.json now uses 1.3.0.
```

This can be:

```text
BLOCKED
```

or, later, configurable as:

```text
WARN
```

But the concept should stay simple:

> Something changed or something risky is visible. Please review.

---

## Recommended wording

Avoid words that imply `vouch` itself proves final human approval.

Prefer:

```text
dependency ledger
recorded decision
addedBy
review required
risk changed
needs review
```

Avoid or downgrade:

```text
approval ledger
approvedBy
verified approver
approve command
authorization
```

This makes the tool easier to understand and more honest.

---

## Recommended command set

Keep the command set small.

Recommended foundation:

```bash
vouch <pkg>
vouch check
vouch --help
vouch --version
```

Optional later:

```bash
vouch refresh
```

Avoid for now:

```bash
vouch approve
vouch reapprove
```

If CVE acknowledgement is needed later, a better name might be:

```bash
vouch acknowledge <pkg>
```

But even that should be considered carefully.

---

## Proposed project definition

Use this as the clean foundation statement:

> `vouch` is a dependency decision ledger for Node.js projects.  
> It does not decide whether a dependency is safe.  
> It ensures every dependency addition is visible, explained, and reviewed in the pull request.

This is soft, smart, and not complicated.

---

## Practical cleanup recommendation

### Keep

```text
✅ ledger
✅ vouch add flow
✅ check command
✅ version age check
✅ install script check
✅ alternatives
✅ CVE warning at install time
✅ CVE drift check
✅ CI test workflow
✅ README clarity
✅ agent instructions
```

### Remove or pause

```text
❌ vouch approve
❌ approvedBy as required authorization
❌ GitHub review verification inside vouch
❌ allowedApprovers config
❌ complex approval identity model
```

### Replace with

```text
PR/MR review is the approval.
vouch only makes the dependency decision visible.
```

---

## Final mental model

> The block does not mean “vouch decided this is forbidden.”  
> The block means “this dependency decision needs to be visible and reviewed before merge.”

That is the right foundation.
