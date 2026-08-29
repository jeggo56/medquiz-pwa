import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';
import { cpSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

function copyStaticPwa() {
  return {
    name: 'copy-static-pwa',
    closeBundle() {
      const outDir = fileURLToPath(new URL('./dist/', import.meta.url));
      for (const file of ['index.html', 'style.css', 'app.js', 'data.js', 'manifest.json', 'sw.js']) {
        copyFileSync(projectDir + file, outDir + file);
      }
      mkdirSync(outDir + 'icons', { recursive: true });
      cpSync(projectDir + 'icons', outDir + 'icons', { recursive: true });
      mkdirSync(outDir + 'server', { recursive: true });
      writeFileSync(outDir + 'server/index.js', `export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};\n`);
    },
  };
}

export default defineConfig({
  plugins: [sites(), copyStaticPwa()],
  build: {
    target: 'es2022',
  },
});
