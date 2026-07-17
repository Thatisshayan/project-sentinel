/**
 * Jest config for the Sentinel backend (CommonJS so Jest parses it natively).
 *
 * Coverage thresholds are intentionally progressive (not the full 50% line goal yet):
 * Phase 4 is a coverage "blitz" and the bar is raised as more unit tests land.
 *
 * Docker / testcontainers-based integration tests are BLOCKED in this environment
 * (no Docker daemon available) — see docs/governance/DEFERRED_WORK.md (D-002).
 *
 * Unit tests use @swc/jest (already in devDeps). ts-jest is intentionally not
 * used: the project runs TypeScript 7, which breaks the jest TS-config parser
 * (same root cause as D-001), and @swc/jest already covers the transform need.
 */

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js', '**/test/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': '@swc/jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.ts', 'src/**/*.js'],
  coverageThreshold: {
    global: {
      branches: 23,
      functions: 16,
      lines: 32,
      statements: 31,
    },
  },
};

module.exports = config;
