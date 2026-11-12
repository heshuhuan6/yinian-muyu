import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.join(dir, 'build', 'YinianMuyu-win32-x64', 'YinianMuyu.exe');
const output = path.join(dir, 'test-results', 'v1.2');
await fs.mkdir(output, { recursive: true });
const report = { version: '1.2.0', checks: [], executablePath, started: new Date().toISOString() };
let application = await electron.launch({ executablePath, timeout: 30000 });
let settingsPath, originalSettings;
try {
  let page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => !!window.muyu);
  const info = await application.evaluate(({ app, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { packaged: app.isPackaged, appVersion: app.getVersion(), version: process.versions, userData: app.getPath('userData'), bounds: w.getBounds(), pinned: w.isAlwaysOnTop(), preferences: w.webContents.getLastWebPreferences(), pid: process.pid };
  });
  settingsPath = path.join(info.userData, 'settings.json');
  try { originalSettings = await fs.readFile(settingsPath, 'utf8'); } catch { originalSettings = '{}'; }
  assert.equal(info.appVersion, '1.2.0');
  assert.equal(info.packaged, true); assert.equal(info.preferences.sandbox, true); assert.equal(info.preferences.contextIsolation, true); assert.equal(info.preferences.nodeIntegration, false);
  assert.equal(await application.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.openDevTools(); return wc.isDevToolsOpened(); }), false);
  const initial = await page.evaluate(() => window.muyu.inspect());
  assert.equal(initial.sound, false); assert.equal(initial.bpm, 60); assert.equal(initial.mode, 'clock');
  assert.equal(initial.settingsOpen, false); assert.equal(await page.locator('.settings-panel').isVisible(), false);
  assert.ok(Math.abs(info.bounds.height - Math.ceil(initial.desktopWidth * .525)) <= 1);
  report.checks.push({ name: 'v1.2 packaged EXE starts capsule-only with bundled Chromium and sandbox', passed: true, info, initial });
  const secondExit = await new Promise((resolve, reject) => {
    const p = spawn(executablePath, [], { windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { p.kill(); reject(new Error('Second instance failed to exit')); }, 15000);
    p.on('error', reject); p.on('exit', code => { clearTimeout(timeout); resolve(code); });
  });
  assert.equal(secondExit, 0); assert.equal(application.windows().length, 1);
  report.checks.push({ name: 'second EXE invocation exits and keeps one window', passed: true });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.enableNetworkEmulation({ offline: true }));
  await page.reload(); await page.waitForFunction(() => !!window.muyu);
  await page.evaluate(() => window.muyu.setTime(570.5));
  await page.waitForTimeout(1600);
  const offline = await page.evaluate(() => window.muyu.inspect());
  assert.equal(offline.mode, 'preview'); assert.equal(offline.minutes, 570.5); assert.ok(offline.count > 0);
  await page.screenshot({ path: path.join(output, '06-packaged-offline-capsule.png'), omitBackground: true });
  report.checks.push({ name: 'final EXE reloads and counts with network offline', passed: true, offline });
  await page.evaluate(() => { window.muyu.setTime(1380); window.muyu.showSettings(true); });
  await page.waitForTimeout(800);
  await page.getByRole('spinbutton', { name: '胶囊宽度，像素' }).fill('533');
  await page.getByRole('spinbutton', { name: '胶囊宽度，像素' }).press('Tab'); await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.muyu.inspect())).desktopWidth, 533);
  await page.screenshot({ path: path.join(output, '07-packaged-settings-533.png'), omitBackground: true });
  await page.locator('.close-settings').click(); await page.waitForTimeout(150);
  await page.evaluate(() => {
    const post = (action, dx, dy) => window.webkit.messageHandlers.muyu.postMessage({ type: 'desktopGesture', data: { action, mode: 'move', dx, dy } });
    post('begin', 0, 0); post('update', 90, 100); post('end', 90, 100);
  });
  await page.waitForTimeout(200);
  const beforeRestart = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  await application.close(); application = await electron.launch({ executablePath, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForFunction(() => !!window.muyu); await page.waitForTimeout(250);
  const afterRestart = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.deepEqual(afterRestart, beforeRestart);
  assert.equal((await page.evaluate(() => window.muyu.inspect())).desktopWidth, 533);
  assert.equal(await page.locator('.settings-panel').isVisible(), false);
  await page.screenshot({ path: path.join(output, '08-packaged-restarted.png'), omitBackground: true });
  report.checks.push({ name: 'final EXE remembers 533 px and custom position after real process restart', passed: true, beforeRestart, afterRestart });
  assert.deepEqual(errors, []);
  report.checks.push({ name: 'packaged normal-operation console errors', passed: true, errors });
  const fuses = await getCurrentFuseWire(executablePath);
  assert.equal(fuses[FuseV1Options.RunAsNode], 48);
  assert.equal(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable], 48);
  assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], 49);
  report.checks.push({ name: 'release fuses verified on actual EXE', passed: true, fuses });
  await page.evaluate(() => { window.muyu.resumeClock(); window.muyu.showSettings(false); });
  report.passed = true;
} catch (error) { report.passed = false; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await application.close();
  if (settingsPath && originalSettings !== undefined) await fs.writeFile(settingsPath, originalSettings);
  report.finished = new Date().toISOString(); await fs.writeFile(path.join(output, 'packaged.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
