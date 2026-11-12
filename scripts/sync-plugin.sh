#!/usr/bin/env bash
# Sync repo build output into the registered Kimi plugin source dir and bump
# its version (user clicks "Update" on the Personal tab afterwards).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="${1:-$HOME/Library/Application Support/kimi-desktop/daimon-share/plugin-sources/personal/forgejo-process}"
SKILLS_SCRIPTS="$HOME/Library/Application Support/kimi-desktop/daimon-share/daimon/skills/plugin-builder/scripts"

cd "$REPO"
npm run build
rsync -a --delete dist package.json node_modules "$PLUGIN_DIR/server/"
# Note: the plugin's SKILL.md (skills/forgejo-process) is the install-facing
# copy and keeps its own frontmatter name — edit it in the plugin dir when the
# process changes; skills/delivery-loop in this repo is the readable source.
python3 "$SKILLS_SCRIPTS/cachebuster.py" "$PLUGIN_DIR"
echo "synced -> $PLUGIN_DIR (user: click Update on the Personal tab)"
