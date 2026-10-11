---
'@link-assistant/hive-mind': patch
---

Install jq in every hive-mind Docker image (Dockerfile, Dockerfile.dind and
coolify/Dockerfile) when the Box base lacks it, and verify it in
scripts/verify-docker-image.sh. AI tools' `… | jq …` commands and the solver's
printed "Raw command" (`… | jq -c .`) no longer exit 127 with
`jq: command not found`.
