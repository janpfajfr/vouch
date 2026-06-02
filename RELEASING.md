# Releasing vouch

Every published version must land in **three** places: **npm**, a **git tag**, and a
**GitHub Release**. A git tag is *not* a GitHub Release — the Release is the step that's
easiest to forget, so it's on this list. (0.2.0 shipped to npm and was tagged, but had no
GitHub Release for a while — this checklist exists so that doesn't recur.)

## Prerequisites

- All release-worthy changes are merged to `main` via PR.
- You're authenticated to npm: `npm whoami` prints your username. If it 401s, run
  `npm login` first — the `--otp` flag is 2FA, it does **not** log you in.

## Steps

1. **Sync main:** `git checkout main && git pull`.
2. **Pick the version** (semver): bugfix → patch, new backward-compatible feature →
   minor, breaking → major. (Pre-1.0: a breaking change is still a minor bump.)
3. **Bump the version** in `package.json` *and* `package-lock.json`:
   ```
   npm version <x.y.z> --no-git-tag-version
   ```
   This edits both files (top-level `version` and `packages.""`) without committing or
   tagging. Confirm the lockfile `name` is `@vouchjs/vouch` while you're there.
4. **Update the changelog:** move the `## [Unreleased]` notes into a new dated section
   `## [x.y.z] — YYYY-MM-DD` in `CHANGELOG.md`.
5. **Commit:** `git commit -am "release: x.y.z"`.
6. **Tag:** `git tag vx.y.z`.
7. **Push commit + tag:** `git push origin main && git push origin vx.y.z`.
8. **Publish to npm** (the `prepublishOnly` hook runs the full test suite first):
   ```
   npm publish --otp=<fresh-6-digit-code>
   ```
   Generate the OTP immediately before — it can expire during the test run. Re-run with a
   fresh code if you hit `EOTP`.
9. **Verify npm:** `npm view @vouchjs/vouch version` shows the new version.
10. **Create the GitHub Release** — do not skip this:
    ```
    gh release create vx.y.z --title "vx.y.z" --latest \
      --notes-file <(awk '/^## \[x\.y\.z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md)
    ```
    (Substitute the real version in both the title and the `awk` pattern. Or pass
    `--notes "<paste the CHANGELOG section>"`.)

## Confirm all three agree

```
npm view @vouchjs/vouch version          # npm
git ls-remote --tags origin | grep vx.y.z   # tag
gh release view vx.y.z                    # GitHub Release (and that it's marked Latest)
```
