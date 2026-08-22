# Create backup to restore auth data after workspace is stopped (to not login again all the time)

# --- GitHub backup ---
# Verify login status
gh auth status

# Save GitHub auth into persisted workspace folder
mkdir -p /workspace/.persisted-configs
cp -r ~/.config/gh /workspace/.persisted-configs/

# Verify it's saved & list files
GH_CONFIG_BACKUP=/workspace/.persisted-configs/gh/hosts.yml
[ -f "$GH_CONFIG_BACKUP" ] && echo "✅ GitHub saved" || echo "❌ GitHub save failed"
echo "📂 GitHub backup files:"
ls -R -a /workspace/.persisted-configs/gh

# --- Claude backup ---
# Store to Gist
claude-profiles --store gitpod --skip-projects

# Start watching for local changes, to reupload them if they exist
# claude-profiles --watch gitpod