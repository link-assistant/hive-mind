# Timeline of Events: Docker Build Performance Issue #1415

## Workflow Run #22957999603 (2026-03-11)

### Pre-conditions

- Commit: `d11ea8af4550117ce9af7f69a9aff78437120bd6`
- Trigger: Push to main branch
- Docker image version: 1.30.4

### Parallel Job Execution

Both docker-publish jobs started at the same time after the release job completed:

```
14:36:47 - Workflow started
14:42:44 - Release job completed
14:42:51 - Both docker-publish jobs started in parallel
```

---

## linux/amd64 Timeline (ubuntu-latest runner)

| Timestamp | Event               | Details                                  |
| --------- | ------------------- | ---------------------------------------- |
| 14:42:51  | Job started         | Runner: Azure westus, Ubuntu 24.04.3 LTS |
| 14:42:52  | Checkout complete   |                                          |
| 14:43:01  | Free disk space     | Node script executed                     |
| 14:44:20  | Wait for NPM        | Package version 1.30.4 available         |
| 14:44:55  | Docker Buildx setup |                                          |
| 14:44:58  | Docker Hub login    |                                          |
| 14:45:00  | Build started       | All 12 steps CACHED                      |
| 14:45:00  | Step #7-#18         | **CACHED** (no rebuild needed)           |
| 14:45:01  | Export to registry  | Started                                  |
| 14:45:05  | Push complete       | 3.8s total push time                     |
| 14:45:05  | GHA cache export    | Started                                  |
| 14:45:12  | GHA cache export    | **Done in 7.2s**                         |
| 14:45:15  | Job complete        | **Total: ~2 minutes 24 seconds**         |

### Why amd64 was fast:

1. All Docker layers were already cached in GHA
2. No rebuild required - instant CACHED response
3. Only manifest push needed (layers already in registry)
4. Minimal cache export (no new layers to export)

---

## linux/arm64 Timeline (ubuntu-24.04-arm runner)

| Timestamp | Event                | Details                                               |
| --------- | -------------------- | ----------------------------------------------------- |
| 14:42:51  | Job started          | Runner: Azure southcentralus, by Arm Limited          |
| 14:42:52  | Checkout complete    |                                                       |
| 14:43:01  | Free disk space      |                                                       |
| 14:43:20  | Docker Buildx setup  |                                                       |
| 14:43:22  | Build started        |                                                       |
| 14:43:22  | Steps #7-#16         | **CACHED**                                            |
| 14:43:22  | **Step #17 ERROR**   | `blob sha256:b290c07... not found`                    |
| 14:43:23  | **Step #18 ERROR**   | `blob sha256:3b737555... not found`                   |
| 14:43:25  | Base image pull      | Started pulling konard/sandbox:1.3.16                 |
| 14:43:35  | Large layer download | `sha256:9c0efe... 456.38MB` downloading               |
| 14:43:35  | Large layer download | `sha256:c8765b... 798.93MB` downloading               |
| 14:50:35  | Step #18 retry       | playwright install-deps (~7 min delay)                |
| 14:50:37  | Apt-get install      | Installing Playwright dependencies                    |
| 14:51:33  | Step #17 retry       | claude mcp add playwright                             |
| 14:51:34  | Step #17 done        | 1.0s execution                                        |
| 14:51:34  | Export to image      | Started                                               |
| 14:55:36  | Layer export done    | **242.8 seconds**                                     |
| 14:55:37  | Attestation complete |                                                       |
| 14:56:29  | GHA cache export     | Started                                               |
| 14:56:35  | Writing layer        | `sha256:001479f8... 80.70MB` - 5.7s                   |
| 14:57:26  | Writing layer        | `sha256:2c695f7c... ?MB` - **33.8s**                  |
| 14:58:17  | Writing layer        | `sha256:3a3a16b0... ?MB` - **44.6s**                  |
| 15:01:27  | Writing layer        | `sha256:425b1c25... ?MB` - **185.8s** (3+ min!)       |
| 15:02:33  | Writing layer        | `sha256:7e51ab91... 486.41MB` - 37.3s                 |
| 15:03:11  | Writing layer        | `sha256:8b877bbf... ?MB` - 37.1s                      |
| 15:03:51  | Writing layer        | `sha256:9c0efe70... 456.38MB` - 38.9s                 |
| 15:05:37  | Writing layer        | `sha256:c739f5f1... ?MB` - 50.7s                      |
| 15:08:13  | Writing layer        | `sha256:c8765b1e... 798.93MB` - **155.9s** (2.5 min!) |
| 15:08:59  | Cache export done    | **750.8 seconds total** (~12.5 min)                   |
| 15:09:26  | Job complete         | **Total: ~26 minutes 35 seconds**                     |

### Why arm64 was slow:

1. Cache miss on steps #17 and #18 (blob not found)
2. Had to re-download base image layers (~1.5GB)
3. Had to re-run playwright install-deps
4. Had to export ALL layers to GHA cache (not just diff)
5. Sequential layer export with 40+ layers
6. Two layers took >2.5 minutes each to export

---

## Time Breakdown Comparison

| Phase            | amd64        | arm64   | Difference      |
| ---------------- | ------------ | ------- | --------------- |
| Job startup      | ~2m          | ~2m     | Same            |
| Docker build     | <1s (cached) | 8m 42s  | Cache miss      |
| Registry push    | 3.8s         | 242.8s  | 64x slower      |
| GHA cache export | 7.2s         | 750.8s  | **104x slower** |
| **Total**        | 2m 24s       | 26m 35s | **11x slower**  |

---

## Root Cause Evidence

### Cache Miss on arm64

The error messages clearly show cache blob not found:

```
#17 ERROR: blob sha256:b290c07173fb382ce5cda6d6f820913d90cc12aab79b56a5ef70c52f181fb324: not found
#18 ERROR: blob sha256:3b737555cadafbf290e3405c16a63eff2fc1bde635b13f940312129fe672fc47: not found
```

This forced a full rebuild of steps #17 and #18, plus a full cache export of all layers.

### Sequential GHA Cache Export

Each layer is written sequentially, with the slowest taking **185.8 seconds** (over 3 minutes) for a single layer. This is a documented issue in [moby/buildkit#2804](https://github.com/moby/buildkit/issues/2804).
