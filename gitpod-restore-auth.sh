# Restore backup of auth data after stopped workspace is restarted (to not login again all the time)

# --- GitHub restore ---
mkdir -p ~/.config
mkdir -p /workspace/.persisted-configs/gh # To not fail on missing folder

# Show backup files before restore
echo "📦 GitHub files available in backup:"
ls -R -a /workspace/.persisted-configs/gh 2>/dev/null || echo "(none)"

cp -r /workspace/.persisted-configs/gh ~/.config/ 2>/dev/null || true

GH_CONFIG=~/.config/gh/hosts.yml
[ -f "$GH_CONFIG" ] && echo "✅ GitHub credentials restored" || echo "❌ GitHub credentials missing"

# Show restored files (same style as backup)
echo "📂 GitHub files in ~/.config/gh after restore:"
ls -R -a ~/.config/gh 2>/dev/null || echo "(none)"

# --- Verify GitHub login status ---
echo "🔄 Verify GitHub login status"
gh auth status

# --- Claude restore ---
# Restore from Gist and start watching for local changes, to reupload them if they exist
claude-profiles --restore gitpod --watch gitpod --skip-projects --verbose --log