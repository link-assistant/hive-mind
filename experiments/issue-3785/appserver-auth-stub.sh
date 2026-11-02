#!/bin/sh
# Synthetic provider for the app-server callback probe. Never log request bytes.
set -eu
IFS= read -r request
length=0
authorization=''
while IFS= read -r header; do
  header=$(printf '%s' "$header" | tr -d '\r')
  [ -n "$header" ] || break
  case "$(printf '%s' "$header" | tr '[:upper:]' '[:lower:]')" in
    content-length:*) length=${header#*:}; length=$(printf '%s' "$length" | tr -d ' ');;
    authorization:*) authorization=${header#*: }; authorization=${authorization#Bearer };;
  esac
done
case "$length" in *[!0-9]*|'') exit 1;; esac
[ "$length" -le 262144 ] || exit 1
dd bs=1 count="$length" of=/dev/null 2>/dev/null
status='200 OK'
response='{"models":[]}'
case "$request" in
  'POST /v1/responses '*|'POST /responses '*)
    if [ "$authorization" = "$(cat /probe/g0.bearer)" ]; then
      printf 'model-rejected-g0\n' >> /probe/events
      status='401 Unauthorized'
      response='{"error":{"message":"synthetic expired generation","code":"token_expired"}}'
    elif [ "$authorization" = "$(cat /probe/g1.bearer)" ]; then
      printf 'model-observed-g1\n' >> /probe/events
      status='503 Service Unavailable'
      response='{"error":{"message":"synthetic model deliberately unavailable","code":"offline"}}'
    else
      printf 'unexpected-authorization\n' >> /probe/events
      status='401 Unauthorized'
      response='{"error":{"message":"unexpected synthetic authorization","code":"unexpected"}}'
    fi
    ;;
esac
printf 'HTTP/1.1 %s\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: %s\r\n\r\n%s' "$status" "${#response}" "$response"
