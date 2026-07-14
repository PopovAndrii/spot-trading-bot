const stylistic = require('@stylistic/eslint-plugin');

// Formatting is the linter's job here (no Prettier) — same scheme as
// andriipopov.ua. Style matches the existing code: 2 spaces, single quotes.
const formatting = stylistic.configs.customize({
  indent: 2,
  quotes: 'single',
  semi: true,
  arrowParens: true,
  braceStyle: '1tbs',
  // permissive: keeps existing trailing commas, does not add new ones
  commaDangle: 'only-multiline',
});

// Keep the layout this codebase already has, so dropping Prettier does not
// rewrite live trading code for cosmetics:
//   - `&&` / `||` stay at the end of the line, ternary `? :` at the start
//   - "'self'" keeps its double quotes instead of becoming '\'self\''
const houseStyle = {
  '@stylistic/operator-linebreak': ['error', 'after', {
    overrides: { '?': 'before', ':': 'before' },
  }],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
};

module.exports = [
  {
    ignores: ['node_modules/', 'public/stylesheets/', 'data/'],
  },

  // ESM files (import/export)
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: formatting.plugins,
    rules: { ...formatting.rules, ...houseStyle },
  },

  // CJS files
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },
    plugins: formatting.plugins,
    rules: { ...formatting.rules, ...houseStyle },
  },
];
