sig='Signature: 8a477f597d28d172789f06886806bc55'
for root in /tmp /home /root /workspace; do
  [ -d "$root" ] || continue
  find "$root" -xdev -name .git -prune -o -type f -name CACHEDIR.TAG -print 2>/dev/null
  find "$root" -xdev -name .git -prune -o -type d -path '*/node_modules/.cache' -print -prune 2>/dev/null
done | while IFS= read -r hit; do
  case "$hit" in */CACHEDIR.TAG) dir=${hit%/CACHEDIR.TAG}; [ "$(head -c 43 "$hit" 2>/dev/null)" = "$sig" ] || continue ;; *) dir=$hit ;; esac
  case "$dir" in /|/tmp|/home|/root|/workspace|/home/*/|'') continue ;; esac
  [ -e "$dir/.git" ] || [ -e "$dir/Cargo.toml" ] || [ -e "$dir/package.json" ] && continue
  kib=$(du -sk "$dir" 2>/dev/null | cut -f1)
  rm -rf -- "$dir" && echo "pruned ${kib:-0} $dir"
done
exit 0
