/* global console */
// Which tag does the freshness gate's registry resolver pick for each image Hive Mind pins outside Dockerfiles?
import { resolveContainerLatest, resolveGitHubLatest } from '../../scripts/dependency-freshness.lib.mjs';

for (const [name, current] of [
  ['ghcr.io/link-assistant/router', '0.125.4'],
  ['ghcr.io/link-foundation/box', '2.10.5'],
  ['ghcr.io/link-foundation/box-essentials-dind', '2.10.4'],
]) {
  try {
    console.log(name, current, '->', await resolveContainerLatest(name, { current }));
  } catch (error) {
    console.log(name, 'ERROR', error.message);
  }
}
console.log('github link-foundation/box ->', await resolveGitHubLatest('link-foundation/box'));
