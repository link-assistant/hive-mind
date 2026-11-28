## Use case

A service stores its current state in a link-cli database. Deploying a new service version can require renaming a relation, backfilling links, or changing how an existing record is represented. Operators need to roll the service forward or back while preserving unrelated writes. A migration also needs to be safe to retry after a restart.

Hive Mind has this need for the Telegram bot state mirror. Its companion LiNo snapshot and the binary store must expose the same schema version after a deploy. [Integration context](https://github.com/link-assistant/hive-mind/pull/4146#issuecomment-7227426648)

## Reproduction with Rust link-cli 3.3.3

```sh
db_dir=$(mktemp -d)
printf '%s\n' '(task: key value)' > "$db_dir/bootstrap.lino"
clink --version
clink --db "$db_dir/state.links" --in "$db_dir/bootstrap.lino" --transactions
clink --db "$db_dir/state.links" --migrate up
```

The import succeeds. The last command exits 1 with `Error: unknown option '--migrate'`. `clink --help` documents import, transaction history, and tags/checkouts. There is no command for planning or applying ordered schema changes, tracking their application, or applying only a particular schema change's inverse. Checking out the tag from before a schema change also reverts subsequent graph changes on that branch.

## Suggested behavior

- Describe ordered migrations using immutable IDs, checksums, and a forward transformation. Let authors optionally supply a reverse transformation.
- Generate reverse steps for invertible operations from the committed change set and its before-images. Reject ambiguous or lossy rollback unless the migration supplies a reverse step. Detect conflicts with later writes so down does not silently remove application data.
- Add a CLI to list and plan migrations, apply up or down to a target manually, and configure automatic up or down on open. Opening a store should retain a mode that requires an operator to migrate it explicitly.
- Apply the graph change, its generated rollback data, and migration history in the same transaction under the store lock. Failed operations should leave the graph and the applied migration list unchanged. Keep rollback information independently of the regular journal retention limit.

## Current workaround

The service stores a schema marker in its logical snapshot, keeps ordered migrations in its application, and holds an outer lock while migrating the text copy and importing the corresponding binary snapshot with `--transactions`. It derives the inverse of declared field additions and renames, or accepts an explicit down step. The text copy allows it to retry and repair the mirror if the process stops between writes. The workaround covers Hive Mind snapshots, and other link-cli users still need their own migration runner.
