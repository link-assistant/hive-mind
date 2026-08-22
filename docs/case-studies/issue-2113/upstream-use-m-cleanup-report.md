# Recursive alias cleanup can fail with ENOTEMPTY because rm has no retry budget

Filed as [link-foundation/use-m#68](https://github.com/link-foundation/use-m/issues/68).

## Problem

`use-m@8.14.3` added corrupt-alias self-healing in #67. A production run made
after that release reached the new repair path, but repair itself failed:

```text
Failed to remove corrupt npm alias '.../command-stream-v-latest'.
Caused by: Error: ENOTEMPTY: directory not empty, rmdir
'.../command-stream-v-latest/examples' (code: ENOTEMPTY)
```

Environment: Linux, Docker-in-Docker. The launcher reports Node 24.3.0; the
affected global alias is under the NVM 20.20.2 prefix. Full downstream log:
https://gist.github.com/konard/154eaf009bdf41cd722fe902cfbcb10c

The shared `removePackageAlias()` calls:

```js
await rm(packagePath, { recursive: true, force: true });
```

Node's `fsPromises.rm` documentation says `ENOTEMPTY` is retryable when
`recursive` is true, but `maxRetries` defaults to zero. A concurrent installer
or another filesystem mutation can therefore win between directory enumeration
and removal, and the transient race escapes from the recovery path.

## Reproduction

The downstream stress reproduction keeps writing into an alias while it is
removed:

https://github.com/link-assistant/hive-mind/blob/issue-2113-39f0b66307a2/experiments/issue-2113/reproduce-cleanup-race.mjs

On Node 20/Linux (the downstream development environment):

```text
default rm reproduced ENOTEMPTY on attempt 1
retry-budget rm completed without leaving the alias behind
```

The exact production error shape is also covered by an automated downstream
regression test.

## Suggested fix

Give recursive alias removal an explicit retry budget:

```js
await rm(packagePath, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
});
```

Because `removePackageAlias()` is shared, this covers both cleanup after a
failed install and cleanup before corrupt-alias repair. A regression test can
inject or provoke `ENOTEMPTY` and verify that removal is retried before the
repair fails.

## Downstream workaround

Hive Mind classifies only use-m's exact `Failed to remove
(corrupt|incomplete) npm alias ...` wrapper when its cause is one of Node's
documented recursive-rm retry codes. It extracts the alias, removes it with an
explicit retry budget, and calls `use()` again:

https://github.com/link-assistant/hive-mind/pull/2114

Related: [use-m #66](https://github.com/link-foundation/use-m/issues/66) and
[use-m PR #67](https://github.com/link-foundation/use-m/pull/67).
