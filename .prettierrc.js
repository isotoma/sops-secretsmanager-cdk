module.exports = {
    semi: true,
    trailingComma: 'all',
    singleQuote: true,
    printWidth: 200,
    tabWidth: 2,
    // prettier 3 defaults arrowParens to 'always'; keep 'avoid' to match the
    // existing source formatting (prettier 1.x default) so the upgrade needs no
    // source changes.
    arrowParens: 'avoid',
    overrides: [
        {
            files: ['*.js', '*.ts'],
            options: {
                tabWidth: 4,
            },
        },
    ],
};
