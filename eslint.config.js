import js from '@eslint/js';

const browserGlobals = Object.fromEntries([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'screen', 'location',
  'fetch', 'URL', 'AbortController', 'FormData', 'Intl', 'indexedDB', 'IDBKeyRange',
  'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'console', 'Event', 'File', 'Blob', 'FileReader',
  'HTMLElement', 'CustomEvent', 'ResizeObserver', 'MutationObserver', 'Image', 'Request',
  'Response', 'Headers', 'caches', 'self', 'structuredClone', 'crypto', 'TextEncoder',
  'TextDecoder', 'alert', 'confirm', 'prompt', 'globalThis', 'matchMedia', 'devicePixelRatio'
].map(name => [name, 'readonly']));

const nodeGlobals = Object.fromEntries([
  'process', 'console', 'Buffer', '__dirname', '__filename', 'URL', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'structuredClone', 'globalThis',
  'fetch', 'AbortController', 'TextEncoder', 'TextDecoder'
].map(name => [name, 'readonly']));

export default [
  { ignores: ['dist/**', 'node_modules/**', 'frontend/legacy/**', 'tool/output/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['frontend/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...browserGlobals, import: 'readonly' }
    }
  },
  {
    files: ['tool/**/*.{js,mjs}', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: nodeGlobals }
  },
  {
    files: ['tool/**/*.js', 'frontend/vault-sync.js'],
    languageOptions: { sourceType: 'commonjs', globals: nodeGlobals }
  },
  {
    files: ['frontend/sw.js'],
    languageOptions: { sourceType: 'script' }
  }
];
