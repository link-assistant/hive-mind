---
'@link-assistant/hive-mind': minor
---

Add threshold markers to /limits command progress bars

This change implements visual threshold markers in the progress bars displayed by the /limits command. Users can now see:

- **Threshold position marker (│)**: Shows where queue behavior changes (e.g., blocking, one-at-a-time mode)
- **Warning emoji (⚠️)**: Appears when usage exceeds the threshold

Thresholds displayed:

- RAM: 65% (blocks new commands)
- CPU: 65% (blocks new commands)
- Disk: 90% (one-at-a-time mode)
- Claude 5-hour session: 65% (one-at-a-time mode)
- Claude weekly: 97% (one-at-a-time mode)
- GitHub API: 75% (blocks parallel claude commands)

Example output:

```
CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░│░░░░░░░░░░ 25%
0.04/6 CPU cores used

Claude 5 hour session
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓ 98% ⚠️
Resets in 2h 10m (Dec 6, 12:00pm UTC)
```

Fixes #1242
