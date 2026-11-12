// Issue #4043: placeholders stay, real values after the same options are masked.
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';
const value = ['Xy7q', 'L9mN2v', 'B4tR8k'].join('');
for (const text of [`playwright test --secrets ${value}`, `mysql --password ${value}`, `mysql --password=${value}`, `export SECRETS_PATH=./secrets.env`]) {
  console.log(JSON.stringify(text), '->', JSON.stringify(await sanitizeForPublication(text)));
}
