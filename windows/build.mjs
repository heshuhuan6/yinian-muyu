import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { makeIcon } from './icon.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(dir), stage = path.join(dir, '.stage'), out = path.join(dir, 'build');
const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
await fs.access(path.join(root, 'dist', 'index.html'));
await makeIcon();
if (path.dirname(stage) !== dir || path.basename(stage) !== '.stage') throw new Error('Unexpected staging directory');
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });
for (const file of ['main.cjs', 'preload.cjs', 'validation.cjs', 'geometry.cjs']) await fs.copyFile(path.join(dir, file), path.join(stage, file));
await fs.cp(path.join(dir, 'assets'), path.join(stage, 'assets'), { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(stage, 'frontend'), { recursive: true });
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'yinian-muyu', productName: '一念木鱼', version: pkg.version, main: 'main.cjs', description: pkg.description, author: 'Yinian Muyu contributors' }, null, 2));
const index = path.join(stage, 'frontend', 'index.html');
// The host supplies a stricter HTTP-equivalent CSP; strip the development meta policy.
await fs.writeFile(index, (await fs.readFile(index, 'utf8')).replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i, ''));
const paths = await packager({
  dir: stage, out, name: 'YinianMuyu', executableName: 'YinianMuyu',
  platform: 'win32', arch: 'x64', electronVersion: pkg.devDependencies.electron,
  appVersion: pkg.version, buildVersion: pkg.version, overwrite: true, asar: true,
  prune: true, icon: path.join(dir, 'assets', 'icon.ico'),
  win32metadata: { CompanyName: 'Yinian Muyu contributors', FileDescription: '一念木鱼', ProductName: '一念木鱼', OriginalFilename: 'YinianMuyu.exe' },
});
const packaged = paths[0];
await flipFuses(path.join(packaged, 'YinianMuyu.exe'), {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});
await fs.copyFile(path.join(dir, 'PORTABLE-README.txt'), path.join(packaged, '请先阅读.txt'));
await fs.copyFile(path.join(dir, 'LICENSE-YinianMuyu.txt'), path.join(packaged, 'LICENSE-YinianMuyu.txt'));
for (const dependency of ['react', 'react-dom', 'scheduler']) {
  await fs.copyFile(path.join(root, 'node_modules', dependency, 'LICENSE'), path.join(packaged, `LICENSE-${dependency}.txt`));
}
await fs.copyFile(path.join(root, 'node_modules', 'vite', 'LICENSE.md'), path.join(packaged, 'LICENSE-Vite.txt'));
await fs.access(path.join(packaged, 'LICENSE'));
await fs.access(path.join(packaged, 'LICENSES.chromium.html'));
const zip = path.join(out, `Yinian-Muyu-${pkg.version}-Windows-x64.zip`);
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:MUYU_PACKAGE_DIR -DestinationPath $env:MUYU_ZIP_PATH -Force'], {
  env: { ...process.env, MUYU_PACKAGE_DIR: packaged, MUYU_ZIP_PATH: zip }, stdio: 'inherit', windowsHide: true,
});
if (result.status !== 0) throw new Error('ZIP creation failed');
const hash = createHash('sha256').update(await fs.readFile(zip)).digest('hex');
await fs.writeFile(zip + '.sha256', `${hash}  ${path.basename(zip)}\n`);
console.log(JSON.stringify({ package: zip, sha256: hash, executable: path.join(packaged, 'YinianMuyu.exe') }, null, 2));
