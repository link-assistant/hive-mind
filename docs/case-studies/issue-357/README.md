# Converting Sentry Issues to GitHub Issues - Research Report

## Overview

This document explores all available options for automatically converting Sentry issues into GitHub Issues for the `link-assistant/hive-mind` project. Our Sentry dashboard is available at: https://deepassistant.sentry.io/issues

## Current Integration Status

The project currently has Sentry integrated for error tracking:

- **Sentry SDK**: `@sentry/node` (v10.15.0) and `@sentry/profiling-node` (v10.15.0)
- **Implementation**: Comprehensive Sentry library at `src/sentry.lib.mjs` with error tracking, breadcrumbs, and performance monitoring
- **No existing GitHub issue creation automation**

## Available Options

### Option 1: Native Sentry GitHub Integration (UI-Based)

Sentry provides a built-in GitHub integration that can be configured through the Sentry web interface.

#### Features:

- **Automatic Issue Creation**: Create GitHub issues automatically via Alert Rules
- **Manual Issue Creation**: Create and link GitHub issues from the Sentry UI
- **Bidirectional Linking**: Link Sentry issues to existing GitHub issues/PRs
- **Code Ownership Integration**: Sync CODEOWNERS file for automatic assignee suggestions
- **Commit Tracking**: Automatically resolve Sentry issues when commits mention `fixes <SENTRY-SHORT-ID>`
- **PR Comments**: Automatic comments on merged PRs suspected of causing issues

#### Setup:

1. Navigate to **Settings > Integrations > GitHub** in Sentry
2. Install the GitHub integration (recommended to install from Sentry, not GitHub)
3. Configure Issue Alerts to automatically create GitHub issues
4. Set up alert rules with "Create a new GitHub issue" action

#### Limitations:

- **Requires manual UI configuration** for alert rules
- **Not programmatically controllable** - limited API access to built-in integration
- **Requires Business or Enterprise plan** for automatic issue creation
- **Team plan or higher** required for manual issue management

#### Pricing Impact:

- May require plan upgrade depending on current Sentry subscription

---

### Option 2: Custom Script Using Sentry API + GitHub API

Build a custom Node.js script that periodically fetches Sentry issues and creates corresponding GitHub issues.

#### Implementation Approach:

**Step 1: Fetch Sentry Issues**

```javascript
// Using Sentry REST API v0
const response = await fetch('https://sentry.io/api/0/organizations/{org_slug}/issues/?query=is:unresolved', {
  headers: {
    Authorization: 'Bearer <SENTRY_AUTH_TOKEN>',
  },
});
```

**Endpoint Details:**

- **URL**: `GET /api/0/organizations/{organization_id_or_slug}/issues/`
- **Authentication**: Bearer token with `event:read` scope
- **Query Parameters**:
  - `query`: Filter issues (default: `is:unresolved issue.priority:[high,medium]`)
  - `statsPeriod`: Time period (`24h`, `7d`, etc.)
  - `project`: Filter by project IDs
  - `sort`: Sort order (`date`, `new`, `freq`, `user`)
  - `limit`: Max 100 per request

**Step 2: Create GitHub Issues**

```javascript
// Using GitHub REST API
const response = await fetch('https://api.github.com/repos/{owner}/{repo}/issues', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer <GITHUB_TOKEN>',
    Accept: 'application/vnd.github+json',
  },
  body: JSON.stringify({
    title: sentryIssue.title,
    body: `**Sentry Issue:** ${sentryIssue.permalink}\n\n${sentryIssue.metadata.value}`,
    labels: ['sentry', 'bug'],
  }),
});
```

**Step 3: Track Synced Issues**

- Store mapping between Sentry issue IDs and GitHub issue numbers
- Prevent duplicate issue creation
- Options for storage:
  - Local JSON file
  - Database
  - GitHub issue labels/metadata
  - Sentry tags

#### Scheduling Options:

1. **Cron Job**: Run script periodically (e.g., every hour)
2. **GitHub Actions**: Use scheduled workflow
3. **systemd timer**: For server deployments
4. **Docker container**: With scheduler

#### Advantages:

- ✅ Full control over issue format and content
- ✅ No additional service dependencies
- ✅ Can customize filtering and priority logic
- ✅ Can add custom labels, assignees, and metadata
- ✅ Works with any Sentry plan
- ✅ Easily integrated into existing codebase

#### Disadvantages:

- ❌ Requires maintenance
- ❌ Not real-time (depends on polling interval)
- ❌ Need to handle rate limiting for both APIs
- ❌ Must implement state tracking to avoid duplicates
- ❌ Requires secure token storage

#### Implementation Estimate:

- **Initial Development**: 4-6 hours
- **Testing & Refinement**: 2-3 hours
- **Total**: 6-9 hours

---

### Option 3: Webhook-Based Automation with GitHub Actions

Use Sentry webhooks to trigger GitHub Actions workflows that create issues in real-time.

#### Architecture:

```
Sentry Issue Event → Webhook → GitHub Actions Workflow → Create GitHub Issue
```

#### Implementation Steps:

**Step 1: Create Sentry Internal Integration**

1. Go to **Settings > Developer Settings > Internal Integrations** in Sentry
2. Create new internal integration
3. Subscribe to webhook events: `issue.created`, `issue.updated`
4. Set webhook URL to GitHub Actions webhook receiver

**Step 2: Set Up GitHub Actions Webhook Receiver**

- Use repository dispatch events or webhook proxy
- Options:
  - **Webhook proxy service** (e.g., smee.io for development)
  - **Self-hosted webhook receiver**
  - **Cloud function** (AWS Lambda, Google Cloud Functions)

**Step 3: GitHub Actions Workflow**

```yaml
name: Create GitHub Issue from Sentry
on:
  repository_dispatch:
    types: [sentry-issue]

jobs:
  create-issue:
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub Issue
        uses: actions/github-script@v7
        with:
          script: |
            const sentryIssue = context.payload.client_payload;
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: sentryIssue.data.issue.title,
              body: `Sentry Issue: ${sentryIssue.data.issue.web_url}`,
              labels: ['sentry', 'automated']
            });
```

#### Webhook Payload Structure:

```json
{
  "action": "created",
  "installation": {
    "uuid": "<installation-uuid>"
  },
  "data": {
    "issue": {
      "id": "<issue-id>",
      "title": "Issue title",
      "web_url": "https://sentry.io/...",
      "project": {...},
      "metadata": {...}
    }
  },
  "actor": {
    "type": "application",
    "id": "sentry",
    "name": "Sentry"
  }
}
```

#### Advantages:

- ✅ Real-time issue creation
- ✅ Event-driven (no polling required)
- ✅ No additional infrastructure if using cloud functions
- ✅ Scalable
- ✅ Works with any Sentry plan

#### Disadvantages:

- ❌ Requires webhook endpoint setup
- ❌ More complex initial setup
- ❌ Need to handle webhook authentication and verification
- ❌ Potential webhook delivery failures require retry logic
- ❌ GitHub Actions has usage limits

#### Implementation Estimate:

- **Initial Development**: 6-8 hours
- **Testing & Deployment**: 3-4 hours
- **Total**: 9-12 hours

---

### Option 4: Third-Party Automation Platforms

Use no-code/low-code automation platforms to connect Sentry and GitHub.

#### Available Platforms:

##### **Pipedream** (Recommended for simplicity)

- **Pre-built Integration**: "Create Issue with GitHub API on New Issue Event (Instant) from Sentry API"
- **URL**: https://pipedream.com/apps/sentry/integrations/github
- **Features**:
  - Instant Sentry issue events via webhook
  - Pre-configured GitHub issue creation
  - Free tier available (runs 24/7)
  - Source-available components
  - Easy customization with Node.js

**Setup Time**: 15-30 minutes

##### **n8n** (Best for self-hosting)

- **Integration**: GitHub + Sentry.io workflow automation
- **URL**: https://n8n.io/integrations/github/and/sentryio/
- **Features**:
  - Self-hosted option (full data control)
  - Visual workflow builder
  - No coding required
  - Flexible trigger and action configuration
  - Free and open-source

**Setup Time**: 30-60 minutes (plus hosting setup if self-hosted)

##### **Zapier**

- **Status**: No native Sentry integration (must use webhooks)
- **Limitations**: Requires manual webhook configuration
- **Pricing**: Paid plans required for premium features

**Not recommended due to lack of native support**

##### **Make** (formerly Integromat)

- **Integration**: Available but requires manual setup
- **Features**: Visual workflow design
- **Pricing**: Free tier available with limitations

**Setup Time**: 45-60 minutes

#### Comparison Matrix:

| Platform  | Setup Time | Cost       | Self-Hosted | Ease of Use | Recommendation               |
| --------- | ---------- | ---------- | ----------- | ----------- | ---------------------------- |
| Pipedream | 15-30 min  | Free tier  | No          | ⭐⭐⭐⭐⭐  | ✅ Best for quick setup      |
| n8n       | 30-60 min  | Free (OSS) | Yes         | ⭐⭐⭐⭐    | ✅ Best for data privacy     |
| Make      | 45-60 min  | Paid       | No          | ⭐⭐⭐⭐    | ⚠️ Consider if already using |
| Zapier    | 60+ min    | Paid       | No          | ⭐⭐⭐      | ❌ Not recommended           |

#### Advantages:

- ✅ Fastest time to deployment (especially Pipedream)
- ✅ No code/minimal code required
- ✅ Built-in error handling and retry logic
- ✅ Visual workflow management
- ✅ Easy to modify and test
- ✅ Free tiers available

#### Disadvantages:

- ❌ External service dependency
- ❌ May have usage limits on free tiers
- ❌ Less control over implementation details
- ❌ Vendor lock-in (except n8n)
- ❌ Data flows through third-party servers (except self-hosted n8n)

---

## Recommended Approach

### For Immediate Implementation: **Pipedream**

**Why:**

1. ✅ Fastest setup (15-30 minutes)
2. ✅ Pre-built integration ready to use
3. ✅ Free tier sufficient for most use cases
4. ✅ No infrastructure to maintain
5. ✅ Easy to test and iterate

**Setup Steps:**

1. Sign up for Pipedream account
2. Navigate to https://pipedream.com/apps/sentry/integrations/github
3. Click "Create Issue with GitHub API on New Issue Event (Instant) from Sentry API"
4. Connect Sentry account (will create webhook automatically)
5. Connect GitHub account
6. Configure repository and issue template
7. Test and deploy

### For Long-Term Flexibility: **Custom Script (Option 2)**

**Why:**

1. ✅ Full control and customization
2. ✅ No external dependencies
3. ✅ Can integrate with existing codebase
4. ✅ Easy to extend with additional features
5. ✅ No vendor lock-in

**Implementation Path:**

1. Create script in `scripts/sentry-to-github.mjs`
2. Add configuration file for issue mapping rules
3. Implement GitHub Actions workflow for scheduling
4. Add state tracking (JSON file or GitHub labels)
5. Add comprehensive error handling and logging
6. Document usage and configuration

**Example File Structure:**

```
scripts/
  sentry-to-github.mjs          # Main script
  sentry-github-config.json     # Configuration
  sentry-sync-state.json        # State tracking (gitignored)
.github/
  workflows/
    sentry-sync.yml             # Scheduled workflow
```

### For Enterprise/Privacy Requirements: **Self-Hosted n8n**

**Why:**

1. ✅ Full data control (self-hosted)
2. ✅ Visual workflow management
3. ✅ No external data sharing
4. ✅ Free and open-source
5. ✅ Extensible with custom nodes

---

## Implementation Roadmap

### Phase 1: Quick Win (1-2 days)

1. Set up Pipedream integration for immediate issue sync
2. Test with a subset of Sentry issues
3. Refine GitHub issue template and labels
4. Document the process

### Phase 2: Custom Solution (1-2 weeks)

1. Develop custom script with full feature set
2. Implement comprehensive state tracking
3. Add filtering rules (priority, project, etc.)
4. Set up GitHub Actions scheduling
5. Add monitoring and alerting
6. Migrate from Pipedream to custom solution

### Phase 3: Optimization (Ongoing)

1. Add ML-based issue deduplication
2. Implement automatic assignee detection based on stack traces
3. Add issue lifecycle management (auto-close when Sentry issue resolved)
4. Create dashboard for sync statistics
5. Add support for bidirectional sync

---

## API Reference

### Sentry API

**List Organization Issues:**

```
GET https://sentry.io/api/0/organizations/{org_slug}/issues/
Authorization: Bearer <token>
```

**Query Parameters:**

- `query`: Filter query (e.g., `is:unresolved issue.priority:high`)
- `statsPeriod`: Time period (`24h`, `7d`, `14d`)
- `project`: Project IDs to filter
- `sort`: Sort order (`date`, `new`, `freq`, `user`)
- `limit`: Max 100 results

**Response:**

```json
[
  {
    "id": "issue-id",
    "title": "Error title",
    "permalink": "https://sentry.io/organizations/.../issues/...",
    "project": {
      "name": "Project Name",
      "slug": "project-slug"
    },
    "status": "unresolved",
    "level": "error",
    "count": 42,
    "userCount": 10,
    "firstSeen": "2025-10-01T00:00:00Z",
    "lastSeen": "2025-10-01T12:00:00Z"
  }
]
```

### GitHub API

**Create Issue:**

```
POST https://api.github.com/repos/{owner}/{repo}/issues
Authorization: Bearer <token>
Accept: application/vnd.github+json
```

**Request Body:**

```json
{
  "title": "Issue title",
  "body": "Issue description with Sentry link",
  "labels": ["bug", "sentry"],
  "assignees": ["username"]
}
```

**Response:**

```json
{
  "id": 123,
  "number": 456,
  "state": "open",
  "title": "Issue title",
  "html_url": "https://github.com/owner/repo/issues/456"
}
```

---

## Security Considerations

### Authentication Tokens

1. **Sentry Auth Token**: Create with minimal scopes (`event:read`)
2. **GitHub Token**: Use fine-grained PAT with `issues:write` permission
3. **Storage**: Use environment variables or secure secret management
4. **Rotation**: Implement token rotation policy

### Webhook Security

1. **Signature Verification**: Validate webhook signatures from Sentry
2. **HTTPS Only**: Always use HTTPS for webhook endpoints
3. **IP Allowlisting**: Restrict webhook sources to Sentry IPs if possible
4. **Rate Limiting**: Implement rate limiting on webhook endpoints

### Data Privacy

1. **PII Handling**: Be cautious with stack traces containing sensitive data
2. **Error Messages**: Sanitize error messages before creating GitHub issues
3. **Access Control**: Ensure GitHub repository has appropriate access restrictions
4. **Compliance**: Consider GDPR/privacy requirements for error data

---

## Cost Analysis

### Option 1: Native Sentry Integration

- **Cost**: Depends on Sentry plan (may require upgrade)
- **Business Plan**: Starting at $80/month
- **Setup**: Free
- **Maintenance**: Minimal

### Option 2: Custom Script

- **Development**: 6-9 hours (one-time)
- **Infrastructure**: Free (using GitHub Actions)
- **Maintenance**: ~2-4 hours/month
- **Total First Year**: ~$0 (assuming internal development)

### Option 3: Webhook + GitHub Actions

- **Development**: 9-12 hours (one-time)
- **Infrastructure**: Free (within GitHub Actions limits)
- **Maintenance**: ~1-2 hours/month
- **Total First Year**: ~$0 (assuming internal development)

### Option 4: Third-Party Platforms

**Pipedream:**

- **Free Tier**: 100K credits/month (sufficient for most use cases)
- **Paid Tier**: $19/month for 1M credits
- **Setup**: Free
- **Maintenance**: Minimal

**n8n (Cloud):**

- **Starter**: $20/month
- **Pro**: $50/month

**n8n (Self-Hosted):**

- **Software**: Free (open-source)
- **Infrastructure**: ~$5-20/month (small VPS)
- **Setup**: 2-4 hours
- **Maintenance**: ~2-3 hours/month

---

## Monitoring and Maintenance

### Key Metrics to Track

1. **Sync Success Rate**: Percentage of Sentry issues successfully converted
2. **Sync Latency**: Time between Sentry issue creation and GitHub issue creation
3. **Duplicate Rate**: Percentage of duplicate issues created
4. **API Rate Limits**: Monitor both Sentry and GitHub API usage
5. **Error Rate**: Failed syncs due to API errors or validation issues

### Recommended Monitoring Tools

1. **Logging**: Use structured logging (JSON format)
2. **Alerting**: Set up alerts for sync failures
3. **Dashboard**: Create status dashboard for sync health
4. **Metrics**: Track using existing Sentry integration for the script itself

---

## Conclusion

For the `hive-mind` project, we recommend a **two-phase approach**:

1. **Immediate (Week 1)**: Deploy **Pipedream** integration for quick wins
   - Get immediate value from automated issue creation
   - Validate the workflow and issue format
   - Gather feedback from team

2. **Long-term (Month 1-2)**: Develop **custom script** for full control
   - Build tailored solution with advanced features
   - Integrate deeply with existing codebase
   - Eliminate external dependencies
   - Migrate away from Pipedream

This approach balances time-to-value with long-term sustainability and control.

---

## Next Steps

1. ✅ Review this document with team
2. ⬜ Decide on approach (recommend: Pipedream → Custom Script)
3. ⬜ If Pipedream: Set up integration and test (ETA: 1 hour)
4. ⬜ If custom script: Create implementation plan (ETA: 1 day)
5. ⬜ Document final solution in project README
6. ⬜ Set up monitoring and alerting
7. ⬜ Schedule regular review of sync effectiveness

---

## References

- [Sentry GitHub Integration Docs](https://docs.sentry.io/organization/integrations/source-code-mgmt/github/)
- [Sentry API Reference](https://docs.sentry.io/api/)
- [Sentry Webhooks Documentation](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/)
- [GitHub REST API - Issues](https://docs.github.com/en/rest/issues/issues)
- [Pipedream Sentry-GitHub Integration](https://pipedream.com/apps/sentry/integrations/github)
- [n8n Sentry Integration](https://n8n.io/integrations/sentryio/)
- [Sentry Integration Platform](https://docs.sentry.io/organization/integrations/integration-platform/)

---

_Report generated: 2025-10-01_
_Author: AI Issue Solver_
_Issue: #357_
