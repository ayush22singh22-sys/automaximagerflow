import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

execSync('npx tsc -p tsconfig.json', { stdio: 'inherit', cwd: root });

for (const rel of ['manifest.json', 'popup/popup.html', 'popup/popup.css']) {
  const src = join(root, 'src', rel);
  const dst = join(out, rel);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}

console.log('Build complete → dist/');
