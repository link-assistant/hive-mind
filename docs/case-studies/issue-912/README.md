# Case Study: Auto-Cleanup and Service Auto-Restart Solutions (Issue #912)

## Summary

The Hive Mind server accumulates resource waste over time:

- **CPU**: Dangling processes from solve/hive commands
- **RAM**: Zombie processes that never get reaped
- **Disk**: Temporary files in `/tmp` from cloned repositories

This leads to situations where the `solve` and `hive` commands stop working when disk/RAM becomes full. The current workaround is `sudo reboot`, but this requires:

1. Ensuring all solve/hive commands have finished
2. Auto-restarting the `hive-telegram-bot` (running in `screen -r bot`)

This case study explores solutions using screen, Docker, cron, systemd, and other tools.

## Documents

### [00-OVERVIEW.md](./00-OVERVIEW.md)

**Executive summary with problem analysis**

- Problem description and observed symptoms
- Resource accumulation patterns
- Impact assessment

### [01-TIMELINE.md](./01-TIMELINE.md)

**Timeline and sequence of events**

- How resource waste accumulates over time
- Process lifecycle in solve/hive commands
- Server degradation patterns

### [02-ROOT-CAUSES.md](./02-ROOT-CAUSES.md)

**Deep technical analysis**

- Temporary file accumulation in `/tmp`
- Process lifecycle management gaps
- Why processes become orphaned/zombie

### [03-SOLUTIONS.md](./03-SOLUTIONS.md)

**Proposed solutions and mitigations (15 solutions analyzed)**

- Service auto-restart: systemd, Docker Compose, PM2, Supervisord, Kubernetes
- Resource cleanup: Cron jobs, systemd-tmpfiles, logrotate, incron
- OOM protection: earlyoom/systemd-oomd, OOM score tuning
- Resource isolation: cgroups via systemd
- Monitoring: Monit, resource watchdog scripts
- Safe reboot mechanism

### [04-IMPLEMENTATION.md](./04-IMPLEMENTATION.md)

**Implementation guide**

- Step-by-step setup instructions
- Configuration examples
- Monitoring and alerting

## Quick Reference

### Problem Summary

| Resource | Issue              | Cause                                                     |
| -------- | ------------------ | --------------------------------------------------------- |
| CPU      | Dangling processes | Solve commands spawning subprocesses that don't terminate |
| RAM      | Zombie processes   | Parent processes not reaping child exit status            |
| Disk     | /tmp filling up    | Cloned repositories and temporary files not cleaned       |

### Proposed Solutions Overview

#### Tier 1: Essential

| Solution                | Addresses                  | Complexity | Recommended |
| ----------------------- | -------------------------- | ---------- | ----------- |
| systemd service for bot | Auto-restart after reboot  | Low        | Yes         |
| Cron cleanup job        | Disk/process cleanup       | Low        | Yes         |
| systemd-tmpfiles        | Disk cleanup               | Low        | Yes         |
| earlyoom / systemd-oomd | Proactive OOM prevention   | Low        | Yes         |
| OOM score tuning        | RAM cleanup prioritization | Low        | Yes         |
| logrotate               | Log file disk cleanup      | Low        | Yes         |

#### Tier 2: Recommended Enhancements

| Solution            | Addresses                 | Complexity | Recommended |
| ------------------- | ------------------------- | ---------- | ----------- |
| cgroups via systemd | CPU/RAM/process isolation | Medium     | Yes         |
| Safe reboot script  | All resources             | Medium     | Optional    |

#### Tier 3: Advanced

| Solution          | Addresses                  | Complexity | Recommended          |
| ----------------- | -------------------------- | ---------- | -------------------- |
| Docker Compose    | Auto-restart + isolation   | Medium     | If using Docker      |
| Monit             | Threshold-based monitoring | Low        | Optional             |
| PM2               | Process management         | Medium     | If not using systemd |
| Resource watchdog | Threshold-based cleanup    | Medium     | Optional             |
| Supervisord       | Process management         | Low-Medium | If not using systemd |
| incron            | Real-time file cleanup     | Medium     | Optional             |
| Kubernetes        | Full orchestration         | High       | If already using K8s |

## Related Issues and PRs

- **[Issue #912](https://github.com/link-assistant/hive-mind/issues/912)** - This issue
- **[Issue #837](https://github.com/link-assistant/hive-mind/issues/837)** - Playwright MCP Chrome leak (related resource leak)
- **[PR #913](https://github.com/link-assistant/hive-mind/pull/913)** - Case study documentation

## External Resources

### Documentation

- [systemd-tmpfiles Configuration](https://www.baeldung.com/linux/systemd-tmpfiles-configure-temporary-files)
- [Docker Compose Restart Policies](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [GNU Screen Auto-Restart](https://medium.com/@VirtualAdept/restarting-a-screen-session-without-manual-intervention-a5c12749ee5b)
- [earlyoom GitHub](https://github.com/rfjakob/earlyoom)
- [systemd-oomd Documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd-oomd.service.html)
- [Monit Official Documentation](https://mmonit.com/monit/documentation/monit.html)
- [Kubernetes Liveness Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

### Best Practices

- [How To Configure a Linux Service to Start Automatically After Reboot](https://www.digitalocean.com/community/tutorials/how-to-configure-a-linux-service-to-start-automatically-after-a-crash-or-reboot-part-1-practical-examples)
- [How to Kill Zombie Processes on Linux](https://www.howtogeek.com/701971/how-to-kill-zombie-processes-on-linux/)
- [Linux OOM Killer Guide (Last9)](https://last9.io/blog/understanding-the-linux-oom-killer/)
- [Red Hat: Setting Resource Limits with Control Groups](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/managing_monitoring_and_updating_the_kernel/setting-limits-for-applications_managing-monitoring-and-updating-the-kernel)
- [Better Stack: Complete Guide to logrotate](https://betterstack.com/community/guides/logging/how-to-manage-log-files-with-logrotate-on-ubuntu-20-04/)

## Authors

- Investigation: AI Assistant (Claude)
- Issue Reporter: @konard
- Date: 2025-12-11 (initial), 2026-02-01 (expanded analysis)

## License

This case study is part of the Hive Mind project documentation.
