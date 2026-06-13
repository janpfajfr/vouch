# vouch — adopt demo, MOBILE cut (VHS tape)
#
# Renders assets/adopt-demo.mp4 — a square (1:1) H.264 video sized for the
# LinkedIn mobile feed, where square/portrait take the most screen real estate.
# Same story and setup as assets/adopt-demo.tape (the landscape GIF for the
# README); only the dimensions and output format differ. Keep the command beats
# below in sync with adopt-demo.tape.
#
# Render from the repo root (requires github.com/charmbracelet/vhs + ffmpeg):
#
#     npm run build                      # produces dist/ that the demo drives
#     vhs assets/adopt-demo-mobile.tape  # writes assets/adopt-demo.mp4

Output assets/adopt-demo.mp4

Set Shell bash
Set FontSize 18
Set Width 1100
Set Height 1100
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set PlaybackSpeed 1.0

# --- setup, hidden from the recording (shared with adopt-demo.tape) --------
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
#     The "Adopted N dependencies across M workspaces" line is the hook frame.
Type "vouch adopt" Sleep 500ms Enter
Sleep 7s

# --- 3. the "after": every dependency is recorded — check is green ---------
Type "vouch check" Sleep 500ms Enter
Sleep 5s

# --- 4. the payoff: what now enters the repo — a reviewable ledger + rules -
Type "git add -A && git status --short" Sleep 500ms Enter
Sleep 7s

Sleep 2s
