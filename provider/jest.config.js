module.exports = {
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    collectCoverage: true,
    coverageThreshold: {
        global: {
            statements: 86,
            branches: 65,
            functions: 90,
            lines: 86,
        },
    },
};
