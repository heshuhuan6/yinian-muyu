const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSettings, validMessage, validPeriods, localAsset } = require('../validation.cjs');

test('untrusted persisted preferences normalize to safe defaults', () => {
  const defaults = cleanSettings(null);
  assert.equal(defaults.bpm, 60);
  assert.equal(defaults.anchor, 'left');
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
  assert.equal(validMessage({ type: 'layout', data: { extra: 250 } }), true);
  for (const message of [{ type: 'exec', data: 'anything' }, { type: 'layout', data: { extra: -1 } }, { type: 'layout', data: { extra: Infinity } }, { type: 'layout', data: { extra: 1201 } }, { type: 'settings', data: { periods: [], bpm: 100 } }, { type: 'menu', data: { command: 'launch' } }, { type: 'error', data: 'x'.repeat(4097) }]) assert.equal(validMessage(message), false);
});
test('asset URL policy rejects remote, local file, foreign hosts and encoded path escapes', () => {
  assert.equal(localAsset('muyu://app/index.html'), 'index.html');
  assert.equal(localAsset('muyu://app/assets/app.js'), 'assets/app.js');
  for (const url of ['https://example.com/', 'file:///C:/Windows/win.ini', 'muyu://remote/index.html', 'muyu://app/%2e%2e%2fsecret', 'muyu://app/a%5Cb', 'muyu://user@app/index.html', 'muyu://app:123/index.html', 'muyu://app/%00']) assert.equal(localAsset(url), null);
});
