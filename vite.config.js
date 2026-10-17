import { cpSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = resolve(projectRoot, 'frontend');

function copyPwaAssets() {
  return {
    name: 'copy-pwa-assets',
    closeBundle() {
      const output = resolve(projectRoot, 'dist');
      copyFileSync(resolve(frontendRoot, 'manifest.json'), resolve(output, 'manifest.json'));
      copyFileSync(resolve(frontendRoot, 'sw.js'), resolve(output, 'sw.js'));
      cpSync(resolve(frontendRoot, 'icon'), resolve(output, 'icon'), { recursive: true });
      cpSync(resolve(frontendRoot, 'img'), resolve(output, 'img'), { recursive: true });
    }
  };
}

export default defineConfig({
  root: frontendRoot,
  base: '/TravelApp/',
  plugins: [copyPwaAssets()],
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true
  }
});