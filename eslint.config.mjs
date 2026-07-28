import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const forbiddenCoreImports = [
  '@anthropic-ai/*',
  '@prisma/*',
  'bullmq',
  'fastify',
  '*powerbi*',
];

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'Core must receive configuration through ports.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: forbiddenCoreImports,
              message: 'Core must remain framework- and vendor-independent.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/boundary/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@connect/db', '@prisma/*', 'prisma'],
              message: 'Boundary may depend only on contracts and ports.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
