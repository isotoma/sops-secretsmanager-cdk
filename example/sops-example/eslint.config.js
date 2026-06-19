const tseslint = require('typescript-eslint');
const prettierRecommended = require('eslint-plugin-prettier/recommended');
const json = require('@eslint/json').default;

// Flat config (ESLint 9+). Replaces the old .eslintrc.js:
//  - typescript-eslint recommended rules for TS sources
//  - @eslint/json so the package.json and tsconfig.json passed to the lint
//    command can still be parsed (ESLint no longer lints JSON out of the box)
//  - eslint-plugin-prettier/recommended enables the prettier plugin and, via
//    eslint-config-prettier, turns off any rules that would conflict with prettier.
//    It must come last so it can override formatting rules.
module.exports = tseslint.config(
    ...tseslint.configs.recommended,
    {
        files: ['**/*.json'],
        ignores: ['**/package-lock.json'],
        language: 'json/json',
        ...json.configs.recommended,
    },
    prettierRecommended,
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
);
