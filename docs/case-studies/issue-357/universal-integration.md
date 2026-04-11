# Universal Sentry to GitHub Issues Integration

## Purpose

This guide provides a **universal solution** for converting Sentry issues into GitHub Issues that works with:

- ✅ **Self-hosted Sentry** (on-premise deployments)
- ✅ **Cloud-hosted Sentry** (sentry.io)
- ✅ **Restricted environments** (firewall, air-gapped, limited API access)
- ✅ **All Sentry plans** (Developer, Team, Business, Enterprise)

## Why This Guide?

Many Sentry-to-GitHub integration options have limitations:

- Native Sentry GitHub integration requires Business/Enterprise plan
- Third-party platforms (Zapier, Pipedream) only work with cloud Sentry
- Webhook-based solutions require publicly accessible endpoints
- Platform-specific solutions don't work in restricted environments

This guide focuses on **API-based approaches** that work universally.

## Core Approach: Sentry API + GitHub API

The most universal approach uses direct API calls to both platforms. This works regardless of:

- Your Sentry hosting type (self-hosted or cloud)
- Your network restrictions
- Your Sentry subscription plan
- Your deployment environment

### Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Sentry API    │   ←──   │  Integration     │   ──→   │   GitHub API    │
│ (Self-hosted or │         │     Script       │         │                 │
│     Cloud)      │         │  (Node.js/Bash)  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │  State Storage   │
                            │ (File/DB/Memory) │
                            └──────────────────┘
```

## Step 1: Sentry API Authentication

### For Cloud Sentry (sentry.io)

1. **Create Auth Token:**
   - Navigate to: https://sentry.io/settings/account/api/auth-tokens/
   - Click "Create New Token"
   - Select scopes: `event:read`, `org:read`, `project:read`
   - Save token securely

2. **Test Authentication:**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://sentry.io/api/0/organizations/YOUR_ORG/
```

### For Self-Hosted Sentry

1. **Create Auth Token:**
   - Navigate to: `https://your-sentry-domain.com/settings/account/api/auth-tokens/`
   - Click "Create New Token"
   - Select scopes: `event:read`, `org:read`, `project:read`
   - Save token securely

2. **Test Authentication:**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://your-sentry-domain.com/api/0/organizations/YOUR_ORG/
```

**Key Point:** The API structure is identical for both cloud and self-hosted Sentry.

## Step 2: GitHub API Authentication

### Create Personal Access Token (Classic)

1. Navigate to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (full control of private repositories)
   - `public_repo` (for public repositories only)
4. Generate and save token

### Test Authentication

```bash
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/user
```

## Step 3: Fetch Sentry Issues

### Universal API Endpoint

```
GET {SENTRY_URL}/api/0/organizations/{organization_slug}/issues/
```

Where:

- `{SENTRY_URL}` = `https://sentry.io` for cloud, `https://your-domain.com` for self-hosted
- `{organization_slug}` = your organization identifier

### Query Parameters

| Parameter     | Description                | Example               |
| ------------- | -------------------------- | --------------------- |
| `query`       | Filter issues              | `is:unresolved`       |
| `statsPeriod` | Time range                 | `24h`, `7d`, `14d`    |
| `project`     | Filter by project ID       | `12345`               |
| `sort`        | Sort order                 | `date`, `freq`, `new` |
| `limit`       | Results per page (max 100) | `50`                  |
| `cursor`      | Pagination cursor          | From `Link` header    |

### Example: Fetch Unresolved Issues

```bash
# For Cloud Sentry
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://sentry.io/api/0/organizations/YOUR_ORG/issues/?query=is:unresolved&limit=50"

# For Self-Hosted Sentry (same API structure)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-sentry.com/api/0/organizations/YOUR_ORG/issues/?query=is:unresolved&limit=50"
```

### Response Structure

```json
[
  {
    "id": "1234567890",
    "title": "TypeError: Cannot read property 'x' of undefined",
    "culprit": "app/controllers/user.js in getUserData",
    "permalink": "https://sentry.io/organizations/org/issues/1234567890/",
    "shortId": "PROJECT-123",
    "metadata": {
      "type": "TypeError",
      "value": "Cannot read property 'x' of undefined"
    },
    "level": "error",
    "status": "unresolved",
    "count": "45",
    "userCount": 12,
    "firstSeen": "2025-10-01T10:30:00Z",
    "lastSeen": "2025-10-02T14:20:00Z",
    "project": {
      "id": "12345",
      "name": "my-project",
      "slug": "my-project"
    }
  }
]
```

## Step 4: Create GitHub Issues

### API Endpoint

```
POST https://api.github.com/repos/{owner}/{repo}/issues
```

### Example Request

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/OWNER/REPO/issues \
  -d '{
    "title": "🐛 Sentry: TypeError in getUserData",
    "body": "**Sentry Issue:** https://sentry.io/issues/1234567890/\n\n**Error Type:** TypeError\n**Message:** Cannot read property '\''x'\'' of undefined\n**Location:** app/controllers/user.js\n\n**Statistics:**\n- Events: 45\n- Users affected: 12\n- First seen: 2025-10-01T10:30:00Z\n- Last seen: 2025-10-02T14:20:00Z",
    "labels": ["sentry", "bug", "automated"]
  }'
```

### Response

```json
{
  "number": 42,
  "title": "🐛 Sentry: TypeError in getUserData",
  "html_url": "https://github.com/owner/repo/issues/42",
  "state": "open"
}
```

## Step 5: Implementation Script

### Node.js Implementation

```javascript
#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

// Configuration
const CONFIG = {
  // Works for both cloud and self-hosted
  SENTRY_URL: process.env.SENTRY_URL || 'https://sentry.io',
  SENTRY_TOKEN: process.env.SENTRY_TOKEN,
  SENTRY_ORG: process.env.SENTRY_ORG,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPO: process.env.GITHUB_REPO, // format: "owner/repo"
  STATE_FILE: process.env.STATE_FILE || './sentry-sync-state.json',
};

// State management to prevent duplicates
async function loadState() {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { synced: {} };
  }
}

async function saveState(state) {
  await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
}

// Fetch issues from Sentry (works for both cloud and self-hosted)
async function fetchSentryIssues() {
  const url = `${CONFIG.SENTRY_URL}/api/0/organizations/${CONFIG.SENTRY_ORG}/issues/`;
  const params = new URLSearchParams({
    query: 'is:unresolved',
    statsPeriod: '24h',
    limit: '50',
  });

  const response = await fetch(`${url}?${params}`, {
    headers: {
      Authorization: `Bearer ${CONFIG.SENTRY_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Create GitHub issue
async function createGitHubIssue(sentryIssue) {
  const [owner, repo] = CONFIG.GITHUB_REPO.split('/');

  const issueBody = [`**Sentry Issue:** ${sentryIssue.permalink}`, ``, `**Error Type:** ${sentryIssue.metadata?.type || 'Unknown'}`, `**Message:** ${sentryIssue.metadata?.value || sentryIssue.title}`, `**Location:** ${sentryIssue.culprit || 'Unknown'}`, ``, `**Statistics:**`, `- Events: ${sentryIssue.count}`, `- Users affected: ${sentryIssue.userCount}`, `- First seen: ${sentryIssue.firstSeen}`, `- Last seen: ${sentryIssue.lastSeen}`, ``, `**Project:** ${sentryIssue.project?.name || 'Unknown'}`, `**Short ID:** ${sentryIssue.shortId}`].join('\n');

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `🐛 Sentry: ${sentryIssue.title}`,
      body: issueBody,
      labels: ['sentry', 'bug', 'automated'],
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Main sync function
async function sync() {
  console.log('Starting Sentry → GitHub sync...');

  // Load state
  const state = await loadState();

  // Fetch Sentry issues
  console.log('Fetching issues from Sentry...');
  const sentryIssues = await fetchSentryIssues();
  console.log(`Found ${sentryIssues.length} issues`);

  // Process each issue
  let created = 0;
  let skipped = 0;

  for (const issue of sentryIssues) {
    // Skip if already synced
    if (state.synced[issue.id]) {
      skipped++;
      continue;
    }

    try {
      console.log(`Creating GitHub issue for Sentry issue ${issue.shortId}...`);
      const githubIssue = await createGitHubIssue(issue);

      // Mark as synced
      state.synced[issue.id] = {
        githubIssueNumber: githubIssue.number,
        githubIssueUrl: githubIssue.html_url,
        syncedAt: new Date().toISOString(),
      };

      created++;
      console.log(`✓ Created GitHub issue #${githubIssue.number}`);

      // Rate limiting: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`✗ Failed to create issue for ${issue.shortId}:`, error.message);
    }
  }

  // Save state
  await saveState(state);

  console.log(`\nSync complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
}

// Run
sync().catch(error => {
  console.error('Sync failed:', error);
  process.exit(1);
});
```

### Usage

```bash
# For Cloud Sentry
export SENTRY_URL="https://sentry.io"
export SENTRY_TOKEN="your-sentry-token"
export SENTRY_ORG="your-org-slug"
export GITHUB_TOKEN="your-github-token"
export GITHUB_REPO="owner/repo"

node sentry-github-sync.mjs

# For Self-Hosted Sentry (just change SENTRY_URL)
export SENTRY_URL="https://your-sentry-domain.com"
export SENTRY_TOKEN="your-sentry-token"
export SENTRY_ORG="your-org-slug"
export GITHUB_TOKEN="your-github-token"
export GITHUB_REPO="owner/repo"

node sentry-github-sync.mjs
```

## Step 6: Automation & Scheduling

### Option A: Cron Job (Linux/macOS)

Works in any environment with cron.

```bash
# Edit crontab
crontab -e

# Run every hour
0 * * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1

# Run every 6 hours
0 */6 * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1
```

### Option B: systemd Timer (Linux)

Create `/etc/systemd/system/sentry-sync.service`:

```ini
[Unit]
Description=Sync Sentry Issues to GitHub
After=network.target

[Service]
Type=oneshot
User=youruser
WorkingDirectory=/path/to/script
Environment="SENTRY_URL=https://sentry.io"
Environment="SENTRY_TOKEN=your-token"
Environment="SENTRY_ORG=your-org"
Environment="GITHUB_TOKEN=your-token"
Environment="GITHUB_REPO=owner/repo"
ExecStart=/usr/bin/node sentry-github-sync.mjs
```

Create `/etc/systemd/system/sentry-sync.timer`:

```ini
[Unit]
Description=Run Sentry sync every hour

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
sudo systemctl enable sentry-sync.timer
sudo systemctl start sentry-sync.timer
sudo systemctl status sentry-sync.timer
```

### Option C: GitHub Actions (For Cloud Environments)

Only works if your Sentry instance is accessible from GitHub Actions runners.

`.github/workflows/sentry-sync.yml`:

```yaml
name: Sync Sentry to GitHub Issues

on:
  schedule:
    # Run every 6 hours
    - cron: '0 */6 * * *'
  workflow_dispatch: # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run Sync
        env:
          SENTRY_URL: ${{ secrets.SENTRY_URL }}
          SENTRY_TOKEN: ${{ secrets.SENTRY_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPO: ${{ github.repository }}
        run: node scripts/sentry-github-sync.mjs
```

### Option D: Docker Container

Works in any environment with Docker.

`Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY sentry-github-sync.mjs .
COPY package.json .

RUN npm install

CMD ["node", "sentry-github-sync.mjs"]
```

Run with cron or scheduler:

```bash
docker build -t sentry-sync .

# Run once
docker run --rm \
  -e SENTRY_URL="https://sentry.io" \
  -e SENTRY_TOKEN="your-token" \
  -e SENTRY_ORG="your-org" \
  -e GITHUB_TOKEN="your-token" \
  -e GITHUB_REPO="owner/repo" \
  -v $(pwd)/state:/app/state \
  sentry-sync

# Schedule with cron
0 * * * * docker run --rm -e SENTRY_URL="..." sentry-sync
```

## Advanced: Filtering & Prioritization

### Filter by Issue Priority

```javascript
// Fetch only high-priority issues
const params = new URLSearchParams({
  query: 'is:unresolved issue.priority:[high,medium]',
  statsPeriod: '24h',
  limit: '50',
});
```

### Filter by Project

```javascript
// Fetch issues from specific project
const params = new URLSearchParams({
  query: 'is:unresolved',
  project: '12345', // Project ID
  statsPeriod: '24h',
});
```

### Filter by Tags

```javascript
// Fetch issues with specific tags
const params = new URLSearchParams({
  query: 'is:unresolved environment:production',
  statsPeriod: '24h',
});
```

### Custom Priority Labels

```javascript
function getPriorityLabel(sentryIssue) {
  const eventCount = parseInt(sentryIssue.count);
  const userCount = sentryIssue.userCount;

  if (eventCount > 100 || userCount > 50) return 'priority:critical';
  if (eventCount > 50 || userCount > 20) return 'priority:high';
  if (eventCount > 10 || userCount > 5) return 'priority:medium';
  return 'priority:low';
}

// Add to GitHub issue labels
labels: ['sentry', 'bug', 'automated', getPriorityLabel(sentryIssue)];
```

## Security Best Practices

### 1. Token Storage

**Never commit tokens to git:**

```bash
# .gitenv
SENTRY_TOKEN=your-token
GITHUB_TOKEN=your-token

# .gitignore
.env
.env.*
sentry-sync-state.json
```

**Use environment variables or secret management:**

```bash
# Load from .env file
export $(cat .env | xargs)

# Or use secret management (e.g., HashiCorp Vault)
export SENTRY_TOKEN=$(vault kv get -field=token secret/sentry)
```

### 2. Token Permissions

**Minimize scopes:**

- Sentry: `event:read`, `org:read`, `project:read` (no write permissions)
- GitHub: `repo` or `public_repo` only (no admin or delete permissions)

### 3. Network Security

**For self-hosted Sentry:**

- Use HTTPS for all API calls
- Verify SSL certificates
- Consider VPN or private network for internal Sentry

```javascript
// Enable SSL verification
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  // Node.js will verify SSL by default
});
```

### 4. Rate Limiting

**Respect API rate limits:**

```javascript
// Add delay between requests
await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second

// Sentry rate limits: 20,000 requests per hour (cloud)
// GitHub rate limits: 5,000 requests per hour for authenticated requests
```

### 5. Error Handling

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
        console.log(`Rate limited. Waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}
```

## Troubleshooting

### Issue: "Unauthorized" Error from Sentry

**Causes:**

- Invalid or expired auth token
- Insufficient token permissions
- Wrong organization slug

**Solutions:**

```bash
# Test token
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/

# Verify token scopes in Sentry UI
# Regenerate token if needed
```

### Issue: "Not Found" Error from Sentry

**Causes:**

- Wrong organization slug
- Wrong Sentry URL (self-hosted)
- Project doesn't exist

**Solutions:**

```bash
# List all organizations
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/

# List all projects
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/projects/
```

### Issue: GitHub API Rate Limit

**Causes:**

- Too many requests in short time
- Using unauthenticated requests

**Solutions:**

```bash
# Check rate limit status
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Add delays between requests
# Use conditional requests with ETag
```

### Issue: Duplicate Issues Created

**Causes:**

- State file not persisting
- State file corruption
- Running multiple instances simultaneously

**Solutions:**

```javascript
// Ensure state file is writable
await fs.access(CONFIG.STATE_FILE, fs.constants.W_OK);

// Use file locking for concurrent access
import lockfile from 'proper-lockfile';
await lockfile.lock(CONFIG.STATE_FILE);

// Add unique identifier to GitHub issue
// Search existing issues before creating
```

### Issue: Self-Hosted Sentry SSL Verification Failed

**Causes:**

- Self-signed SSL certificate
- Certificate not trusted by system

**Solutions:**

```javascript
// Option 1: Add certificate to system trust store (recommended)

// Option 2: Disable SSL verification (NOT recommended for production)
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false,
});

fetch(url, { agent });
```

## Performance Optimization

### 1. Pagination for Large Result Sets

```javascript
async function fetchAllSentryIssues() {
  let allIssues = [];
  let cursor = null;

  do {
    const url = new URL(`${CONFIG.SENTRY_URL}/api/0/organizations/${CONFIG.SENTRY_ORG}/issues/`);
    url.searchParams.set('query', 'is:unresolved');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${CONFIG.SENTRY_TOKEN}` },
    });

    const issues = await response.json();
    allIssues.push(...issues);

    // Get next cursor from Link header
    const linkHeader = response.headers.get('Link');
    cursor = parseLinkHeader(linkHeader)?.next?.cursor;
  } while (cursor);

  return allIssues;
}
```

### 2. Batch Processing

```javascript
// Process in batches to avoid memory issues
const BATCH_SIZE = 10;

for (let i = 0; i < issues.length; i += BATCH_SIZE) {
  const batch = issues.slice(i, i + BATCH_SIZE);

  await Promise.all(batch.map(issue => createGitHubIssue(issue)));

  // Rate limiting delay
  await new Promise(resolve => setTimeout(resolve, 5000));
}
```

### 3. Incremental Sync

```javascript
// Only fetch issues since last sync
const state = await loadState();
const lastSyncTime = state.lastSync || '24h';

const params = new URLSearchParams({
  query: 'is:unresolved',
  statsPeriod: lastSyncTime,
});

// Update last sync time
state.lastSync = new Date().toISOString();
await saveState(state);
```

## Summary

### What Works Universally

✅ **Sentry API access** - Same API for cloud and self-hosted
✅ **GitHub API access** - Works from any environment with internet
✅ **API-based sync script** - No platform dependencies
✅ **Cron/systemd scheduling** - Works on any Linux/Unix system
✅ **Docker deployment** - Portable across environments
✅ **State management** - File-based, no external dependencies

### What Has Restrictions

⚠️ **Native Sentry integration** - Requires Business/Enterprise plan
⚠️ **Third-party platforms** - Only work with cloud Sentry
⚠️ **Webhooks** - Require publicly accessible endpoints
⚠️ **GitHub Actions** - Requires GitHub-accessible Sentry instance

### Recommended Setup

**For most environments:**

1. Use the Node.js script provided above
2. Schedule with cron or systemd
3. Store state in a file
4. Monitor logs for errors

**For restricted environments:**

1. Deploy script on internal server with access to both Sentry and GitHub
2. Use environment variables for configuration
3. Run on schedule (hourly or daily)
4. No external dependencies required

## Next Steps

1. **Test the script** with your Sentry and GitHub instances
2. **Adjust filters** to match your needs (priority, project, tags)
3. **Set up scheduling** based on your environment
4. **Monitor and iterate** on the issue format and labels
5. **Consider enhancements** like bidirectional sync, auto-closing resolved issues

## References

- [Sentry API Documentation](https://docs.sentry.io/api/)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [Sentry Self-Hosted Documentation](https://develop.sentry.dev/self-hosted/)
