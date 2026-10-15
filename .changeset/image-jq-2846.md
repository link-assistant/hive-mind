---
'@link-assistant/hive-mind': patch
---

Install jq in every hive-mind Docker image built from a Box base (Dockerfile, Dockerfile.dind and coolify/Dockerfile; Dockerfile.formal-ai and Dockerfile.e2e inherit it) when the base lacks it, and check it in scripts/verify-docker-image.sh so an image without jq fails verification. AI tools' `… | jq …` commands and the solver's printed "Raw command" (`… | jq -c .`) no longer exit 127 with `jq: command not found` (issue #2846).
