#!/bin/bash

# Adds fig-start alias to ~/.zshrc (or ~/.bashrc)

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ALIAS_LINE="alias fig-start='$REPO_DIR/bin/fig-start'"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# Detect shell config file
# `case`, not an exact path: a Homebrew zsh is /opt/homebrew/bin/zsh and fell through to ~/.bashrc.
case "${ZSH_VERSION:+zsh}${SHELL}" in *zsh*) RC_IS_ZSH=1 ;; *) RC_IS_ZSH=0 ;; esac
if [ "$RC_IS_ZSH" = 1 ]; then
    RC_FILE="$HOME/.zshrc"
else
    RC_FILE="$HOME/.bashrc"
fi

# Check if alias already exists
if grep -q "alias fig-start=" "$RC_FILE" 2>/dev/null; then
    # Update existing alias (path may have changed)
    # Portable in-place delete: `sed -i ''` is BSD-only and appended a duplicate alias on Linux.
    grep -v "alias fig-start=" "$RC_FILE" > "$RC_FILE.tmp" && mv "$RC_FILE.tmp" "$RC_FILE"
fi

# Add alias
echo "" >> "$RC_FILE"
echo "# Figma CLI" >> "$RC_FILE"
echo "$ALIAS_LINE" >> "$RC_FILE"

# Save repo path to config
mkdir -p "$HOME/.figma-cli"
node -e '
const fs = require("fs"); const [path, repo] = process.argv.slice(1);
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
cfg.repoPath = repo; fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
' "$HOME/.figma-cli/config.json" "$REPO_DIR"

echo ""
echo -e "  ${GREEN}Done!${NC} Added ${BOLD}fig-start${NC} alias to ${BOLD}$RC_FILE${NC}"
echo ""
echo -e "  Now run: ${BOLD}source $RC_FILE${NC}"
echo -e "  Then type: ${BOLD}fig-start${NC}"
echo ""
