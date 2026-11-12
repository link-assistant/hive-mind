// Value-free findings for public code/configuration examples.
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const engine = createSyncSanitizer({ credentialsOnly: true, transformation: { mode: 'hive-mask' } });
for (const text of ['set `password=<secret>` in the config', '`-c model_auto_compact_token_limit=<tokens>` overrides.', '`HIVE_MIND_CLAUDE_AUTH_AUTHORITY=conventional` to opt out.', '`HIVE_MIND_ROUTER_AUTH_GUARD=0` disables it.', '`HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT=1` opts out.']) {
  console.log(JSON.stringify({ text, output: engine.sanitize(text).text, findings: engine.inspect(text) }));
}
