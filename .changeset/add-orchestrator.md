---
'@link-assistant/hive-mind': minor
---

Add orchestrator CLI command with REST API for task queue management

- New `orchestrator` CLI command with configurable `--port` and `--hostname`
- REST API endpoints for queue management:
  - `POST /api/v0/solve/enqueue` - enqueue solve tasks
  - `GET /api/v0/solve/queue` - retrieve queue status
  - `GET /api/v0/solve/task/:id` - get task details
- Uses lino-rest-api (Links Notation format) for API communication
- New `--use-orchestrator` option for `solve`, `hive`, and `telegram-bot` commands
- Support for upstream orchestrator load balancing (master/slave pattern)
- Queue management with resource-aware throttling (RAM, CPU, disk, Claude limits)
