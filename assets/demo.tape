# vouch — demo recording (VHS tape)
#
# Renders assets/demo.gif, the README demo. The story: a safe dependency is
# recorded, a risky one is BLOCKED, a raw `npm install` bypass is CAUGHT by
# `vouch check`, and recording the decision makes `check` green again.
#
# Render from the repo root (requires github.com/charmbracelet/vhs):
#
#     npm run build          # produces dist/ that the demo drives
#     vhs assets/demo.tape   # writes assets/demo.gif
#
# The `.tape` is committed so the demo is reproducible — re-render it whenever
# the CLI output changes. (Fitting, for a tool about reproducible decisions.)

Output assets/demo.gif

Set Shell bash
Set FontSize 18
Set Width 1100
Set Height 860
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set PlaybackSpeed 1.0

# --- setup, hidden from the recording -------------------------------------
# All the quote-heavy setup lives in assets/demo-setup.sh and is *sourced*
# (so the `vouch` function and the temp-project cd persist in this shell),
# keeping the recording itself to clean, quote-free commands.
Hide
Type "source assets/demo-setup.sh" Enter
Sleep 1s
Show

# --- 1. a safe dependency: reviewed, installed, recorded ------------------
Type "vouch left-pad" Sleep 500ms Enter
Sleep 6s

# --- 2. a risky dependency is BLOCKED (install-time script) ---------------
Type "vouch esbuild" Sleep 500ms Enter
Sleep 6s

# --- 3. the gate: every recorded dependency passes ------------------------
Type "vouch check" Sleep 500ms Enter
Sleep 4s

# --- 4. a raw `npm install` bypass — CAUGHT by check ----------------------
Type "npm install ms --no-audit --no-fund >/dev/null 2>&1" Sleep 500ms Enter
Sleep 3s
Type "vouch check" Sleep 500ms Enter
Sleep 5s

# --- 5. record the decision (with a reason) → check is green again --------
Type 'vouch esbuild --force-with-reason "needed for the build step"' Sleep 500ms Enter
Sleep 6s
Type "vouch check" Sleep 500ms Enter
Sleep 5s

# --- 6. the payoff: the decision lives in committed JSON, reviewable in the PR
Type "cat .security/dependency-approvals.json" Sleep 500ms Enter
Sleep 8s

Sleep 2s
