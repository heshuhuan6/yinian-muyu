const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSettings, validMessage, validPeriods, localAsset } = require('../validation.cjs');

test('untrusted persisted preferences normalize to safe defaults', () => {
  const defaults = cleanSettings(null);
  assert.equal(defaults.bpm, 60);
  assert.equal(defaults.anchor, 'right');
  assert.equal(defaults.pinned, true);
  assert.deepEqual(defaults.periods.map(p => [p.start, p.end]), [[480, 720], [870, 1050]]);
  assert.deepEqual(cleanSettings({ bpm: Infinity, width: 40000, periods: 'bad', anchor: '__proto__' }), defaults);
});
test('period boundary validation accepts midnight and empty list, rejects malformed data', () => {
  assert.equal(validPeriods([]), true);
  assert.equal(validPeriods([{ id: 'night', start: 1380, end: 60 }]), true);
  for (const periods of [null, [{}], [{ id: 'x', start: 0, end: 1440 }], [{ id: 'x', start: 0, end: 0 }], [{ id: '../x', start: 0, end: 10 }], [{ id: 'x', start: 0.5, end: 10 }], Array(7).fill({ id: 'x', start: 0, end: 10 })]) assert.equal(validPeriods(periods), false);
});
test('IPC only accepts known bounded payloads', () => {
  assert.equal(validMessage({ type: 'menu', data: null }), true);
  assert.equal(validMessage({ type: 'layout', data: { extra: 250, settingsOpen: true } }), true);
  for (const message of [{ type: 'exec', data: 'anything' }, { type: 'layout', data: { extra: -1 } }, { type: 'layout', data: { extra: Infinity } }, { type: 'layout', data: { extra: 1201 } }, { type: 'settings', data: { periods: [], bpm: 100 } }, { type: 'menu', data: { command: 'launch' } }, { type: 'error', data: 'x'.repeat(4097) }]) assert.equal(validMessage(message), false);
});
test('v1 preferences migrate and arbitrary v1.1 geometry survives serialization', () => {
  assert.equal(cleanSettings({ width: 640, anchor: 'right' }).width, 640);
  const value = cleanSettings({ width: 377.3, anchor: 'custom', position: { x: -720.3, y: 214.8 }, display: 10 });
  assert.equal(value.width, 377); assert.equal(value.anchor, 'custom');
  assert.deepEqual(value.position, { x: -720, y: 215 });
  assert.deepEqual(cleanSettings(JSON.parse(JSON.stringify(value))), value);
  assert.equal(cleanSettings({ anchor: 'custom', position: { x: Infinity, y: 0 } }).anchor, 'right');
});

test('new users default upper-right while all old anchors and custom positions survive', () => {
  for (const anchor of ['left', 'right', 'bottom-left', 'bottom-right']) assert.equal(cleanSettings({ anchor }).anchor, anchor);
  assert.deepEqual(cleanSettings({ anchor: 'custom', position: { x: 123, y: 456 }, width: 533 }).position, { x: 123, y: 456 });
  assert.equal(cleanSettings({ startup: true }).startup, undefined);
});
test('desktop messages enforce finite bounded offsets and a zero-offset begin', () => {
  for (const mode of ['move', 'resize']) {
    for (const action of ['begin', 'update', 'end', 'cancel']) assert.equal(validMessage({ type: 'desktopGesture', data: { action, mode, dx: 0, dy: 0 } }), true);
  }
  for (const width of [240, 377.5, 800]) assert.equal(validMessage({ type: 'desktopSize', data: { width } }), true);
  assert.equal(validMessage({ type: 'desktopScale', data: { delta: -32 } }), true);
  for (const data of [{ action: 'begin', mode: 'move', dx: 1, dy: 0 }, { action: 'update', mode: 'exec', dx: 0, dy: 0 }, { action: 'update', mode: 'move', dx: Infinity, dy: 0 }, { action: 'end', mode: 'resize', dx: 0, dy: 100001 }]) assert.equal(validMessage({ type: 'desktopGesture', data }), false);
  for (const width of [0, 239, 801, NaN, '480']) assert.equal(validMessage({ type: 'desktopSize', data: { width } }), false);
  assert.equal(validMessage({ type: 'desktopScale', data: { delta: Infinity } }), false);
  assert.equal(validMessage({ type: 'layout', data: { extra: 0 } }), false);
});
test('asset URL policy rejects remote, local file, foreign hosts and encoded path escapes', () => {
  assert.equal(localAsset('muyu://app/index.html'), 'index.html');
  assert.equal(localAsset('muyu://app/assets/app.js'), 'assets/app.js');
  for (const url of ['https://example.com/', 'file:///C:/Windows/win.ini', 'muyu://remote/index.html', 'muyu://app/%2e%2e%2fsecret', 'muyu://app/a%5Cb', 'muyu://user@app/index.html', 'muyu://app:123/index.html', 'muyu://app/%00']) assert.equal(localAsset(url), null);
});
