'use strict';

const RATIO = 84 / 160;
const MIN_WIDTH = 240, MAX_WIDTH = 800;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clampWidth = value => clamp(Math.round(value), MIN_WIDTH, MAX_WIDTH);
const heightFor = width => Math.ceil(width * RATIO);

function displayForRect(rect, displays, preferredId) {
  let best, bestOverlap = -1, bestDistance = Infinity;
  for (const display of displays) {
    const a = display.workArea;
    const overlap = Math.max(0, Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x)) *
      Math.max(0, Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y));
    const dx = Math.max(a.x - (rect.x + rect.width), rect.x - (a.x + a.width), 0);
    const dy = Math.max(a.y - (rect.y + rect.height), rect.y - (a.y + a.height), 0);
    const distance = dx * dx + dy * dy;
    if (!best || overlap > bestOverlap || (overlap === bestOverlap && (distance < bestDistance || (distance === bestDistance && display.id === preferredId)))) {
      best = display; bestOverlap = overlap; bestDistance = distance;
    }
  }
  return best;
}
function fitRect(rect, area) {
  // Only an impossibly small work area can force a width below the UI minimum.
  const width = Math.min(clampWidth(rect.width), area.width, Math.floor(area.height / RATIO));
  const height = heightFor(width);
  return { x: Math.round(clamp(rect.x, area.x, area.x + area.width - width)),
    y: Math.round(clamp(rect.y, area.y, area.y + area.height - height)), width, height };
}
function capsulePose(settings, displays) {
  let display = displays.find(d => d.id === settings.display) ?? displays[0];
  let x = display.workArea.x + 16, y = display.workArea.y + 16;
  if (settings.anchor === 'custom' && settings.position) {
    ({ x, y } = settings.position);
    display = displayForRect({ x, y, width: settings.width, height: heightFor(settings.width) }, displays, settings.display);
  } else if (settings.anchor === 'right') x = display.workArea.x + display.workArea.width - settings.width - 16;
  return { rect: fitRect({ x, y, width: settings.width }, display.workArea), display };
}
function windowRect(capsule, area, settingsOpen, extra) {
  if (!settingsOpen) return { ...capsule };
  const width = Math.min(area.width, Math.max(capsule.width, 480));
  const height = Math.min(area.height, capsule.height + Math.ceil(extra));
  return { x: Math.round(clamp(capsule.x - (width - capsule.width) / 2, area.x, area.x + area.width - width)),
    y: Math.round(clamp(capsule.y, area.y, area.y + area.height - height)), width, height };
}
function gestureRect(origin, mode, dx, dy) {
  if (mode === 'move') return { ...origin, x: origin.x + dx, y: origin.y + dy };
  // Project the pointer displacement onto the capsule's bottom-right diagonal.
  const width = clampWidth(origin.width + (dx + RATIO * dy) / (1 + RATIO * RATIO));
  return { ...origin, width, height: heightFor(width) };
}
module.exports = { RATIO, MIN_WIDTH, MAX_WIDTH, clampWidth, heightFor, displayForRect, fitRect, capsulePose, windowRect, gestureRect };
