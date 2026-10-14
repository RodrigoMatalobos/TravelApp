import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function copyPwaAssets() {
  return {
    name: 'copy-pwa-assets',
    closeBundle() {
      const root = process.cwd();
      const output = resolve(root, 'dist');
      copyFileSync(resolve(root, 'manifest.json'), resolve(output, 'manifest.json'));
      copyFileSync(resolve(root, 'sw.js'), resolve(output, 'sw.js'));
      mkdirSync(resolve(output, 'icon'), { recursive: true });
      copyFileSync(resolve(root, 'icon/icon.png'), resolve(output, 'icon/icon.png'));
    }
  };
}

export default defineConfig({
  base: '/TravelApp/',
  plugins: [copyPwaAssets()]
});