import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { makeIcon } from '../icon.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(dir, 'test-results', 'v1.2'), profile = path.join(dir, 'test-results', 'profile-v1.2');
await fs.mkdir(output, { recursive: true }); await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(profile, 'settings.json'), '{}');
await makeIcon();
const report = { version: '1.2.0', platform: process.platform, started: new Date().toISOString(), checks: [], errors: [], limitations: ['Power events are simulated; physical sleep is not requested.', 'Offline uses per-application network emulation; OS network adapters remain enabled.'] };
const record = (name, data) => { report.checks.push({ name, passed: true, data }); console.log('PASS', name, JSON.stringify(data ?? '')); };
let application, page;
const consoleErrors = [];
const open = async () => {
  application = await electron.launch({ args: [path.join(dir, 'tests', 'driver.cjs')] });
  page = await application.firstWindow();
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.waitForFunction(() => !!window.muyu); await page.waitForTimeout(250);
};
const inspect = () => page.evaluate(() => window.muyu.inspect());
const host = (operation, data) => application.evaluate(({ app, powerMonitor, ipcMain, screen }, { operation, data }) => {
  const h = globalThis.__muyuTestHost, w = h.getWindow();
  if (operation === 'info') return { settings: h.getSettings(), errors: h.getErrors(), bounds: w.getBounds(), pinned: w.isAlwaysOnTop(), visible: w.isVisible(), preferences: w.webContents.getLastWebPreferences(), userData: app.getPath('userData'), workArea: screen.getPrimaryDisplay().workArea, focused: w.isFocused(), startup: { enabled: h.getMenu().getMenuItemById('login-startup').enabled, checked: h.getMenu().getMenuItemById('login-startup').checked } };
  if (operation === 'menu') { const item = h.getMenu().getMenuItemById(data); item.click(item, w, {}); }
  if (operation === 'power') powerMonitor.emit(data);
  if (operation === 'blur') w.blur();
  if (operation === 'offline') w.webContents.session.enableNetworkEmulation({ offline: data });
  if (operation === 'observeSize') { globalThis.__sizePosts = 0; ipcMain.on('muyu:message', (_e, m) => { if (m.type === 'desktopSize') globalThis.__sizePosts++; }); }
  if (operation === 'sizePosts') return globalThis.__sizePosts;
}, { operation, data });
const post = (type, data) => page.evaluate(message => window.webkit.messageHandlers.muyu.postMessage(message), { type, data });
const gesture = async (mode, dx, dy) => {
  await post('desktopGesture', { action: 'begin', mode, dx: 0, dy: 0 });
  await post('desktopGesture', { action: 'update', mode, dx, dy });
  await post('desktopGesture', { action: 'end', mode, dx, dy });
  await page.waitForTimeout(120);
};
// Keep pointer positions fixed in screen coordinates while the native window moves.
const drag = async (x, y, dx, dy, alt = false) => {
  const start = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    const now = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
    await page.mouse.move(start.x + x + dx * i / 14 - now.x, start.y + y + dy * i / 14 - now.y);
    await page.waitForTimeout(35);
  }
  // CDP mouse-up reuses its last client point. Rebase that point after the final
  // native move so mouse-up does not accidentally add one extra movement step.
  for (let i = 0; i < 3; i++) {
    const now = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
    await page.mouse.move(start.x + x + dx - now.x, start.y + y + dy - now.y);
    await page.waitForTimeout(50);
  }
  await page.mouse.up(); if (alt) await page.keyboard.up('Alt');
  await page.waitForTimeout(250);
};
const screenshot = name => page.screenshot({ path: path.join(output, name), omitBackground: true });
try {
  await open();
  const initial = await inspect(), info = await host('info');
  assert.deepEqual(info.bounds, { x: info.workArea.x + info.workArea.width - 496, y: info.workArea.y + 16, width: 480, height: 252 });
  assert.equal(info.settings.anchor, 'right'); assert.equal(info.focused, false);
  assert.deepEqual(info.startup, { enabled: false, checked: false });
  assert.equal(initial.desktopWidth, 480); assert.equal(initial.settingsOpen, false); assert.equal(initial.sound, false); assert.equal(initial.bpm, 60);
  assert.equal(await page.locator('.settings-panel').isVisible(), false);
  assert.equal(await page.locator('.timebar').isVisible(), false);
  assert.equal(await page.locator('.console').isVisible(), false);
  assert.equal(await page.locator('.schedule').isVisible(), false);
  assert.equal(info.pinned, true); assert.equal(info.preferences.contextIsolation, true); assert.equal(info.preferences.sandbox, true); assert.equal(info.preferences.nodeIntegration, false);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  record('capsule-only startup, no bottom controls or reserved height, sandbox', { bounds: info.bounds, initial });
  await screenshot('01-capsule-only.png');
  await page.waitForTimeout(1100); assert.notEqual((await inspect()).minutes, initial.minutes);
  record('local clock still advances with hidden controls');

  await host('menu', 'left');
  await page.evaluate(() => window.muyu.setTime(600)); await page.waitForTimeout(600);
  const beforeMove = (await host('info')).bounds;
  await drag(80, 126, 180, 100);
  const moved = (await host('info')).bounds;
  assert.ok(Math.abs(moved.x - beforeMove.x - 180) <= 3, JSON.stringify(moved));
  assert.ok(Math.abs(moved.y - beforeMove.y - 100) <= 3); assert.equal((await inspect()).minutes, 600);
  record('courtyard pointer drag moves native window without changing preview', { beforeMove, moved });
  const lensX = 480 * (45 + (await inspect()).position * 70) / 160;
  await drag(lensX, 126, 80, 40, true);
  const altMoved = (await host('info')).bounds;
  assert.ok(Math.abs(altMoved.x - moved.x - 80) <= 3); assert.equal((await inspect()).minutes, 600);
  record('Alt+drag on lens moves native window', { altMoved });
  await drag(lensX, 126, 35, 0);
  const preview = await inspect();
  assert.ok(preview.minutes > 700 && preview.minutes < 950); assert.deepEqual((await host('info')).bounds, altMoved);
  await page.waitForTimeout(600); assert.equal((await inspect()).minutes, preview.minutes);
  record('lens pointer drag previews time and never moves window', { minutes: preview.minutes, bounds: altMoved });

  await page.locator('.world-switch').hover();
  const handle = await page.locator('.resize-handle').boundingBox();
  await drag(handle.x + handle.width / 2, handle.y + handle.height / 2, 100, 52.5);
  const resizedInfo = await host('info'), resized = resizedInfo.bounds, resizedWidth = resizedInfo.settings.width;
  assert.ok(Math.abs(resizedWidth - 580) <= 1, JSON.stringify(resizedInfo));
  // At fractional Windows DPI native outer bounds may round out by one DIP.
  assert.ok(Math.abs(resized.width - resizedWidth) <= 1);
  assert.ok(Math.abs(resized.height - Math.ceil(resizedWidth * .525)) <= 1); assert.equal(resized.x, altMoved.x); assert.equal(resized.y, altMoved.y);
  assert.equal((await inspect()).desktopWidth, resizedWidth);
  record('actual resize grip drag preserves aspect and top-left', { resized, requestedWidth: resizedWidth });
  await page.mouse.move(resized.width / 2, resized.height / 2); await page.mouse.wheel(0, -20); await page.waitForTimeout(300);
  const wheeledInfo = await host('info'), wheeled = wheeledInfo.bounds; assert.equal(wheeledInfo.settings.width, resizedWidth + 12);
  record('wheel scales and synchronizes frontend', { wheeled });
  await screenshot('02-moved-resized.png');

  await host('menu', 'schedule'); await page.waitForTimeout(300);
  assert.equal((await inspect()).settingsOpen, true); assert.equal(await page.locator('.settings-panel').isVisible(), true);
  for (const width of [517, 533]) {
    await page.getByRole('spinbutton', { name: '胶囊宽度，像素' }).fill(String(width));
    await page.getByRole('spinbutton', { name: '胶囊宽度，像素' }).press('Tab');
    await page.waitForTimeout(250);
    assert.equal((await host('info')).settings.width, width); assert.equal((await inspect()).desktopWidth, width);
    assert.ok(Math.abs((await host('info')).bounds.width - width) <= 1);
    assert.ok(Math.abs((await page.locator('.world-switch').boundingBox()).width - width) < 1);
  }
  record('arbitrary size fields accept 517 and 533 px without preset snapping');
  await screenshot('03-settings-533.png');
  await page.locator('.close-settings').click(); await page.waitForTimeout(200);
  assert.ok(Math.abs((await host('info')).bounds.height - Math.ceil(533 * .525)) <= 1); assert.equal(await page.locator('.settings-panel').isVisible(), false);
  record('drawer close removes all extra height');

  await host('menu', 'size-240'); await gesture('move', 100000, 100000);
  const edge = await host('info'), savedAtEdge = structuredClone(edge.settings);
  await host('menu', 'schedule'); await page.waitForTimeout(350);
  const expanded = await host('info');
  assert.equal(expanded.bounds.width, 480); assert.equal((await inspect()).desktopWidth, 240);
  assert.deepEqual(expanded.settings, savedAtEdge);
  await screenshot('04-small-capsule-drawer.png');
  await page.locator('.close-settings').click(); await page.waitForTimeout(200);
  assert.deepEqual((await host('info')).bounds, edge.bounds);
  assert.deepEqual((await host('info')).settings, savedAtEdge);
  record('bottom/right 240 px capsule opens 480 px drawer and restores original position', { collapsed: edge.bounds, expanded: expanded.bounds });

  await gesture('move', -500, -300);
  await post('desktopGesture', { action: 'begin', mode: 'move', dx: 0, dy: 0 });
  await post('desktopGesture', { action: 'update', mode: 'move', dx: 45, dy: 20 }); await page.waitForTimeout(100);
  const lastValid = (await host('info')).bounds;
  await post('desktopGesture', { action: 'cancel', mode: 'move', dx: 0, dy: 0 }); await page.waitForTimeout(100);
  assert.deepEqual((await host('info')).bounds, lastValid);
  const persistedCancel = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
  assert.deepEqual(persistedCancel.position, { x: lastValid.x, y: lastValid.y });
  record('cancel preserves and saves last valid geometry', { lastValid });
  await gesture('resize', 100000, 100000); assert.equal((await inspect()).desktopWidth, 800);
  await gesture('resize', -100000, -100000); assert.equal((await inspect()).desktopWidth, 240);
  await host('observeSize'); await host('menu', 'size-640'); await page.waitForTimeout(300);
  assert.equal(await host('sizePosts'), 0);
  record('240–800 limits and host size sync does not echo back as IPC');
  await post('desktopSize', { width: 533 }); await gesture('move', -220, -180);
  const beforeReopen = (await host('info')).bounds;
  await application.close(); application = null; await open();
  assert.deepEqual((await host('info')).bounds, beforeReopen); assert.equal((await inspect()).desktopWidth, 533);
  assert.equal((await inspect()).settingsOpen, false);
  record('real process restart restores custom size and arbitrary position', { beforeReopen, reopened: (await host('info')).bounds });
  await screenshot('05-reopened-custom.png');

  for (const [t, active] of [[479.999, false], [480, true], [719.999, true], [720, false], [869.999, false], [870, true], [1049.999, true], [1050, false], [1440, false]]) assert.equal((await page.evaluate(t => window.muyu.setTime(t), t)).active, active);
  record('default schedule boundaries unaffected');
  await host('menu', 'schedule'); await page.waitForTimeout(200);
  await page.getByRole('button', { name: '＋ 添加时段' }).click();
  await page.getByLabel('第 3 段开始时间').fill('23:00'); await page.getByLabel('第 3 段结束时间').fill('01:00'); await page.getByLabel('第 3 段结束时间').press('Tab');
  for (const [t, active] of [[1380, true], [0, true], [59.99, true], [60, false]]) assert.equal((await page.evaluate(t => window.muyu.setTime(t), t)).active, active);
  await page.getByRole('button', { name: '删除第 3 个时段' }).click(); assert.equal((await inspect()).periods.length, 2);
  record('drawer period add/edit/remove and cross-midnight schedule');
  await page.evaluate(() => { window.muyu.setTime(600); window.muyu.setPeriods([{ id: 'one', start: 480, end: 720 }, { id: 'two', start: 500, end: 700 }]); });
  const rates = [];
  for (const bpm of [40, 60, 90]) {
    await page.getByRole('button', { name: `每分钟 ${bpm} 次`, exact: true }).click(); await page.evaluate(() => window.muyu.resetCount()); await page.waitForTimeout(3100);
    const count = (await inspect()).count; assert.ok(Math.abs(count - 3.1 * bpm / 60) < 1.6); rates.push({ bpm, count });
  }
  record('overlapping periods and all three tempos remain correct', rates);
  await page.evaluate(() => {
    const original = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () { const gain = original.call(this); if (!window.__audioProbe) { const analyser = this.createAnalyser(); gain.connect(analyser); window.__audioProbe = analyser; } return gain; };
  });
  await page.getByRole('button', { name: '开启木鱼声音', exact: true }).click();
  const peak = await page.evaluate(async () => { const data = new Float32Array(2048); let peak = 0; for (let i = 0; i < 160; i++) { window.__audioProbe.getFloatTimeDomainData(data); for (const v of data) peak = Math.max(peak, Math.abs(v)); await new Promise(r => setTimeout(r, 10)); } return peak; });
  assert.ok(peak > .001); await page.getByRole('button', { name: '关闭木鱼声音', exact: true }).click();
  assert.equal((await inspect()).audio.state, 'suspended'); record('default-off local audio still produces real signal', { peak });
  await page.getByRole('button', { name: '回到当前时间' }).click(); assert.equal((await inspect()).mode, 'clock');
  await page.locator('.close-settings').click();
  await page.evaluate(() => { window.muyu.setTime(600); window.muyu.setTempo(60); window.muyu.resetCount(); });
  await host('blur'); await page.waitForTimeout(2100); assert.ok((await inspect()).count >= 1);
  await host('menu', 'visible'); await page.waitForTimeout(150); const hidden = await inspect();
  await page.waitForTimeout(1600); assert.equal((await inspect()).count, hidden.count);
  await host('menu', 'visible'); await page.waitForTimeout(100); assert.equal((await inspect()).paused, false); assert.ok((await inspect()).count - hidden.count <= 1);
  await host('power', 'suspend'); await page.waitForTimeout(100); const sleeping = await inspect();
  await page.waitForTimeout(1600); assert.equal((await inspect()).count, sleeping.count);
  await host('power', 'resume'); await page.waitForTimeout(100); assert.equal((await inspect()).paused, false); assert.ok((await inspect()).count - sleeping.count <= 1);
  record('unfocused continues; hide/show and simulated suspend/resume do not catch up');
  const corners = [];
  for (const anchor of ['left', 'right', 'bottom-left', 'bottom-right']) {
    await host('menu', anchor);
    const current = await host('info'), a = current.workArea, b = current.bounds;
    assert.equal(current.settings.anchor, anchor);
    const expectedX = anchor.endsWith('right') ? a.x + a.width - current.settings.width - 16 : a.x + 16;
    const expectedY = anchor.startsWith('bottom') ? a.y + a.height - Math.ceil(current.settings.width * .525) - 16 : a.y + 16;
    assert.ok(Math.abs(b.x - expectedX) <= 1 && Math.abs(b.y - expectedY) <= 1);
    corners.push({ anchor, bounds: b });
  }
  record('four native corner commands respect the actual taskbar work area', corners);
  await post('desktopSize', { width: 533 }); await page.waitForTimeout(250);
  await gesture('resize', 100, 52.5);
  let anchored = await host('info');
  assert.equal(anchored.settings.width, 633); assert.equal(anchored.settings.anchor, 'bottom-right');
  await page.mouse.move(300, 140); await page.mouse.wheel(0, 100); await page.waitForTimeout(300);
  anchored = await host('info');
  assert.equal(anchored.settings.width, 573); assert.equal(anchored.settings.anchor, 'bottom-right');
  assert.ok(Math.abs(anchored.bounds.x + anchored.bounds.width - anchored.workArea.x - anchored.workArea.width + 16) <= 1);
  assert.ok(Math.abs(anchored.bounds.y + anchored.bounds.height - anchored.workArea.y - anchored.workArea.height + 16) <= 1);
  record('bottom-right grip and wheel resizing retain both corner margins', { bounds: anchored.bounds, width: anchored.settings.width });
  await host('menu', 'size-240');
  const beforeDrawer = await host('info');
  await host('menu', 'schedule'); await page.waitForTimeout(350);
  const cornerDrawer = await host('info');
  assert.equal(cornerDrawer.bounds.width, 480); assert.deepEqual(cornerDrawer.settings, beforeDrawer.settings);
  assert.ok(cornerDrawer.bounds.y + cornerDrawer.bounds.height <= cornerDrawer.workArea.y + cornerDrawer.workArea.height + 1);
  await screenshot('09-bottom-right-drawer.png');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  assert.deepEqual((await host('info')).bounds, beforeDrawer.bounds);
  record('bottom-right settings expansion and Escape restore the anchored capsule');
  await post('desktopSize', { width: 533 }); await page.waitForTimeout(250);
  const beforeCornerRestart = await host('info');
  await page.evaluate(() => { window.muyu.setTime(600); window.muyu.showSettings(true); });
  await application.close(); application = null; await open();
  assert.deepEqual((await host('info')).bounds, beforeCornerRestart.bounds);
  assert.equal((await host('info')).settings.anchor, 'bottom-right');
  assert.equal((await host('info')).focused, false);
  assert.equal((await inspect()).mode, 'clock'); assert.equal((await inspect()).sound, false); assert.equal((await inspect()).settingsOpen, false);
  await screenshot('10-bottom-right-restarted.png');
  record('corner restart restores size/position with quiet unfocused current-clock capsule');
  await host('power', 'lock-screen'); await page.waitForTimeout(150); assert.equal((await inspect()).paused, true);
  await host('power', 'unlock-screen'); await page.waitForTimeout(150); assert.equal((await inspect()).paused, false);
  record('safe lock/unlock event simulation resumes without a real logoff');
  await host('menu', 'right'); assert.equal((await host('info')).settings.anchor, 'right');
  await host('menu', 'pinned'); assert.equal((await host('info')).pinned, false); await host('menu', 'pinned'); assert.equal((await host('info')).pinned, true);
  record('corner shortcuts and always-on-top remain functional');
  await host('offline', true); await page.reload(); await page.waitForFunction(() => !!window.muyu);
  await page.evaluate(() => { window.muyu.setTime(600); window.muyu.resetCount(); }); await page.waitForTimeout(1500); assert.ok((await inspect()).count > 0);
  await host('offline', false); record('offline reload and capsule operation');
  assert.deepEqual(consoleErrors, []); assert.deepEqual((await host('info')).errors, []); record('zero normal-operation console/preload errors');
  const beforeInvalid = await host('info');
  for (const [type, data] of [['desktopSize', { width: 99999 }], ['desktopScale', { delta: Infinity }], ['desktopGesture', { action: 'update', mode: 'move', dx: 500, dy: 500 }], ['layout', { extra: 99999, settingsOpen: true }]]) await post(type, data);
  await page.waitForTimeout(100); assert.deepEqual((await host('info')).bounds, beforeInvalid.bounds);
  assert.equal(await page.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } }), true);
  record('invalid geometry IPC, orphan update and external network blocked');
  report.passed = true;
} catch (e) { report.passed = false; report.errors.push(String(e.stack ?? e)); console.error(e); process.exitCode = 1; }
finally { if (application) await application.close(); report.finished = new Date().toISOString(); await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2)); }
