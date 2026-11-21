// Prints parseVersion/compareVersions for a few tricky versions (issue #3863).
import { compareVersions, parseVersion } from '../src/fix.dependabot-superseded.lib.mjs';

for (const [a, b] of [
  ['5.0.0rc1', '5.0.0'],
  ['1.0.0.post1', '1.0.0'],
  ['26.3', '26.3.0'],
  ['1.0.0-rc.1', '1.0.0'],
]) {
  console.log(a, JSON.stringify(parseVersion(a)), b, JSON.stringify(parseVersion(b)), '→', compareVersions(a, b));
}
