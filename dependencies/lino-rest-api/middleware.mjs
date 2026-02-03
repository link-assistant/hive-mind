/**
 * LINO REST API Middleware
 *
 * Express middleware for handling Links Notation (LINO) format requests and responses.
 *
 * Based on: https://github.com/link-foundation/lino-rest-api
 */

import { encode, decode } from './codec.mjs';

/**
 * Content type for LINO format
 */
export const LINO_CONTENT_TYPE = 'text/lino';

/**
 * Create a body parser middleware for LINO format
 * @returns {Function} Express middleware
 */
export function linoBodyParser() {
  return async (req, res, next) => {
    // Skip if not LINO content type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes(LINO_CONTENT_TYPE) && !contentType.includes('text/plain')) {
      return next();
    }

    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf-8');

      if (body.trim()) {
        req.body = decode(body);
      } else {
        req.body = {};
      }

      next();
    } catch (error) {
      res.status(400);
      res.setHeader('Content-Type', LINO_CONTENT_TYPE);
      res.end(
        encode({
          error: 'Invalid LINO format',
          message: error.message,
        })
      );
    }
  };
}

/**
 * Send a LINO response
 * @param {Object} res - Express response object
 * @param {*} data - Data to send
 * @param {number} statusCode - HTTP status code
 */
export function linoResponse(res, data, statusCode = 200) {
  res.status(statusCode);
  res.setHeader('Content-Type', LINO_CONTENT_TYPE);
  res.end(encode(data));
}

/**
 * Create combined LINO middleware
 * @returns {Function} Express middleware
 */
export function linoMiddleware() {
  const bodyParser = linoBodyParser();

  return (req, res, next) => {
    // Add convenience method to response
    res.lino = (data, statusCode = 200) => {
      linoResponse(res, data, statusCode);
    };

    // Parse body
    bodyParser(req, res, next);
  };
}

export default {
  linoBodyParser,
  linoResponse,
  linoMiddleware,
  LINO_CONTENT_TYPE,
};
