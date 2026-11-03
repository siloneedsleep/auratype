import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
});
const config = [
  {
    ignores: [
      '.next/**',
      '.next-check/**',
      'work/**',
      'node_modules/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
