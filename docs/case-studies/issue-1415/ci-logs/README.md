# CI Logs

The full CI logs from run #22957999603 are too large to commit to git (~20K lines).

For the raw logs, download using:

```bash
gh run view 22957999603 --repo link-assistant/hive-mind --log > release-22957999603.log
```

## Key Excerpts

### amd64 Build (2 minutes, fully cached)

- All steps #7-#18 were **CACHED**
- GHA cache export: 7.2 seconds
- Total job time: ~2 minutes 24 seconds

### arm64 Build (26 minutes, cache miss)

- Steps #7-#16 were **CACHED**
- Steps #17-#18 had ERROR: blob not found
- Had to re-download ~1.5GB of base image layers
- GHA cache export: 750.8 seconds (12.5 minutes)
- Total job time: ~26 minutes 35 seconds

### Cache Miss Errors (arm64)

```
#17 ERROR: blob sha256:b290c07173fb382ce5cda6d6f820913d90cc12aab79b56a5ef70c52f181fb324: not found
#18 ERROR: blob sha256:3b737555cadafbf290e3405c16a63eff2fc1bde635b13f940312129fe672fc47: not found
```

### Cache Export Timing (arm64)

The slowest layers during export:

- `sha256:425b1c25...`: 185.8 seconds
- `sha256:c8765b1e...`: 155.9 seconds
- `sha256:c739f5f1...`: 50.7 seconds
