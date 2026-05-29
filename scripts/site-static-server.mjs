// Minimal static file server used by the Pages e2e test and the screenshot
// generator. Serves a single directory over loopback with directory-traversal
// protection. Returns the bound URL and a close() to release the port.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

export async function createStaticServer(rootDir) {
  const root = path.resolve(rootDir);

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      const requestedPath = path.resolve(root, `.${decodeURIComponent(pathname)}`);

      if (requestedPath !== root && !requestedPath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const fileStat = await stat(requestedPath);
      const filePath = fileStat.isDirectory() ? path.join(requestedPath, 'index.html') : requestedPath;
      const body = await readFile(filePath);
      const contentType = contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream';

      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

// A reproducible release fixture so the page renders a representative version
// label without depending on a live network call.
export const RELEASE_API_URL = 'https://api.github.com/repos/link-assistant/hive-mind/releases/latest';

export function makeReleaseFixture(tag) {
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/link-assistant/hive-mind/releases/tag/${tag}`,
    assets: [],
  };
}
