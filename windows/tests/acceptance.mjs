import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { makeIcon } from '../icon.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(dir, 'test-results');
await fs.mkdir(output, { recursive: true });
await makeIcon();
const report = { platform: process.platform, arch: process.arch, started: new Date().toISOString(), checks: [], errors: [], limitations: ['Power suspend/resume is tested by emitting Electron powerMonitor events; the physical workstation is not put to sleep.', 'Offline operation uses Chromium network emulation; host network adapters remain enabled for the Mac handoff.'] };
const record = (name, data) => { report.checks.push({ name, passed: true, data }); console.log('PASS', name, JSON.stringify(data ?? '')); };
let application;
try {
  application = await electron.launch({ args: [path.join(dir, 'tests', 'driver.cjs')], timeout: 30000 });
  const page = await application.firstWindow();
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.waitForFunction(() => !!window.muyu);
  await page.waitForTimeout(200);
  const inspect = () => page.evaluate(() => window.muyu.inspect());
  const host = (operation, data) => application.evaluate(({ app, powerMonitor }, { operation, data }) => {
    const h = globalThis.__muyuTestHost;
    const w = h.getWindow();
    if (operation === 'info') return { settings: h.getSettings(), errors: h.getErrors(), bounds: w.getBounds(), visible: w.isVisible(), pinned: w.isAlwaysOnTop(), webPreferences: w.webContents.getLastWebPreferences(), userData: app.getPath('userData') };
    if (operation === 'menu') { const item = h.getMenu().getMenuItemById(data); item.click(item, w, {}); }
    if (operation === 'power') powerMonitor.emit(data);
    if (operation === 'blur') w.blur();
    if (operation === 'offline') w.webContents.session.enableNetworkEmulation({ offline: data });
  }, { operation, data });

  const initial = await inspect();
  assert.equal(initial.mode, 'clock'); assert.equal(initial.bpm, 60); assert.equal(initial.sound, false);
  assert.deepEqual(initial.periods.map(p => [p.start, p.end]), [[480, 720], [870, 1050]]);
  const info = await host('info');
  assert.equal(info.pinned, true); assert.equal(info.settings.anchor, 'left');
  for (const [key, value] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false })) assert.equal(info.webPreferences[key], value);
  const pageAccess = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, bridge: !!window.webkit?.messageHandlers?.muyu, native: window.__MUYU_NATIVE__ }));
  assert.equal(pageAccess.require, 'undefined'); assert.equal(pageAccess.process, 'undefined');
  record('startup, defaults and sandbox', { initial, bounds: info.bounds, pageAccess });
  await page.screenshot({ path: path.join(output, '01-default-left.png'), omitBackground: true });
  await page.waitForTimeout(1100);
  const current = await inspect(); assert.ok(current.minutes > initial.minutes); record('real local clock advances', { from: initial.minutes, to: current.minutes });

  const boundaries = [];
  for (const [minutes, active] of [[0, false], [479.999, false], [480, true], [719.999, true], [720, false], [869.999, false], [870, true], [1049.999, true], [1050, false], [1440, false]]) {
    const result = await page.evaluate(t => window.muyu.setTime(t), minutes);
    assert.equal(result.active, active); boundaries.push({ minutes, active: result.active });
  }
  record('default schedule inclusive start / exclusive end', boundaries);
  await page.evaluate(() => window.muyu.setTime(600));
  await page.waitForTimeout(600);
  const box = await page.locator('.world-switch').boundingBox();
  const startX = box.x + box.width * (45 + 600 / 1440 * 70) / 160;
  const targetX = box.x + box.width * (45 + 777.25 / 1440 * 70) / 160;
  await page.mouse.move(startX, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(targetX, box.y + box.height / 2, { steps: 20 }); await page.mouse.up();
  const dragged = await inspect();
  await page.waitForTimeout(800);
  const settled = await inspect();
  assert.equal(settled.mode, 'preview'); assert.ok(settled.minutes > 730 && settled.minutes < 820); assert.equal(settled.minutes, dragged.minutes);
  assert.ok(settled.target > 0 && settled.target < 1);
  record('actual pointer drag retains intermediate preview without endpoint snapping', { dragged: dragged.minutes, settled: settled.minutes, target: settled.target });
  await page.screenshot({ path: path.join(output, '02-drag-preview.png'), omitBackground: true });
  await page.getByRole('button', { name: '回到当前时间' }).click(); assert.equal((await inspect()).mode, 'clock');
  record('return to current time button');

  await page.locator('.schedule summary').click();
  await page.waitForTimeout(300);
  const expanded = await host('info'); assert.ok(expanded.bounds.height > info.bounds.height);
  await page.getByRole('button', { name: '＋ 添加时段' }).click();
  assert.equal((await inspect()).periods.length, 3);
  await page.getByLabel('第 3 段开始时间').fill('23:00');
  await page.getByLabel('第 3 段结束时间').fill('01:00');
  await page.getByLabel('第 3 段结束时间').press('Tab');
  const night = (await inspect()).periods[2]; assert.equal(night.start, 1380); assert.equal(night.end, 60);
  for (const [minutes, active] of [[1380, true], [1439.9, true], [0, true], [59.9, true], [60, false]]) assert.equal((await page.evaluate(t => window.muyu.setTime(t), minutes)).active, active);
  await page.screenshot({ path: path.join(output, '03-settings-midnight.png'), omitBackground: true });
  await page.getByRole('button', { name: '删除第 3 个时段' }).click(); assert.equal((await inspect()).periods.length, 2);
  record('edit / add / remove periods, midnight scheduling, native window expansion', { height: expanded.bounds.height, night });

  await page.evaluate(() => { window.muyu.setPeriods([{ id: 'one', start: 480, end: 720 }, { id: 'two', start: 500, end: 700 }]); window.muyu.setTime(600); window.muyu.setTempo(60); window.muyu.resetCount(); });
  await page.waitForTimeout(3200);
  const overlap = await inspect(); assert.ok(overlap.count >= 2 && overlap.count <= 4); record('overlapping periods do not double count', { seconds: 3.2, count: overlap.count });
  const rates = [];
  for (const bpm of [40, 60, 90]) {
    await page.getByRole('button', { name: `每分钟 ${bpm} 次`, exact: true }).click();
    await page.evaluate(() => window.muyu.resetCount());
    await page.waitForTimeout(3100);
    const s = await inspect(); assert.equal(s.bpm, bpm); assert.ok(Math.abs(s.count - 3.1 * bpm / 60) < 1.6); rates.push({ bpm, count: s.count, seconds: 3.1 });
  }
  record('40 / 60 / 90 tempo via visible controls', rates);

  // Observe the real Web Audio output signal without capturing the microphone.
  await page.evaluate(() => {
    const original = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = original.call(this);
      if (!window.__audioProbe) { const analyser = this.createAnalyser(); analyser.fftSize = 2048; gain.connect(analyser); window.__audioProbe = analyser; }
      return gain;
    };
  });
  await page.getByRole('button', { name: '开启木鱼声音', exact: true }).click();
  const signal = await page.evaluate(async () => {
    let peak = 0;
    const data = new Float32Array(2048);
    for (let i = 0; i < 160; i++) { window.__audioProbe?.getFloatTimeDomainData(data); for (const v of data) peak = Math.max(peak, Math.abs(v)); await new Promise(resolve => setTimeout(resolve, 10)); }
    return { peak, state: window.muyu.inspect() };
  });
  assert.ok(signal.peak > .001); assert.equal(signal.state.audio.state, 'running'); assert.ok(signal.state.audio.hits > 0);
  await page.getByRole('button', { name: '关闭木鱼声音', exact: true }).click();
  assert.equal((await inspect()).audio.state, 'suspended');
  record('sound defaults off, explicit enable produces nonzero local audio, disable suspends', { peak: signal.peak, audio: signal.state.audio });

  await page.evaluate(() => { window.muyu.setTempo(60); window.muyu.resetCount(); });
  await host('blur'); await page.waitForTimeout(2200); assert.ok((await inspect()).count >= 1); record('visible but unfocused continues');
  await host('menu', 'visible'); await page.waitForTimeout(200);
  const hidden = await inspect(); assert.equal(hidden.paused, true);
  await page.waitForTimeout(2200); assert.equal((await inspect()).count, hidden.count);
  await host('menu', 'visible'); await page.waitForTimeout(120);
  const shown = await inspect(); assert.equal(shown.paused, false); assert.ok(shown.count - hidden.count <= 1);
  record('real hide/show stops and resumes without catch-up', { hidden: hidden.count, shown: shown.count });
  await host('power', 'suspend'); await page.waitForTimeout(150);
  const sleeping = await inspect(); assert.equal(sleeping.paused, true);
  await page.waitForTimeout(2200); assert.equal((await inspect()).count, sleeping.count);
  await host('power', 'resume'); await page.waitForTimeout(100);
  const resumed = await inspect(); assert.equal(resumed.paused, false); assert.ok(resumed.count - sleeping.count <= 1);
  record('suspend/resume handlers stop and resume without catch-up (simulated OS event)', { sleeping: sleeping.count, resumed: resumed.count });

  await host('menu', 'right'); await page.waitForTimeout(200);
  const right = await host('info');
  const workArea = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  assert.equal(right.bounds.x, workArea.x + workArea.width - right.bounds.width - 16);
  record('right corner placement', { bounds: right.bounds, workArea });
  await host('menu', 'pinned'); assert.equal((await host('info')).pinned, false);
  await host('menu', 'pinned'); assert.equal((await host('info')).pinned, true);
  record('native always-on-top can be disabled and restored');
  await page.screenshot({ path: path.join(output, '04-right-corner.png'), omitBackground: true });
  await host('offline', true);
  await page.evaluate(() => { window.muyu.setTime(600); window.muyu.resetCount(); });
  await page.waitForTimeout(2200); assert.ok((await inspect()).count >= 1);
  await page.reload(); await page.waitForFunction(() => !!window.muyu);
  const reloaded = await inspect(); assert.equal(reloaded.bpm, 60); assert.equal(reloaded.periods.length, 2);
  record('offline reload and operation, settings bootstrap', { reloaded });
  await host('offline', false);
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  assert.deepEqual((await host('info')).errors, []);
  record('no normal-operation console or preload errors', { consoleErrors });

  const settingsBefore = (await host('info')).settings;
  await page.evaluate(() => {
    window.webkit.messageHandlers.muyu.postMessage({ type: 'settings', data: { periods: [], bpm: 999 } });
    window.webkit.messageHandlers.muyu.postMessage({ type: 'layout', data: { extra: 999999 } });
    window.open('https://example.com');
  });
  await page.waitForTimeout(100);
  assert.deepEqual((await host('info')).settings, settingsBefore); assert.equal(application.windows().length, 1);
  const beforeURL = page.url();
  await page.evaluate(() => { location.href = 'https://example.com'; });
  await page.waitForTimeout(200); assert.equal(page.url(), beforeURL);
  const blocked = await page.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } });
  assert.equal(blocked, true);
  record('malformed IPC, external window/navigation and network fetch blocked');
  // Restore shipped defaults so repeat runs start consistently.
  await page.evaluate(() => { window.muyu.setPeriods([{ id: 'period-1', start: 480, end: 720 }, { id: 'period-2', start: 870, end: 1050 }]); window.muyu.setTempo(60); window.muyu.resumeClock(); window.muyu.showSettings(false); });
  await host('menu', 'left');
  report.finished = new Date().toISOString(); report.passed = true;
} catch (error) {
  report.passed = false; report.errors.push(String(error.stack ?? error)); console.error(error); process.exitCode = 1;
} finally {
  if (application) await application.close();
  await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
}
