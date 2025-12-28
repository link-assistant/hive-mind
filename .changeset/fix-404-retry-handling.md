---
'@link-assistant/hive-mind': patch
---

Fix: Do not retry on 404 errors, display user-friendly permission suggestions

This fix addresses issue #808 by improving error handling when attempting to fork inaccessible repositories.

**Key improvements:**

1. **No retry on 404 errors** - 404 errors are detected immediately and fail fast, saving ~30 seconds and ~10 API requests per failure
2. **User-friendly error messages** - Comprehensive error messages explain what happened, list common causes, and provide step-by-step troubleshooting
3. **Reduced API requests** - Early 404 detection in getRootRepository and immediate exit on 404 during fork creation eliminates unnecessary retries

**Impact:**
- Time saved: ~30 seconds per failed fork attempt
- API requests saved: ~10 requests per failed fork attempt
- Better UX: Clear guidance on diagnosing and resolving repository access issues
