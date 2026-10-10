#!/usr/bin/env bash
# Reproduce issue #2846 against a published or locally built hive-mind image.
#   bash experiments/issue-2846/check-jq.sh konard/hive-mind-dind:2.34.0   # before: exit 127
#   bash experiments/issue-2846/check-jq.sh konard/hive-mind-dind:test     # after: prints jq-1.x
set -u
image="${1:-konard/hive-mind-dind:2.34.0}"
docker run --rm ${HIVE_MIND_CHECK_DOCKER_ARGS:-} --entrypoint /bin/bash "$image" -lc \
  'command -v jq; jq --version; echo "{\"ok\":true}" | jq -c .'
