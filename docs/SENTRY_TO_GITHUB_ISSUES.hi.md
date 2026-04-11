# Sentry Issues को GitHub Issues में बदलना: व्यापक विश्लेषण (languages: [en](SENTRY_TO_GITHUB_ISSUES.md) • [zh](SENTRY_TO_GITHUB_ISSUES.zh.md) • hi • [ru](SENTRY_TO_GITHUB_ISSUES.ru.md))

## अवलोकन

यह दस्तावेज़ Hive Mind प्रोजेक्ट के लिए Sentry issues को GitHub Issues में बदलने के सभी उपलब्ध विकल्पों की खोज करता है। हमारा Sentry instance https://deepassistant.sentry.io/issues पर स्थित है।

## समाधान विकल्प

### 1. Sentry का Native GitHub Integration ⭐ त्वरित सेटअप के लिए अनुशंसित

#### अवलोकन

Sentry एक built-in GitHub integration प्रदान करता है जो Sentry से सीधे GitHub issues बनाने और लिंक करने की अनुमति देता है।

#### विशेषताएं

**Manual Issue निर्माण:**

- किसी भी Sentry issue पर जाएं
- दाएं panel में "Linked Issues" अनुभाग का उपयोग करें
- नया GitHub issue बनाने के लिए क्लिक करें
- CODEOWNERS फ़ाइल के आधार पर स्वचालित रूप से assignees सुझाता है
- Sentry और GitHub के बीच द्विदिशीय लिंक बनाता है

**Automatic Issue निर्माण:**

- Sentry में Issue Alerts कॉन्फ़िगर करें
- Alert rules में "Create a new GitHub issue" action जोड़ें
- Alerts trigger होने पर GitHub issues स्वचालित रूप से बनाए जाते हैं
- केवल Business या Enterprise plans के लिए उपलब्ध

#### सेटअप चरण

1. Sentry Settings > Integrations पर जाएं
2. GitHub integration चुनें
3. Sentry GitHub App install करें
4. अपनी GitHub repositories कनेक्ट करें
5. (वैकल्पिक) स्वतः-असाइनमेंट के लिए CODEOWNERS फ़ाइल अपलोड करें
6. स्वचालित निर्माण के लिए Issue Alerts कॉन्फ़िगर करें

#### फायदे

- ✅ Sentry द्वारा अनुरक्षित आधिकारिक integration
- ✅ कोई कोड आवश्यक नहीं
- ✅ द्विदिशीय लिंकिंग (Sentry ↔ GitHub)
- ✅ CODEOWNERS के आधार पर स्वतः-असाइनमेंट
- ✅ PR comments और releases के साथ काम करता है
- ✅ त्वरित सेटअप (5-10 मिनट)

#### नुकसान

- ❌ Automatic निर्माण के लिए Business/Enterprise plan आवश्यक
- ❌ Issue format का सीमित अनुकूलन
- ❌ Free plan के लिए manual clicks आवश्यक
- ❌ मौजूदा issues को bulk-convert नहीं कर सकता

#### लागत

- Manual: सभी plans पर उपलब्ध (Team, Business, Enterprise)
- Automatic: केवल Business/Enterprise plans

#### दस्तावेज़ीकरण

- https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- https://sentry.io/integrations/github/

---

### 2. Sentry API + GitHub API के साथ Custom Implementation ⭐ पूर्ण नियंत्रण के लिए अनुशंसित

#### अवलोकन

Sentry के REST API का उपयोग करके issues fetch करने और GitHub के Octokit का उपयोग करके programmatically issues बनाने के लिए एक custom script या service बनाएं।

#### आर्किटेक्चर

```
Sentry API → Custom Script → GitHub API
    ↓              ↓              ↓
Fetch Issues   Transform     Create Issues
```

#### Implementation उदाहरण

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

#### सेटअप चरण

1. Sentry Auth Token बनाएं (Settings > Account > API > Auth Tokens)
2. `repo` scope के साथ GitHub Personal Access Token बनाएं
3. Dependencies install करें: `npm install octokit`
4. Authentication के साथ script बनाएं
5. Manually चलाएं या cron/GitHub Actions के साथ schedule करें

#### Sentry API विवरण

**Endpoint:** `GET /api/0/projects/{org_slug}/{project_slug}/issues/`

**Authentication:** Authorization header में Bearer token

**मुख्य Parameters:**

- `query`: Issues filter करें (जैसे, `is:unresolved`, `is:unresolved is:for_review`)
- `statsPeriod`: समय सीमा (`24h`, `14d`)
- `cursor`: Pagination

**Response में शामिल है:**

- Issue ID, title, status
- First seen, last seen timestamps
- Event count, user count
- Metadata (error type, value)
- Sentry UI का Permalink

#### GitHub API विवरण

**Endpoint:** `POST /repos/{owner}/{repo}/issues`

**Authentication:** Personal Access Token

**Parameters:**

- `title`: Issue title (आवश्यक)
- `body`: Issue description (वैकल्पिक)
- `labels`: Label names की array
- `assignees`: GitHub usernames की array
- `milestone`: Milestone number

#### फायदे

- ✅ Issue format और content पर पूर्ण नियंत्रण
- ✅ मौजूदा issues को bulk-convert कर सकता है
- ✅ अनुकूलन योग्य filtering और transformation
- ✅ Custom labels, assignees, milestones जोड़ सकता है
- ✅ Free Sentry plan के साथ काम करता है
- ✅ Schedule किया जा सकता है या event-driven हो सकता है
- ✅ पहले से @sentry/node install है

#### नुकसान

- ❌ विकास और रखरखाव की आवश्यकता है
- ❌ Rate limiting संभालनी होगी
- ❌ यह ट्रैक करना होगा कि कौन से issues पहले से convert हो चुके हैं
- ❌ Box से बाहर द्विदिशीय sync नहीं

#### लागत

- मुफ़्त (Sentry API + GitHub API उपयोग करता है)

#### दस्तावेज़ीकरण

- Sentry API: https://docs.sentry.io/api/events/list-a-projects-issues/
- GitHub Octokit: https://github.com/octokit/octokit.js
- GitHub Issues API: https://docs.github.com/en/rest/issues/issues

---

### 3. Sentry Webhooks + Custom Service ⭐ Real-time के लिए अनुशंसित

#### अवलोकन

Sentry के webhook integration का उपयोग करके issues बनाने या अपडेट होने पर real-time notifications प्राप्त करें, फिर स्वचालित रूप से GitHub issues बनाएं।

#### आर्किटेक्चर

```
Sentry Issue Created/Updated
         ↓
   Sentry Webhook
         ↓
   Your Web Service (Express.js)
         ↓
   GitHub API (Create Issue)
```

#### Implementation उदाहरण

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

**Payload में शामिल है:**

- Issue URL, project URL
- Status और substatus
- Status details (resolution info)
- Full issue metadata

#### सेटअप चरण

1. Sentry में internal integration बनाएं (Settings > Custom Integrations)
2. Webhook URL कॉन्फ़िगर करें (आपका public endpoint)
3. "Issue" events subscribe करें
4. Webhook receiver service deploy करें
5. Sample issues के साथ परीक्षण करें

#### फायदे

- ✅ Real-time issue निर्माण (तत्काल)
- ✅ Event-driven, polling की आवश्यकता नहीं
- ✅ Status changes पर प्रतिक्रिया कर सकता है (resolved, reopened)
- ✅ कम resource उपयोग
- ✅ Scalable आर्किटेक्चर

#### नुकसान

- ❌ Web service hosting की आवश्यकता है
- ❌ Public HTTPS endpoint चाहिए
- ❌ अधिक जटिल सेटअप
- ❌ Webhook retries और failures संभालने की आवश्यकता है

#### लागत

- मुफ़्त (Sentry webhooks + GitHub API)
- Webhook service के लिए hosting लागत (अलग-अलग)

#### दस्तावेज़ीकरण

- https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/

---

### 4. Third-party Automation Platforms

#### 4.1 Pipedream ⭐ सबसे आसान No-Code विकल्प

**अवलोकन:** Pre-built Sentry → GitHub workflows वाला Low-code platform

**विशेषताएं:**

- Pre-built workflow templates
- "Create GitHub Issue on New Sentry Issue Event"
- Visual workflow builder
- दोनों services के लिए Built-in authentication
- Serverless execution

**सेटअप:**

1. https://pipedream.com पर साइन अप करें
2. "Sentry API" trigger चुनें: "New Issue Event (Instant)"
3. "GitHub API" action जोड़ें: "Create Issue"
4. Sentry से GitHub तक fields map करें
5. Workflow deploy करें

**फायदे:**

- ✅ कोई कोड आवश्यक नहीं
- ✅ Pre-built templates उपलब्ध
- ✅ Visual workflow builder
- ✅ Free tier उपलब्ध (100 invocations/day)
- ✅ Managed hosting शामिल

**नुकसान:**

- ❌ Free tier पर सीमित अनुकूलन
- ❌ Vendor lock-in
- ❌ Free plan पर उपयोग सीमाएं

**लागत:** Free tier (100 invocations/day), Paid ($19/mo+)

**URL:** https://pipedream.com/apps/sentry/integrations/github

---

#### 4.2 n8n - Self-hosted विकल्प

**अवलोकन:** Open-source workflow automation, self-hosted

**विशेषताएं:**

- Visual workflow builder
- Sentry + GitHub nodes उपलब्ध
- Self-hosted (पूर्ण नियंत्रण)
- आपके infrastructure पर चल सकता है

**सेटअप:**

1. n8n deploy करें (Docker/npm)
2. Sentry trigger के साथ workflow बनाएं
3. GitHub "Create Issue" node जोड़ें
4. Field mappings कॉन्फ़िगर करें
5. Workflow सक्रिय करें

**फायदे:**

- ✅ Open-source और मुफ़्त
- ✅ Self-hosted (data आपके पास रहता है)
- ✅ असीमित executions
- ✅ पूर्ण अनुकूलन
- ✅ SOC2 compliant

**नुकसान:**

- ❌ Hosting/infrastructure की आवश्यकता है
- ❌ अधिक सेटअप जटिलता
- ❌ Self-maintained

**लागत:** मुफ़्त (self-hosted) या Cloud ($20/mo+)

**URL:** https://n8n.io/integrations/github/and/sentryio/

---

#### 4.3 Make.com (पूर्व में Integromat)

**अवलोकन:** Sentry और GitHub support के साथ Visual automation platform

**विशेषताएं:**

- Visual scenario builder
- Sentry module: issues retrieve करें
- GitHub module: issues, PRs, comments बनाएं
- Advanced routing और filtering

**सेटअप:**

1. https://www.make.com पर साइन अप करें
2. नया scenario बनाएं
3. Sentry module जोड़ें (trigger या action)
4. GitHub "Create Issue" module जोड़ें
5. Data fields map करें
6. Scenario चलाएं

**फायदे:**

- ✅ Visual no-code builder
- ✅ Advanced features (routing, filtering)
- ✅ Free tier (1,000 operations/mo)
- ✅ अच्छा दस्तावेज़ीकरण

**नुकसान:**

- ❌ अधिक सीखने की आवश्यकता
- ❌ जटिल pricing model
- ❌ Free tier पर सीमित operations

**लागत:** Free tier (1,000 ops/mo), Paid ($9/mo+)

**URLs:**

- Sentry: https://www.make.com/en/integrations/sentry
- GitHub: https://www.make.com/en/integrations/github

---

#### 4.4 Zapier - सर्वाधिक Integrations

**अवलोकन:** 7,000+ apps के साथ automation में market leader

**विशेषताएं:**

- Simple workflow builder (Zaps)
- Sentry integration उपलब्ध
- GitHub integration उपलब्ध
- Business users के लिए सर्वश्रेष्ठ

**सेटअप:**

1. https://zapier.com पर साइन अप करें
2. नया Zap बनाएं
3. Trigger: Sentry (webhook सेटअप की आवश्यकता है)
4. Action: GitHub "Create Issue"
5. Fields map करें और enable करें

**फायदे:**

- ✅ Non-technical users के लिए सबसे आसान
- ✅ सबसे mature platform
- ✅ व्यापक app ecosystem
- ✅ बेहतरीन support और docs

**नुकसान:**

- ❌ अधिक महंगा
- ❌ सीमित Sentry integration
- ❌ Free tier बहुत सीमित (100 tasks/mo)

**लागत:** Free tier (100 tasks/mo), Paid ($19.99/mo+)

---

### 5. GitHub Actions Custom Workflow

#### अवलोकन

एक scheduled GitHub Action बनाएं जो Sentry API poll करे और issues बनाए

#### Implementation उदाहरण

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

#### फायदे

- ✅ Schedule पर स्वचालित रूप से चलता है
- ✅ कोई बाहरी services आवश्यक नहीं
- ✅ मुफ़्त (GitHub Actions minutes)
- ✅ कोड repository में रहता है
- ✅ Version control करना आसान

#### नुकसान

- ❌ Polling-based (real-time नहीं)
- ❌ State management की आवश्यकता है
- ❌ Cron schedule तक सीमित
- ❌ Rate limiting विचार

#### लागत

- मुफ़्त (GitHub Actions सीमाओं के अंतर्गत)

---

## तुलना तालिका

| समाधान                          | सेटअप समय  | लागत    | Real-time | अनुकूलन | रखरखाव  | सर्वश्रेष्ठ के लिए               |
| ------------------------------- | ---------- | ------- | --------- | ------------- | ----------- | ------------------------------ |
| **Native Integration (Manual)** | 10 मिनट     | मुफ़्त    | नहीं        | कम           | कोई नहीं        | त्वरित सेटअप, छोटी टीमें       |
| **Native Integration (Auto)**   | 15 मिनट     | $$      | हाँ       | कम           | कोई नहीं        | Enterprise, स्वचालित workflow |
| **Custom Script (API)**         | 2-4 घंटे  | मुफ़्त    | नहीं        | अधिक          | मध्यम      | पूर्ण नियंत्रण, bulk operations  |
| **Webhooks + Service**          | 4-8 घंटे  | Hosting | हाँ       | अधिक          | अधिक        | Real-time, बड़े पैमाने पर         |
| **Pipedream**                   | 30 मिनट     | मुफ़्त/$  | हाँ       | मध्यम        | कम         | No-code, rapid prototyping     |
| **n8n**                         | 2-3 घंटे  | मुफ़्त\*  | हाँ       | अधिक          | मध्यम      | Self-hosted, data privacy      |
| **Make.com**                    | 1 घंटा     | मुफ़्त/$  | हाँ       | अधिक          | कम         | जटिल workflows              |
| **Zapier**                      | 30 मिनट     | $$      | हाँ       | मध्यम        | कम         | Business users, सरलता     |
| **GitHub Actions**              | 2-3 घंटे  | मुफ़्त    | नहीं        | अधिक          | मध्यम      | CI/CD integration              |

\* Hosting infrastructure की आवश्यकता है

---

## अनुशंसाएं

### तत्काल उपयोग के लिए (इस सप्ताह)

**→ Sentry का Native GitHub Integration (Manual)**

त्वरित जीत के लिए आधिकारिक integration से शुरुआत करें:

1. 10 मिनट में install करें
2. कुछ issues के साथ manually परीक्षण करें
3. मूल्यांकन करें कि automatic version के लिए plan upgrade करना उचित है या नहीं

### Production उपयोग के लिए (दीर्घकालिक)

**→ Custom Implementation (Sentry API + GitHub API)**

अनुशंसित क्योंकि:

1. ✅ **पहले से @sentry/node dependency है** - मौजूदा integration का लाभ उठाएं
2. ✅ **पूर्ण नियंत्रण** - issue format, labels, assignment logic अनुकूलित करें
3. ✅ **Hive Mind के साथ integrate कर सकते हैं** - मौजूदा automation suite में जोड़ें
4. ✅ **मुफ़्त** - कोई अतिरिक्त subscription लागत नहीं
5. ✅ **विकसित हो सकता है** - सरल शुरुआत, समय के साथ features जोड़ें
6. ✅ **Bulk operations** - मौजूदा issues convert कर सकते हैं

**Implementation योजना:**

1. `scripts/sentry-to-github.mjs` script बनाएं
2. मौजूदा Sentry credentials उपयोग करें
3. npm scripts में जोड़ें: `"sentry:sync": "node scripts/sentry-to-github.mjs"`
4. Cron या GitHub Actions के साथ schedule करें
5. (वैकल्पिक) Real-time के लिए webhook-based तक विस्तारित करें

### Real-time आवश्यकताओं के लिए

**→ Sentry Webhooks + Custom Service**

यदि real-time महत्वपूर्ण है:

1. Custom script को webhook receiver तक विस्तारित करें
2. Microservice के रूप में deploy करें (hive-mind के समान infrastructure)
3. मौजूदा deployment pipeline उपयोग करें

### No-code Quick Prototype के लिए

**→ Pipedream**

यदि custom code के प्रति प्रतिबद्ध होने से पहले परीक्षण करना चाहते हैं:

1. परीक्षण के लिए Free tier पर्याप्त है
2. बाद में logic export/migrate कर सकते हैं
3. Data flow समझने के लिए उपयोगी

---

## Implementation विचार

### Deduplication

Duplicates से बचने के लिए synced issues को track करें:

```javascript
const syncedIssues = new Map(); // sentryId -> githubIssueNumber
```

### Rate Limiting

- Sentry API: कोई दस्तावेजीकृत सीमा नहीं, लेकिन उचित रहें
- GitHub API: Authenticated requests के लिए 5,000 requests/घंटा
- Batch operations के बीच देरी जोड़ें

### Issue Status Sync

द्विदिशीय sync पर विचार करें:

- Sentry issue resolved → GitHub issue बंद करें
- GitHub issue बंद → Sentry issue status अपडेट करें

### Labels और Assignment

- Filtering के लिए `sentry` label जोड़ें
- Additional labels के लिए error type parse करें (जैसे, `TypeError`, `network-error`)
- Assignment के लिए Sentry fingerprint/user data उपयोग करें

### Error Handling

- Manual review के लिए failures log करें
- Transient errors retry करें (network issues)
- Persistent failures पर alert करें

---

## अगले कदम

1. **तत्काल:** Manual testing के लिए Sentry GitHub integration install करें
2. **सप्ताह 1:** मौजूदा issues के bulk conversion के लिए custom script बनाएं
3. **सप्ताह 2-3:** Scheduling जोड़ें (GitHub Actions या cron)
4. **भविष्य:** यदि आवश्यक हो तो webhook-based real-time sync पर विचार करें

---

## संदर्भ

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
