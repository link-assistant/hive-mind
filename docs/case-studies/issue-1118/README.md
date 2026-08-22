# Case Study: Issue #1118 - Automatically Accepting GitHub Invitations via gh CLI

## Executive Summary

This case study investigates whether it is possible to automatically accept invitations to private repositories and organizations using the GitHub CLI (`gh`) tool.

**Key Finding:** Yes, it is fully possible to automatically accept both repository and organization invitations using the `gh api` command to interact with GitHub's REST API. While there is no dedicated high-level `gh` command like `gh repo accept-invite` or `gh org join`, the underlying API functionality is complete and accessible.

## Research Question

> Can we automatically accept invitations to private repositories and organizations via the `gh` CLI tool?

## Findings Overview

| Capability                      | Support Level   | Method                                                         |
| ------------------------------- | --------------- | -------------------------------------------------------------- |
| List repository invitations     | Fully supported | `gh api /user/repository_invitations`                          |
| Accept repository invitations   | Fully supported | `gh api -X PATCH /user/repository_invitations/{id}`            |
| Decline repository invitations  | Fully supported | `gh api -X DELETE /user/repository_invitations/{id}`           |
| List org membership/invitations | Fully supported | `gh api /user/memberships/orgs`                                |
| Accept organization invitations | Fully supported | `gh api -X PATCH /user/memberships/orgs/{org} -f state=active` |

## Detailed Analysis

### 1. Repository Invitations

#### API Endpoints

The GitHub REST API provides complete support for managing repository invitations:

| Action       | Method | Endpoint                                       | Required Scope          |
| ------------ | ------ | ---------------------------------------------- | ----------------------- |
| List pending | GET    | `/user/repository_invitations`                 | `repo:invite` or `repo` |
| Accept       | PATCH  | `/user/repository_invitations/{invitation_id}` | `repo:invite` or `repo` |
| Decline      | DELETE | `/user/repository_invitations/{invitation_id}` | `repo:invite` or `repo` |

#### Example: Accept All Repository Invitations

```bash
# List all pending invitations
gh api /user/repository_invitations --jq '.[] | {id, repo: .repository.full_name, inviter: .inviter.login}'

# Accept a specific invitation
gh api -X PATCH /user/repository_invitations/12345678

# Accept ALL pending invitations (one-liner)
gh api /user/repository_invitations --jq '.[].id' | xargs -I{} gh api -X PATCH /user/repository_invitations/{}
```

#### Important Notes

- The `repo:invite` OAuth scope provides targeted access to invitations without granting access to repository code
- The `repo` scope grants both code access and invitation management
- Invitations can expire (typically after 7 days) - the API response includes an `expired` field
- Response status `204 No Content` indicates successful acceptance

### 2. Organization Invitations

#### API Endpoints

Organization membership invitations are managed through membership endpoints:

| Action            | Method | Endpoint                       | Required Scope             |
| ----------------- | ------ | ------------------------------ | -------------------------- |
| List memberships  | GET    | `/user/memberships/orgs`       | `read:org`                 |
| Accept invitation | PATCH  | `/user/memberships/orgs/{org}` | `admin:org` or `write:org` |

#### Example: Accept All Organization Invitations

```bash
# List all organization memberships (active and pending)
gh api /user/memberships/orgs --jq '.[] | {org: .organization.login, state, role}'

# Filter for pending invitations only
gh api /user/memberships/orgs --jq '.[] | select(.state == "pending") | .organization.login'

# Accept a specific organization invitation
gh api -X PATCH /user/memberships/orgs/org-name -f state=active

# Accept ALL pending organization invitations
gh api /user/memberships/orgs --jq '.[] | select(.state == "pending") | .organization.login' | \
  xargs -I{} gh api -X PATCH /user/memberships/orgs/{} -f state=active
```

#### Key Differences from Repository Invitations

- Organization invitations appear as memberships with `state: "pending"` rather than as separate invitation objects
- Accepting requires setting `state` to `"active"` in the request body
- The response returns the full membership object (status `200`) rather than `204 No Content`

### 3. GitHub CLI Native Support Status

As of January 2026, the GitHub CLI (`gh`) does **not** have dedicated high-level commands for invitation management:

| Missing Command         | Status            | Reference                                              |
| ----------------------- | ----------------- | ------------------------------------------------------ |
| `gh repo accept-invite` | Not implemented   | No feature request found                               |
| `gh org invite`         | Feature requested | [cli/cli#9122](https://github.com/cli/cli/issues/9122) |
| `gh org join`           | Not implemented   | Community workarounds exist                            |

**Workaround:** Use `gh api` to directly call the REST API endpoints as shown above.

## Proposed Solutions

### Solution 1: Shell Script (Simplest)

Create a simple bash script for one-time or periodic execution:

```bash
#!/bin/bash
# accept-all-invitations.sh

echo "Accepting repository invitations..."
gh api /user/repository_invitations --jq '.[].id' | while read id; do
    gh api -X PATCH "/user/repository_invitations/$id"
    echo "Accepted repository invitation: $id"
done

echo "Accepting organization invitations..."
gh api /user/memberships/orgs --jq '.[] | select(.state == "pending") | .organization.login' | while read org; do
    gh api -X PATCH "/user/memberships/orgs/$org" -f state=active
    echo "Accepted organization invitation: $org"
done
```

See [scripts/accept-all-repo-invitations.sh](scripts/accept-all-repo-invitations.sh) and [scripts/accept-all-org-invitations.sh](scripts/accept-all-org-invitations.sh) for complete implementations with error handling and dry-run support.

### Solution 2: Node.js Script (With Filtering)

For more control over which invitations to accept (allowlists, denylists):

See [scripts/accept-invitations.mjs](scripts/accept-invitations.mjs) for a complete implementation with features:

- Dry-run mode
- Allow/deny lists for filtering by inviter
- Separate repository/organization handling
- Detailed logging

### Solution 3: GitHub Actions Workflow (Automated)

For continuous automatic acceptance on a schedule:

```yaml
name: Accept Invitations
on:
  schedule:
    - cron: '0 * * * *' # Every hour
  workflow_dispatch:

jobs:
  accept:
    runs-on: ubuntu-latest
    steps:
      - name: Accept all invitations
        run: |
          gh api /user/repository_invitations --jq '.[].id' | \
            xargs -I{} gh api -X PATCH /user/repository_invitations/{}
          gh api /user/memberships/orgs --jq '.[] | select(.state == "pending") | .organization.login' | \
            xargs -I{} gh api -X PATCH /user/memberships/orgs/{} -f state=active
        env:
          GH_TOKEN: ${{ secrets.INVITE_TOKEN }}
```

See [scripts/github-action-accept-invitations.yml](scripts/github-action-accept-invitations.yml) for the complete workflow with manual trigger and options.

### Solution 4: Use Existing Tools

Several open-source tools already implement this functionality:

1. **[accept-github-invitations](https://github.com/hi-ashleyj/accept-github-invitations)** (Node.js)
   - Configurable allow/deny lists
   - Strict mode for allowlist-only acceptance
   - Can run as GitHub Action

2. **[PyGithub](https://github.com/PyGithub/PyGithub)** (Python)
   - `AuthenticatedUser.get_invitations()` - List pending invitations
   - `AuthenticatedUser.accept_invitation(id)` - Accept an invitation

### Solution 5: Feature Request to GitHub CLI

Consider contributing to the [GitHub CLI project](https://github.com/cli/cli):

1. Open a feature request for `gh repo invitation` commands
2. Reference existing issue [#9122](https://github.com/cli/cli/issues/9122) for organization invitations
3. Contribute an implementation as a PR

## Security Considerations

### Token Scopes

| Scope                      | Provides Access To                                           |
| -------------------------- | ------------------------------------------------------------ |
| `repo:invite`              | Repository invitations only (recommended for minimal access) |
| `repo`                     | Full repository access including invitations                 |
| `read:org`                 | List organization memberships                                |
| `write:org` or `admin:org` | Accept organization invitations                              |

### Best Practices

1. **Use minimal scopes**: Prefer `repo:invite` over `repo` when only invitation management is needed
2. **Implement allowlists**: Only accept invitations from known/trusted users or organizations
3. **Review before automating**: Manually review pending invitations before enabling auto-accept
4. **Log all actions**: Keep audit logs of accepted invitations
5. **Regular token rotation**: Rotate PATs periodically, especially for automation

### Example: Allowlist-Only Acceptance

```bash
# Only accept from trusted organizations
TRUSTED_ORGS="my-company other-trusted-org"

gh api /user/memberships/orgs --jq '.[] | select(.state == "pending") | .organization.login' | while read org; do
    if echo "$TRUSTED_ORGS" | grep -qw "$org"; then
        gh api -X PATCH "/user/memberships/orgs/$org" -f state=active
        echo "Accepted: $org"
    else
        echo "Skipped (not trusted): $org"
    fi
done
```

## Live Testing Results

During this research, we verified the API functionality:

```
$ gh api /user/repository_invitations --jq 'length'
8

$ gh api /user/repository_invitations --jq '.[0:3] | .[] | {repo: .repository.full_name, expired}'
{"repo":"suenot/trading-terms","expired":true}
{"repo":"VogelOygen/Test_Canaan","expired":true}
{"repo":"goplay1937/main","expired":true}

$ gh api /user/memberships/orgs --jq '.[] | select(.state == "pending") | .organization.login'
(no output - no pending organization invitations)
```

## Conclusion

**Is it possible to automatically accept invitations via gh CLI?**

**Yes, absolutely.** While there are no dedicated high-level commands, the `gh api` command provides full access to all necessary REST API endpoints for:

- Listing pending repository invitations
- Accepting/declining repository invitations
- Listing organization memberships (including pending invitations)
- Accepting organization invitations

The solution can be implemented as:

- A simple shell script for manual/periodic execution
- A Node.js/Python script with advanced filtering
- A GitHub Actions workflow for continuous automation
- Using existing open-source tools

## Recommendations

1. **For simple use cases**: Use the shell scripts provided in this case study
2. **For selective acceptance**: Use the Node.js script with allowlists/denylists
3. **For continuous automation**: Deploy the GitHub Actions workflow
4. **For enterprise use**: Consider building a GitHub App for better audit trails and fine-grained permissions

## Data Files

| File                                                                     | Description                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| [api-endpoints.json](api-endpoints.json)                                 | Complete API endpoint reference                  |
| [research-sources.json](research-sources.json)                           | Sources and references used in this research     |
| [repository-invitations-sample.json](repository-invitations-sample.json) | Sample API response for repository invitations   |
| [org-memberships-sample.json](org-memberships-sample.json)               | Sample API response for organization memberships |
| [scripts/](scripts/)                                                     | Ready-to-use scripts for invitation management   |

## References

### Official Documentation

- [GitHub REST API - Repository Invitations](https://docs.github.com/en/rest/collaborators/invitations)
- [GitHub REST API - Organization Members](https://docs.github.com/en/rest/orgs/members)
- [GitHub CLI Manual](https://cli.github.com/manual/)

### Related Issues & Discussions

- [cli/cli#9122 - Feature request for org invite commands](https://github.com/cli/cli/issues/9122)
- [community#29606 - API for accepting org/team invitations](https://github.com/orgs/community/discussions/29606)

### Third-Party Tools

- [accept-github-invitations](https://github.com/hi-ashleyj/accept-github-invitations) - Node.js utility
- [PyGithub](https://github.com/PyGithub/PyGithub) - Python library with invitation support

---

_Case study completed: January 12, 2026_
_Original Issue: [link-assistant/hive-mind#1118](https://github.com/link-assistant/hive-mind/issues/1118)_
