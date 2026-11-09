#!/usr/bin/env bash
# Issue #4025: reproduce lycheeverse/lychee-action's download failing on one
# transient error. A local server answers the first request with 503, then
# serves the file, like a GitHub release-CDN blip.
#   bash experiments/issue-4025/lychee-action-curl-no-retry.sh
set -u
dir="$(mktemp -d)"; trap 'kill "$pid" 2>/dev/null; rm -rf "$dir"' EXIT
printf 'fake archive\n' > "$dir/lychee.tar.gz"
cat > "$dir/server.py" <<'PY'
import http.server, sys, os
count = {"n": 0}
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        count["n"] += 1
        if count["n"] <= 2:  # requests 1 and 2 fail: one per curl below
            self.send_error(503, "transient")
        else:
            super().do_GET()
    def log_message(self, *a): pass
os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), H).serve_forever()
PY
port=$((20000 + RANDOM % 20000))
python3 -I "$dir/server.py" "$dir" "$port" & pid=$!
sleep 1
url="http://127.0.0.1:$port/lychee.tar.gz"
mkdir "$dir/download"; cd "$dir/download" || exit 1
echo "--- lychee-action v2.9.0 (action.yml): curl -sfLO"
curl -sfLO "$url"; echo "exit=$?"
rm -f lychee.tar.gz
echo "--- proposed: curl --retry 5 --retry-all-errors"
curl --fail --silent --show-error --location --retry 5 --retry-all-errors --retry-delay 1 -O "$url"; echo "exit=$?"
