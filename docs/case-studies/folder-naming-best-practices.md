# Best Practices for Folder Naming: Case Studies, Incidents, Investigations, and Problems

> **Research Summary**: This document provides research-backed, GitHub-friendly guidelines for organizing documentation about incidents, investigations, problems, and case studies in software repositories.

## Table of Contents

1. [Overview](#overview)
2. [Industry Standards and Frameworks](#industry-standards-and-frameworks)
3. [Recommended Folder Structure](#recommended-folder-structure)
4. [File Naming Conventions](#file-naming-conventions)
5. [Document Type Definitions](#document-type-definitions)
6. [Templates](#templates)
7. [Sources and References](#sources-and-references)

---

## Overview

There is no single universal GitHub standard for incident/investigation/case-study documentation. However, teams converge on several **widely adopted frameworks**:

| Type | Framework | Source |
|------|-----------|--------|
| Incidents & Postmortems | Google SRE blameless postmortem | [Google SRE Workbook](https://sre.google/workbook/postmortem-culture/) |
| Problem Management | ITIL 4 incident vs. problem distinction | [Atlassian ITIL Guide](https://www.atlassian.com/incident-management/devops/incident-vs-problem-management) |
| Security Incidents | NIST SP 800-61, ISO/IEC 27035 | [NIST CSRC](https://csrc.nist.gov/pubs/sp/800/61/r2/final) |
| Architecture Decisions | ADR/MADR templates | [ADR Template by Michael Nygard](https://github.com/joelparkerhenderson/architecture-decision-record) |
| Knowledge Documentation | Diataxis framework | [diataxis.fr](https://diataxis.fr/) |

---

## Industry Standards and Frameworks

### Google SRE Postmortem Culture

Google's Site Reliability Engineering guidance recommends a **blameless postmortem** approach with these required sections:

1. **Summary** - One-paragraph plain-language description
2. **Impact** - Duration, % affected, SLO/SLA breach
3. **Timeline (UTC)** - Detection to recovery
4. **Root Cause** - Systems view, no blame
5. **Contributing Factors** - What made it worse
6. **Resolution** - Temporary vs. durable fix
7. **Lessons Learned** - What we'll do differently
8. **Action Items** - Owner, priority, due date, issue link
9. **Links & Evidence** - Dashboards, logs, PRs

**Source**: [Google SRE Workbook - Postmortem Culture](https://sre.google/workbook/postmortem-culture/)

### ITIL Problem Management

ITIL 4 distinguishes between:
- **Incident Management**: Restore service immediately
- **Problem Management**: Find and eliminate root causes to prevent recurrence

This separation clarifies accountability and time horizons.

**Source**: [Atlassian - Incident vs Problem Management](https://www.atlassian.com/incident-management/devops/incident-vs-problem-management)

### GitHub Community Health Files

GitHub recognizes files in three locations (in priority order):
1. `.github/` folder
2. Repository root
3. `docs/` folder

Issue templates **must** be in `.github/ISSUE_TEMPLATE/`.

**Source**: [GitHub Docs - Community Health Files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)

### Static Site Generator Conventions

MkDocs, Docusaurus, and Jekyll all treat `docs/` as the first-class documentation directory.

**Source**: [MkDocs User Guide](https://www.mkdocs.org/user-guide/writing-your-docs/)

---

## Recommended Folder Structure

### General Naming Rules

Based on industry conventions from [Folder-Structure-Conventions](https://github.com/kriasoft/Folder-Structure-Conventions) and [World Bank Guidelines](https://worldbank.github.io/template/docs/folders-and-naming.html):

1. **Use lowercase letters** - Avoid CamelCase or UPPERCASE
2. **Use hyphens (kebab-case)** - Prefer `damage-assessment` over `damage_assessment`
3. **Keep names short** - One or two words preferred
4. **No spaces** - Never use spaces in file or folder names
5. **No version numbers** - Use git tags instead of `_v01`, `_v02`, etc.
6. **Be descriptive** - Names should match topic/theme

### Recommended Directory Tree

```
docs/
  incidents/              # Postmortems & ops incidents
    2025/
      2025-06-05-sev2-actions-delays.md
  investigations/         # Debugging/research narratives
    2025-05-12-api-timeout-spikes.md
  problems/               # ITIL problem records (RCA/recurrence prevention)
    PRB-00023-message-queue-backpressure.md
  case-studies/           # Explanation-style writeups of larger efforts
    2025-streaming-pipeline-rewrite.md
    folder-naming-best-practices.md
  decisions/              # ADR/MADR records
    adr/
      0001-slo-policy-v2.md
  runbooks/               # How-to operational procedures
    restart-batch-consumer.md
```

### Why This Structure Works

| Choice | Rationale |
|--------|-----------|
| `docs/` as root | Standard for MkDocs, Docusaurus, Jekyll; recognized by GitHub |
| Lowercase kebab-case | Universal convention; avoids cross-platform issues |
| Date prefixes | Enables chronological sorting; ISO 8601 format |
| Type-based folders | Separates concerns; matches industry frameworks |

---

## File Naming Conventions

### By Document Type

| Type | Pattern | Example |
|------|---------|---------|
| Incidents | `YYYY-MM-DD-sev[1-4]-short-slug.md` | `2025-06-05-sev2-actions-delays.md` |
| Investigations | `YYYY-MM-DD-short-slug.md` | `2025-05-12-api-timeout-spikes.md` |
| Problems (ITIL) | `PRB-<id>-slug.md` | `PRB-00023-message-queue.md` |
| ADRs | `NNNN-title.md` | `0001-slo-policy-v2.md` |
| Case Studies | `YYYY-topic-slug.md` or `topic-slug.md` | `2025-streaming-pipeline-rewrite.md` |
| Runbooks | `action-target.md` | `restart-batch-consumer.md` |

### Postmortem-Specific Pattern

Per [dastergon/postmortem-templates](https://github.com/dastergon/postmortem-templates), a common naming pattern is:

```
postmortem-<component>-<type>-YYYY-MM-DD.md
```

Example: `postmortem-api-outage-2025-05-29.md`

This pattern enables:
- Automatic template loading in editors (Vim, Emacs)
- Easy filtering and searching
- Clear identification of document purpose

---

## Document Type Definitions

### Incidents (Postmortems)

**Purpose**: Document what happened during an outage, learn from failures, and track remediation actions.

**When to create**: After any service disruption or near-miss that affected users or breached SLOs.

**Timeline**: Create within 3-5 business days after the incident.

**Source**: [PagerDuty Postmortem Guide](https://response.pagerduty.com/after/post_mortem_template/)

### Investigations

**Purpose**: Document debugging sessions, exploratory analysis, and hypothesis testing.

**When to create**: When researching symptoms, performance issues, or unexpected behavior that hasn't yet caused an incident.

**Key sections**:
- Context & problem statement
- Hypotheses (ranked)
- Experiments (steps, evidence, results)
- Findings
- Decision / Next step
- Unknowns & follow-ups

### Problems (ITIL)

**Purpose**: Document root cause analysis and permanent fixes to prevent recurrence.

**When to create**: After an incident when the root cause needs deeper analysis, or when multiple related incidents suggest a systemic issue.

**Key sections**:
- Problem statement
- Known error & workaround
- Related incidents
- RCA summary
- Remediation options
- Chosen fix & plan

### Case Studies

**Purpose**: Share knowledge about significant efforts, architectural decisions, or lessons learned.

**When to create**: After completing a major project, migration, or solving a complex problem that others could learn from.

In the [Diataxis framework](https://diataxis.fr/), case studies map to **explanation** content - designed to transfer insight rather than document incidents.

### Architecture Decision Records (ADRs)

**Purpose**: Capture the context, decision, and consequences of architectural choices.

**Format** (Michael Nygard template):
1. **Title** - Descriptive heading
2. **Status** - Proposed, accepted, rejected, deprecated, superseded
3. **Context** - The issue motivating the decision
4. **Decision** - The proposed change
5. **Consequences** - What becomes easier or harder

**Source**: [ADR Template by Michael Nygard](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md)

---

## Templates

### Front Matter (YAML)

All documents should include YAML front matter for tooling compatibility:

```yaml
---
title: "SEV-2: Actions run delays"
date: 2025-06-05T17:47:00Z
doc_type: incident  # incident | investigation | problem | case-study | adr
status: completed   # draft | active | completed | superseded
severity: SEV-2     # SEV-1 | SEV-2 | SEV-3 | SEV-4 (for incidents)
components: [actions, copilot, pages]
owner: sre-oncall
tags: [postmortem, reliability]
related_issues: ["#1234"]
related_prs: ["#5678"]
---
```

### Severity Levels

| Level | Definition | Response |
|-------|------------|----------|
| SEV-1 | Critical - Total service outage | Immediate, all-hands |
| SEV-2 | Major - Significant feature degraded | Urgent, dedicated team |
| SEV-3 | Minor - Limited impact | Normal priority |
| SEV-4 | Low - Cosmetic or minor issue | Best effort |

### Incident Template

```markdown
---
doc_type: incident
title: "SEV-2: <short summary>"
date: 2025-06-05T17:47:00Z
status: completed
severity: SEV-2
components: [<service>]
owner: sre-oncall
tags: [postmortem, reliability]
related_issues: ["#1234"]
related_prs: ["#5678"]
---

## Summary
<one-paragraph description for non-experts>

## Impact
- Duration: <mm> minutes
- Users affected: <%, region/segment>
- SLO/SLA: <breached or not>, which SLO?

## Timeline (UTC)
- 17:47 Detected by <alert/dashboard link>
- 18:05 Mitigation started: <what>
- 19:20 Recovered: <what proved effective>

## Root Cause
<Systemic explanation; include causal chain>

## Contributing Factors
<config debt, insufficient alerts, etc.>

## Resolution
<temporary vs. permanent fix>

## Lessons Learned
<bullets>

## Action Items
- [ ] <owner> - <task> - due <date> - issue #<id>

## References
<dashboards>, <logs>, <runbooks>, PRs, issues
```

### Investigation Template

```markdown
---
doc_type: investigation
title: "<symptom or question>"
date: 2025-05-12
status: active
owner: <name or team>
components: [<service>]
tags: [investigation, debugging]
---

## Context
<symptom, scope, when/where observed>

## Hypotheses
1. <hypothesis> - why it's plausible

## Experiments & Evidence
- Step: <what you did> - Result: <data> - Link: <logs/trace>

## Findings
<what we now know>

## Decision / Next Step
<fix candidate or escalate to Problem record>

## Unknowns
<open questions>
```

### Problem Record Template (ITIL)

```markdown
---
doc_type: problem
id: PRB-0023
status: open
owner: <name or team>
related_incidents: ["2025-06-05-actions-delays"]
---

## Problem Statement
<description of the underlying issue>

## Known Error & Workaround
<temporary mitigation>

## RCA Summary
<causal chain analysis>

## Remediation Options
| Option | Pros | Cons | Effort |
|--------|------|------|--------|

## Chosen Fix & Plan
<selected approach with PR/issue links>
```

### Case Study Template

```markdown
---
doc_type: case-study
title: "<initiative>"
date: 2025-09-01
tags: [case-study, architecture]
---

## Background
<context and starting point>

## Problem
<what needed to be solved>

## Approach
<methodology and decisions>

## Results
<metrics and outcomes>

## Trade-offs
<what was sacrificed>

## Lessons
<key takeaways>

## Recommendations
<guidance for similar situations>
```

---

## Sources and References

### Primary Sources (Verified)

| Source | URL | Verified |
|--------|-----|----------|
| Google SRE Workbook - Postmortem Culture | https://sre.google/workbook/postmortem-culture/ | Yes |
| Google SRE Book - Example Postmortem | https://sre.google/sre-book/example-postmortem/ | Yes |
| MkDocs User Guide | https://www.mkdocs.org/user-guide/writing-your-docs/ | Yes |
| GitHub Docs - Community Health Files | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file | Yes |
| GitHub Docs - Issue Templates | https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates | Yes |
| ADR Template - Michael Nygard | https://github.com/joelparkerhenderson/architecture-decision-record | Yes |
| Diataxis Framework | https://diataxis.fr/ | Yes |
| Keep a Changelog | https://keepachangelog.com/en/1.0.0/ | Yes |
| PagerDuty Postmortem Template | https://response.pagerduty.com/after/post_mortem_template/ | Yes |
| Folder Structure Conventions | https://github.com/kriasoft/Folder-Structure-Conventions | Yes |
| World Bank Folder Naming | https://worldbank.github.io/template/docs/folders-and-naming.html | Yes |
| Postmortem Templates Collection | https://github.com/dastergon/postmortem-templates | Yes |
| GitHub Blog - Incident Analysis Example | https://github.blog/news-insights/company-news/oct21-post-incident-analysis/ | Yes |
| NIST SP 800-61 | https://csrc.nist.gov/pubs/sp/800/61/r2/final | Yes |

### Additional Resources

- [GitHub Docs - Closing Issues with Keywords](https://docs.github.com/articles/closing-issues-using-keywords)
- [GitHub Docs - Security Policy](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)
- [Atlassian - Incident Severity Levels](https://www.atlassian.com/incident-management/kpis/severity-levels)
- [Atlassian - 5 Whys Analysis](https://www.atlassian.com/software/confluence/templates/5-whys-analysis)
- [GitHub Availability Report](https://github.blog/news-insights/company-news/github-availability-report-june-2025/)

---

## Summary of Recommendations

1. **Use `docs/` as the root** for all technical documentation
2. **Organize by document type** with separate folders for `incidents/`, `investigations/`, `problems/`, `case-studies/`, and `decisions/`
3. **Follow kebab-case naming** with lowercase letters and hyphens
4. **Use ISO 8601 date prefixes** (`YYYY-MM-DD`) for chronological documents
5. **Include YAML front matter** for tooling compatibility and searchability
6. **Adopt severity levels** (SEV-1 through SEV-4) based on business impact
7. **Link related issues and PRs** to maintain traceability
8. **Create postmortems within 5 business days** of incidents
9. **Separate incident response (restore service) from problem management (prevent recurrence)**
10. **Write blameless, systems-focused documentation** that enables organizational learning
