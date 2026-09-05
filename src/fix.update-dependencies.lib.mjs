/**
 * Pure helpers for the `/fix --update-all-dependencies` command (issue #2184).
 *
 * `/fix --update-all-dependencies <repository>` mirrors `/fix --ci-cd`:
 *   1. detect the languages used in the target repository and the dependency
 *      manifests actually committed to its default branch,
 *   2. map both signals onto package ecosystems, ordered by how much of the
 *      repository each one covers,
 *   3. create a maintenance issue that lists every ecosystem with the manifests
 *      found, the lockfiles to regenerate and the command that actually crosses
 *      major versions in that ecosystem, followed by the standard prompt, and
 *   4. hand the issue off to `/solve --development-log --deep-analysis
 *      --auto-merge --update-all-dependencies`, forwarding every option `/fix`
 *      does not consume itself.
 *
 * Unlike `--ci-cd`, whose prompt is quoted from web-capture#139, there is no
 * single upstream template issue for dependency updates. The prompt below was
 * written from the recurring shape of the real ones in the organisation —
 * link-foundation/links-notation#292, link-foundation/lino-objects-codec#47 and
 * link-assistant/router#372 — all of which ask for a per-language table of
 * pinned-vs-latest versions, deliberate major upgrades, and one consistent
 * version across implementations.
 *
 * Everything that does not touch the network or the filesystem lives here so it
 * can be unit-tested without GitHub access.
 */

import { KEEP_WORKING_PROMPT } from './solve.keep-working.detect.lib.mjs';
// `normalizeLanguages`/`buildLanguagesSection` render the same GitHub Linguist
// payload for both `/fix` modes; they keep their original home so the existing
// tests stay pointed at one implementation.
import { buildLanguagesSection, normalizeLanguages } from './fix.ci-cd.lib.mjs';

/**
 * Canonical package-ecosystem catalog.
 *
 * Coverage was checked against the 33 `package-ecosystem` values Dependabot
 * accepts (see docs/case-studies/issue-2184/data/dependabot-package-ecosystems.json);
 * every `updateCommand` was verified against that tool's own documentation (see
 * data/ecosystem-update-commands.json).
 *
 * `languages` are GitHub Linguist names — the same signal `/fix --ci-cd` uses.
 * `manifests`/`lockfiles` are exact file names and `pathPatterns` are regular
 * expressions, because some ecosystems (GitHub Actions, .NET projects, Docker,
 * Terraform) are identified by a path shape rather than by a fixed name.
 *
 * Order in this array is the stable tie-breaker when two ecosystems carry the
 * same weight.
 */
export const DEPENDENCY_ECOSYSTEMS = Object.freeze(
  [
    {
      key: 'javascript',
      label: 'JavaScript / TypeScript',
      languages: ['JavaScript', 'TypeScript'],
      manifests: ['package.json'],
      lockfiles: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'],
      dependabot: ['npm', 'yarn', 'pnpm', 'bun'],
      updateCommand: 'npx npm-check-updates -u && npm install',
      note: '`npm update` stays inside the existing semver ranges and never crosses a major; `npm-check-updates -u` rewrites package.json to the `latest` dist-tag.',
    },
    {
      key: 'python',
      label: 'Python',
      languages: ['Python'],
      manifests: ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml'],
      lockfiles: ['uv.lock', 'poetry.lock', 'Pipfile.lock', 'requirements.lock'],
      pathPatterns: [/(^|\/)requirements[^/]*\.(txt|in)$/],
      dependabot: ['pip', 'uv'],
      updateCommand: 'uv lock --upgrade  •  pip-compile --upgrade  •  poetry update',
      note: 'Raise the floors in pyproject.toml as well: a `>=` floor years below the resolved version means CI and a fresh install are not testing the same tree. Drop upper bounds that exclude the current release.',
    },
    {
      key: 'rust',
      label: 'Rust',
      languages: ['Rust'],
      manifests: ['Cargo.toml'],
      lockfiles: ['Cargo.lock'],
      dependabot: ['cargo', 'rust-toolchain'],
      updateCommand: 'cargo upgrade --incompatible && cargo update  (cargo-edit)',
      note: 'Plain `cargo update` only moves Cargo.lock inside the requirements already in Cargo.toml. `cargo update --breaking` rewrites them but is nightly-only (`-Z unstable-options`), so `cargo upgrade --incompatible` from cargo-edit is the stable route. Revisit `edition` and `rust-version` too.',
    },
    {
      key: 'go',
      label: 'Go',
      languages: ['Go'],
      manifests: ['go.mod'],
      lockfiles: ['go.sum'],
      dependabot: ['gomod'],
      updateCommand: 'go get -u ./... && go mod tidy',
      note: 'Also review the `go` directive itself — it pins the language version, not just the dependencies.',
    },
    {
      key: 'csharp',
      label: 'C# / .NET',
      languages: ['C#', 'F#', 'Visual Basic .NET'],
      manifests: ['Directory.Packages.props', 'Directory.Build.props', 'packages.config', 'global.json'],
      lockfiles: ['packages.lock.json'],
      pathPatterns: [/\.(cs|fs|vb)proj$/],
      dependabot: ['nuget', 'dotnet-sdk'],
      updateCommand: 'dotnet outdated -u  (dotnet-outdated)  •  dotnet list package --outdated',
      note: 'Check `TargetFramework` at the same time; a test SDK or xunit major usually moves with it.',
    },
    {
      key: 'java',
      label: 'Java / Kotlin / Scala',
      languages: ['Java', 'Kotlin', 'Scala', 'Groovy'],
      manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'build.sbt'],
      lockfiles: ['gradle.lockfile'],
      pathPatterns: [/(^|\/)gradle\/libs\.versions\.toml$/, /(^|\/)gradle\/wrapper\/gradle-wrapper\.properties$/],
      dependabot: ['maven', 'gradle', 'sbt'],
      updateCommand: 'mvn versions:use-latest-releases versions:update-properties  •  ./gradlew dependencyUpdates',
      note: 'Maven pins most versions in `<properties>`, so `versions:use-latest-releases` alone leaves them behind — run `versions:update-properties` too. Review `maven.compiler.source/target` and the Gradle wrapper version.',
    },
    {
      key: 'php',
      label: 'PHP',
      languages: ['PHP'],
      manifests: ['composer.json'],
      lockfiles: ['composer.lock'],
      dependabot: ['composer'],
      updateCommand: 'composer update --with-all-dependencies',
      note: 'Crossing a major needs the constraint rewritten first (`composer require vendor/pkg:^X`); `composer update` alone resolves inside composer.json.',
    },
    {
      key: 'ruby',
      label: 'Ruby',
      languages: ['Ruby'],
      manifests: ['Gemfile'],
      lockfiles: ['Gemfile.lock'],
      pathPatterns: [/\.gemspec$/],
      dependabot: ['bundler'],
      updateCommand: 'bundle update --all',
      note: 'Constraints live in the Gemfile and the gemspec; `bundle update --all` respects both.',
    },
    {
      key: 'elixir',
      label: 'Elixir / Erlang',
      languages: ['Elixir', 'Erlang'],
      manifests: ['mix.exs', 'rebar.config'],
      lockfiles: ['mix.lock', 'rebar.lock'],
      dependabot: ['hex'],
      updateCommand: 'mix deps.update --all',
    },
    {
      key: 'dart',
      label: 'Dart / Flutter',
      languages: ['Dart'],
      manifests: ['pubspec.yaml'],
      lockfiles: ['pubspec.lock'],
      dependabot: ['pub'],
      updateCommand: 'dart pub upgrade --major-versions',
      note: '`--major-versions` is what ignores the upper bounds in pubspec.yaml and rewrites them; plain `dart pub upgrade` stays inside them.',
    },
    {
      key: 'swift',
      label: 'Swift',
      languages: ['Swift', 'Objective-C'],
      manifests: ['Package.swift', 'Podfile', 'Cartfile'],
      lockfiles: ['Package.resolved', 'Podfile.lock', 'Cartfile.resolved'],
      dependabot: ['swift'],
      updateCommand: 'swift package update  •  pod update',
    },
    {
      key: 'haskell',
      label: 'Haskell',
      languages: ['Haskell'],
      manifests: ['stack.yaml', 'cabal.project'],
      lockfiles: ['stack.yaml.lock', 'cabal.project.freeze'],
      pathPatterns: [/\.cabal$/],
      dependabot: [],
      updateCommand: 'cabal update && cabal outdated  •  stack upgrade --resolver latest',
    },
    {
      key: 'github-actions',
      label: 'GitHub Actions',
      languages: [],
      manifests: ['action.yml', 'action.yaml'],
      pathPatterns: [/^\.github\/workflows\/[^/]+\.ya?ml$/],
      dependabot: ['github-actions'],
      updateCommand: 'bump every `uses:` reference to the newest release (tag or pinned digest)',
      note: 'Actions pinned to a stale major (`actions/checkout@v3`) are the most common source of deprecation warnings in an otherwise green pipeline. Update reusable workflows and composite `action.yml` files too.',
      alwaysRelevantWhen: files => files.some(file => /^\.github\//.test(file)),
    },
    {
      key: 'docker',
      label: 'Docker',
      languages: ['Dockerfile'],
      manifests: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
      pathPatterns: [/(^|\/)Dockerfile([.-][^/]*)?$/, /(^|\/)devcontainer\.json$/],
      dependabot: ['docker', 'docker-compose', 'devcontainers'],
      updateCommand: 'bump each `FROM` base-image tag (and re-pin the digest, if digests are used)',
      note: 'A base image is a dependency: an old `FROM` ships the distribution’s unpatched libraries no matter how current the language packages are.',
    },
    {
      key: 'infrastructure',
      label: 'Infrastructure as code',
      languages: ['HCL'],
      manifests: ['Chart.yaml', '.pre-commit-config.yaml'],
      pathPatterns: [/\.tf$/, /(^|\/)\.gitmodules$/],
      dependabot: ['terraform', 'opentofu', 'helm', 'pre-commit', 'gitsubmodule'],
      updateCommand: 'terraform init -upgrade  •  helm dependency update  •  pre-commit autoupdate  •  git submodule update --remote',
    },
  ].map(ecosystem => Object.freeze({ ...ecosystem, manifests: Object.freeze(ecosystem.manifests || []), lockfiles: Object.freeze(ecosystem.lockfiles || []), pathPatterns: Object.freeze(ecosystem.pathPatterns || []), dependabot: Object.freeze(ecosystem.dependabot || []) }))
);

export const DEPENDENCY_BEST_PRACTICES_URL = 'https://github.com/link-assistant/hive-mind/blob/main/docs/DEPENDENCY-UPDATE-BEST-PRACTICES.md';

/** Basename of a repository-relative path. */
function baseName(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** Directories a dependency update must never be looked for in. */
const IGNORED_PATH = /(^|\/)(node_modules|vendor|\.git|dist|build|target|\.venv|venv|third_party|Pods)\//;

/** Does `filePath` belong to `ecosystem`? */
export function matchesEcosystem(ecosystem, filePath) {
  const path = String(filePath || '').replace(/\\/g, '/');
  if (!path || IGNORED_PATH.test(path)) return false;
  const name = baseName(path);
  if (ecosystem.manifests.includes(name)) return true;
  if (ecosystem.lockfiles.includes(name)) return true;
  return ecosystem.pathPatterns.some(pattern => pattern.test(path));
}

/**
 * Map a repository onto the ecosystems that need updating (issue #2184).
 *
 * Two independent signals are combined, because either alone is wrong:
 *   - Linguist languages miss ecosystems that contain no source code of their
 *     own (GitHub Actions workflows, Dockerfiles, Terraform), and
 *   - committed manifests miss a language whose manifest is unusual or absent.
 *
 * Ecosystems are ordered by detected language bytes first (the same ordering
 * `/fix --ci-cd` applies to its templates), then by whether manifests were
 * found, then by catalog order. Returns the matched ecosystems with the exact
 * manifest and lockfile paths found for each, plus the detected languages that
 * no ecosystem claimed.
 */
export function mapRepositoryToEcosystems({ languages = {}, files = [] } = {}) {
  const normalizedLanguages = normalizeLanguages(languages);
  const fileList = (Array.isArray(files) ? files : []).map(file => String(file || '').replace(/\\/g, '/')).filter(Boolean);

  const bytesByLanguage = new Map(normalizedLanguages.map(({ name, bytes }) => [name.toLowerCase(), bytes]));
  const claimedLanguages = new Set();
  const detected = [];

  DEPENDENCY_ECOSYSTEMS.forEach((ecosystem, index) => {
    const matchedLanguages = ecosystem.languages.filter(language => bytesByLanguage.has(language.toLowerCase()));
    const bytes = matchedLanguages.reduce((sum, language) => sum + (bytesByLanguage.get(language.toLowerCase()) || 0), 0);

    const matchedFiles = fileList.filter(file => matchesEcosystem(ecosystem, file));
    const manifests = matchedFiles.filter(file => ecosystem.manifests.includes(baseName(file)) || ecosystem.pathPatterns.some(pattern => pattern.test(file)));
    const lockfiles = matchedFiles.filter(file => ecosystem.lockfiles.includes(baseName(file)));

    const relevant = matchedLanguages.length > 0 || matchedFiles.length > 0 || (typeof ecosystem.alwaysRelevantWhen === 'function' && ecosystem.alwaysRelevantWhen(fileList));
    if (!relevant) return;

    for (const language of matchedLanguages) claimedLanguages.add(language.toLowerCase());
    detected.push({ ecosystem, bytes, languages: matchedLanguages, manifests, lockfiles, index });
  });

  detected.sort((a, b) => b.bytes - a.bytes || b.manifests.length - a.manifests.length || a.index - b.index);

  const unmatchedLanguages = normalizedLanguages.filter(({ name }) => !claimedLanguages.has(name.toLowerCase())).map(({ name }) => name);

  return { detected, unmatchedLanguages };
}

/**
 * Title of the auto-generated maintenance issue.
 *
 * Constant, like `CI_CD_ISSUE_TITLE`: the issue is created in the target
 * repository itself, so it needs no repository suffix, and a stable title is
 * what lets a second `/fix --update-all-dependencies` run be recognised as a
 * repeat of the first.
 */
export const UPDATE_DEPENDENCIES_ISSUE_TITLE = 'Update all dependencies in all languages to their latest versions';

export function buildUpdateDependenciesIssueTitle() {
  return UPDATE_DEPENDENCIES_ISSUE_TITLE;
}

/**
 * Issue type and labels of the generated issue.
 *
 * Not a Bug: `/solve --deep-analysis` emits its root-cause/debug-output
 * paragraphs only for bugs, and a dependency bump has no root cause to find.
 * The non-bug variant — research, requirement coverage, solution planning — is
 * the correct one here. `dependencies` is the label Dependabot itself uses.
 */
export const UPDATE_DEPENDENCIES_ISSUE_TYPE = 'Task';
export const UPDATE_DEPENDENCIES_ISSUE_LABELS = Object.freeze(['dependencies']);

/** Render the detected-ecosystems table. */
export function buildEcosystemsSection({ languages, files } = {}) {
  const { detected, unmatchedLanguages } = mapRepositoryToEcosystems({ languages, files });
  const lines = [];

  if (detected.length === 0) {
    lines.push('No package ecosystem was detected automatically. Inspect the repository for dependency manifests by hand and update every one of them.');
  } else {
    lines.push('Update **every** ecosystem below, in this order (most of the repository first). One pull request may cover them all, but each ecosystem must end up fully current — not partially.');
    lines.push('');
    detected.forEach((entry, position) => {
      const { ecosystem, manifests, lockfiles, languages: matchedLanguages } = entry;
      lines.push(`${position + 1}. **${ecosystem.label}**`);
      if (matchedLanguages.length > 0) lines.push(`   - Detected languages: ${matchedLanguages.join(', ')}`);
      lines.push(`   - Manifests: ${manifests.length > 0 ? manifests.map(file => `\`${file}\``).join(', ') : '_none found — check whether one is missing_'}`);
      if (lockfiles.length > 0) lines.push(`   - Lockfiles to regenerate and commit: ${lockfiles.map(file => `\`${file}\``).join(', ')}`);
      lines.push(`   - Update everything: \`${ecosystem.updateCommand}\``);
      if (ecosystem.note) lines.push(`   - ${ecosystem.note}`);
      lines.push('');
    });
  }

  if (unmatchedLanguages.length > 0) {
    lines.push(`Detected languages with no dependency manifest of their own: ${unmatchedLanguages.join(', ')}. Check whether they pull dependencies through one of the ecosystems above.`);
  }

  return lines.join('\n').trimEnd();
}

/** Render the Dependabot configuration hint for the detected ecosystems. */
export function buildAutomationSection({ languages, files } = {}) {
  const { detected } = mapRepositoryToEcosystems({ languages, files });
  const values = [...new Set(detected.flatMap(entry => entry.ecosystem.dependabot))];
  const hasDependabotConfig = (Array.isArray(files) ? files : []).some(file => /^\.github\/dependabot\.ya?ml$/.test(String(file)));

  const lines = [];
  if (hasDependabotConfig) {
    lines.push('`.github/dependabot.yml` already exists — verify it covers every ecosystem and directory listed above, then keep it in sync with any manifest this work adds or moves.');
  } else {
    lines.push('There is no `.github/dependabot.yml` in this repository, so nothing keeps the versions current after this issue is closed. Add one so the next drift is a pull request instead of another issue.');
  }
  if (values.length > 0) {
    lines.push('');
    lines.push(`Ecosystems to declare (one \`updates:\` entry per ecosystem **and** per directory): ${values.map(value => `\`${value}\``).join(', ')}.`);
  }
  return lines.join('\n');
}

/**
 * Paragraphs of the standard dependency-update prompt.
 *
 * `providedBy` follows the `/fix --ci-cd` convention: a paragraph is dropped
 * from the issue body when every `/solve` option that already injects the same
 * instruction into the AI prompt is passed to `/solve`.
 */
export const REPORT_UPSTREAM_PARAGRAPH = 'If an update is blocked by a bug in a dependency, report it on that project’s GitHub with a reproducible example, the workaround used here, and a suggested fix in code — then link the report from the work instead of silently pinning back.';

/** Build the ordered, tagged paragraphs of the standard prompt. */
export function buildStandardPromptParagraphs({ ecosystems = [] } = {}) {
  const labels = ecosystems.length > 0 ? ecosystems.map(entry => entry.ecosystem.label).join(', ') : 'every language and package manager present in the repository';

  return [
    {
      providedBy: [],
      text: `Update all dependencies to their latest versions, in ${labels}. "All" is literal: development dependencies, transitive lockfile entries, build plugins, test runners, linters, base images, GitHub Actions, and the language/toolchain versions themselves.`,
    },
    {
      providedBy: [],
      text: 'For each ecosystem, produce a table of every dependency with the version pinned today and the version released today, resolved from the registry — not from memory. Anything left behind must have a written reason recorded (an upstream bug, a dropped platform, a paid tier), not silence.',
    },
    {
      providedBy: [],
      text: 'Cross major versions deliberately. Read the changelog and the migration guide for every major bump, adapt the code to the new API, and remove the shims the old version needed. A constraint loosened or a test skipped to make a major "pass" is not an update.',
    },
    {
      providedBy: [],
      text: 'Use the new features. Where a newer version replaces something this repository implements by hand, delete the hand-rolled copy and use the upstream feature, so there is less duplicated code and logic afterwards than before.',
    },
    {
      providedBy: [],
      text: 'Make the constraints honest: raise floors that are years below what is actually installed, drop upper bounds that exclude the current release, and regenerate and commit every lockfile so a fresh install and CI resolve the same tree.',
    },
    {
      providedBy: [],
      text: 'If the same dependency is pinned in more than one place — several language implementations, a Dockerfile, a workflow — bring every pin to the same version. A repository that pins one library at four different versions has four different behaviours.',
    },
    {
      providedBy: [],
      text: 'Run the full build, test and lint suite of every ecosystem after updating, and make CI green. Resolve every new deprecation warning the update introduces rather than leaving it for the next reader.',
    },
    {
      providedBy: [],
      text: 'Check the security advisories for the tree as it stands afterwards (`npm audit`, `cargo audit`, `pip-audit`, `bundle audit`, `dotnet list package --vulnerable`, or the ecosystem equivalent) and make sure the update leaves none unresolved.',
    },
    {
      providedBy: ['--deep-analysis'],
      text: REPORT_UPSTREAM_PARAGRAPH,
    },
    {
      providedBy: [],
      text: `Follow the dependency-update practices collected in [${DEPENDENCY_BEST_PRACTICES_URL}](${DEPENDENCY_BEST_PRACTICES_URL}).`,
    },
    {
      // Identical to the reinforcement prompt /solve --keep-working-... reuses,
      // so share the single constant instead of restating it.
      providedBy: [],
      text: KEEP_WORKING_PROMPT,
    },
  ];
}

/** The `/solve` options `/fix --update-all-dependencies` always turns on. */
export const UPDATE_DEPENDENCIES_FORWARDED_SOLVE_OPTIONS = Object.freeze(['--development-log', '--deep-analysis']);

/**
 * The standard dependency-update prompt, with the paragraphs that
 * `omittedOptions` already provide removed.
 */
export function buildStandardPrompt({ ecosystems, omittedOptions = UPDATE_DEPENDENCIES_FORWARDED_SOLVE_OPTIONS } = {}) {
  const omitted = new Set(omittedOptions || []);
  return buildStandardPromptParagraphs({ ecosystems })
    .filter(paragraph => paragraph.providedBy.length === 0 || !paragraph.providedBy.every(option => omitted.has(option)))
    .map(paragraph => paragraph.text)
    .join('\n\n');
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7);
}

/**
 * Build the full Markdown body of the auto-generated maintenance issue.
 *
 * The body leads with what has to change (the ecosystem inventory) and the
 * standard prompt, then keeps the data `/fix` collected in a collapsed context
 * block so it stays available without displacing the instructions.
 */
export { buildLanguagesSection };

export function buildUpdateDependenciesIssueBody({ repository, defaultBranch, commit, languages, files = [], filesTruncated = false, omittedOptions = UPDATE_DEPENDENCIES_FORWARDED_SOLVE_OPTIONS }) {
  const { detected } = mapRepositoryToEcosystems({ languages, files });
  const commitLine = commit?.sha ? `\`${shortSha(commit.sha)}\`${commit.url ? ` ([commit](${commit.url}))` : ''}${commit.message ? ` — ${String(commit.message).split('\n')[0]}` : ''}` : 'unknown';

  const sections = ['### Dependency ecosystems detected in this repository', '', buildEcosystemsSection({ languages, files }), '', '### Keeping them current', '', buildAutomationSection({ languages, files }), '', buildStandardPrompt({ ecosystems: detected, omittedOptions }), '', '---', '', '<details>', '<summary>Context collected by <code>/fix --update-all-dependencies</code></summary>', '', `- **Repository:** [${repository?.fullName}](${repository?.url})`, `- **Default branch:** \`${defaultBranch || 'unknown'}\``, `- **Latest commit:** ${commitLine}`, `- **Ecosystems detected:** ${detected.length}`, `- **Manifest files found:** ${detected.reduce((sum, entry) => sum + entry.manifests.length, 0)}`];

  if (filesTruncated) {
    sections.push('- ⚠️ **The file listing returned by GitHub was truncated**, so the manifest inventory above may be incomplete. Re-check the repository tree by hand.');
  }

  sections.push('', '**Detected languages**', '', buildLanguagesSection(languages), '', '</details>');

  return sections.join('\n');
}
