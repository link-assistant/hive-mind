#!/usr/bin/env bash
# Issue #3125: can an unprivileged process raise the oom_score_adj of another
# process with the same uid, and do processes it forks later inherit it? The
# kernel only needs CAP_SYS_RESOURCE to go below the lowest value that process
# ever had, so raising a build to 500 needs no privilege.
set -u
tail -f /dev/null &
child=$!
echo "uid $(id -u), child $child starts at oom_score_adj $(cat /proc/$child/oom_score_adj)"
echo 500 > /proc/$child/oom_score_adj && echo "raise another process to 500: ok ($(cat /proc/$child/oom_score_adj))"
(echo 0 > /proc/$child/oom_score_adj) 2>/dev/null && echo "lower it back to 0: ok" || echo "lower it back to 0: refused"
(echo -100 > /proc/$child/oom_score_adj) 2>/dev/null && echo "lower it to -100: ok" || echo "lower it to -100: refused (needs CAP_SYS_RESOURCE)"
kill "$child"
sh -c 'echo 500 > /proc/self/oom_score_adj; sh -c "echo \"a process forked after the change inherits \$(cat /proc/self/oom_score_adj)\""'
echo "this shell keeps $(cat /proc/$$/oom_score_adj)"
