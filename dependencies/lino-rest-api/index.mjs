/**
 * LINO REST API
 *
 * A REST API framework using Links Notation (LINO) instead of JSON.
 *
 * Based on: https://github.com/link-foundation/lino-rest-api
 *
 * @module lino-rest-api
 */

export { encode, decode, ObjectCodec } from './codec.mjs';
export { linoMiddleware, linoBodyParser, linoResponse, LINO_CONTENT_TYPE } from './middleware.mjs';
export { LinoApp, createLinoApp } from './app.mjs';

import { createLinoApp } from './app.mjs';
export default createLinoApp;
