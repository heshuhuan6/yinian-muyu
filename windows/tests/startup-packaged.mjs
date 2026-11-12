import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(dir, 'test-results', 'v1.2');
const spacedDirectory = path.join(output, 'Startup Space Path', 'Yinian Muyu');
const executablePath = path.join(spacedDirectory, 'YinianMuyu.exe');
const settingsPath = path.join(process.env.APPDATA, '一念木鱼', 'settings.json');
const registryScript = path.join(dir, 'tests', 'startup-registry.ps1');
const registrySnapshot = path.join(output, 'startup-registry-before.private.json');
const settingsSnapshot = path.join(output, 'startup-settings-before.private.json');
const report = { version: '1.2.0', started: new Date().toISOString(), checks: [], limitations: ['No actual restart or logoff was performed.', 'System startup disabling is exercised through the native Windows StartupApproved API.'] };
const record = (name, data) => { report.checks.push({ name, passed: true, data }); console.log('PASS', name, JSON.stringify(data ?? '')); };
const registry = (mode = 'Snapshot') => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', registryScript, '-Mode', mode, '-SnapshotFile', registrySnapshot], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
};
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(dir, 'build', 'YinianMuyu-win32-x64'), spacedDirectory, { recursive: true });
const beforeRegistry = registry();
await fs.writeFile(registrySnapshot, JSON.stringify(beforeRegistry, null, 2));
let beforeSettings = null;
try { beforeSettings = await fs.readFile(settingsPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(settingsSnapshot, JSON.stringify({ existed: beforeSettings !== null, base64: beforeSettings?.toString('base64') ?? null }));
let application, page;
const open = async (args = []) => {
  application = await electron.launch({ executablePath, args, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForFunction(() => !!window.muyu); await page.waitForTimeout(300);
};
const close = async () => { if (application) { await application.close(); application = null; } };
const host = (operation, data) => application.evaluate(({ app, BrowserWindow, screen }, request) => {
  const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
  const h = require('./main.cjs'), w = BrowserWindow.getAllWindows()[0];
  const options = { path: process.execPath, args: ['--muyu-login'] };
  if (request.operation === 'info') {
    const item = h.getMenu().getMenuItemById('login-startup');
    return { packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath,
      bounds: w.getBounds(), workArea: screen.getPrimaryDisplay().workArea, focused: w.isFocused(), visible: w.isVisible(),
      settings: h.getSettings(), errors: h.getErrors(), menu: { checked: item.checked, enabled: item.enabled },
      native: app.getLoginItemSettings(options) };
  }
  if (request.operation === 'toggle') {
    // Electron's MenuItem.click wrapper performs the checkbox toggle itself.
    const item = h.getMenu().getMenuItemById('login-startup'); if (item.checked !== request.data) item.click(item, w, {});
  }
  if (request.operation === 'menu') { const item = h.getMenu().getMenuItemById(request.data); item.click(item, w, {}); }
  if (request.operation === 'system-disable') app.setLoginItemSettings({ ...options, name: 'local.yinian.muyu', openAtLogin: true, enabled: false });
  if (request.operation === 'hide') w.hide();
  if (request.operation === 'show-inactive') w.showInactive();
}, { operation, data });
const inspect = () => page.evaluate(() => window.muyu.inspect());
const invokeLoginCommand = (exe, args) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Duplicate login command did not exit')); }, 15000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('exit', code => { clearTimeout(timer); resolve(code); });
});
try {
  await fs.writeFile(settingsPath, '{}');
  await open();
  let info = await host('info');
  assert.equal(info.packaged, true); assert.equal(info.version, '1.2.0'); assert.ok(info.executable.includes(' '));
  assert.equal(info.settings.anchor, 'right'); assert.equal(info.focused, false); assert.equal(info.visible, true);
  assert.equal(info.menu.enabled, true); assert.equal(info.menu.checked, false);
  assert.deepEqual(registry(), beforeRegistry);
  record('new installed EXE defaults upper-right and does not register startup or focus itself', { bounds: info.bounds, menu: info.menu });
  await host('menu', 'bottom-right');
  await page.evaluate(() => window.webkit.messageHandlers.muyu.postMessage({ type: 'desktopSize', data: { width: 533 } }));
  await page.waitForTimeout(300);
  await host('toggle', true); info = await host('info');
  assert.equal(info.menu.checked, true, JSON.stringify(info)); assert.equal(info.native.openAtLogin, true); assert.equal(info.native.executableWillLaunchAtLogin, true);
  const enabledRegistry = registry(), command = enabledRegistry[0].data;
  const parsed = /^"([^"]+)"\s+("?--muyu-login"?)$/.exec(command);
  assert.ok(parsed, `Unexpected Run command: ${command}`);
  assert.equal(parsed[1].toLowerCase(), executablePath.toLowerCase());
  const loginArgs = [parsed[2].replaceAll('"', '')];
  assert.deepEqual(loginArgs, ['--muyu-login']);
  await fs.writeFile(path.join(output, 'registered-login-command.private.json'), JSON.stringify({ executablePath: parsed[1], args: loginArgs, command }, null, 2));
  record('native checkbox registers the full spaced EXE path with only the login argument', { command, native: info.native, menu: info.menu });
  await page.screenshot({ path: path.join(output, '11-startup-enabled-bottom-right.png'), omitBackground: true });
  await host('system-disable'); await page.waitForTimeout(1300);
  info = await host('info'); const disabledRegistry = registry();
  assert.equal(info.native.openAtLogin, true); assert.equal(info.native.executableWillLaunchAtLogin, false); assert.equal(info.menu.checked, false);
  await page.waitForTimeout(1200); assert.deepEqual(registry(), disabledRegistry);
  record('Windows StartupApproved disable is reflected unchecked and never auto-reenabled');
  const savedBounds = info.bounds;
  await page.evaluate(() => { window.muyu.setTime(600); window.muyu.showSettings(true); });
  await host('menu', 'sound'); await page.waitForTimeout(100);
  await close();
  await open(loginArgs); info = await host('info');
  const afterLogin = await inspect();
  assert.deepEqual(info.bounds, savedBounds); assert.equal(info.focused, false); assert.equal(info.visible, true);
  assert.equal(afterLogin.mode, 'clock'); assert.equal(afterLogin.sound, false); assert.equal(afterLogin.settingsOpen, false);
  assert.equal(info.settings.anchor, 'bottom-right'); assert.equal(afterLogin.desktopWidth, 533);
  assert.deepEqual(registry(), disabledRegistry); assert.equal(info.menu.checked, false);
  const currentMinutes = await page.evaluate(() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60; });
  assert.ok(Math.min(Math.abs(currentMinutes - afterLogin.minutes), 1440 - Math.abs(currentMinutes - afterLogin.minutes)) < 1);
  record('registered login path/args restart into a quiet unfocused clock capsule and preserve system disable', { bounds: info.bounds, initial: afterLogin });
  await page.screenshot({ path: path.join(output, '12-login-restarted-capsule.png'), omitBackground: true });
  assert.equal(await invokeLoginCommand(parsed[1], loginArgs), 0); await page.waitForTimeout(200);
  assert.equal(application.windows().length, 1); assert.equal((await host('info')).focused, false);
  await host('hide');
  assert.equal(await invokeLoginCommand(parsed[1], loginArgs), 0); await page.waitForTimeout(200);
  assert.equal(application.windows().length, 1); assert.equal((await host('info')).visible, false); assert.equal((await inspect()).paused, true);
  record('exact recorded login command exits as a duplicate without focus or unhiding the existing capsule');
  await host('show-inactive'); await host('toggle', true);
  assert.equal((await host('info')).native.executableWillLaunchAtLogin, true);
  await host('toggle', false); info = await host('info');
  assert.equal(info.native.openAtLogin, false); assert.equal(info.menu.checked, false); assert.equal(registry()[0].exists, false);
  record('explicit reenable and uncheck update real Windows registration');
  await close();
  const offRegistry = registry(); await open(loginArgs); info = await host('info');
  assert.deepEqual(registry(), offRegistry); assert.equal(info.menu.checked, false); assert.deepEqual(info.errors, []);
  record('subsequent startup leaves disabled registration unchanged and has no host errors');
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  try { await close(); } catch (error) { report.passed = false; report.closeError = String(error); process.exitCode = 1; }
  report.restored = { originalStartupRegistry: false, originalSettings: false };
  try {
    assert.deepEqual(registry('Restore'), beforeRegistry);
    report.restored.originalStartupRegistry = true;
  } catch (error) { report.passed = false; report.registryRestoreError = String(error.stack ?? error); process.exitCode = 1; }
  try {
    if (beforeSettings === null) await fs.unlink(settingsPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    else { await fs.writeFile(settingsPath, beforeSettings); assert.deepEqual(await fs.readFile(settingsPath), beforeSettings); }
    report.restored.originalSettings = true;
  } catch (error) { report.passed = false; report.settingsRestoreError = String(error.stack ?? error); process.exitCode = 1; }
  if (report.restored.originalStartupRegistry && report.restored.originalSettings) record('test-before Run/StartupApproved entries and original user settings restored exactly');
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(output, 'startup-packaged.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
