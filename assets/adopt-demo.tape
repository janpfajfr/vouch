# vouch — adopt demo recording (VHS tape)
#
# Renders assets/adopt-demo.gif: onboarding an EXISTING repo. The story —
# `init` sets up config + agent rules, `check` fails on a wall of unrecorded
# dependencies (the "before"), `adopt` baselines every installed dependency
# across all workspaces in one command, and `check` goes green (the "after").
# The freeze frame is the "Adopted N dependencies across M workspaces" line.
#
# Render from the repo root (requires github.com/charmbracelet/vhs):
#
#     npm run build               # produces dist/ that the demo drives
#     vhs assets/adopt-demo.tape  # writes assets/adopt-demo.gif
#
# The `.tape` and its setup are committed so the demo is reproducible — re-render
# whenever the CLI output changes. If `check` ever fails after `adopt`, a pinned
# dependency in adopt-demo-setup.sh gained a CVE; bump it to a clean version.

Output assets/adopt-demo.gif

Set Shell bash
Set FontSize 18
Set Width 1100
Set Height 860
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set PlaybackSpeed 1.0

# --- setup, hidden from the recording -------------------------------------
# Builds the throwaway monorepo and installs its deps (the "existing repo").
# Sourced so the `vouch` function and the cd persist; see adopt-demo-setup.sh.
Hide
Type "source assets/adopt-demo-setup.sh" Enter
Sleep 1s
Show

# --- 0. an existing repo — onboard it: config + agent rules ---------------
Type "vouch init" Sleep 500ms Enter
Sleep 5s

# --- 1. the "before": check fails on a wall of unrecorded dependencies ----
Type "vouch check" Sleep 500ms Enter
Sleep 5s

# --- 2. adopt: baseline every installed dependency across all workspaces ---
#     The summary line ("Adopted N dependencies across M workspaces") is the
#     hook frame — the long Sleep keeps it on screen to read.
Type "vouch adopt" Sleep 500ms Enter
Sleep 7s

# --- 3. the "after": every dependency is recorded — check is green ---------
Type "vouch check" Sleep 500ms Enter
Sleep 5s

# --- 4. the payoff: what now enters the repo — a reviewable ledger + rules -
Type "git add -A && git status --short" Sleep 500ms Enter
Sleep 7s

Sleep 2s
