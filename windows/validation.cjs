'use strict';

const DEFAULT_PERIODS = [{ id: 'period-1', start: 480, end: 720 }, { id: 'period-2', start: 870, end: 1050 }];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validPeriods(value) {
  return Array.isArray(value) && value.length <= 6 && new Set(value.map(p => p?.id)).size === value.length && value.every(p =>
    plain(p) && typeof p.id === 'string' && /^[\w-]{1,80}$/.test(p.id) &&
    Number.isInteger(p.start) && p.start >= 0 && p.start < 1440 &&
    Number.isInteger(p.end) && p.end >= 0 && p.end < 1440 && p.start !== p.end);
}
function cleanSettings(value) {
  const v = plain(value) ? value : {};
  const position = plain(v.position) && [v.position.x, v.position.y].every(n => Number.isFinite(n) && Math.abs(n) <= 100000)
    ? { x: Math.round(v.position.x), y: Math.round(v.position.y) } : null;
  return {
    periods: (validPeriods(v.periods) ? v.periods : DEFAULT_PERIODS).map(({ id, start, end }) => ({ id, start, end })),
    bpm: [40, 60, 90].includes(v.bpm) ? v.bpm : 60,
    anchor: v.anchor === 'custom' && position ? 'custom' : ['left', 'right', 'bottom-left', 'bottom-right'].includes(v.anchor) ? v.anchor : 'right',
    position,
    width: Number.isFinite(v.width) && v.width >= 240 && v.width <= 800 ? Math.round(v.width) : 480,
    pinned: typeof v.pinned === 'boolean' ? v.pinned : true,
    display: Number.isSafeInteger(v.display) ? v.display : null,
  };
}
function validMessage(message) {
  if (!plain(message) || typeof message.type !== 'string') return false;
  const d = message.data;
  switch (message.type) {
    case 'settings': return plain(d) && validPeriods(d.periods) && [40, 60, 90].includes(d.bpm);
    case 'layout': return plain(d) && Number.isFinite(d.extra) && d.extra >= 0 && d.extra <= 1200 && typeof d.settingsOpen === 'boolean';
    case 'desktopGesture': return plain(d) && ['begin', 'update', 'end', 'cancel'].includes(d.action) &&
      ['move', 'resize'].includes(d.mode) && [d.dx, d.dy].every(n => Number.isFinite(n) && Math.abs(n) <= 100000) &&
      (d.action !== 'begin' || (d.dx === 0 && d.dy === 0));
    case 'desktopSize': return plain(d) && Number.isFinite(d.width) && d.width >= 240 && d.width <= 800;
    case 'desktopScale': return plain(d) && Number.isFinite(d.delta) && Math.abs(d.delta) <= 1000;
    case 'menu': return d === null;
    case 'error': return typeof d === 'string' && d.length <= 4096;
    case 'ready':
    case 'status': return plain(d) && Number.isSafeInteger(d.count) && d.count >= 0 &&
      [40, 60, 90].includes(d.bpm) && typeof d.sound === 'boolean' && typeof d.paused === 'boolean' &&
      ['clock', 'preview', 'demo'].includes(d.mode);
    default: return false;
  }
}
function localAsset(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'muyu:' || u.hostname !== 'app' || u.port || u.username || u.password) return null;
    const path = decodeURIComponent(u.pathname);
    if (path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.')) return null;
    return path === '/' ? 'index.html' : path.replace(/^\//, '');
  } catch { return null; }
}
module.exports = { DEFAULT_PERIODS, validPeriods, cleanSettings, validMessage, localAsset };
