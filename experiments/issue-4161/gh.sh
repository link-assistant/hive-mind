#!/bin/sh
# Serve read-only GitHub fixtures and record any attempted mutation.
printf 'gh %s\n' "$*" >> "$SOLVE_FIXTURE_COMMANDS"

case "$1 $2" in
  'repo clone') exec git clone "$SOLVE_FIXTURE_REMOTE" "$4" ;;
  'repo view') exit 1 ;;
  'auth status' | 'auth setup-git') exit 0 ;;
  'auth token') exit 1 ;;
  'issue view') printf '%s\n' '{"number":16,"title":"Fixture issue","state":"OPEN"}'; exit 0 ;;
  'pr view')
    printf '%s\n' '{"number":17,"headRefName":"issue-16-abcd1234","baseRefName":"main","body":"Fixes #16","state":"OPEN","mergeStateStatus":"CLEAN","isDraft":false,"headRepositoryOwner":{"login":"fixture"},"headRepository":{"name":"repo"}}'
    exit 0
    ;;
  'pr list')
    if [ "$SOLVE_FIXTURE_CASE" = existing ]; then
      printf '[{"number":17,"headRefName":"issue-16-abcd1234","state":"OPEN","isDraft":false,"createdAt":"%s"}]\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else
      printf '%s\n' '[]'
    fi
    exit 0
    ;;
esac

if [ "$1" = api ]; then
  shift
  # GraphQL reads use POST transport. Only a query operation belongs here.
  if [ "$1" = graphql ] && [ "$2" = -f ]; then
    case "$3" in
      query=query\(*) printf '%s\n' '{"data":{"repository":{}}}'; exit 0 ;;
    esac
  fi
  case " $* " in
    *' --method GET '* | *' -X GET '*) ;;
    *' --method '* | *' -X '* | *' --field '* | *' --raw-field '* | *' -f '* | *' -F '* | *' --input '*)
      printf 'WRITE gh api %s\n' "$*" >> "$SOLVE_FIXTURE_COMMANDS"
      exit 1
      ;;
  esac
  case "$*" in
    *'/repository_invitations'*)
      printf '%s\n' '[{"id":123,"repository":{"full_name":"fixture/repo"}}]' ;;
    *'/memberships/orgs'*) printf '%s\n' '[]' ;;
    'users/fixture '*) printf '%s\n' 'fixture' ;;
    'user '*) printf '%s\n' 'fixture-reader' ;;
    *' --jq .full_name'*) printf '%s\n' 'fixture/repo' ;;
    *' --jq .permissions'*) printf '%s\n' '{"push":true,"pull":true}' ;;
    *' --jq .visibility'*) printf '%s\n' 'public' ;;
    *' --jq .private'*) printf '%s\n' 'false' ;;
    *' --jq .default_branch'*) printf '%s\n' 'main' ;;
    *' --jq .updated_at'*) printf '%s\n' '2026-01-02T12:00:00Z' ;;
    *' --jq .login'*) printf '%s\n' 'fixture-reader' ;;
    *' --jq .head.sha'*) printf '%s\n' '123abc' ;;
    *'last.commit.author.date'*) printf '%s\n' '2026-01-02T12:00:00Z' ;;
    *'/contents/'*) exit 1 ;;
    *'/git/ref/heads/'*) printf '%s\n' '{"ref":"refs/heads/release"}' ;;
    *'/branches/release --jq .name'*) printf '%s\n' 'release' ;;
    *'/branches'*)
      if [ "$SOLVE_FIXTURE_CASE" = existing ] || [ "$SOLVE_FIXTURE_CASE" = orphan ]; then
        printf '%s\n' 'issue-16-abcd1234'
      else
        printf '%s\n' 'main'
      fi
      ;;
    *'/issues?'*)
      printf '%s\n' '[{"number":16,"title":"First","html_url":"https://github.com/fixture/repo/issues/16","created_at":"2026-01-01T12:00:00Z"},{"number":18,"title":"Second","html_url":"https://github.com/fixture/repo/issues/18","created_at":"2026-01-02T12:00:00Z"}]'
      ;;
    *'/comments'* | *'/commits'* | *'/reviews'*) printf '%s\n' '[]' ;;
    'repos/fixture/repo') printf '%s\n' '{"name":"repo","default_branch":"main","private":false,"visibility":"public"}' ;;
    *) printf '%s\n' '{}' ;;
  esac
  exit 0
fi

printf 'WRITE gh %s\n' "$*" >> "$SOLVE_FIXTURE_COMMANDS"
exit 1
