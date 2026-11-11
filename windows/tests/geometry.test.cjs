const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSettings } = require('../validation.cjs');
const { RATIO, clampWidth, capsulePose, windowRect, displayForRect, fitRect, gestureRect } = require('../geometry.cjs');
const screens = [
  { id: 1, workArea: { x: 0, y: 0, width: 1536, height: 816 } },
  { id: 2, workArea: { x: -1920, y: -120, width: 1920, height: 1080 } },
];
test('default is capsule only; corner commands preserve the intended aspect', () => {
  assert.deepEqual(capsulePose(cleanSettings(null), screens).rect, { x: 16, y: 16, width: 480, height: 252 });
  assert.deepEqual(capsulePose(cleanSettings({ width: 377, anchor: 'right' }), screens).rect, { x: 1143, y: 16, width: 377, height: 198 });
});
test('expanded drawer at bottom/right does not mutate the collapsed geometry', () => {
  const settings = cleanSettings({ width: 240, anchor: 'custom', position: { x: 1296, y: 690 } });
  const original = structuredClone(settings), { rect, display } = capsulePose(settings, screens);
  assert.deepEqual(rect, { x: 1296, y: 690, width: 240, height: 126 });
  const expanded = windowRect(rect, display.workArea, true, 520);
  assert.deepEqual(expanded, { x: 1056, y: 170, width: 480, height: 646 });
  assert.deepEqual(settings, original);
  assert.deepEqual(windowRect(rect, display.workArea, false, 520), rect);
  assert.equal(windowRect(rect, display.workArea, true, 1200).height, 816);
  assert.equal(windowRect({ ...rect, x: 600 }, display.workArea, true, 320).x, 480);
});
test('custom coordinates survive negative-coordinate displays and unplug recovery', () => {
  const settings = cleanSettings({ width: 600, anchor: 'custom', position: { x: -1400, y: 100 }, display: 2 });
  assert.deepEqual(capsulePose(settings, screens).rect, { x: -1400, y: 100, width: 600, height: 315 });
  assert.equal(capsulePose(settings, [screens[0]]).rect.x, 0);
  assert.equal(settings.position.x, -1400);
  assert.equal(displayForRect({ x: -300, y: 30, width: 240, height: 126 }, screens, 1).id, 2);
});
test('gestures use original absolute offsets and resize proportionally', () => {
  const origin = { x: 300, y: 160, width: 480, height: 252 };
  assert.deepEqual(gestureRect(origin, 'move', 127, -90), { x: 427, y: 70, width: 480, height: 252 });
  assert.deepEqual(gestureRect(origin, 'resize', 100, 100 * RATIO), { x: 300, y: 160, width: 580, height: 305 });
  assert.equal(gestureRect(origin, 'resize', 10000, 10000).width, 800);
  assert.equal(gestureRect(origin, 'resize', -10000, -10000).width, 240);
  assert.deepEqual(origin, { x: 300, y: 160, width: 480, height: 252 });
});
test('offscreen movement and growing capsules clamp to the full work area', () => {
  assert.deepEqual(fitRect({ x: 1400, y: 780, width: 800 }, screens[0].workArea), { x: 736, y: 396, width: 800, height: 420 });
  assert.deepEqual(fitRect({ x: -9999, y: -9999, width: 240 }, screens[1].workArea), { x: -1920, y: -120, width: 240, height: 126 });
  assert.equal(clampWidth(801), 800); assert.equal(clampWidth(239), 240);
});
