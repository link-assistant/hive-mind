# Universal Sentry से GitHub Issues Integration (languages: [en](sentry-github-universal-integration.md) • [zh](sentry-github-universal-integration.zh.md) • hi • [ru](sentry-github-universal-integration.ru.md))

## उद्देश्य

यह guide Sentry issues को GitHub Issues में बदलने के लिए एक **universal solution** प्रदान करती है जो इनके साथ काम करती है:

- ✅ **Self-hosted Sentry** (on-premise deployments)
- ✅ **Cloud-hosted Sentry** (sentry.io)
- ✅ **प्रतिबंधित environments** (firewall, air-gapped, limited API access)
- ✅ **सभी Sentry plans** (Developer, Team, Business, Enterprise)

## यह Guide क्यों?

कई Sentry-to-GitHub integration options में सीमाएं हैं:

- Native Sentry GitHub integration के लिए Business/Enterprise plan आवश्यक है
- Third-party platforms (Zapier, Pipedream) केवल cloud Sentry के साथ काम करते हैं
- Webhook-based solutions के लिए publicly accessible endpoints आवश्यक हैं
- Platform-specific solutions प्रतिबंधित environments में काम नहीं करते

यह guide **API-based approaches** पर focus करती है जो universally काम करती हैं।

## Core Approach: Sentry API + GitHub API

सबसे universal approach दोनों platforms पर direct API calls का उपयोग करती है। यह इससे स्वतंत्र काम करती है:

- आपका Sentry hosting प्रकार (self-hosted या cloud)
- आपके network restrictions
- आपकी Sentry subscription plan
- आपका deployment environment

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

## चरण 1: Sentry API Authentication

### Cloud Sentry (sentry.io) के लिए

1. **Auth Token बनाएं:**
   - Navigate करें: https://sentry.io/settings/account/api/auth-tokens/
   - "Create New Token" click करें
   - Scopes चुनें: `event:read`, `org:read`, `project:read`
   - Token सुरक्षित रूप से save करें

2. **Authentication परीक्षण:**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://sentry.io/api/0/organizations/YOUR_ORG/
```

### Self-Hosted Sentry के लिए

1. **Auth Token बनाएं:**
   - Navigate करें: `https://your-sentry-domain.com/settings/account/api/auth-tokens/`
   - "Create New Token" click करें
   - Scopes चुनें: `event:read`, `org:read`, `project:read`
   - Token सुरक्षित रूप से save करें

2. **Authentication परीक्षण:**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://your-sentry-domain.com/api/0/organizations/YOUR_ORG/
```

**मुख्य बात:** Cloud और self-hosted Sentry दोनों के लिए API structure समान है।

## चरण 2: GitHub API Authentication

### Personal Access Token (Classic) बनाएं

1. Navigate करें: https://github.com/settings/tokens
2. "Generate new token (classic)" click करें
3. Scopes चुनें:
   - `repo` (private repositories पर पूर्ण नियंत्रण)
   - `public_repo` (केवल public repositories के लिए)
4. Token generate और save करें

### Authentication परीक्षण

```bash
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/user
```

## चरण 3: Sentry Issues Fetch करें

### Universal API Endpoint

```
GET {SENTRY_URL}/api/0/organizations/{organization_slug}/issues/
```

जहां:

- `{SENTRY_URL}` = cloud के लिए `https://sentry.io`, self-hosted के लिए `https://your-domain.com`
- `{organization_slug}` = आपका organization identifier

### Query Parameters

| Parameter     | विवरण                | उदाहरण               |
| ------------- | -------------------------- | --------------------- |
| `query`       | Issues filter करें              | `is:unresolved`       |
| `statsPeriod` | समय सीमा                 | `24h`, `7d`, `14d`    |
| `project`     | Project ID से filter करें       | `12345`               |
| `sort`        | Sort order                 | `date`, `freq`, `new` |
| `limit`       | प्रति page परिणाम (max 100) | `50`                  |
| `cursor`      | Pagination cursor          | `Link` header से    |

### उदाहरण: Unresolved Issues Fetch करें

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

## चरण 4: GitHub Issues बनाएं

### API Endpoint

```
POST https://api.github.com/repos/{owner}/{repo}/issues
```

### उदाहरण Request

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

## चरण 5: Implementation Script

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

### उपयोग

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

## चरण 6: Automation & Scheduling

### विकल्प A: Cron Job (Linux/macOS)

Cron के साथ किसी भी environment में काम करता है।

```bash
# Edit crontab
crontab -e

# Run every hour
0 * * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1

# Run every 6 hours
0 */6 * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1
```

### विकल्प B: systemd Timer (Linux)

`/etc/systemd/system/sentry-sync.service` बनाएं:

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

`/etc/systemd/system/sentry-sync.timer` बनाएं:

```ini
[Unit]
Description=Run Sentry sync every hour

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable और start करें:

```bash
sudo systemctl enable sentry-sync.timer
sudo systemctl start sentry-sync.timer
sudo systemctl status sentry-sync.timer
```

### विकल्प C: GitHub Actions (Cloud Environments के लिए)

केवल तभी काम करता है जब आपका Sentry instance GitHub Actions runners से accessible हो।

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

### विकल्प D: Docker Container

Docker के साथ किसी भी environment में काम करता है।

`Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY sentry-github-sync.mjs .
COPY package.json .

RUN npm install

CMD ["node", "sentry-github-sync.mjs"]
```

Cron या scheduler के साथ चलाएं:

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

### Issue Priority से Filter करें

```javascript
// Fetch only high-priority issues
const params = new URLSearchParams({
  query: 'is:unresolved issue.priority:[high,medium]',
  statsPeriod: '24h',
  limit: '50',
});
```

### Project से Filter करें

```javascript
// Fetch issues from specific project
const params = new URLSearchParams({
  query: 'is:unresolved',
  project: '12345', // Project ID
  statsPeriod: '24h',
});
```

### Tags से Filter करें

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

**कभी भी tokens को git में commit न करें:**

```bash
# .gitenv
SENTRY_TOKEN=your-token
GITHUB_TOKEN=your-token

# .gitignore
.env
.env.*
sentry-sync-state.json
```

**Environment variables या secret management उपयोग करें:**

```bash
# Load from .env file
export $(cat .env | xargs)

# Or use secret management (e.g., HashiCorp Vault)
export SENTRY_TOKEN=$(vault kv get -field=token secret/sentry)
```

### 2. Token Permissions

**Scopes minimize करें:**

- Sentry: `event:read`, `org:read`, `project:read` (कोई write permissions नहीं)
- GitHub: केवल `repo` या `public_repo` (कोई admin या delete permissions नहीं)

### 3. Network Security

**Self-hosted Sentry के लिए:**

- सभी API calls के लिए HTTPS उपयोग करें
- SSL certificates verify करें
- Internal Sentry के लिए VPN या private network पर विचार करें

```javascript
// Enable SSL verification
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  // Node.js will verify SSL by default
});
```

### 4. Rate Limiting

**API rate limits का सम्मान करें:**

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

## समस्या निवारण

### समस्या: Sentry से "Unauthorized" Error

**कारण:**

- Invalid या expired auth token
- अपर्याप्त token permissions
- गलत organization slug

**समाधान:**

```bash
# Test token
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/

# Verify token scopes in Sentry UI
# Regenerate token if needed
```

### समस्या: Sentry से "Not Found" Error

**कारण:**

- गलत organization slug
- गलत Sentry URL (self-hosted)
- Project exist नहीं करता

**समाधान:**

```bash
# List all organizations
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/

# List all projects
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/projects/
```

### समस्या: GitHub API Rate Limit

**कारण:**

- कम समय में बहुत अधिक requests
- Unauthenticated requests का उपयोग

**समाधान:**

```bash
# Check rate limit status
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Add delays between requests
# Use conditional requests with ETag
```

### समस्या: Duplicate Issues बन गए

**कारण:**

- State file persist नहीं हो रही
- State file corruption
- एक साथ कई instances चल रहे

**समाधान:**

```javascript
// Ensure state file is writable
await fs.access(CONFIG.STATE_FILE, fs.constants.W_OK);

// Use file locking for concurrent access
import lockfile from 'proper-lockfile';
await lockfile.lock(CONFIG.STATE_FILE);

// Add unique identifier to GitHub issue
// Search existing issues before creating
```

### समस्या: Self-Hosted Sentry SSL Verification Failed

**कारण:**

- Self-signed SSL certificate
- Certificate system द्वारा trusted नहीं

**समाधान:**

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

### 1. बड़े Result Sets के लिए Pagination

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

## सारांश

### क्या Universally काम करता है

✅ **Sentry API access** - Cloud और self-hosted दोनों के लिए समान API
✅ **GitHub API access** - Internet वाले किसी भी environment से काम करता है
✅ **API-based sync script** - कोई platform dependencies नहीं
✅ **Cron/systemd scheduling** - किसी भी Linux/Unix system पर काम करता है
✅ **Docker deployment** - Environments में portable
✅ **State management** - File-based, कोई external dependencies नहीं

### किसमें प्रतिबंध हैं

⚠️ **Native Sentry integration** - Business/Enterprise plan आवश्यक है
⚠️ **Third-party platforms** - केवल cloud Sentry के साथ काम करते हैं
⚠️ **Webhooks** - Publicly accessible endpoints आवश्यक हैं
⚠️ **GitHub Actions** - GitHub-accessible Sentry instance आवश्यक है

### अनुशंसित सेटअप

**अधिकांश environments के लिए:**

1. ऊपर दिए गए Node.js script का उपयोग करें
2. Cron या systemd के साथ schedule करें
3. State को एक file में store करें
4. Errors के लिए logs monitor करें

**प्रतिबंधित environments के लिए:**

1. Sentry और GitHub दोनों तक access वाले internal server पर script deploy करें
2. Configuration के लिए environment variables उपयोग करें
3. Schedule पर चलाएं (hourly या daily)
4. कोई external dependencies आवश्यक नहीं

## अगले कदम

1. **Script का परीक्षण करें** अपने Sentry और GitHub instances के साथ
2. **Filters adjust करें** अपनी जरूरतों के अनुसार (priority, project, tags)
3. **Scheduling सेट करें** अपने environment के आधार पर
4. **Monitor और iterate करें** issue format और labels पर
5. **Enhancements पर विचार करें** जैसे bidirectional sync, resolved issues auto-closing

## संदर्भ

- [Sentry API Documentation](https://docs.sentry.io/api/)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [Sentry Self-Hosted Documentation](https://develop.sentry.dev/self-hosted/)
