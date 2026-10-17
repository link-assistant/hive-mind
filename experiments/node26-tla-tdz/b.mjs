// "pr-draft-state": depends on c, which awaits at top level.
import { c } from './c.mjs';
export const x = c + 1;
