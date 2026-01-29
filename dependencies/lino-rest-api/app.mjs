/**
 * LINO REST API Application
 *
 * A lightweight REST API wrapper that uses Links Notation (LINO) format.
 * Works with Node.js built-in http module (no Express dependency).
 *
 * Based on: https://github.com/link-foundation/lino-rest-api
 */

import { createServer } from 'http';
import { encode, decode } from './codec.mjs';
import { LINO_CONTENT_TYPE } from './middleware.mjs';

/**
 * Simple router for HTTP requests
 */
class Router {
  constructor() {
    this.routes = {
      GET: [],
      POST: [],
      PUT: [],
      DELETE: [],
      PATCH: [],
    };
  }

  /**
   * Add a route handler
   * @param {string} method - HTTP method
   * @param {string} path - Route path (supports :param syntax)
   * @param {Function} handler - Route handler
   */
  addRoute(method, path, handler) {
    // Convert path to regex pattern
    const paramNames = [];
    const regexPath = path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });

    this.routes[method].push({
      pattern: new RegExp(`^${regexPath}$`),
      paramNames,
      handler,
    });
  }

  /**
   * Find a matching route
   * @param {string} method - HTTP method
   * @param {string} path - Request path
   * @returns {{handler: Function, params: Object}|null}
   */
  match(method, path) {
    const routes = this.routes[method] || [];

    for (const route of routes) {
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return { handler: route.handler, params };
      }
    }

    return null;
  }
}

/**
 * LINO REST API Application
 */
export class LinoApp {
  constructor() {
    this.router = new Router();
    this.server = null;
    this.middlewares = [];
  }

  /**
   * Add middleware
   * @param {Function} middleware - Middleware function
   */
  use(middleware) {
    this.middlewares.push(middleware);
  }

  /**
   * Register a GET route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler
   */
  get(path, handler) {
    this.router.addRoute('GET', path, handler);
  }

  /**
   * Register a POST route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler
   */
  post(path, handler) {
    this.router.addRoute('POST', path, handler);
  }

  /**
   * Register a PUT route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler
   */
  put(path, handler) {
    this.router.addRoute('PUT', path, handler);
  }

  /**
   * Register a DELETE route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler
   */
  delete(path, handler) {
    this.router.addRoute('DELETE', path, handler);
  }

  /**
   * Register a PATCH route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler
   */
  patch(path, handler) {
    this.router.addRoute('PATCH', path, handler);
  }

  /**
   * Parse request body
   * @param {IncomingMessage} req - HTTP request
   * @returns {Promise<*>}
   */
  async parseBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (!body.trim()) {
          resolve({});
          return;
        }

        const contentType = req.headers['content-type'] || '';

        try {
          if (contentType.includes('application/json')) {
            resolve(JSON.parse(body));
          } else if (contentType.includes(LINO_CONTENT_TYPE) || contentType.includes('text/plain')) {
            resolve(decode(body));
          } else {
            // Try JSON first, then LINO
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(decode(body));
            }
          }
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Send a LINO response
   * @param {ServerResponse} res - HTTP response
   * @param {*} data - Data to send
   * @param {number} statusCode - HTTP status code
   */
  sendLino(res, data, statusCode = 200) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', LINO_CONTENT_TYPE);
    res.end(encode(data));
  }

  /**
   * Send a JSON response
   * @param {ServerResponse} res - HTTP response
   * @param {*} data - Data to send
   * @param {number} statusCode - HTTP status code
   */
  sendJson(res, data, statusCode = 200) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  /**
   * Handle incoming request
   * @param {IncomingMessage} req - HTTP request
   * @param {ServerResponse} res - HTTP response
   */
  async handleRequest(req, res) {
    // Parse URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    // Handle OPTIONS (preflight)
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Find matching route
    const match = this.router.match(method, path);

    if (!match) {
      this.sendLino(
        res,
        {
          error: 'Not Found',
          path,
          method,
        },
        404
      );
      return;
    }

    try {
      // Parse body for POST/PUT/PATCH
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        body = await this.parseBody(req);
      }

      // Create request context
      const context = {
        params: match.params,
        query: Object.fromEntries(url.searchParams),
        body,
        headers: req.headers,
        method,
        path,
        url: req.url,
      };

      // Create response helpers
      const responseHelpers = {
        lino: (data, statusCode = 200) => this.sendLino(res, data, statusCode),
        json: (data, statusCode = 200) => this.sendJson(res, data, statusCode),
        status: statusCode => {
          res.statusCode = statusCode;
          return responseHelpers;
        },
        setHeader: (name, value) => {
          res.setHeader(name, value);
          return responseHelpers;
        },
        end: data => res.end(data),
      };

      // Call handler
      const result = await match.handler(context, responseHelpers);

      // If handler returned a value, send it as LINO
      if (result !== undefined && !res.writableEnded) {
        this.sendLino(res, result);
      }
    } catch (error) {
      console.error('Request handler error:', error);
      this.sendLino(
        res,
        {
          error: 'Internal Server Error',
          message: error.message,
        },
        500
      );
    }
  }

  /**
   * Start the server
   * @param {number} port - Port to listen on
   * @param {string} hostname - Hostname to bind to
   * @returns {Promise<void>}
   */
  listen(port, hostname = '0.0.0.0') {
    return new Promise(resolve => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(port, hostname, () => {
        console.log(`LINO REST API server listening on ${hostname}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close(err => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * Create a new LINO app instance
 * @returns {LinoApp}
 */
export function createLinoApp() {
  return new LinoApp();
}

export default { LinoApp, createLinoApp };
