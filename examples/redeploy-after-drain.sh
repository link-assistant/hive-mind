#!/usr/bin/env bash
# Issue #4143: redeploy a hive-telegram-bot container without killing tasks.
#
#   CONTAINER=hive-mind ./examples/redeploy-after-drain.sh "docker compose up -d --force-recreate hive-mind"
#
# 1. --drain: the running instance stops taking new tasks (users are told it is
#    restarting); running tasks keep going, queued tasks stay in the state file.
# 2. --wait-for-idle: returns once the drain is acknowledged and nothing is
#    running or starting (or fails after WAIT_TIMEOUT seconds).
# 3. Run the deploy command. The new instance resets the drain, restores the
#    /subscribe list and re-queues the tasks that had not started.
#
# The commands only touch the state directory (HIVE_MIND_STATE_DIR), so they
# need no bot token. CONTAINER_USER (default box) is the user docker exec runs
# as. Without CONTAINER they run on this host, which works when
# the state directory is mounted here (pass STATE_DIR).
set -euo pipefail

DEPLOY_COMMAND="${1:?usage: $0 '<deploy command>'}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-3600}"
REASON="${DRAIN_REASON:-redeploy}"

bot() {
  if [ -n "${CONTAINER:-}" ]; then
    # Run as the bot's user (box in the hive-mind images, as hive-manager does) so
    # the state directory resolves to the bot's HOME and keeps its owner.
    docker exec --user "${CONTAINER_USER:-box}" "$CONTAINER" hive-telegram-bot "$@"
  else
    hive-telegram-bot ${STATE_DIR:+--state-dir "$STATE_DIR"} "$@"
  fi
}

bot --status
bot --drain --drain-reason "$REASON"
if ! bot --wait-for-idle --wait-timeout "$WAIT_TIMEOUT"; then
  echo "Tasks are still running after ${WAIT_TIMEOUT}s; resuming intake and aborting the deploy." >&2
  bot --resume-intake
  exit 1
fi
eval "$DEPLOY_COMMAND"
