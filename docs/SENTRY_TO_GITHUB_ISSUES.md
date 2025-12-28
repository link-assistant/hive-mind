# Converting Sentry Issues to GitHub Issues: Comprehensive Analysis

## Overview

This document explores all available options for converting Sentry issues into GitHub Issues for the Hive Mind project. Our Sentry instance is located at https://deepassistant.sentry.io/issues.

## Solution Options

### 1. Sentry's Native GitHub Integration ⭐ Recommended for Quick Setup

#### Overview

Sentry provides a built-in GitHub integration that allows creating and linking GitHub issues directly from Sentry.

#### Features

**Manual Issue Creation:**

- Navigate to any Sentry issue
- Use "Linked Issues" section in right panel
- Click to create a new GitHub issue
- Automatically suggests assignees based on CODEOWNERS file
- Creates bidirectional link between Sentry and GitHub

**Automatic Issue Creation:**

- Configure Issue Alerts in Sentry
- Add "Create a new GitHub issue" action to alert rules
- GitHub issues created automatically when alerts trigger
- Available for Business or Enterprise plans only

#### Setup Steps

1. Navigate to Sentry Settings > Integrations
2. Select GitHub integration
3. Install the Sentry GitHub App
4. Connect your GitHub repositories
5. (Optional) Upload CODEOWNERS file for auto-assignment
6. Configure Issue Alerts for automatic creation

#### Pros

- ✅ Official integration maintained by Sentry
- ✅ Zero code required
- ✅ Bidirectional linking (Sentry ↔ GitHub)
- ✅ Auto-assignment based on CODEOWNERS
- ✅ Works with PR comments and releases
- ✅ Quick setup (5-10 minutes)

#### Cons

- ❌ Automatic creation requires Business/Enterprise plan
- ❌ Limited customization of issue format
- ❌ Manual clicks required for free plan
- ❌ Cannot bulk-convert existing issues

#### Cost

- Manual: Available on all plans (Team, Business, Enterprise)
- Automatic: Business/Enterprise plans only

#### Documentation

- https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- https://sentry.io/integrations/github/

---

### 2. Custom Implementation with Sentry API + GitHub API ⭐ Recommended for Full Control

#### Overview

Build a custom script or service using Sentry's REST API to fetch issues and GitHub's Octokit to create issues programmatically.

#### Architecture

```
Sentry API → Custom Script → GitHub API
    ↓              ↓              ↓
Fetch Issues   Transform     Create Issues
```

#### Implementation Example

**Dependencies:**

```bash
npm install @sentry/node octokit
```

**Sample Code:**

```javascript
import { Octokit } from 'octokit';

const SENTRY_API_TOKEN = process.env.SENTRY_API_TOKEN;
const SENTRY_ORG = 'link-assistant';
const SENTRY_PROJECT = 'hive-mind';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'link-assistant';
const GITHUB_REPO = 'hive-mind';

const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function fetchSentryIssues() {
  const response = await fetch(`https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved`, {
    headers: {
      Authorization: `Bearer ${SENTRY_API_TOKEN}`,
    },
  });
  return response.json();
}

async function createGitHubIssue(sentryIssue) {
  const { data } = await octokit.rest.issues.create({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title: `[Sentry] ${sentryIssue.title}`,
    body: `
## Sentry Issue

**Issue URL:** ${sentryIssue.permalink}
**Status:** ${sentryIssue.status}
**First Seen:** ${sentryIssue.firstSeen}
**Last Seen:** ${sentryIssue.lastSeen}
**Count:** ${sentryIssue.count} events
**User Count:** ${sentryIssue.userCount} users affected

## Error Details

${sentryIssue.metadata?.type || 'N/A'}: ${sentryIssue.metadata?.value || 'N/A'}

---
*Automatically created from Sentry*
    `.trim(),
    labels: ['bug', 'sentry', 'automated'],
  });
  return data;
}

async function main() {
  const sentryIssues = await fetchSentryIssues();

  for (const issue of sentryIssues) {
    try {
      const githubIssue = await createGitHubIssue(issue);
      console.log(`Created GitHub issue #${githubIssue.number} for Sentry issue ${issue.id}`);
    } catch (error) {
      console.error(`Failed to create issue for ${issue.id}:`, error);
    }
  }
}

main();
```

#### Setup Steps

1. Create Sentry Auth Token (Settings > Account > API > Auth Tokens)
2. Create GitHub Personal Access Token with `repo` scope
3. Install dependencies: `npm install octokit`
4. Create the script with authentication
5. Run manually or schedule with cron/GitHub Actions

#### Sentry API Details

**Endpoint:** `GET /api/0/projects/{org_slug}/{project_slug}/issues/`

**Authentication:** Bearer token in Authorization header

**Key Parameters:**

- `query`: Filter issues (e.g., `is:unresolved`, `is:unresolved is:for_review`)
- `statsPeriod`: Time range (`24h`, `14d`)
- `cursor`: Pagination

**Response includes:**

- Issue ID, title, status
- First seen, last seen timestamps
- Event count, user count
- Metadata (error type, value)
- Permalink to Sentry UI

#### GitHub API Details

**Endpoint:** `POST /repos/{owner}/{repo}/issues`

**Authentication:** Personal Access Token

**Parameters:**

- `title`: Issue title (required)
- `body`: Issue description (optional)
- `labels`: Array of label names
- `assignees`: Array of GitHub usernames
- `milestone`: Milestone number

#### Pros

- ✅ Full control over issue format and content
- ✅ Can bulk-convert existing issues
- ✅ Customizable filtering and transformation
- ✅ Can add custom labels, assignees, milestones
- ✅ Works with free Sentry plan
- ✅ Can be scheduled or event-driven
- ✅ Already have @sentry/node installed

#### Cons

- ❌ Requires development and maintenance
- ❌ Need to handle rate limiting
- ❌ Need to track which issues already converted
- ❌ No bidirectional sync out of the box

#### Cost

- Free (uses Sentry API + GitHub API)

#### Documentation

- Sentry API: https://docs.sentry.io/api/events/list-a-projects-issues/
- GitHub Octokit: https://github.com/octokit/octokit.js
- GitHub Issues API: https://docs.github.com/en/rest/issues/issues

---

### 3. Sentry Webhooks + Custom Service ⭐ Recommended for Real-time

#### Overview

Use Sentry's webhook integration to receive real-time notifications when issues are created or updated, then automatically create GitHub issues.

#### Architecture

```
Sentry Issue Created/Updated
         ↓
   Sentry Webhook
         ↓
   Your Web Service (Express.js)
         ↓
   GitHub API (Create Issue)
```

#### Implementation Example

**Dependencies:**

```bash
npm install express octokit
```

**Sample Code:**

```javascript
import express from 'express';
import { Octokit } from 'octokit';

const app = express();
app.use(express.json());

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

app.post('/sentry-webhook', async (req, res) => {
  const resource = req.headers['sentry-hook-resource'];
  const action = req.body.action;

  if (resource === 'issue' && action === 'created') {
    const sentryIssue = req.body.data.issue;

    await octokit.rest.issues.create({
      owner: 'link-assistant',
      repo: 'hive-mind',
      title: `[Sentry] ${sentryIssue.title}`,
      body: `
Sentry Issue: ${sentryIssue.web_url}
Status: ${sentryIssue.status}

${sentryIssue.metadata?.type}: ${sentryIssue.metadata?.value}
      `.trim(),
      labels: ['bug', 'sentry', 'automated'],
    });
  }

  res.status(200).send('OK');
});

app.listen(3000);
```

#### Webhook Payload

**Header:** `Sentry-Hook-Resource: issue`

**Actions:** `created`, `resolved`, `assigned`, `archived`, `unresolved`

**Payload includes:**

- Issue URL, project URL
- Status and substatus
- Status details (resolution info)
- Full issue metadata

#### Setup Steps

1. Create internal integration in Sentry (Settings > Custom Integrations)
2. Configure webhook URL (your public endpoint)
3. Subscribe to "Issue" events
4. Deploy webhook receiver service
5. Test with sample issues

#### Pros

- ✅ Real-time issue creation (instant)
- ✅ Event-driven, no polling needed
- ✅ Can react to status changes (resolved, reopened)
- ✅ Low resource usage
- ✅ Scalable architecture

#### Cons

- ❌ Requires hosting a web service
- ❌ Need public HTTPS endpoint
- ❌ More complex setup
- ❌ Need to handle webhook retries and failures

#### Cost

- Free (Sentry webhooks + GitHub API)
- Hosting cost for webhook service (varies)

#### Documentation

- https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/

---

### 4. Third-party Automation Platforms

#### 4.1 Pipedream ⭐ Easiest No-Code Option

**Overview:** Low-code platform with pre-built Sentry → GitHub workflows

**Features:**

- Pre-built workflow templates
- "Create GitHub Issue on New Sentry Issue Event"
- Visual workflow builder
- Built-in authentication for both services
- Serverless execution

**Setup:**

1. Sign up at https://pipedream.com
2. Choose "Sentry API" trigger: "New Issue Event (Instant)"
3. Add "GitHub API" action: "Create Issue"
4. Map fields from Sentry to GitHub
5. Deploy workflow

**Pros:**

- ✅ Zero code required
- ✅ Pre-built templates available
- ✅ Visual workflow builder
- ✅ Free tier available (100 invocations/day)
- ✅ Managed hosting included

**Cons:**

- ❌ Limited customization on free tier
- ❌ Vendor lock-in
- ❌ Usage limits on free plan

**Cost:** Free tier (100 invocations/day), Paid ($19/mo+)

**URL:** https://pipedream.com/apps/sentry/integrations/github

---

#### 4.2 n8n - Self-hosted Alternative

**Overview:** Open-source workflow automation, self-hosted

**Features:**

- Visual workflow builder
- Sentry + GitHub nodes available
- Self-hosted (full control)
- Can run on your infrastructure

**Setup:**

1. Deploy n8n (Docker/npm)
2. Create workflow with Sentry trigger
3. Add GitHub "Create Issue" node
4. Configure field mappings
5. Activate workflow

**Pros:**

- ✅ Open-source and free
- ✅ Self-hosted (data stays with you)
- ✅ Unlimited executions
- ✅ Full customization
- ✅ SOC2 compliant

**Cons:**

- ❌ Requires hosting/infrastructure
- ❌ More setup complexity
- ❌ Self-maintained

**Cost:** Free (self-hosted) or Cloud ($20/mo+)

**URL:** https://n8n.io/integrations/github/and/sentryio/

---

#### 4.3 Make.com (formerly Integromat)

**Overview:** Visual automation platform with Sentry and GitHub support

**Features:**

- Visual scenario builder
- Sentry module: retrieve issues
- GitHub module: create issues, PRs, comments
- Advanced routing and filtering

**Setup:**

1. Sign up at https://www.make.com
2. Create new scenario
3. Add Sentry module (trigger or action)
4. Add GitHub "Create Issue" module
5. Map data fields
6. Run scenario

**Pros:**

- ✅ Visual no-code builder
- ✅ Advanced features (routing, filtering)
- ✅ Free tier (1,000 operations/mo)
- ✅ Good documentation

**Cons:**

- ❌ Steeper learning curve
- ❌ Complex pricing model
- ❌ Limited operations on free tier

**Cost:** Free tier (1,000 ops/mo), Paid ($9/mo+)

**URLs:**

- Sentry: https://www.make.com/en/integrations/sentry
- GitHub: https://www.make.com/en/integrations/github

---

#### 4.4 Zapier - Most Integrations

**Overview:** Market leader in automation with 7,000+ apps

**Features:**

- Simple workflow builder (Zaps)
- Sentry integration available
- GitHub integration available
- Best for business users

**Setup:**

1. Sign up at https://zapier.com
2. Create new Zap
3. Trigger: Sentry (requires webhook setup)
4. Action: GitHub "Create Issue"
5. Map fields and enable

**Pros:**

- ✅ Easiest for non-technical users
- ✅ Most mature platform
- ✅ Extensive app ecosystem
- ✅ Great support and docs

**Cons:**

- ❌ More expensive
- ❌ Limited Sentry integration
- ❌ Free tier very limited (100 tasks/mo)

**Cost:** Free tier (100 tasks/mo), Paid ($19.99/mo+)

---

### 5. GitHub Actions Custom Workflow

#### Overview

Create a scheduled GitHub Action that polls Sentry API and creates issues

#### Implementation Example

**.github/workflows/sentry-sync.yml:**

```yaml
name: Sync Sentry Issues to GitHub

on:
  schedule:
    - cron: '0 */6 * * *' # Every 6 hours
  workflow_dispatch: # Manual trigger

jobs:
  sync-issues:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install octokit

      - name: Sync Sentry Issues
        env:
          SENTRY_API_TOKEN: ${{ secrets.SENTRY_API_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/sync-sentry-issues.js
```

**scripts/sync-sentry-issues.js:**

```javascript
import { Octokit } from 'octokit';
import fs from 'fs';

const SYNCED_ISSUES_FILE = 'synced-sentry-issues.json';

async function main() {
  const synced = fs.existsSync(SYNCED_ISSUES_FILE) ? JSON.parse(fs.readFileSync(SYNCED_ISSUES_FILE)) : {};

  const sentryIssues = await fetchSentryIssues();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  for (const issue of sentryIssues) {
    if (synced[issue.id]) continue;

    const ghIssue = await octokit.rest.issues.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: `[Sentry] ${issue.title}`,
      body: createIssueBody(issue),
      labels: ['bug', 'sentry'],
    });

    synced[issue.id] = ghIssue.data.number;
    fs.writeFileSync(SYNCED_ISSUES_FILE, JSON.stringify(synced));
  }
}

main();
```

#### Pros

- ✅ Runs automatically on schedule
- ✅ No external services needed
- ✅ Free (GitHub Actions minutes)
- ✅ Code lives in repository
- ✅ Easy to version control

#### Cons

- ❌ Polling-based (not real-time)
- ❌ Requires state management
- ❌ Limited to cron schedule
- ❌ Rate limiting considerations

#### Cost

- Free (within GitHub Actions limits)

---

## Comparison Matrix

| Solution                        | Setup Time | Cost    | Real-time | Customization | Maintenance | Best For                       |
| ------------------------------- | ---------- | ------- | --------- | ------------- | ----------- | ------------------------------ |
| **Native Integration (Manual)** | 10 min     | Free    | No        | Low           | None        | Quick setup, small teams       |
| **Native Integration (Auto)**   | 15 min     | $$      | Yes       | Low           | None        | Enterprise, automated workflow |
| **Custom Script (API)**         | 2-4 hours  | Free    | No        | High          | Medium      | Full control, bulk operations  |
| **Webhooks + Service**          | 4-8 hours  | Hosting | Yes       | High          | High        | Real-time, large scale         |
| **Pipedream**                   | 30 min     | Free/$  | Yes       | Medium        | Low         | No-code, rapid prototyping     |
| **n8n**                         | 2-3 hours  | Free\*  | Yes       | High          | Medium      | Self-hosted, data privacy      |
| **Make.com**                    | 1 hour     | Free/$  | Yes       | High          | Low         | Complex workflows              |
| **Zapier**                      | 30 min     | $$      | Yes       | Medium        | Low         | Business users, simplicity     |
| **GitHub Actions**              | 2-3 hours  | Free    | No        | High          | Medium      | CI/CD integration              |

\* Requires hosting infrastructure

---

## Recommendations

### For Immediate Use (This Week)

**→ Sentry's Native GitHub Integration (Manual)**

Start with the official integration for quick wins:

1. Install in 10 minutes
2. Test with a few issues manually
3. Evaluate if automatic version is worth upgrading plan

### For Production Use (Long-term)

**→ Custom Implementation (Sentry API + GitHub API)**

Recommended because:

1. ✅ **Already have @sentry/node dependency** - leverage existing integration
2. ✅ **Full control** - customize issue format, labels, assignment logic
3. ✅ **Can integrate with Hive Mind** - add to existing automation suite
4. ✅ **Free** - no additional subscription costs
5. ✅ **Can evolve** - start simple, add features over time
6. ✅ **Bulk operations** - can convert existing issues

**Implementation Plan:**

1. Create `scripts/sentry-to-github.mjs` script
2. Use existing Sentry credentials
3. Add to npm scripts: `"sentry:sync": "node scripts/sentry-to-github.mjs"`
4. Schedule with cron or GitHub Actions
5. (Optional) Extend to webhook-based for real-time

### For Real-time Requirements

**→ Sentry Webhooks + Custom Service**

If real-time is critical:

1. Extend custom script to webhook receiver
2. Deploy as microservice (same infrastructure as hive-mind)
3. Use existing deployment pipeline

### For No-code Quick Prototype

**→ Pipedream**

If you want to test before committing to custom code:

1. Free tier sufficient for testing
2. Can export/migrate logic later
3. Good for understanding data flow

---

## Implementation Considerations

### Deduplication

Track synced issues to avoid duplicates:

```javascript
const syncedIssues = new Map(); // sentryId -> githubIssueNumber
```

### Rate Limiting

- Sentry API: No documented limit, but be reasonable
- GitHub API: 5,000 requests/hour for authenticated requests
- Add delays between batch operations

### Issue Status Sync

Consider bidirectional sync:

- Sentry issue resolved → Close GitHub issue
- GitHub issue closed → Update Sentry issue status

### Labels and Assignment

- Add `sentry` label for filtering
- Parse error type for additional labels (e.g., `TypeError`, `network-error`)
- Use Sentry fingerprint/user data for assignment

### Error Handling

- Log failures for manual review
- Retry transient errors (network issues)
- Alert on persistent failures

---

## Next Steps

1. **Immediate:** Install Sentry GitHub integration for manual testing
2. **Week 1:** Build custom script for bulk conversion of existing issues
3. **Week 2-3:** Add scheduling (GitHub Actions or cron)
4. **Future:** Consider webhook-based real-time sync if needed

---

## References

### Sentry Documentation

- GitHub Integration: https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- API Reference: https://docs.sentry.io/api/
- List Issues: https://docs.sentry.io/api/events/list-a-projects-issues/
- Webhooks: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
- Auth Tokens: https://docs.sentry.io/api/guides/create-auth-token/

### GitHub Documentation

- REST API: https://docs.github.com/en/rest
- Octokit.js: https://github.com/octokit/octokit.js
- Create Issue: https://docs.github.com/en/rest/issues/issues#create-an-issue

### Third-party Platforms

- Pipedream: https://pipedream.com/apps/sentry/integrations/github
- n8n: https://n8n.io/integrations/github/and/sentryio/
- Make.com: https://www.make.com/en/integrations/sentry
- Zapier: https://zapier.com

### Community Resources

- Stack Overflow: https://stackoverflow.com/questions/79186277/is-there-a-github-action-to-fetch-sentry-issues-and-create-github-issues
- Sentry GitHub App: https://github.com/apps/sentry-io
