import { promises as fs } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const swPath = path.join(distDir, 'sw.js');
const placeholder = '/* __PRECACHE_MANIFEST__ */ []';

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const allowed = new Set(['.html', '.js', '.css', '.woff', '.woff2', '.svg', '.png', '.webp', '.ico', '.webmanifest']);
const excludedBasenames = new Set(['sw.js']);
const files = await walk(distDir);
const manifest = files
  .filter(file => allowed.has(path.extname(file).toLowerCase()) || file.endsWith('.webmanifest'))
  .filter(file => !excludedBasenames.has(path.basename(file)))
  .filter(file => !file.includes(`${path.sep}seed-food${path.sep}`))
  .map(file => `/${path.relative(distDir, file).split(path.sep).join('/')}`)
  .sort();

const source = await fs.readFile(swPath, 'utf8');
if (!source.includes(placeholder)) throw new Error('PWA precache placeholder was not found in dist/sw.js');
await fs.writeFile(swPath, source.replace(placeholder, `/* __PRECACHE_MANIFEST__ */ ${JSON.stringify(manifest)}`));
console.log(`PWA precache manifest injected with ${manifest.length} files.`);
