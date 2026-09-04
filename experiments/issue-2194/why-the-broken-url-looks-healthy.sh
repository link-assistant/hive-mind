#!/usr/bin/env bash
# Issue #2194 — why "https://github.com/G-Ivan-A/aether-orbis/pulls/30" looks fine.
#
# The user's URL had "pulls" where it needed "pull". Nothing in the chat hinted at
# a problem, because github.com answers that path with HTTP 200 and a normal set of
# Open Graph tags — which is exactly what Telegram renders its preview card from.
#
# Usage: bash experiments/issue-2194/why-the-broken-url-looks-healthy.sh
set -u

probe() {
  local url="$1"
  echo "== $url"
  curl -sS -o /tmp/issue2194-probe.html -w '   HTTP %{http_code}  final: %{url_effective}\n' -L "$url" || return 0
  grep -o '<meta property="og:[a-z:]*" content="[^"]*"' /tmp/issue2194-probe.html | head -4 | sed 's/^/   /'
  echo
}

# The typo the user actually sent: a real page, HTTP 200, complete preview card.
probe 'https://github.com/G-Ivan-A/aether-orbis/pulls/30'
# What they meant.
probe 'https://github.com/G-Ivan-A/aether-orbis/pull/30'
# For contrast: a path GitHub really does not have.
probe 'https://github.com/G-Ivan-A/aether-orbis/pullz/30'
