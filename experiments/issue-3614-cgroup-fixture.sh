#!/bin/sh
# Finite sampler fixture from link-foundation/start PR #248 (Unlicense).
# https://github.com/link-foundation/start/blob/80e6640d4ca69f8943138c6acf6a911dfb0c4b0f/experiments/issue-238-cgroup-polling.sh
# Each mocked sleep advances the clock; the fourth sample observes shutdown.
# The no-memory modes (issue #247) run the real in-container scripts against
# a container cgroup without memory.events (no delegated memory controller).
set -eu
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
export START_SAMPLER_FIXTURE="$fixture_dir" START_SAMPLER_MODE="$1"
export TMPDIR="$fixture_dir" PATH="$fixture_dir/bin:$PATH"
export START_COMMAND_CGROUP_ROOT="$fixture_dir/cgroup root"
export START_COMMAND_PROC_ROOT="$fixture_dir/proc"
scope="$START_COMMAND_CGROUP_ROOT/docker/238abc"
mkdir -p "$fixture_dir/bin" "$scope" "$fixture_dir/container"
echo max > "$fixture_dir/container/memory.max"
printf 'oom 0\noom_kill 0\n' > "$scope/memory.events"
echo 67108864 > "$scope/memory.max"
echo 33554432 > "$scope/memory.peak"
echo 0 > "$fixture_dir/round"
touch "$fixture_dir/calls" "$fixture_dir/sleeps"
cat > "$fixture_dir/bin/docker" <<'DOCKER'
#!/bin/sh
printf '%s\n' "$*" >> "$START_SAMPLER_FIXTURE/calls"
case "$1" in
  inspect)
    case "$3" in
      *HostConfig.Memory*) echo 67108864;;
      *CgroupnsMode*)
        if [ "$START_SAMPLER_MODE" = shared ]; then echo host; else echo private; fi;;
      *State.Pid*) echo 0;;
      *State.Running*)
        if [ -f "$START_SAMPLER_FIXTURE/stopped" ]; then echo false; else echo true; fi;;
      *Id*)
        case "$START_SAMPLER_MODE" in local|final) echo 238abc;; *) echo remote238;; esac;;
    esac;;
  exec)
    if [ "${7:-}" = start-command-cgroup-stream ]; then
      # The long-lived exec of issue #242: one line per tick from the host
      # ticker on stdin, until the container stops.
      case "$START_SAMPLER_MODE" in
        local|final) exit 1;;
        no-shell) echo 'sh: not found' >&2; exit 127;;
        no-memory) exec sh -c "$6" "$7" "$START_SAMPLER_FIXTURE/container";;
        *-outage) echo 'Error response from daemon: connection reset' >&2; exit 1;;
        outage)
          if [ "$(cat "$START_SAMPLER_FIXTURE/round")" -gt 0 ]; then
            echo 'Error response from daemon: connection reset' >&2; exit 1
          fi
          read -r tick; echo '67108864 33554432 1 3 /sys/fs/cgroup'; exit 1;;
      esac
      while read -r tick && [ ! -f "$START_SAMPLER_FIXTURE/stopped" ]; do
        echo '67108864 33554432 1 3 /sys/fs/cgroup'
      done
      exit 137
    fi
    case "$START_SAMPLER_MODE" in
      local|final) exit 1;;
      no-shell|no-shell-outage) echo 'sh: not found' >&2; exit 127;;
      no-memory|no-memory-outage)
        exec sh -c "$(printf '%s' "$5" | sed "s#/sys/fs/cgroup#$START_SAMPLER_FIXTURE/container#g")";;
      outage) if [ "$(cat "$START_SAMPLER_FIXTURE/round")" -gt 0 ]; then exit 1; fi;;
    esac
    echo '67108864 33554432 1 3 /sys/fs/cgroup';;
esac
DOCKER
cat > "$fixture_dir/bin/sleep" <<'SLEEP'
#!/bin/sh
# The ticker of the long-lived exec writes to a pipe. A real sleep outlasts an
# exec that fails at once or a stopped container, and the ticker then ends on
# its next write; end it here so the round count stays deterministic.
if [ -p /dev/stdout ]; then
  case "$START_SAMPLER_MODE" in no-shell*|no-memory*|outage) exit 1;; esac
  [ ! -f "$START_SAMPLER_FIXTURE/stopped" ] || exit 1
fi
printf '%s\n' "$1" >> "$START_SAMPLER_FIXTURE/sleeps"
round=$(cat "$START_SAMPLER_FIXTURE/round")
round=$((round+1))
echo "$round" > "$START_SAMPLER_FIXTURE/round"
# Fail finitely even if a regression prevents the sampler from stopping.
if [ "$round" -gt 4 ]; then kill -TERM "$PPID"; exit 1; fi
if [ "$round" -ge 3 ]; then
  touch "$START_SAMPLER_FIXTURE/stopped"
  rm -f "$START_COMMAND_CGROUP_ROOT/docker/238abc/memory.events"
else
  printf 'oom %s\noom_kill %s\n' "$round" "$round" > "$START_COMMAND_CGROUP_ROOT/docker/238abc/memory.events"
fi
SLEEP
cat > "$fixture_dir/bin/date" <<'DATE'
#!/bin/sh
round=$(cat "$START_SAMPLER_FIXTURE/round")
echo "$((100+round*${START_SAMPLER_CLOCK_STEP:-5}))"
DATE
chmod +x "$fixture_dir/bin/"*
# The generated shell waits for autonomous shutdown, optionally performs a
# final read after a new counter value, and prints the sample and call trace.
sh "$2"
