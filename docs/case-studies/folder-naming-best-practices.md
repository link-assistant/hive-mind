# Best Practices for Folder Naming: Case Studies, Incidents, Investigations, and Problems

> **Research Summary**: This document provides research-backed, GitHub-friendly guidelines for organizing documentation about incidents, investigations, problems, case studies, and related technical documentation in software repositories.

## Table of Contents

1. [Overview](#overview)
2. [Industry Standards and Frameworks](#industry-standards-and-frameworks)
3. [Alternative Terminology and Document Types](#alternative-terminology-and-document-types)
4. [Recommended Folder Structure](#recommended-folder-structure)
5. [File Naming Conventions](#file-naming-conventions)
6. [Document Type Definitions](#document-type-definitions)
7. [Templates](#templates)
8. [Sources and References](#sources-and-references)

---

## Overview

There is no single universal GitHub standard for incident/investigation/case-study documentation. However, teams converge on several **widely adopted frameworks**:

| Type                    | Framework                               | Source                                                                                                              |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Incidents & Postmortems | Google SRE blameless postmortem         | [Google SRE Workbook](https://sre.google/workbook/postmortem-culture/)                                              |
| Problem Management      | ITIL 4 incident vs. problem distinction | [Atlassian ITIL Guide](https://www.atlassian.com/incident-management/devops/incident-vs-problem-management)         |
| Security Incidents      | NIST SP 800-61, ISO/IEC 27035           | [NIST CSRC](https://csrc.nist.gov/pubs/sp/800/61/r2/final)                                                          |
| Architecture Decisions  | ADR/MADR templates                      | [ADR Template by Michael Nygard](https://github.com/joelparkerhenderson/architecture-decision-record)               |
| Knowledge Documentation | Diataxis framework                      | [diataxis.fr](https://diataxis.fr/)                                                                                 |
| Technical Proposals     | RFC/RFD process                         | [Oxide RFD Process](https://oxide.computer/blog/rfd-1-requests-for-discussion)                                      |
| Failure Analysis        | FRB/FRACAS standards                    | [NASA FRB Handbook](https://standards.nasa.gov/standard/GSFC/GSFC-HDBK-8700)                                        |
| After Action Reports    | Military/FEMA AAR methodology           | [FEMA AAR Toolkit](https://preptoolkit.fema.gov/web/cip-citap/ncig/-/knowledge_base/ncig/2-3-1-after-action-report) |

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

## Alternative Terminology and Document Types

Different organizations and industries use varying terminology for similar documentation types. This section maps common alternatives to help teams choose consistent naming.

### Terminology Mapping

| Common Term         | Alternative Names                                     | Best Folder Name  |
| ------------------- | ----------------------------------------------------- | ----------------- |
| Incident            | Postmortem, PIR (Post-Incident Review), Outage Report | `incidents/`      |
| Investigation       | Analysis, Research, Spike, Debug Journal              | `investigations/` |
| Problem             | RCA (Root Cause Analysis), Defect Analysis            | `problems/`       |
| Case Study          | Lessons Learned, Knowledge Article, Technical Brief   | `case-studies/`   |
| Decision Record     | ADR, RFC, RFD, Design Doc, TDD, TDR                   | `decisions/`      |
| After Action Report | AAR, Debrief, Learning Review                         | `reviews/`        |
| Failure Analysis    | FRB Report, FRACAS, Anomaly Report                    | `failures/`       |
| Technical Memo      | Engineering Note, One-Pager, Tech Note                | `memos/`          |
| Retrospective       | Sprint Retro, Blameless Retrospective, Team Review    | `retrospectives/` |
| Spike               | Research Spike, Technical Spike, Exploration          | `spikes/`         |

### RFC/RFD (Request for Comments/Discussion)

RFCs and RFDs are collaborative design documents used to propose and discuss technical changes before implementation.

**Oxide Computer Company's RFD Process**:

- RFDs capture ideas in writing for rigorous formulation and transparent sharing
- Used for both technical and company-wide ideas and processes
- States: `prediscussion` → `ideation` → `discussion` → `published` → `committed` or `abandoned`

**Naming convention**: `NNNN-title.md` (e.g., `0001-requests-for-discussion.md`)

**Folder**: `rfds/` or `decisions/rfd/`

**Source**: [Oxide RFD 1](https://rfd.shared.oxide.computer/rfd/0001)

### Post-Incident Review (PIR)

PIR is often used interchangeably with "postmortem" but emphasizes learning over blame.

**Key distinction**: PIR focuses on the review process and learning outcomes, while "postmortem" literally means "after death" and some teams prefer the less morbid terminology.

**Naming convention**: `YYYY-MM-DD-pir-short-slug.md` or `PIR-NNNN-slug.md`

**Source**: [Atlassian PIR Best Practices](https://support.atlassian.com/jira-service-management-cloud/docs/post-incident-review-best-practices/)

### After Action Report (AAR)

AARs originated in military contexts and are now widely used in emergency management and software engineering.

**Four-part AAR process**:

1. **Planning** - Determine scope and objectives
2. **Preparation** - Research and gather relevant data
3. **Implementation** - Workshop and analyze findings
4. **Follow-up** - Document action items with owners and due dates

**Naming convention**: `YYYY-MM-DD-aar-event-slug.md`

**Folder**: `reviews/` or `aars/`

**Source**: [AlertMedia AAR Guide](https://www.alertmedia.com/blog/after-action-report/)

### Failure Review Board (FRB) Reports

FRB documentation is common in aerospace, defense, and safety-critical systems.

**Key elements**:

- Failure description and impact
- Root cause determination
- Corrective action plan
- Verification and closure

**Naming convention**: `FRB-NNNN-component-slug.md`

**Folder**: `failures/` or `frb/`

**Source**: [NASA GSFC FRB Handbook](https://standards.nasa.gov/standard/GSFC/GSFC-HDBK-8700)

### Technical Spikes

Spikes are time-boxed research activities used in Agile development to reduce uncertainty.

**Types of spikes**:

- **Technical spike** - Evaluate technology impact on implementation
- **Functional spike** - Determine interaction with new features
- **Research spike** - Gather information for decision-making

**Naming convention**: `SPIKE-NNNN-topic.md` or `YYYY-MM-DD-spike-topic.md`

**Folder**: `spikes/` or `investigations/spikes/`

**Source**: [Microsoft Technical Spike Template](https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/recipes/technical-spike/)

### Technical Design Documents (TDD/TDR)

TDDs describe the technical solution for a feature or system.

**Key sections**:

- Problem statement
- Proposed solution
- Architecture and data model
- API specifications
- Trade-offs and alternatives

**Naming convention**: `TDD-NNNN-feature-slug.md` or `YYYY-MM-DD-tdd-feature.md`

**Folder**: `tdr/` (Marfeel convention) or `designs/`

**Source**: [Marfeel TDR Documentation](https://www.marfeel.com/docs/touch/extensibility/tdr.html)

### One-Pagers

One-pagers are concise project proposals that capture the essence of an idea on a single page.

**Key benefits**:

- Forces clear thinking upfront
- Serves as constant reference point
- Communication tool rather than heavy documentation

**Naming convention**: `YYYY-MM-DD-one-pager-topic.md` or `one-pager-topic.md`

**Folder**: `proposals/` or `one-pagers/`

**Source**: [HackerNoon One-Pager Template](https://hackernoon.com/the-one-pager-advantage-a-template-for-software-engineering-projects)

### Blameless Retrospectives

Retrospectives focus on team learning and process improvement rather than individual blame.

**Guiding principles**:

- Ask "what" and "how" questions, avoid "why" (which implies justification)
- Focus on systems, not people
- Ensure follow-through with owners and dates

**Naming convention**: `YYYY-MM-DD-retro-sprint-NN.md` or `retro-YYYY-QN.md`

**Folder**: `retrospectives/` or `retros/`

**Source**: [FireHydrant - Blameless Retrospectives](https://firehydrant.com/blog/what-are-blameless-retrospectives-do-they-work-how/)

### Incident Learning Reviews

Modern SRE practice emphasizes learning over fixing, treating incidents as learning opportunities.

**Learning-focused approach**:

- Focus on knowledge transfer, not just action items
- Incidents reveal the real state of systems and organizations
- Transparent reviews inject realism into development processes

**Naming convention**: `YYYY-MM-DD-learning-review-slug.md`

**Folder**: `incidents/` or `learning-reviews/`

**Source**: [The Pragmatic Engineer - Postmortem Best Practices](https://blog.pragmaticengineer.com/postmortem-best-practices/)

### Root Cause Analysis (RCA) Documents

RCA documents focus specifically on determining the underlying cause of problems.

**Common methods**:

- 5 Whys analysis
- Fishbone (Ishikawa) diagrams
- Fault tree analysis
- 8D problem-solving

**Naming convention**: `RCA-NNNN-problem-slug.md` or `YYYY-MM-DD-rca-issue.md`

**Folder**: `problems/` or `rca/`

**Source**: [Asana RCA Template](https://asana.com/resources/root-cause-analysis-template)

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
  incidents/              # Postmortems & ops incidents (also: PIRs, outage reports)
    2025/
      2025-06-05-sev2-actions-delays.md
  investigations/         # Debugging/research narratives
    2025-05-12-api-timeout-spikes.md
    spikes/               # Time-boxed research spikes
      SPIKE-0042-grpc-migration.md
  problems/               # ITIL problem records (RCA/recurrence prevention)
    PRB-00023-message-queue-backpressure.md
  case-studies/           # Explanation-style writeups of larger efforts
    2025-streaming-pipeline-rewrite.md
    folder-naming-best-practices.md
  decisions/              # Technical proposals and decisions
    adr/                  # Architecture Decision Records
      0001-slo-policy-v2.md
    rfd/                  # Requests for Discussion (Oxide-style)
      0001-api-versioning-strategy.md
    tdr/                  # Technical Design Reviews
      TDR-0015-auth-redesign.md
  reviews/                # After Action Reports & learning reviews
    2025-12-01-aar-launch-incident.md
  retrospectives/         # Team retrospectives
    2025-Q4-team-alpha-retro.md
  runbooks/               # How-to operational procedures
    restart-batch-consumer.md
```

### Extended Directory Tree (for larger organizations)

```
docs/
  incidents/              # Postmortems, PIRs, outage reports
  investigations/         # Research and debugging
    spikes/               # Agile spikes
    explorations/         # Open-ended research
  problems/               # ITIL problem management
    rca/                  # Root cause analysis documents
  case-studies/           # Knowledge transfer articles
  decisions/              # All decision records
    adr/                  # Architecture decisions
    rfd/                  # Requests for discussion
    tdr/                  # Technical design reviews
    rfcs/                 # Requests for comments
  reviews/                # Post-event reviews
    aars/                 # After action reports
    learning-reviews/     # Incident learning reviews
  retrospectives/         # Team retrospectives
  failures/               # FRB reports (aerospace/safety-critical)
  proposals/              # One-pagers and proposals
  memos/                  # Technical memos and notes
  runbooks/               # Operational procedures
```

### Why This Structure Works

| Choice               | Rationale                                                     |
| -------------------- | ------------------------------------------------------------- |
| `docs/` as root      | Standard for MkDocs, Docusaurus, Jekyll; recognized by GitHub |
| Lowercase kebab-case | Universal convention; avoids cross-platform issues            |
| Date prefixes        | Enables chronological sorting; ISO 8601 format                |
| Type-based folders   | Separates concerns; matches industry frameworks               |

---

## File Naming Conventions

### By Document Type

| Type             | Pattern                                 | Example                              |
| ---------------- | --------------------------------------- | ------------------------------------ |
| Incidents        | `YYYY-MM-DD-sev[1-4]-short-slug.md`     | `2025-06-05-sev2-actions-delays.md`  |
| PIRs             | `YYYY-MM-DD-pir-short-slug.md`          | `2025-06-05-pir-database-outage.md`  |
| Investigations   | `YYYY-MM-DD-short-slug.md`              | `2025-05-12-api-timeout-spikes.md`   |
| Spikes           | `SPIKE-<id>-topic.md`                   | `SPIKE-0042-grpc-migration.md`       |
| Problems (ITIL)  | `PRB-<id>-slug.md`                      | `PRB-00023-message-queue.md`         |
| RCAs             | `RCA-<id>-slug.md`                      | `RCA-0015-auth-failure.md`           |
| ADRs             | `NNNN-title.md`                         | `0001-slo-policy-v2.md`              |
| RFDs             | `NNNN-title.md`                         | `0001-api-versioning.md`             |
| RFCs             | `RFC-<id>-title.md`                     | `RFC-0023-logging-standard.md`       |
| TDRs             | `TDR-<id>-feature.md`                   | `TDR-0015-auth-redesign.md`          |
| AARs             | `YYYY-MM-DD-aar-event-slug.md`          | `2025-12-01-aar-launch-incident.md`  |
| Learning Reviews | `YYYY-MM-DD-learning-review-slug.md`    | `2025-06-05-learning-api-outage.md`  |
| Retrospectives   | `YYYY-QN-team-retro.md`                 | `2025-Q4-team-alpha-retro.md`        |
| FRB Reports      | `FRB-<id>-component.md`                 | `FRB-0008-power-subsystem.md`        |
| Case Studies     | `YYYY-topic-slug.md` or `topic-slug.md` | `2025-streaming-pipeline-rewrite.md` |
| One-Pagers       | `one-pager-topic.md`                    | `one-pager-dark-mode.md`             |
| Tech Memos       | `YYYY-MM-DD-memo-topic.md`              | `2025-06-15-memo-api-deprecation.md` |
| Runbooks         | `action-target.md`                      | `restart-batch-consumer.md`          |

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
title: 'SEV-2: Actions run delays'
date: 2025-06-05T17:47:00Z
doc_type: incident # incident | investigation | problem | case-study | adr
status: completed # draft | active | completed | superseded
severity: SEV-2 # SEV-1 | SEV-2 | SEV-3 | SEV-4 (for incidents)
components: [actions, copilot, pages]
owner: sre-oncall
tags: [postmortem, reliability]
related_issues: ['#1234']
related_prs: ['#5678']
---
```

### Severity Levels

| Level | Definition                           | Response               |
| ----- | ------------------------------------ | ---------------------- |
| SEV-1 | Critical - Total service outage      | Immediate, all-hands   |
| SEV-2 | Major - Significant feature degraded | Urgent, dedicated team |
| SEV-3 | Minor - Limited impact               | Normal priority        |
| SEV-4 | Low - Cosmetic or minor issue        | Best effort            |

### Incident Template

```markdown
---
doc_type: incident
title: 'SEV-2: <short summary>'
date: 2025-06-05T17:47:00Z
status: completed
severity: SEV-2
components: [<service>]
owner: sre-oncall
tags: [postmortem, reliability]
related_issues: ['#1234']
related_prs: ['#5678']
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
title: '<symptom or question>'
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
related_incidents: ['2025-06-05-actions-delays']
---

## Problem Statement

<description of the underlying issue>

## Known Error & Workaround

<temporary mitigation>

## RCA Summary

<causal chain analysis>

## Remediation Options

| Option | Pros | Cons | Effort |
| ------ | ---- | ---- | ------ |

## Chosen Fix & Plan

<selected approach with PR/issue links>
```

### Case Study Template

```markdown
---
doc_type: case-study
title: '<initiative>'
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

### RFD Template (Oxide-style)

```markdown
---
doc_type: rfd
id: '0001'
title: '<descriptive title>'
authors: ['name <email@example.com>']
state: discussion # prediscussion | ideation | discussion | published | committed | abandoned
date: 2025-06-15
---

## Overview

<brief description of the topic>

## Problem Statement

<what problem are we solving>

## Proposed Solution

<detailed description of the proposal>

## Alternatives Considered

<other approaches and why they were rejected>

## Implementation Plan

<how to implement the proposal>

## Open Questions

<unresolved issues for discussion>
```

**Source**: [Oxide RFD Process](https://oxide.computer/blog/rfd-1-requests-for-discussion)

### Technical Spike Template

```markdown
---
doc_type: spike
id: SPIKE-0042
title: '<technology or question to explore>'
timebox: 2d
date: 2025-06-15
status: completed # in-progress | completed | abandoned
owner: <name or team>
tags: [spike, research]
---

## Goal

<what are we trying to learn>

## Background

<context and why this spike is needed>

## Tasks / Activities

- [ ] <specific task to perform>

## Findings

<what we discovered>

## Recommendations

<suggested next steps based on findings>

## References

<links to documentation, code, or external resources>
```

**Source**: [Microsoft Technical Spike Template](https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/recipes/templates/template-technical-spike/)

### After Action Report (AAR) Template

```markdown
---
doc_type: aar
title: '<event or incident name>'
date: 2025-12-01
event_date: 2025-11-28
status: completed
owner: <name or team>
participants: [<list of participants>]
tags: [aar, review]
---

## Executive Summary

<brief overview of the event and key outcomes>

## Event Overview

- **Event**: <description>
- **Date/Time**: <when it occurred>
- **Duration**: <how long>
- **Scope**: <what was affected>

## What Went Well

<list of things that worked>

## What Could Be Improved

<list of areas for improvement>

## Observations

| Observation            | Category   | Recommendation          |
| ---------------------- | ---------- | ----------------------- |
| <specific observation> | <category> | <suggested improvement> |

## Action Items

| Action            | Owner         | Due Date | Status   |
| ----------------- | ------------- | -------- | -------- |
| <specific action> | <responsible> | <date>   | <status> |

## Lessons Learned

<key takeaways for future events>
```

**Source**: [FEMA AAR Template](https://preptoolkit.fema.gov/web/cip-citap/ncig/-/knowledge_base/ncig/2-3-1-after-action-report)

### Retrospective Template

```markdown
---
doc_type: retrospective
title: '<team> <period> Retrospective'
date: 2025-12-15
period: 2025-Q4
team: <team name>
facilitator: <name>
participants: [<list>]
tags: [retrospective, team]
---

## Summary

<brief overview of the retrospective focus>

## What Went Well

<things to continue doing>

## What Could Be Improved

<areas for growth>

## Action Items

| Action            | Owner         | Due Date |
| ----------------- | ------------- | -------- |
| <specific action> | <responsible> | <date>   |

## Team Health Check

| Category   | Rating (1-5) | Notes   |
| ---------- | ------------ | ------- |
| <category> | <rating>     | <notes> |

## Follow-up from Previous Retro

| Previous Action          | Status         | Notes   |
| ------------------------ | -------------- | ------- |
| <action from last retro> | <done/ongoing> | <notes> |
```

**Source**: [Echometer Blameless Retrospective Template](https://echometerapp.com/en/blameless-retrospective-template/)

### One-Pager Template

```markdown
---
doc_type: one-pager
title: '<feature or project name>'
date: 2025-06-15
author: <name>
status: proposed # proposed | approved | in-progress | completed
tags: [one-pager, proposal]
---

## Problem Statement

<what problem are we solving and why does it matter>

## Proposed Solution

<high-level description of the solution>

## Scope

**In Scope:**

- <what's included>

**Out of Scope:**

- <what's explicitly excluded>

## Success Metrics

<how will we measure success>

## User Flow (MVP)

1. <step 1>
2. <step 2>

## Open Questions

- <question 1>

## Risks

| Risk             | Mitigation       |
| ---------------- | ---------------- |
| <potential risk> | <how to address> |
```

**Source**: [HackerNoon One-Pager Template](https://hackernoon.com/the-one-pager-advantage-a-template-for-software-engineering-projects)

---

## Sources and References

### Primary Sources (Verified)

| Source                                     | URL                                                                                                                                        | Verified |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Google SRE Workbook - Postmortem Culture   | https://sre.google/workbook/postmortem-culture/                                                                                            | Yes      |
| Google SRE Book - Example Postmortem       | https://sre.google/sre-book/example-postmortem/                                                                                            | Yes      |
| MkDocs User Guide                          | https://www.mkdocs.org/user-guide/writing-your-docs/                                                                                       | Yes      |
| GitHub Docs - Community Health Files       | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file          | Yes      |
| GitHub Docs - Issue Templates              | https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates | Yes      |
| ADR Template - Michael Nygard              | https://github.com/joelparkerhenderson/architecture-decision-record                                                                        | Yes      |
| Diataxis Framework                         | https://diataxis.fr/                                                                                                                       | Yes      |
| Keep a Changelog                           | https://keepachangelog.com/en/1.0.0/                                                                                                       | Yes      |
| PagerDuty Postmortem Template              | https://response.pagerduty.com/after/post_mortem_template/                                                                                 | Yes      |
| Folder Structure Conventions               | https://github.com/kriasoft/Folder-Structure-Conventions                                                                                   | Yes      |
| World Bank Folder Naming                   | https://worldbank.github.io/template/docs/folders-and-naming.html                                                                          | Yes      |
| Postmortem Templates Collection            | https://github.com/dastergon/postmortem-templates                                                                                          | Yes      |
| GitHub Blog - Incident Analysis Example    | https://github.blog/news-insights/company-news/oct21-post-incident-analysis/                                                               | Yes      |
| NIST SP 800-61                             | https://csrc.nist.gov/pubs/sp/800/61/r2/final                                                                                              | Yes      |
| Oxide RFD Process                          | https://oxide.computer/blog/rfd-1-requests-for-discussion                                                                                  | Yes      |
| Oxide RFD 1 Document                       | https://rfd.shared.oxide.computer/rfd/0001                                                                                                 | Yes      |
| Microsoft Technical Spike Template         | https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/recipes/technical-spike/                                  | Yes      |
| NASA FRB Handbook                          | https://standards.nasa.gov/standard/GSFC/GSFC-HDBK-8700                                                                                    | Yes      |
| FEMA AAR Toolkit                           | https://preptoolkit.fema.gov/web/cip-citap/ncig/-/knowledge_base/ncig/2-3-1-after-action-report                                            | Yes      |
| AlertMedia AAR Guide                       | https://www.alertmedia.com/blog/after-action-report/                                                                                       | Yes      |
| Pragmatic Engineer - RFCs Design Docs      | https://blog.pragmaticengineer.com/rfcs-and-design-docs/                                                                                   | Yes      |
| Pragmatic Engineer - Postmortems           | https://blog.pragmaticengineer.com/postmortem-best-practices/                                                                              | Yes      |
| FireHydrant Blameless Retrospectives       | https://firehydrant.com/blog/what-are-blameless-retrospectives-do-they-work-how/                                                           | Yes      |
| Echometer Retrospective Template           | https://echometerapp.com/en/blameless-retrospective-template/                                                                              | Yes      |
| HackerNoon One-Pager Template              | https://hackernoon.com/the-one-pager-advantage-a-template-for-software-engineering-projects                                                | Yes      |
| Marfeel TDR Documentation                  | https://www.marfeel.com/docs/touch/extensibility/tdr.html                                                                                  | Yes      |
| Atlassian PIR Best Practices               | https://support.atlassian.com/jira-service-management-cloud/docs/post-incident-review-best-practices/                                      | Yes      |
| Asana RCA Template                         | https://asana.com/resources/root-cause-analysis-template                                                                                   | Yes      |
| Infrastructure Engineering Incident Review | https://infraeng.dev/incident-review/                                                                                                      | Yes      |
| FireHydrant Incident Retrospective         | https://firehydrant.com/blog/incident-retrospective-postmortem-template/                                                                   | Yes      |

### Additional Resources

- [GitHub Docs - Closing Issues with Keywords](https://docs.github.com/articles/closing-issues-using-keywords)
- [GitHub Docs - Security Policy](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)
- [Atlassian - Incident Severity Levels](https://www.atlassian.com/incident-management/kpis/severity-levels)
- [Atlassian - 5 Whys Analysis](https://www.atlassian.com/software/confluence/templates/5-whys-analysis)
- [GitHub Availability Report](https://github.blog/news-insights/company-news/github-availability-report-june-2025/)
- [Wikipedia - Spike (software development)](<https://en.wikipedia.org/wiki/Spike_(software_development)>)
- [Agilemania - What is an Agile Spike Story](https://agilemania.com/agile-spike-story-what-is-a-spike-in-agile)
- [LogRocket - What is a One-Pager](https://blog.logrocket.com/product-management/what-is-a-one-pager-examples-rules-template/)
- [dsebastien - The Art of Note Naming](https://www.dsebastien.net/the-art-of-note-naming-keys-to-effective-knowledge-management/)
- [MIT CommLab - File Structure](https://mitcommlab.mit.edu/meche/commkit/file-structure/)
- [AIAA S-102.1.5 - FRB Requirements](https://arc.aiaa.org/doi/book/10.2514/4.867071)

---

## Summary of Recommendations

1. **Use `docs/` as the root** for all technical documentation
2. **Organize by document type** with separate folders for `incidents/`, `investigations/`, `problems/`, `case-studies/`, `decisions/`, `reviews/`, `retrospectives/`, and `runbooks/`
3. **Follow kebab-case naming** with lowercase letters and hyphens
4. **Use ISO 8601 date prefixes** (`YYYY-MM-DD`) for chronological documents
5. **Use ID prefixes** for tracked documents (e.g., `PRB-`, `RCA-`, `SPIKE-`, `RFC-`, `TDR-`, `FRB-`)
6. **Include YAML front matter** for tooling compatibility and searchability
7. **Adopt severity levels** (SEV-1 through SEV-4) based on business impact
8. **Link related issues and PRs** to maintain traceability
9. **Create postmortems within 5 business days** of incidents
10. **Separate incident response (restore service) from problem management (prevent recurrence)**
11. **Write blameless, systems-focused documentation** that enables organizational learning
12. **Choose terminology consistently** - pick one term per document type and stick with it (see Terminology Mapping table)
13. **Consider organizational scale** - use extended folder structure for larger teams with more document types
14. **Time-box research activities** - use spikes to explore unknowns before committing to solutions
