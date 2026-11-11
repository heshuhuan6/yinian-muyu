import { clamp, Simulation } from './motion';
import { createRenderer } from './renderer';
import { PixelWorld } from './world';
import { WoodSound } from './sound';
import { DEFAULT_PERIODS, clockLight, formatTime, isScheduled, nextStart, parseTime, systemMinutes, validPeriods } from './schedule';
import type { Period } from './schedule';

export interface Snapshot {
  active: boolean; count: number; bpm: number; phase: number; time: number;
  minutes: number; mode: 'clock' | 'preview' | 'demo'; periods: Period[];
  position: number; target: number; velocity: number; stretch: number;
  paused: boolean; reduced: boolean; demo: boolean; sound: boolean;
  backend: string; pixelScale: number; width: number; height: number; checksum: string;
  desktopWidth: number; settingsOpen: boolean;
  audio: ReturnType<WoodSound['inspect']>;
}
interface MuyuAPI {
  inspect(): Snapshot;
  setTime(minutes: number): Snapshot;
  resumeClock(): Snapshot;
  setPeriods(periods: Period[]): Snapshot;
  showSettings(open: boolean): void;
  setDesktopSize(width: number): void;
  setTempo(value: number): Snapshot;
  setSound(value: boolean): Promise<Snapshot>;
  setPaused(value: boolean): Snapshot;
  setReduced(value: boolean): Snapshot;
  resetCount(): Snapshot;
}
declare global {
  interface Window {
    __MUYU_NATIVE__?: { reduced: boolean; periods?: Period[]; bpm?: number; width?: number };
    webkit?: { messageHandlers?: { muyu?: { postMessage(message: unknown): void } } };
    muyu?: MuyuAPI;
    __render?: (seconds: number) => Snapshot;
    __inspect?: () => Snapshot;
  }
}
const rooms = [[209, 221, 215], [218, 225, 204], [236, 224, 201], [238, 229, 212]];
const storageKey = 'yinian.muyu.schedule.v1';

export function mountEngine(room: HTMLElement): { dispose(): void } {
  const find = <T extends HTMLElement>(selector: string): T => room.querySelector<T>(selector)!;
  const slider = find<HTMLElement>('.world-switch'), stage = find('.stage');
  const counter = find('.counter'), live = find('#live-status'), status = find('.status-label');
  const timeValue = find('.time-value'), timeMode = find('.time-mode'), returnButton = find<HTMLButtonElement>('.return-clock');
  const soundButton = find<HTMLButtonElement>('.sound-button'), soundLabel = find('.sound-label'), soundHint = find('.sound-hint');
  const details = find<HTMLDetailsElement>('.schedule'), rows = find('.schedule-rows'), scheduleHint = find('.schedule-hint');
  const summary = find('.schedule-summary'), addButton = find<HTMLButtonElement>('.add-period');
  const settingsPanel = find('.settings-panel'), sizeInput = find<HTMLInputElement>('.widget-size'), sizeNumber = find<HTMLInputElement>('.widget-size-number');
  const desktop = room.classList.contains('desktop');
  let desktopWidth = clamp(window.__MUYU_NATIVE__?.width ?? 480, 240, 800), settingsOpen = false, lastLayout = '';
  room.style.setProperty('--widget-width', desktopWidth + 'px');
  sizeInput.value = sizeNumber.value = String(Math.round(desktopWidth));
  const abort = new AbortController(), signal = abort.signal;
  const reducedMedia = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = window.__MUYU_NATIVE__?.reduced ?? reducedMedia.matches;
  const params = new URLSearchParams(location.search);
  let stored: { periods?: unknown; bpm?: number } = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (value && typeof value === 'object') stored = value as typeof stored;
  } catch { /* Storage is optional. */ }
  const candidate = window.__MUYU_NATIVE__?.periods ?? stored.periods;
  let periods = (validPeriods(candidate) ? candidate : DEFAULT_PERIODS).map(p => ({ ...p }));
  const savedTempo = window.__MUYU_NATIVE__?.bpm ?? stored.bpm ?? 60;
  let model = new Simulation(systemMinutes() / 1440, params.get('demo') === '1' && !reduced, reduced);
  model.bpm = [40, 60, 90].includes(savedTempo) ? savedTempo : 60;
  let reading = systemMinutes(), previewMinutes: number | null = null;
  let world = new PixelWorld();
  let { renderer, canvas } = createRenderer(find<HTMLCanvasElement>('canvas'), params.get('renderer') === '2d');
  const sound = new WoodSound();
  let soundWanted = false, disposed = false, suspended = false, seeking = false;
  let frame = 0, last: number | null = null, pixelScale = 1, lastPost = -1000;
  let lastStatus = '', lastCount = -1, nextID = 10;
  let gesture: { id: number; x: number; y: number; moved: boolean; offset: number } | null = null;
  let desktopGesture: { id: number; x: number; y: number; mode: 'move' | 'resize'; started: boolean } | null = null;
  const post = (type: string, data: unknown): void => window.webkit?.messageHandlers?.muyu?.postMessage({ type, data });
  const isPaused = (): boolean => suspended || (!window.__MUYU_NATIVE__ && document.hidden);
  const mode = (): Snapshot['mode'] => model.demo ? 'demo' : previewMinutes === null ? 'clock' : 'preview';
  const inspect = (): Snapshot => ({
    active: model.committed, count: model.count, bpm: model.bpm, phase: model.phase, time: model.time,
    minutes: reading, mode: mode(), periods: periods.map(p => ({ ...p })),
    position: model.position, target: model.target, velocity: model.velocity, stretch: model.stretch,
    paused: isPaused(), reduced: model.reduced, demo: model.demo, sound: soundWanted,
    backend: renderer.kind, pixelScale, width: canvas.width, height: canvas.height,
    checksum: world.checksum(), audio: sound.inspect(), desktopWidth, settingsOpen,
  });
  const clock = (): void => {
    reading = model.demo ? model.scriptClock() : previewMinutes ?? systemMinutes();
    const target = clamp(reading / 1440);
    const midnight = mode() === 'clock' && model.target > 0.98 && target < 0.02;
    model.target = target;
    if (midnight || model.reduced) model.settle();
    model.light = clockLight(reading);
    model.setPlaying(isScheduled(reading, seeking ? DEFAULT_PERIODS : periods));
  };
  const save = (): void => {
    const settings = { periods, bpm: model.bpm };
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Native bridge persists separately. */ }
    post('settings', settings);
  };
  const layout = (): void => {
    const extra = desktop ? (settingsOpen ? Math.ceil(settingsPanel.getBoundingClientRect().height + 20) : 0)
      : details.open ? find('.schedule-body').scrollHeight + 16 : 0;
    const key = extra + ':' + settingsOpen;
    if (lastLayout !== key) { lastLayout = key; post('layout', { extra, settingsOpen }); }
  };
  const renderRows = (): void => {
    rows.replaceChildren();
    periods.forEach((period, i) => {
      const row = document.createElement('div'); row.className = 'period-row'; row.dataset.id = period.id;
      const number = document.createElement('span'); number.className = 'period-number'; number.textContent = String(i + 1).padStart(2, '0');
      row.append(number);
      for (const field of ['start', 'end'] as const) {
        if (field === 'end') { const dash = document.createElement('span'); dash.textContent = '—'; dash.className = 'period-dash'; row.append(dash); }
        const input = document.createElement('input');
        input.type = 'time'; input.step = '60'; input.value = formatTime(period[field]);
        input.dataset.field = field; input.setAttribute('aria-label', '第 ' + (i + 1) + ' 段' + (field === 'start' ? '开始时间' : '结束时间'));
        row.append(input);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.remove = period.id;
      remove.className = 'remove-period'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除第 ' + (i + 1) + ' 个时段');
      row.append(remove); rows.append(row);
    });
    addButton.disabled = periods.length >= 6;
    summary.textContent = periods.length ? periods.map(p => formatTime(p.start) + '–' + formatTime(p.end) + (p.start > p.end ? '（次日）' : '')).join(' · ') : '未设置时段';
    scheduleHint.textContent = '每天重复 · 修改即保存 · 时段外自动静候';
    layout();
  };
  const paint = (): void => {
    world.draw(model); renderer.draw(world, model);
    const value = model.light * 3, key = Math.min(2, Math.floor(value)), fraction = value - key;
    const rgb = rooms[key]!.map((v, i) => Math.round(v + (rooms[key + 1]![i]! - v) * fraction));
    room.style.setProperty('--room', 'rgb(' + rgb.join(',') + ')');
    room.style.setProperty('--active', model.committed ? '1' : '0');
    room.style.setProperty('--pulse', String(Math.exp(-model.sinceHit * 12)));
    room.dataset.active = String(model.committed);
    slider.dataset.renderer = renderer.kind;
    if (lastCount !== model.count) {
      counter.textContent = String(model.count).padStart(4, '0');
      counter.setAttribute('aria-label', '本次已敲 ' + model.count + ' 次'); lastCount = model.count;
    }
    const formatted = formatTime(reading, true);
    if (timeValue.textContent !== formatted) timeValue.textContent = formatted;
    const currentMode = mode();
    timeMode.textContent = currentMode === 'clock' ? '当地时间' : currentMode === 'demo' ? '时间演示' : '时间预览';
    returnButton.disabled = currentMode === 'clock';
    returnButton.textContent = currentMode === 'clock' ? '正跟随现在' : '回到当前时间';
    slider.setAttribute('aria-valuenow', reading.toFixed(2));
    slider.setAttribute('aria-valuetext', formatted + (model.committed ? '，敲击时段' : '，静候时段') + (currentMode === 'clock' ? '，跟随当地时间' : '，时间预览'));
    const line = model.committed ? '时段内 · 正在轻敲' : nextStart(reading, periods);
    status.textContent = line;
    const announcement = currentMode + ':' + model.committed + ':' + periods.length;
    if (lastStatus !== announcement) {
      live.textContent = (currentMode === 'clock' ? '跟随当地时间。' : '手动时间预览。') + line;
      lastStatus = announcement; post('status', inspect());
    }
    if (performance.now() - lastPost >= 1000) { post('status', inspect()); lastPost = performance.now(); }
  };
  const resize = (): void => {
    const dpr = devicePixelRatio || 1;
    const available = desktop ? Math.min(800, stage.clientWidth)
      : Math.min(800, stage.clientWidth, Math.max(168, innerHeight - (details.open ? 560 : 470)) * 160 / 84);
    const scale = Math.min(available * dpr / 160, 422 * dpr / 84);
    // Custom desktop sizes fill the chosen width; world textures still use NEAREST.
    // The full-page experience retains whole-device-pixel scaling.
    pixelScale = desktop ? scale : scale >= 1 ? Math.floor(scale + 1e-8) : scale;
    canvas.width = Math.round(160 * pixelScale); canvas.height = Math.round(84 * pixelScale);
    slider.style.width = canvas.width / dpr + 'px'; slider.style.height = canvas.height / dpr + 'px';
    paint(); layout();
  };
  const tick = (now: number): void => {
    if (disposed || seeking || isPaused()) return;
    const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000); last = now;
    clock(); model.step(dt);
    if (model.didHit) sound.strike();
    paint(); frame = requestAnimationFrame(tick);
  };
  const restartLoop = (): void => {
    cancelAnimationFrame(frame); last = null;
    if (!isPaused() && !seeking && !disposed) frame = requestAnimationFrame(tick);
    if (soundWanted) void sound.enable(!isPaused() && !seeking);
  };
  const handover = (): void => {
    if (model.demo) previewMinutes = reading;
    model.handover();
    if (seeking) { seeking = false; restartLoop(); }
  };
  const setTime = (minutes: number): Snapshot => {
    if (!Number.isFinite(minutes)) return inspect();
    handover(); previewMinutes = clamp(minutes, 0, 1440); clock(); paint(); return inspect();
  };
  const cancelGesture = (): void => {
    if (desktopGesture) {
      if (desktopGesture.started) post('desktopGesture', { action: 'cancel', mode: desktopGesture.mode, dx: 0, dy: 0 });
      const id = desktopGesture.id; desktopGesture = null;
      delete slider.dataset.desktopGesture;
      if (slider.hasPointerCapture(id)) slider.releasePointerCapture(id);
    }
    if (gesture) { const id = gesture.id; gesture = null; if (slider.hasPointerCapture(id)) slider.releasePointerCapture(id); }
    model.dragging = false; delete slider.dataset.dragging;
  };
  const applyPeriods = (next: Period[]): Snapshot => {
    if (!validPeriods(next)) throw new RangeError('时段的起止时间应有效且不同，最多 6 段。');
    periods = next.map(p => ({ ...p })); save(); renderRows(); clock(); paint();
    live.textContent = '每日敲击时段已更新。'; return inspect();
  };
  const api: MuyuAPI = {
    inspect, setTime, setPeriods: applyPeriods,
    resumeClock() { handover(); cancelGesture(); previewMinutes = null; clock(); paint(); return inspect(); },
    showSettings(open) {
      settingsOpen = desktop && open; room.classList.toggle('settings-open', settingsOpen);
      if (!open) room.scrollTop = 0;
      details.open = open;
      resize();
      if (open && desktop) find<HTMLButtonElement>('.close-settings').focus({ preventScroll: true });
      else if (desktop) slider.focus({ preventScroll: true });
    },
    setDesktopSize(width) {
      if (!Number.isFinite(width)) return;
      desktopWidth = clamp(width, 240, 800);
      room.style.setProperty('--widget-width', desktopWidth + 'px');
      sizeInput.value = sizeNumber.value = String(Math.round(desktopWidth)); resize();
    },
    setTempo(value) {
      if (![40, 60, 90].includes(value)) return inspect();
      handover(); model.bpm = value; model.phase = 0;
      room.querySelectorAll<HTMLButtonElement>('.tempo-button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.bpm) === value)));
      save(); live.textContent = '节奏设为每分钟 ' + value + ' 次。'; post('status', inspect()); return inspect();
    },
    async setSound(value) {
      handover(); soundButton.disabled = true;
      soundWanted = value && await sound.enable(true);
      if (!value) await sound.enable(false);
      if (disposed) return inspect();
      soundButton.disabled = false; soundButton.setAttribute('aria-pressed', String(soundWanted));
      soundButton.setAttribute('aria-label', soundWanted ? '关闭木鱼声音' : '开启木鱼声音');
      soundLabel.textContent = soundWanted ? '声音已开' : '开启声音';
      soundHint.textContent = soundWanted ? '一声一声，慢慢来' : value ? '请再点击一次开启声音' : '默认静音，声音由你开启';
      live.textContent = soundWanted ? '木鱼声音已开启。' : '木鱼声音已关闭。';
      post('status', inspect()); return inspect();
    },
    setPaused(value) { suspended = value; cancelGesture(); restartLoop(); post('status', inspect()); return inspect(); },
    setReduced(value) { model.reduced = value; if (value) { model.settle(); model.cursor.opacity = 0; } clock(); paint(); return inspect(); },
    resetCount() { handover(); model.count = 0; model.phase = 0; model.activeSeconds = 0; paint(); live.textContent = '本次次数已清零。'; return inspect(); },
  };
  window.muyu = api;
  window.addEventListener('pointerdown', handover, { signal, capture: true });
  window.addEventListener('keydown', handover, { signal, capture: true });
  const minuteAt = (clientX: number, offset = 0): number => {
    const bounds = slider.getBoundingClientRect(), unit = bounds.width / 160;
    return clamp(((clientX - bounds.left - offset) / unit - 45) / 70) * 1440;
  };
  slider.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = slider.getBoundingClientRect(), unit = bounds.width / 160;
    const delta = event.clientX - bounds.left - (45 + model.position * 70) * unit;
    const y = (event.clientY - bounds.top) / unit;
    const overLens = Math.hypot(delta / unit, Math.max(Math.abs(y - 42) - 15, 0)) <= 22;
    const handle = (event.target as HTMLElement).closest('.resize-handle');
    if (desktop && window.__MUYU_NATIVE__ && (handle || event.altKey || !overLens)) {
      event.preventDefault();
      desktopGesture = { id: event.pointerId, x: event.screenX, y: event.screenY, mode: handle ? 'resize' : 'move', started: false };
      slider.setPointerCapture(event.pointerId); slider.focus({ preventScroll: true }); return;
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, offset: Math.abs(delta) <= 21 * unit ? delta : 0 };
    slider.setPointerCapture(event.pointerId); slider.focus({ preventScroll: true });
  }, { signal });
  window.addEventListener('pointermove', event => {
    if (desktopGesture && desktopGesture.id === event.pointerId) {
      const dx = event.screenX - desktopGesture.x, dy = event.screenY - desktopGesture.y;
      if (!desktopGesture.started && Math.hypot(dx, dy) > 4) {
        desktopGesture.started = true;
        slider.dataset.desktopGesture = desktopGesture.mode;
        post('desktopGesture', { action: 'begin', mode: desktopGesture.mode, dx: 0, dy: 0 });
      }
      if (desktopGesture.started) post('desktopGesture', { action: 'update', mode: desktopGesture.mode, dx, dy });
      return;
    }
    const bounds = slider.getBoundingClientRect();
    model.pointerX = clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
    model.pointerY = clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1);
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { cancelGesture(); return; }
    if (Math.abs(dx) > 4) gesture.moved = true;
    if (gesture.moved) {
      previewMinutes = minuteAt(event.clientX, gesture.offset); model.dragging = true;
      slider.dataset.dragging = 'true'; clock(); if (model.reduced) model.settle();
    }
  }, { signal });
  window.addEventListener('pointerup', event => {
    if (desktopGesture && desktopGesture.id === event.pointerId) {
      const current = desktopGesture; desktopGesture = null; delete slider.dataset.desktopGesture;
      if (current.started) post('desktopGesture', { action: 'end', mode: current.mode, dx: event.screenX - current.x, dy: event.screenY - current.y });
      if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
      return;
    }
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.moved) previewMinutes = minuteAt(event.clientX);
    gesture = null; model.dragging = false; delete slider.dataset.dragging;
    if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
    clock(); paint();
  }, { signal });
  window.addEventListener('pointercancel', cancelGesture, { signal });
  window.addEventListener('blur', cancelGesture, { signal });
  slider.addEventListener('lostpointercapture', cancelGesture, { signal });
  slider.addEventListener('pointerleave', () => { if (!gesture) model.pointerX = model.pointerY = 0; }, { signal });
  slider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (['Enter', ' '].includes(event.key)) { if (!event.repeat) api.resumeClock(); }
    else if (event.key === 'Home') setTime(0);
    else if (event.key === 'End') setTime(1440);
    else setTime(reading + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 60 : 15));
  }, { signal });
  returnButton.addEventListener('click', () => api.resumeClock(), { signal });
  find<HTMLButtonElement>('.close-settings').addEventListener('click', () => api.showSettings(false), { signal });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancelGesture(); if (settingsOpen) api.showSettings(false); }
  }, { signal });
  const requestSize = (value: number): void => {
    if (!Number.isFinite(value)) return;
    const width = Math.round(clamp(value, 240, 800));
    api.setDesktopSize(width); post('desktopSize', { width });
  };
  sizeInput.addEventListener('input', () => requestSize(Number(sizeInput.value)), { signal });
  sizeNumber.addEventListener('change', () => requestSize(Number(sizeNumber.value)), { signal });
  slider.addEventListener('wheel', event => {
    if (!desktop) return;
    event.preventDefault();
    const delta = clamp(-event.deltaY * (event.deltaMode === 1 ? 12 : .6), -60, 60);
    if (window.__MUYU_NATIVE__) post('desktopScale', { delta });
    else requestSize(desktopWidth + delta);
  }, { signal, passive: false });
  room.querySelectorAll<HTMLButtonElement>('.tempo-button').forEach(b => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.bpm) === model.bpm));
    b.addEventListener('click', () => api.setTempo(Number(b.dataset.bpm)), { signal });
  });
  soundButton.addEventListener('click', () => { void api.setSound(!soundWanted); }, { signal });
  find<HTMLButtonElement>('.reset-button').addEventListener('click', () => api.resetCount(), { signal });
  rows.addEventListener('change', () => {
    const next: Period[] = []; let valid = true;
    rows.querySelectorAll<HTMLElement>('.period-row').forEach(row => {
      const start = row.querySelector<HTMLInputElement>('[data-field=start]')!, end = row.querySelector<HTMLInputElement>('[data-field=end]')!;
      const a = parseTime(start.value), b = parseTime(end.value), okay = a !== null && b !== null && a !== b;
      start.setAttribute('aria-invalid', String(!okay)); end.setAttribute('aria-invalid', String(!okay));
      if (!okay) valid = false; else next.push({ id: row.dataset.id!, start: a!, end: b! });
    });
    if (valid) { periods = next; save(); clock(); paint(); summary.textContent = periods.map(p => formatTime(p.start) + '–' + formatTime(p.end) + (p.start > p.end ? '（次日）' : '')).join(' · '); scheduleHint.textContent = '已保存 · 每天按这些时段自动敲击'; }
    else scheduleHint.textContent = '请填写有效时间，开始与结束应不同。';
  }, { signal });
  rows.addEventListener('click', event => {
    const element = event.target as HTMLElement, remove = element.closest<HTMLButtonElement>('[data-remove]');
    if (remove) applyPeriods(periods.filter(p => p.id !== remove.dataset.remove));
  }, { signal });
  addButton.addEventListener('click', () => {
    if (periods.length < 6) {
      while (periods.some(p => p.id === 'period-' + nextID)) nextID++;
      applyPeriods([...periods, { id: 'period-' + nextID++, start: 1080, end: 1140 }]);
    }
  }, { signal });
  details.addEventListener('toggle', () => { layout(); resize(); }, { signal });
  reducedMedia.addEventListener('change', () => api.setReduced(reducedMedia.matches), { signal });
  window.addEventListener('resize', resize, { signal });
  document.addEventListener('visibilitychange', restartLoop, { signal });
  document.addEventListener('contextmenu', event => {
    if (desktop) { event.preventDefault(); if (window.__MUYU_NATIVE__) post('menu', null); else api.showSettings(!settingsOpen); }
  }, { signal });
  window.addEventListener('error', e => post('error', e.message), { signal });
  window.addEventListener('unhandledrejection', e => post('error', String(e.reason)), { signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); renderer.dispose();
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement; canvas.replaceWith(replacement);
    ({ renderer, canvas } = createRenderer(replacement, true)); resize();
  }, { signal });
  const seek = (seconds: number): Snapshot => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('__render(t) expects finite, nonnegative seconds');
    cancelAnimationFrame(frame); seeking = true; cancelGesture();
    model = new Simulation(360 / 1440, !reducedMedia.matches, reducedMedia.matches);
    world = new PixelWorld(); lastStatus = ''; lastCount = -1; previewMinutes = 360;
    room.querySelectorAll<HTMLButtonElement>('.tempo-button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.bpm) === model.bpm)));
    for (let i = 0; i < Math.floor(seconds * 60 + 1e-8); i++) { clock(); model.step(1 / 60); }
    clock(); paint(); return inspect();
  };
  window.__render = seek; window.__inspect = inspect;
  renderRows(); clock(); model.settle(); resize(); frame = requestAnimationFrame(tick); post('ready', inspect());
  return { dispose() {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(frame); abort.abort(); cancelGesture(); renderer.dispose(); sound.dispose();
    if (window.muyu === api) delete window.muyu;
    if (window.__render === seek) delete window.__render;
    if (window.__inspect === inspect) delete window.__inspect;
  } };
}
