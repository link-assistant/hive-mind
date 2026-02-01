---
'@link-assistant/hive-mind': patch
---

docs: Expand auto-cleanup case study with 9 additional solutions (Issue #912)

Expanded the case study analysis from 6 to 15 solutions covering:

- OOM protection (earlyoom, systemd-oomd, OOM score tuning)
- Resource isolation (cgroups via systemd)
- Log management (logrotate)
- Process monitoring (Monit, Supervisord)
- Event-driven cleanup (incron)
- Resource watchdog scripts
- Kubernetes liveness probes and resource limits

Added tiered recommendation system (Essential, Recommended, Advanced) and updated implementation guide with steps for earlyoom, OOM score tuning, cgroup limits, and logrotate configuration.
