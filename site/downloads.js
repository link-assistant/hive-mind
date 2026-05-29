// Distribution metadata for the Hive Mind download page.
//
// Hive Mind ships as a Node.js command-line tool (published to npm and as a
// Docker image), so "downloads" here are install commands rather than signed
// binaries. The data below drives the OS-aware install panel and the per-OS
// instruction cards on the page.

export const REPO = 'link-assistant/hive-mind';
export const NPM_PACKAGE = '@link-assistant/hive-mind';
export const DOCKER_IMAGE = 'konard/hive-mind';

export const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
export const REPO_URL = `https://github.com/${REPO}`;
export const NPM_URL = `https://www.npmjs.com/package/${NPM_PACKAGE}`;
export const DOCKER_URL = `https://hub.docker.com/r/${DOCKER_IMAGE}`;

// The shared prerequisite for every native install path.
export const NODE_MIN_VERSION = '24';

// Per-OS install methods. Each method renders as a copyable command block.
export const installMethods = {
  macos: [
    {
      id: 'macos-npm',
      labelKey: 'methodNpm',
      noteKey: 'methodNpmNote',
      commands: ['npm install -g @link-assistant/hive-mind'],
    },
    {
      id: 'macos-npx',
      labelKey: 'methodNpx',
      noteKey: 'methodNpxNote',
      commands: ['npx @link-assistant/hive-mind --help'],
    },
    {
      id: 'macos-docker',
      labelKey: 'methodDocker',
      noteKey: 'methodDockerNote',
      commands: ['docker pull konard/hive-mind:latest', 'docker run -dit --name hive-mind konard/hive-mind:latest'],
    },
  ],
  windows: [
    {
      id: 'windows-npm',
      labelKey: 'methodNpm',
      noteKey: 'methodNpmNote',
      commands: ['npm install -g @link-assistant/hive-mind'],
    },
    {
      id: 'windows-npx',
      labelKey: 'methodNpx',
      noteKey: 'methodNpxNote',
      commands: ['npx @link-assistant/hive-mind --help'],
    },
    {
      id: 'windows-docker',
      labelKey: 'methodDocker',
      noteKey: 'methodDockerNote',
      commands: ['docker pull konard/hive-mind:latest', 'docker run -dit --name hive-mind konard/hive-mind:latest'],
    },
  ],
  linux: [
    {
      id: 'linux-npm',
      labelKey: 'methodNpm',
      noteKey: 'methodNpmNote',
      commands: ['npm install -g @link-assistant/hive-mind'],
    },
    {
      id: 'linux-npx',
      labelKey: 'methodNpx',
      noteKey: 'methodNpxNote',
      commands: ['npx @link-assistant/hive-mind --help'],
    },
    {
      id: 'linux-docker',
      labelKey: 'methodDocker',
      noteKey: 'methodDockerNote',
      commands: ['docker pull konard/hive-mind:latest', 'docker run -dit --name hive-mind konard/hive-mind:latest'],
    },
  ],
};

export const operatingSystems = ['macos', 'windows', 'linux'];

export function primaryMethodFor(os) {
  const methods = installMethods[os];

  return methods ? methods[0] : undefined;
}

export function releaseVersion(release) {
  const tag = String(release?.tag_name || release?.tagName || release?.name || '');
  const match = tag.match(/(?:^|-)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);

  return match?.[1];
}

export function detectOperatingSystem(navigatorLike) {
  const nav = navigatorLike || (typeof navigator !== 'undefined' ? navigator : undefined);
  const platform = String(nav?.userAgentData?.platform || nav?.platform || '').toLowerCase();
  const userAgent = String(nav?.userAgent || '').toLowerCase();
  const signal = `${platform} ${userAgent}`;

  if (signal.includes('mac')) {
    return 'macos';
  }

  if (signal.includes('win')) {
    return 'windows';
  }

  if (signal.includes('linux') || signal.includes('x11')) {
    return 'linux';
  }

  return 'unknown';
}
