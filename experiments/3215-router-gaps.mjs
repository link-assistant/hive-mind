// Print the router coverage gaps for each Formal AI spelling (issue #3215).
import { describeRouterCoverageGaps } from '../src/router-isolation.lib.mjs';
for (const model of ['formal-ai', 'formalai/formal-ai', 'sonnet']) console.log(model, describeRouterCoverageGaps({ model }));
