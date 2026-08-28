#!/usr/bin/env bash
# Build 9router from this repo and install it over the global npm copy.
# No `set -e`: every command substitution below is checked explicitly instead.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
[ -n "$REPO" ] || { echo "FAIL: cannot resolve repo dir" >&2; exit 1; }

GLOBAL_DIR="$HOME/.local/lib/node_modules/9router"
BACKUP="$HOME/9router-backup-$(date +%Y%m%d-%H%M%S)"

die() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

# --- 1. stop the running server -------------------------------------------
step "Stopping running 9router"
# Match the launcher, not the child next-server: killing the parent takes both.
pids="$(pgrep -f 'node .*bin/9router' 2>/dev/null)"
if [ -n "$pids" ]; then
  echo "$pids" | while IFS= read -r p; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  sleep 2
  # SIGTERM is advisory; confirm it actually died before overwriting its files.
  still="$(pgrep -f 'node .*bin/9router' 2>/dev/null)"
  [ -z "$still" ] || die "9router still running (pids: $still) — kill -9 them and rerun"
  echo "stopped: $pids"
else
  echo "nothing running"
fi

# --- 2. back up the current install ---------------------------------------
step "Backing up $GLOBAL_DIR"
if [ -d "$GLOBAL_DIR" ]; then
  cp -R "$GLOBAL_DIR" "$BACKUP" || die "backup failed"
  echo "backup: $BACKUP"
else
  echo "no existing install to back up"
fi

# --- 3. build ---------------------------------------------------------------
step "Installing deps + building"
cd "$REPO" || die "cannot cd $REPO"
[ -d node_modules ] || { npm install || die "root npm install failed"; }
npm run build || die "next build failed"
npm --prefix cli install || die "cli npm install failed"
npm run cli:pack || die "cli:pack failed"

# --- 4. locate the tarball --------------------------------------------------
step "Locating tarball"
# Build the exact filename from the version rather than globbing for the newest
# match: a stale tarball from an older pack would otherwise be a valid pick.
VER="$(node -p "require('$REPO/cli/package.json').version" 2>/dev/null)"
[ -n "$VER" ] || die "cannot read cli/package.json version"
TGZ="$(cd "$REPO/.." && pwd)/9router-$VER.tgz" || die "cannot resolve tarball dir"
[ -f "$TGZ" ] || die "tarball not found: $TGZ"
echo "tarball: $TGZ"

# --- 5. install over --------------------------------------------------------
step "Installing globally"
# Full path, never the bare name — a bare `9router` would pull from the registry
# and silently discard this build.
npm i -g "$TGZ" || die "global install failed"

# --- 6. verify the change actually shipped ----------------------------------
step "Verifying glm-5.3 context window"
chunks="$GLOBAL_DIR/app/.next-cli-build/server/chunks"
[ -d "$chunks" ] || die "installed chunks dir missing: $chunks"
entry="$(grep -rhao 'glm-5\.3":{[^}]*}' "$chunks" 2>/dev/null | head -1)"
[ -n "$entry" ] || die "glm-5.3 not found in installed build"
echo "$entry"
# -F -e: the pattern is literal and starts with no dash, but keep the habit —
# an unanchored regex here would match 1e60 or similar just as happily.
if grep -qF -e 'contextWindow:1e6' <<< "$entry"; then
  echo "OK: glm-5.3 has a 1M context window"
else
  die "glm-5.3 still capped — install did not take"
fi

step "Verifying gpt-5.6-sol context window"
# Sol's caps live in a shared const, so grep the minified literal directly:
# 372000 must be gone from every chunk, and 1e6 must be present alongside sol.
if grep -rqE '372000|372e3' "$chunks" 2>/dev/null; then
  die "gpt-5.6-sol still capped at 372k — install did not take"
fi
grep -rq 'gpt-5.6-sol' "$chunks" 2>/dev/null || die "gpt-5.6-sol missing from installed build"
echo "OK: gpt-5.6-sol no longer capped at 372k"

step "Verifying cursor client version"
# The 3.12.17 UA made Cursor reject every call with "Update Required" (429).
if grep -rqF -e '3.12.17' "$chunks" 2>/dev/null; then
  die "cursor still sends client version 3.12.17 — install did not take"
fi
grep -rqF -e '3.14.27' "$chunks" 2>/dev/null || die "cursor client version 3.14.27 missing from installed build"
echo "OK: cursor sends client version 3.14.27"

step "Done"
echo "Start it with:"
echo "  9router --skip-update --tray --no-browser"
echo
echo "Roll back with:"
echo "  npm i -g 9router                 # official npm build"
echo "  rm -rf '$GLOBAL_DIR' && cp -R '$BACKUP' '$GLOBAL_DIR'   # this backup"
