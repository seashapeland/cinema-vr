import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectRoot, 'dist');
const trailerDirectory = resolve(distDirectory, 'lobby-media', 'trailers');
const disposableFiles = [
  resolve(distDirectory, 'lobby-media', 'screens', 'game-racer.png'),
];
const rawVideoExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv']);

function assertInsideDist(path) {
  if (path !== distDirectory && !path.startsWith(`${distDirectory}${sep}`)) {
    throw new Error(`Refusing to remove a file outside dist: ${path}`);
  }
}

if (existsSync(trailerDirectory)) {
  for (const entry of readdirSync(trailerDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !rawVideoExtensions.has(extname(entry.name).toLowerCase())) continue;
    disposableFiles.push(join(trailerDirectory, entry.name));
  }
}

let removed = 0;
for (const path of disposableFiles) {
  assertInsideDist(path);
  if (!existsSync(path)) continue;
  rmSync(path, { force: true });
  removed += 1;
}

console.log(`Prepared deployment output: removed ${removed} local-only master file(s) from dist.`);
