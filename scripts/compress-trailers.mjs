import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const help = `
Compress lobby trailers into browser-friendly MP4 files.

Usage:
  npm run media:compress
  npm run media:compress -- --force

Environment:
  FFMPEG_PATH   Optional absolute path to the ffmpeg executable.

Input:
  public/lobby-media/trailers/*.{mp4,webm,mov,m4v,mkv}

Output:
  public/lobby-media/trailers/optimized/*.mp4

Files whose names contain "大屏", "big", "large", or "wall" use the large-TV
preset. Existing output is kept unless --force is supplied.
`.trim();

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(help);
  process.exit(0);
}

const force = process.argv.includes('--force');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const inputDirectory = resolve('public/lobby-media/trailers');
const outputDirectory = join(inputDirectory, 'optimized');
const supportedExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv']);

const versionCheck = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
if (versionCheck.error || versionCheck.status !== 0) {
  console.error('找不到 FFmpeg。请先安装 FFmpeg，或通过 FFMPEG_PATH 指定可执行文件。');
  process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });

const inputFiles = readdirSync(inputDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase()))
  .map((entry) => join(inputDirectory, entry.name));

if (inputFiles.length === 0) {
  console.log(`没有在 ${inputDirectory} 找到待压缩的视频。`);
  process.exit(0);
}

let encoded = 0;
let skipped = 0;

for (const inputPath of inputFiles) {
  const inputName = basename(inputPath, extname(inputPath));
  const outputPath = join(outputDirectory, `${inputName}.mp4`);
  const isLargeDisplay = /大屏|big|large|wall/i.test(inputName);
  const width = isLargeDisplay ? 960 : 640;
  const height = isLargeDisplay ? 540 : 360;
  const crf = isLargeDisplay ? 23 : 25;

  if (existsSync(outputPath) && !force) {
    console.log(`跳过已有文件：${basename(outputPath)}（使用 --force 可重新生成）`);
    skipped += 1;
    continue;
  }

  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'fps=24',
  ].join(',');

  console.log(`\n压缩：${basename(inputPath)} -> optimized/${basename(outputPath)}`);
  const result = spawnSync(ffmpeg, [
    force ? '-y' : '-n',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-map_metadata', '-1',
    '-sn',
    '-dn',
    '-vf', filter,
    '-c:v', 'libx264',
    '-profile:v', 'main',
    '-level:v', '4.0',
    '-preset', 'medium',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: 'inherit' });

  if (result.error || result.status !== 0) {
    console.error(`压缩失败：${basename(inputPath)}`);
    process.exit(result.status || 1);
  }
  encoded += 1;
}

console.log(`\n完成：新生成 ${encoded} 个，跳过 ${skipped} 个。`);
