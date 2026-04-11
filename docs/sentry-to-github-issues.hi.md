# Sentry Issues को GitHub Issues में बदलना - शोध रिपोर्ट (languages: [en](sentry-to-github-issues.md) • [zh](sentry-to-github-issues.zh.md) • hi • [ru](sentry-to-github-issues.ru.md))

## अवलोकन

यह दस्तावेज़ `link-assistant/hive-mind` प्रोजेक्ट के लिए Sentry issues को GitHub Issues में स्वचालित रूप से बदलने के सभी उपलब्ध विकल्पों की खोज करता है। हमारा Sentry dashboard यहां उपलब्ध है: https://deepassistant.sentry.io/issues

## वर्तमान Integration Status

प्रोजेक्ट में वर्तमान में error tracking के लिए Sentry integrated है:

- **Sentry SDK**: `@sentry/node` (v10.15.0) और `@sentry/profiling-node` (v10.15.0)
- **Implementation**: `src/sentry.lib.mjs` पर error tracking, breadcrumbs, और performance monitoring के साथ व्यापक Sentry library
- **कोई मौजूदा GitHub issue निर्माण automation नहीं**

## उपलब्ध विकल्प

### विकल्प 1: Native Sentry GitHub Integration (UI-Based)

Sentry एक built-in GitHub integration प्रदान करता है जिसे Sentry web interface के माध्यम से कॉन्फ़िगर किया जा सकता है।

#### विशेषताएं:

- **Automatic Issue निर्माण**: Alert Rules के माध्यम से स्वचालित रूप से GitHub issues बनाएं
- **Manual Issue निर्माण**: Sentry UI से GitHub issues बनाएं और link करें
- **Bidirectional Linking**: Sentry issues को मौजूदा GitHub issues/PRs से link करें
- **Code Ownership Integration**: स्वचालित assignee suggestions के लिए CODEOWNERS file sync करें
- **Commit Tracking**: जब commits `fixes <SENTRY-SHORT-ID>` mention करते हैं तो Sentry issues स्वचालित रूप से resolve करें
- **PR Comments**: Merged PRs पर स्वचालित comments जो issues का कारण होने का संदेह है

#### सेटअप:

1. Sentry में **Settings > Integrations > GitHub** पर जाएं
2. GitHub integration install करें (GitHub से नहीं, Sentry से install करना अनुशंसित है)
3. GitHub issues स्वचालित रूप से बनाने के लिए Issue Alerts कॉन्फ़िगर करें
4. "Create a new GitHub issue" action के साथ alert rules सेट करें

#### सीमाएं:

- Alert rules के लिए **Manual UI configuration आवश्यक है**
- **Programmatically controllable नहीं** - built-in integration तक सीमित API access
- Automatic issue निर्माण के लिए **Business या Enterprise plan आवश्यक है**
- Manual issue management के लिए **Team plan या उससे उच्च** आवश्यक है

#### Pricing Impact:

- वर्तमान Sentry subscription के आधार पर plan upgrade की आवश्यकता हो सकती है

---

### विकल्प 2: Sentry API + GitHub API का उपयोग करके Custom Script

एक custom Node.js script बनाएं जो periodically Sentry issues fetch करे और corresponding GitHub issues बनाए।

#### Implementation Approach:

**चरण 1: Sentry Issues Fetch करें**

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
- **Authentication**: `event:read` scope के साथ Bearer token
- **Query Parameters**:
  - `query`: Issues filter करें (default: `is:unresolved issue.priority:[high,medium]`)
  - `statsPeriod`: समय अवधि (`24h`, `7d`, आदि)
  - `project`: Project IDs से filter करें
  - `sort`: Sort order (`date`, `new`, `freq`, `user`)
  - `limit`: प्रति request max 100

**चरण 2: GitHub Issues बनाएं**

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

**चरण 3: Synced Issues Track करें**

- Sentry issue IDs और GitHub issue numbers के बीच mapping store करें
- Duplicate issue निर्माण रोकें
- Storage के विकल्प:
  - Local JSON file
  - Database
  - GitHub issue labels/metadata
  - Sentry tags

#### Scheduling विकल्प:

1. **Cron Job**: Script periodically चलाएं (जैसे, हर घंटे)
2. **GitHub Actions**: Scheduled workflow उपयोग करें
3. **systemd timer**: Server deployments के लिए
4. **Docker container**: Scheduler के साथ

#### फायदे:

- ✅ Issue format और content पर पूर्ण नियंत्रण
- ✅ कोई अतिरिक्त service dependencies नहीं
- ✅ Filtering और priority logic अनुकूलित कर सकते हैं
- ✅ Custom labels, assignees, और metadata जोड़ सकते हैं
- ✅ किसी भी Sentry plan के साथ काम करता है
- ✅ मौजूदा codebase में आसानी से integrated

#### नुकसान:

- ❌ रखरखाव की आवश्यकता है
- ❌ Real-time नहीं (polling interval पर निर्भर)
- ❌ दोनों APIs के लिए rate limiting संभालनी होगी
- ❌ Duplicates से बचने के लिए state tracking implement करनी होगी
- ❌ Secure token storage आवश्यक है

#### Implementation Estimate:

- **प्रारंभिक विकास**: 4-6 घंटे
- **परीक्षण और परिशोधन**: 2-3 घंटे
- **कुल**: 6-9 घंटे

---

### विकल्प 3: GitHub Actions के साथ Webhook-Based Automation

Real-time में issues बनाने वाले GitHub Actions workflows trigger करने के लिए Sentry webhooks का उपयोग करें।

#### Architecture:

```
Sentry Issue Event → Webhook → GitHub Actions Workflow → Create GitHub Issue
```

#### Implementation Steps:

**चरण 1: Sentry Internal Integration बनाएं**

1. Sentry में **Settings > Developer Settings > Internal Integrations** पर जाएं
2. नई internal integration बनाएं
3. Webhook events subscribe करें: `issue.created`, `issue.updated`
4. Webhook URL GitHub Actions webhook receiver पर सेट करें

**चरण 2: GitHub Actions Webhook Receiver सेट करें**

- Repository dispatch events या webhook proxy उपयोग करें
- विकल्प:
  - **Webhook proxy service** (जैसे development के लिए smee.io)
  - **Self-hosted webhook receiver**
  - **Cloud function** (AWS Lambda, Google Cloud Functions)

**चरण 3: GitHub Actions Workflow**

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

#### फायदे:

- ✅ Real-time issue निर्माण
- ✅ Event-driven (कोई polling आवश्यक नहीं)
- ✅ Cloud functions उपयोग करने पर कोई अतिरिक्त infrastructure नहीं
- ✅ Scalable
- ✅ किसी भी Sentry plan के साथ काम करता है

#### नुकसान:

- ❌ Webhook endpoint सेटअप की आवश्यकता है
- ❌ अधिक जटिल प्रारंभिक सेटअप
- ❌ Webhook authentication और verification संभालनी होगी
- ❌ Webhook delivery failures के लिए retry logic की आवश्यकता
- ❌ GitHub Actions के उपयोग सीमाएं हैं

#### Implementation Estimate:

- **प्रारंभिक विकास**: 6-8 घंटे
- **परीक्षण और Deployment**: 3-4 घंटे
- **कुल**: 9-12 घंटे

---

### विकल्प 4: Third-Party Automation Platforms

Sentry और GitHub को connect करने के लिए no-code/low-code automation platforms उपयोग करें।

#### उपलब्ध Platforms:

##### **Pipedream** (सरलता के लिए अनुशंसित)

- **Pre-built Integration**: "Create Issue with GitHub API on New Issue Event (Instant) from Sentry API"
- **URL**: https://pipedream.com/apps/sentry/integrations/github
- **विशेषताएं**:
  - Webhook के माध्यम से Instant Sentry issue events
  - Pre-configured GitHub issue निर्माण
  - Free tier उपलब्ध (24/7 चलती है)
  - Source-available components
  - Node.js के साथ आसान अनुकूलन

**सेटअप समय**: 15-30 मिनट

##### **n8n** (Self-hosting के लिए सर्वश्रेष्ठ)

- **Integration**: GitHub + Sentry.io workflow automation
- **URL**: https://n8n.io/integrations/github/and/sentryio/
- **विशेषताएं**:
  - Self-hosted विकल्प (पूर्ण data नियंत्रण)
  - Visual workflow builder
  - Coding आवश्यक नहीं
  - लचीला trigger और action configuration
  - Free और open-source

**सेटअप समय**: 30-60 मिनट (यदि self-hosted तो hosting सेटअप सहित)

##### **Zapier**

- **Status**: कोई native Sentry integration नहीं (webhooks उपयोग करना होगा)
- **सीमाएं**: Manual webhook configuration आवश्यक है
- **Pricing**: Premium features के लिए paid plans आवश्यक

**Native support की कमी के कारण अनुशंसित नहीं**

##### **Make** (पूर्व में Integromat)

- **Integration**: उपलब्ध लेकिन manual सेटअप आवश्यक है
- **विशेषताएं**: Visual workflow design
- **Pricing**: सीमाओं के साथ Free tier उपलब्ध

**सेटअप समय**: 45-60 मिनट

#### तुलना तालिका:

| Platform  | सेटअप समय  | लागत       | Self-Hosted | उपयोग की आसानी | अनुशंसा                                   |
| --------- | ---------- | ---------- | ----------- | -------------- | ----------------------------------------- |
| Pipedream | 15-30 मिनट | Free tier  | नहीं        | ⭐⭐⭐⭐⭐     | ✅ त्वरित सेटअप के लिए सर्वश्रेष्ठ        |
| n8n       | 30-60 मिनट | Free (OSS) | हाँ         | ⭐⭐⭐⭐       | ✅ Data privacy के लिए सर्वश्रेष्ठ        |
| Make      | 45-60 मिनट | Paid       | नहीं        | ⭐⭐⭐⭐       | ⚠️ पहले से उपयोग कर रहे हों तो विचार करें |
| Zapier    | 60+ मिनट   | Paid       | नहीं        | ⭐⭐⭐         | ❌ अनुशंसित नहीं                          |

#### फायदे:

- ✅ Deployment तक सबसे तेज़ समय (विशेषकर Pipedream)
- ✅ No code/minimal code आवश्यक
- ✅ Built-in error handling और retry logic
- ✅ Visual workflow management
- ✅ Modify और परीक्षण करना आसान
- ✅ Free tiers उपलब्ध

#### नुकसान:

- ❌ बाहरी service dependency
- ❌ Free tiers पर उपयोग सीमाएं हो सकती हैं
- ❌ Implementation details पर कम नियंत्रण
- ❌ Vendor lock-in (n8n को छोड़कर)
- ❌ Data third-party servers से गुजरता है (self-hosted n8n को छोड़कर)

---

## अनुशंसित Approach

### तत्काल Implementation के लिए: **Pipedream**

**क्यों:**

1. ✅ सबसे तेज़ सेटअप (15-30 मिनट)
2. ✅ उपयोग के लिए तैयार pre-built integration
3. ✅ अधिकांश उपयोग के मामलों के लिए Free tier पर्याप्त
4. ✅ Maintain करने के लिए कोई infrastructure नहीं
5. ✅ परीक्षण और iterate करना आसान

**सेटअप Steps:**

1. Pipedream account के लिए साइन अप करें
2. https://pipedream.com/apps/sentry/integrations/github पर जाएं
3. "Create Issue with GitHub API on New Issue Event (Instant) from Sentry API" click करें
4. Sentry account connect करें (webhook स्वचालित रूप से बनाएगा)
5. GitHub account connect करें
6. Repository और issue template कॉन्फ़िगर करें
7. परीक्षण करें और deploy करें

### दीर्घकालिक लचीलेपन के लिए: **Custom Script (विकल्प 2)**

**क्यों:**

1. ✅ पूर्ण नियंत्रण और अनुकूलन
2. ✅ कोई बाहरी dependencies नहीं
3. ✅ मौजूदा codebase के साथ integrate कर सकते हैं
4. ✅ अतिरिक्त features के साथ आसानी से extend करें
5. ✅ कोई vendor lock-in नहीं

**Implementation Path:**

1. `scripts/sentry-to-github.mjs` में script बनाएं
2. Issue mapping rules के लिए configuration file जोड़ें
3. Scheduling के लिए GitHub Actions workflow implement करें
4. State tracking जोड़ें (JSON file या GitHub labels)
5. व्यापक error handling और logging जोड़ें
6. Usage और configuration document करें

**उदाहरण File Structure:**

```
scripts/
  sentry-to-github.mjs          # Main script
  sentry-github-config.json     # Configuration
  sentry-sync-state.json        # State tracking (gitignored)
.github/
  workflows/
    sentry-sync.yml             # Scheduled workflow
```

### Enterprise/Privacy Requirements के लिए: **Self-Hosted n8n**

**क्यों:**

1. ✅ पूर्ण data नियंत्रण (self-hosted)
2. ✅ Visual workflow management
3. ✅ कोई बाहरी data sharing नहीं
4. ✅ Free और open-source
5. ✅ Custom nodes के साथ extensible

---

## Implementation Roadmap

### Phase 1: त्वरित जीत (1-2 दिन)

1. तत्काल issue sync के लिए Pipedream integration सेट करें
2. Sentry issues के एक subset के साथ परीक्षण करें
3. GitHub issue template और labels परिशोधित करें
4. प्रक्रिया document करें

### Phase 2: Custom Solution (1-2 सप्ताह)

1. Full feature set के साथ custom script विकसित करें
2. व्यापक state tracking implement करें
3. Filtering rules जोड़ें (priority, project, आदि)
4. GitHub Actions scheduling सेट करें
5. Monitoring और alerting जोड़ें
6. Pipedream से custom solution में migrate करें

### Phase 3: Optimization (चल रहा)

1. ML-based issue deduplication जोड़ें
2. Stack traces के आधार पर automatic assignee detection implement करें
3. Issue lifecycle management जोड़ें (Sentry issue resolved होने पर auto-close)
4. Sync statistics के लिए dashboard बनाएं
5. Bidirectional sync के लिए support जोड़ें

---

## API Reference

### Sentry API

**Organization Issues की सूची:**

```
GET https://sentry.io/api/0/organizations/{org_slug}/issues/
Authorization: Bearer <token>
```

**Query Parameters:**

- `query`: Filter query (जैसे, `is:unresolved issue.priority:high`)
- `statsPeriod`: समय अवधि (`24h`, `7d`, `14d`)
- `project`: Filter करने के लिए Project IDs
- `sort`: Sort order (`date`, `new`, `freq`, `user`)
- `limit`: अधिकतम 100 results

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

**Issue बनाएं:**

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

1. **Sentry Auth Token**: न्यूनतम scopes के साथ बनाएं (`event:read`)
2. **GitHub Token**: `issues:write` permission के साथ fine-grained PAT उपयोग करें
3. **Storage**: Environment variables या secure secret management उपयोग करें
4. **Rotation**: Token rotation नीति implement करें

### Webhook Security

1. **Signature Verification**: Sentry से webhook signatures validate करें
2. **HTTPS Only**: Webhook endpoints के लिए हमेशा HTTPS उपयोग करें
3. **IP Allowlisting**: संभव हो तो webhook sources को Sentry IPs तक प्रतिबंधित करें
4. **Rate Limiting**: Webhook endpoints पर rate limiting implement करें

### Data Privacy

1. **PII Handling**: Sensitive data वाले stack traces के साथ सावधान रहें
2. **Error Messages**: GitHub issues बनाने से पहले error messages sanitize करें
3. **Access Control**: सुनिश्चित करें कि GitHub repository में उचित access restrictions हों
4. **Compliance**: Error data के लिए GDPR/privacy requirements पर विचार करें

---

## लागत विश्लेषण

### विकल्प 1: Native Sentry Integration

- **लागत**: Sentry plan पर निर्भर (upgrade की आवश्यकता हो सकती है)
- **Business Plan**: $80/month से शुरू
- **सेटअप**: मुफ़्त
- **रखरखाव**: न्यूनतम

### विकल्प 2: Custom Script

- **विकास**: 6-9 घंटे (एकबारगी)
- **Infrastructure**: मुफ़्त (GitHub Actions उपयोग करते हुए)
- **रखरखाव**: ~2-4 घंटे/माह
- **पहले वर्ष का कुल**: ~$0 (आंतरिक विकास मानते हुए)

### विकल्प 3: Webhook + GitHub Actions

- **विकास**: 9-12 घंटे (एकबारगी)
- **Infrastructure**: मुफ़्त (GitHub Actions सीमाओं के अंतर्गत)
- **रखरखाव**: ~1-2 घंटे/माह
- **पहले वर्ष का कुल**: ~$0 (आंतरिक विकास मानते हुए)

### विकल्प 4: Third-Party Platforms

**Pipedream:**

- **Free Tier**: 100K credits/month (अधिकांश उपयोग के मामलों के लिए पर्याप्त)
- **Paid Tier**: $19/month 1M credits के लिए
- **सेटअप**: मुफ़्त
- **रखरखाव**: न्यूनतम

**n8n (Cloud):**

- **Starter**: $20/month
- **Pro**: $50/month

**n8n (Self-Hosted):**

- **Software**: मुफ़्त (open-source)
- **Infrastructure**: ~$5-20/month (छोटा VPS)
- **सेटअप**: 2-4 घंटे
- **रखरखाव**: ~2-3 घंटे/माह

---

## Monitoring और Maintenance

### Track करने के लिए मुख्य Metrics

1. **Sync Success Rate**: सफलतापूर्वक convert किए गए Sentry issues का प्रतिशत
2. **Sync Latency**: Sentry issue निर्माण और GitHub issue निर्माण के बीच का समय
3. **Duplicate Rate**: बनाए गए duplicate issues का प्रतिशत
4. **API Rate Limits**: Sentry और GitHub API दोनों के उपयोग की निगरानी करें
5. **Error Rate**: API errors या validation issues के कारण विफल syncs

### अनुशंसित Monitoring Tools

1. **Logging**: Structured logging उपयोग करें (JSON format)
2. **Alerting**: Sync failures के लिए alerts सेट करें
3. **Dashboard**: Sync health के लिए status dashboard बनाएं
4. **Metrics**: Script के लिए मौजूदा Sentry integration का उपयोग करके track करें

---

## निष्कर्ष

`hive-mind` प्रोजेक्ट के लिए, हम **two-phase approach** की अनुशंसा करते हैं:

1. **तत्काल (सप्ताह 1)**: त्वरित जीत के लिए **Pipedream** integration deploy करें
   - Automated issue निर्माण से तत्काल मूल्य प्राप्त करें
   - Workflow और issue format validate करें
   - Team से feedback एकत्र करें

2. **दीर्घकालिक (माह 1-2)**: पूर्ण नियंत्रण के लिए **custom script** विकसित करें
   - Advanced features के साथ tailored solution बनाएं
   - मौजूदा codebase के साथ गहराई से integrate करें
   - बाहरी dependencies समाप्त करें
   - Pipedream से migrate करें

यह approach time-to-value को दीर्घकालिक sustainability और नियंत्रण के साथ संतुलित करती है।

---

## अगले कदम

1. ✅ Team के साथ इस दस्तावेज़ की समीक्षा करें
2. ⬜ Approach तय करें (अनुशंसा: Pipedream → Custom Script)
3. ⬜ यदि Pipedream: Integration सेट करें और परीक्षण करें (ETA: 1 घंटा)
4. ⬜ यदि custom script: Implementation plan बनाएं (ETA: 1 दिन)
5. ⬜ Project README में final solution document करें
6. ⬜ Monitoring और alerting सेट करें
7. ⬜ Sync effectiveness की नियमित समीक्षा schedule करें

---

## संदर्भ

- [Sentry GitHub Integration Docs](https://docs.sentry.io/organization/integrations/source-code-mgmt/github/)
- [Sentry API Reference](https://docs.sentry.io/api/)
- [Sentry Webhooks Documentation](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/)
- [GitHub REST API - Issues](https://docs.github.com/en/rest/issues/issues)
- [Pipedream Sentry-GitHub Integration](https://pipedream.com/apps/sentry/integrations/github)
- [n8n Sentry Integration](https://n8n.io/integrations/sentryio/)
- [Sentry Integration Platform](https://docs.sentry.io/organization/integrations/integration-platform/)

---

_रिपोर्ट तैयार: 2025-10-01_
_लेखक: AI Issue Solver_
_Issue: #357_
