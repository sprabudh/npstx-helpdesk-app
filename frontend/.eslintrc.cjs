module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  env: { browser: true, es2022: true },
  ignorePatterns: ['dist', 'e2e/.output'],
  rules: { '@typescript-eslint/no-explicit-any': 'off', 'react-hooks/exhaustive-deps': 'warn' },
};
