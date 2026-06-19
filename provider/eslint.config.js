const tseslint = require('typescript-eslint');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

// Flat config (ESLint 9+). Replaces the old .eslintrc.js:
//  - typescript-eslint recommended rules
//  - eslint-plugin-prettier/recommended enables the prettier plugin and, via
//    eslint-config-prettier, turns off any rules that would conflict with prettier.
//    It must come last so it can override formatting rules.
module.exports = tseslint.config(
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2018,
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
    },
    prettierRecommended,
);
