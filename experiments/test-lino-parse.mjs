import { parseIndented, formatIndented } from 'lino-objects-codec';

const sample = `en
  error.invalid_github_url "Error: Invalid GitHub URL format"
  error.url_type_not_supported "URL type '{{type}}' is not supported"
  greeting "Hello, {{name}}!"
`;

console.log('Parsed:');
console.log(JSON.stringify(parseIndented({ text: sample }), null, 2));

const formatted = formatIndented({
  id: 'en',
  obj: {
    'error.invalid_github_url': 'Error: Invalid GitHub URL format',
    greeting: 'Hello, {{name}}!',
  },
});
console.log('\nFormatted:');
console.log(formatted);
