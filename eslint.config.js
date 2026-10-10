import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// All randomness goes through src/core/rng.ts so the world stays deterministic.
const noMathRandom = {
  object: 'Math',
  property: 'random',
  message: 'Use the seeded rng from src/core/rng.ts. Math.random breaks determinism.',
};

// World generation and styles must not read the clock either.
// Time comes in as music time (from the source) or view.clock (from the engine).
const noClock = [
  {
    object: 'Date',
    property: 'now',
    message: 'No clock reads in world or styles. Use music time or view.clock.',
  },
  {
    object: 'performance',
    property: 'now',
    message: 'No clock reads in world or styles. Use music time or view.clock.',
  },
];

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'test-results/', 'playwright-report/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'no-restricted-properties': ['error', noMathRandom],
    },
  },
  {
    files: ['src/world/**', 'src/styles/**'],
    rules: {
      'no-restricted-properties': ['error', noMathRandom, ...noClock],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'No clock reads in world or styles. Use music time or view.clock.',
        },
      ],
    },
  },
  {
    files: ['src/core/rng.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
