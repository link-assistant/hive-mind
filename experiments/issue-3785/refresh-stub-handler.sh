#!/bin/sh
# Offline synthetic provider. Never print request headers, bodies or tokens.
set -eu
IFS= read -r request
length=0
while IFS= read -r header; do
  header=$(printf '%s' "$header" | tr -d '\r')
  [ -n "$header" ] || break
  case "$(printf '%s' "$header" | tr '[:upper:]' '[:lower:]')" in
    content-length:*) length=${header#*:}; length=$(printf '%s' "$length" | tr -d ' ');;
  esac
done
case "$length" in *[!0-9]*|'') exit 1;; esac
[ "$length" -le 65536 ] || exit 1
body=$(dd bs=1 count="$length" 2>/dev/null)
status='503 Service Unavailable'
response='{"error":{"message":"offline model endpoint","code":"offline"}}'
case "$request" in
  'POST /oauth/token '*)
    mkdir -p /probe/arrivals
    : > "/probe/arrivals/$$"
    # Hold the provider response until both callers have submitted their
    # generation. This models overlapping refresh requests before commit.
    attempts=0
    while [ "$(ls /probe/arrivals | wc -l)" -lt 2 ] && [ "$attempts" -lt 30 ]; do
      attempts=$((attempts + 1))
      sleep 0.1
    done
    exec 9>/probe/provider.lock
    flock -x 9
    if ! printf '%s' "$body" | grep -q '"refresh_token"[[:space:]]*:[[:space:]]*"synthetic-refresh-g0"'; then
      printf 'unexpected-generation\n' >> /probe/events
      status='400 Bad Request'
      response='{"error":{"code":"unexpected_generation","message":"unexpected synthetic generation"}}'
    elif [ ! -e /probe/consumed ]; then
      : > /probe/consumed
      printf 'refresh-accepted\n' >> /probe/events
      status='200 OK'
      response=$(cat /probe/refresh-response.json)
    else
      printf 'refresh-reused\n' >> /probe/events
      status='401 Unauthorized'
      response='{"error":{"code":"refresh_token_reused","message":"synthetic predecessor consumed"}}'
    fi
    flock -u 9
    ;;
esac
printf 'HTTP/1.1 %s\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: %s\r\n\r\n%s' "$status" "${#response}" "$response"
