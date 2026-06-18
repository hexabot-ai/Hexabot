module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin', 'import', 'header'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'add-extra-deps.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'lines-between-class-members': [
      1,
      {
        enforce: [
          { blankLine: 'always', prev: '*', next: 'field' },
          { blankLine: 'always', prev: 'field', next: '*' },
          { blankLine: 'always', prev: 'method', next: 'method' },
        ],
      },
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    '@typescript-eslint/no-unsafe-function-type': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-namespace': 'off',
    'padding-line-between-statements': [
      2,
      { blankLine: 'always', prev: '*', next: 'export' },
      { blankLine: 'always', prev: '*', next: 'function' },
    ],
    'no-console': 2,
    'no-duplicate-imports': 2,
    'object-shorthand': 1,
    'import/order': [
      'error',
      {
        groups: [
          'builtin', // Built-in imports (come from NodeJS native) go first
          'external', // <- External imports
          'unknown', // <- unknown
          'parent', // <- Relative imports, the sibling and parent types they can be mingled together
          'sibling',
          'index', // <- index imports
          'internal', // <- Absolute imports
        ],
        'newlines-between': 'always',
        alphabetize: {
          /* sort in ascending order. Options: ["ignore", "asc", "desc"] */
          order: 'asc',
          /* ignore case. Options: [true, false] */
          caseInsensitive: true,
        },
      },
    ],
    'header/header': [
      2,
      'block',
      [
        '',
        {
          pattern:
            '^ \\* Copyright © 20\\d{2} Hexastack. All rights reserved.$',
          template: ' * Copyright © 2025 Hexastack. All rights reserved.',
        },
        ' *',
        ' * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:',
        ' * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.',
        ' * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software\'s "About" section, documentation, and README file).',
        ' ',
      ],
      2,
    ],
    'no-multiple-empty-lines': ['error', { max: 1 }],
  },
};
