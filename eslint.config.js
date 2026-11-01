import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nonDeterministic = [
  { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Constitution #3: use the seeded Rng.' },
  { selector: "MemberExpression[object.name='Date']", message: 'Constitution #3: no wall-clock time in the sim.' },
  { selector: "NewExpression[callee.name='Date']", message: 'Constitution #3: no wall-clock time in the sim.' },
  { selector: "MemberExpression[object.name='performance']", message: 'Constitution #3: no wall-clock time in the sim.' },
  { selector: "Identifier[name='document']", message: 'Constitution #3: no DOM in the sim.' },
  { selector: "Identifier[name='window']", message: 'Constitution #3: no DOM in the sim.' },
];

export default tseslint.config(
  { ignores: ['public', 'dist', 'node_modules', 'coverage', 'playwright-report', 'test-results', 'release', 'tmp'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['desktop/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly', Response: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['api/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable', process: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/sim/**/*.ts', 'src/ai/**/*.ts', 'src/data/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...nonDeterministic] },
  },
);
