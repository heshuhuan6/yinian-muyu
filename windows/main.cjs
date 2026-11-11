'use strict';
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, protocol, session, screen, powerMonitor, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { cleanSettings, validMessage, localAsset } = require('./validation.cjs');
const { clampWidth, heightFor, displayForRect, fitRect, capsulePose, windowRect, gestureRect } = require('./geometry.cjs');

const APP_URL = 'muyu://app/index.html';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'none'; font-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
app.setName('一念木鱼');
app.setAppUserModelId('local.yinian.muyu');
app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:9');
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,AutofillServerCommunication');
protocol.registerSchemesAsPrivileged([{ scheme: 'muyu', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// Session-level spelling must be disabled too: a window preference alone still
// permits Chromium to download a Hunspell dictionary on first session creation.
app.on('session-created', ses => {
  ses.setSpellCheckerDictionaryDownloadURL('muyu://app/dictionaries/');
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !localAsset(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
});

let win, tray, settings, settingsPath;
let ready = false, quitting = false, sleeping = false, locked = false, settingsExtra = 0, settingsOpen = false;
let gesture = null, saveTimer = null, syncedWidth = null;
let latest = { count: 0, bpm: 60, sound: false, mode: 'clock', paused: false };
let menu;
const errors = [];
const frontend = app.isPackaged ? path.join(__dirname, 'frontend') : path.join(__dirname, '..', 'dist');

function recordError(error) {
  const message = String(error?.message ?? error).slice(0, 4096);
  errors.push(message);
  if (errors.length > 100) errors.shift();
  console.error(message);
}
function persist() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    const temporary = settingsPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, settingsPath);
  } catch (error) { recordError(error); }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 200); }
function call(method, ...args) {
  if (!ready || !win || win.isDestroyed()) return Promise.resolve(null);
  const allowed = ['setPaused', 'setSound', 'setTempo', 'resumeClock', 'showSettings', 'resetCount', 'setDesktopSize'];
  if (!allowed.includes(method)) return Promise.resolve(null);
  return win.webContents.executeJavaScript(`window.muyu?.[${JSON.stringify(method)}]?.(...${JSON.stringify(args)})`, true)
    .catch(recordError);
}
function syncPaused() {
  return call('setPaused', sleeping || locked || !win.isVisible() || win.isMinimized());
}
function displays() {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter(d => d.id !== primary.id)];
}
function pose() { return capsulePose(settings, displays()); }
function preferredDisplay() { return pose().display; }
function place() {
  if (!win || win.isDestroyed()) return;
  const { rect, display } = pose();
  const next = windowRect(rect, display.workArea, settingsOpen, settingsExtra);
  const current = win.getBounds();
  if (Object.keys(next).some(k => current[k] !== next[k])) win.setBounds(next);
  if (ready && syncedWidth !== rect.width) {
    syncedWidth = rect.width;
    void call('setDesktopSize', rect.width);
  }
}
function commitRect(rect, display) {
  settings = { ...settings, width: rect.width, anchor: 'custom', position: { x: rect.x, y: rect.y }, display: display.id };
  place();
}
function cancelGesture() {
  if (!gesture) return;
  // Pointer cancellation retains the last valid geometry; its zero offsets are
  // not a request to jump back to the gesture origin.
  gesture = null;
  place(); persist(); refreshMenu();
}
function desktopGesture(data) {
  if (data.action === 'begin') {
    cancelGesture();
    gesture = { mode: data.mode, origin: pose().rect };
    return;
  }
  if (!gesture || gesture.mode !== data.mode) return;
  if (data.action === 'cancel') { cancelGesture(); return; }
  const target = gestureRect(gesture.origin, data.mode, data.dx, data.dy);
  const display = displayForRect(target, displays(), settings.display);
  commitRect(fitRect(target, display.workArea), display);
  if (data.action === 'end') { gesture = null; persist(); refreshMenu(); }
}
function setDesktopWidth(width, immediate = false) {
  cancelGesture();
  settings.width = clampWidth(width);
  const { rect, display } = pose();
  // The stored position always refers to the collapsed capsule, never a drawer.
  if (settings.anchor === 'custom') commitRect(rect, display); else place();
  if (immediate) persist(); else saveSoon();
  refreshMenu();
}
function show() {
  place();
  win.show();
  win.setAlwaysOnTop(settings.pinned, 'screen-saver');
  void syncPaused();
  refreshMenu();
}
function setPreference(key, value) {
  if (key === 'width') { setDesktopWidth(value, true); return; }
  cancelGesture();
  const previous = pose();
  settings[key] = value;
  if (key === 'anchor') settings.position = null;
  if (key === 'display' && settings.anchor === 'custom') {
    const display = displays().find(d => d.id === value);
    if (display) commitRect(fitRect({ ...previous.rect, x: display.workArea.x + previous.rect.x - previous.display.workArea.x,
      y: display.workArea.y + previous.rect.y - previous.display.workArea.y }, display.workArea), display);
  }
  persist();
  if (key === 'pinned') win.setAlwaysOnTop(value, 'screen-saver');
  place();
  refreshMenu();
}
function refreshMenu() {
  if (!tray || !win || win.isDestroyed()) return;
  menu = Menu.buildFromTemplate([
    { label: `一念木鱼 · 已敲 ${latest.count} 声`, enabled: false },
    { type: 'separator' },
    { id: 'clock', label: '跟随当前时间', type: 'checkbox', checked: latest.mode === 'clock', click: () => { show(); void call('resumeClock'); } },
    { id: 'schedule', label: '打开设置与每日时段', click: () => { show(); void call('showSettings', true); } },
    { id: 'sound', label: '木鱼声音', type: 'checkbox', checked: latest.sound, click: () => { show(); void call('setSound', !latest.sound); } },
    { label: '节奏', submenu: [40, 60, 90].map(bpm => ({ id: `tempo-${bpm}`, label: `每分钟 ${bpm} 次`, type: 'radio', checked: latest.bpm === bpm, click: () => void call('setTempo', bpm) })) },
    { id: 'reset', label: '本次次数清零', click: () => void call('resetCount') },
    { type: 'separator' },
    { id: 'left', label: '移到左上角', type: 'checkbox', checked: settings.anchor === 'left', click: () => setPreference('anchor', 'left') },
    { id: 'right', label: '移到右上角', type: 'checkbox', checked: settings.anchor === 'right', click: () => setPreference('anchor', 'right') },
    { label: `显示大小 · ${settings.width} px`, submenu: [240, 320, 480, 640, 800].map(width => ({ id: `size-${width}`, label: `${width} px`, type: 'checkbox', checked: settings.width === width, click: () => setPreference('width', width) })) },
    { label: '显示屏', submenu: screen.getAllDisplays().map((d, i) => ({ label: `${i + 1} · ${d.label || `${d.size.width} × ${d.size.height}`}`, type: 'radio', checked: preferredDisplay().id === d.id, click: () => setPreference('display', d.id) })) },
    { id: 'pinned', label: '保持置顶', type: 'checkbox', checked: settings.pinned, click: () => setPreference('pinned', !settings.pinned) },
    { id: 'visible', label: win.isVisible() ? '隐藏木鱼并暂停' : '显示木鱼', click: () => { if (win.isVisible()) win.hide(); else show(); } },
    { type: 'separator' },
    { id: 'quit', label: '退出一念木鱼', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`一念木鱼 · ${latest.mode === 'clock' ? '跟随当前时间' : '时间预览'} · 已敲 ${latest.count} 声`);
}
function trusted(event) {
  return !!win && !win.isDestroyed() && event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === APP_URL;
}

async function start() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  try { settings = cleanSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))); }
  catch { settings = cleanSettings(null); }
  latest.bpm = settings.bpm;
  const ses = session.fromPartition('muyu-offline');
  await ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !localAsset(details.url) }));
  const assets = new Map();
  function collect(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) collect(path.join(dir, entry.name), prefix + entry.name + '/');
      else if (entry.isFile()) assets.set(prefix + entry.name, path.join(dir, entry.name));
    }
  }
  collect(frontend);
  ses.protocol.handle('muyu', request => {
    const asset = localAsset(request.url);
    if (request.method !== 'GET' || !asset || !assets.has(asset)) return new Response('', { status: 404 });
    const type = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(asset)] ?? 'application/octet-stream';
    return new Response(fs.readFileSync(assets.get(asset)), { headers: {
      'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
    } });
  });
  win = new BrowserWindow({
    title: '一念木鱼', width: settings.width, height: heightFor(settings.width), show: false,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: settings.pinned, icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), session: ses,
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      navigateOnDragDrop: false, spellcheck: false, backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) win.webContents.on(event, e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.webContents.on('did-start-loading', () => { ready = false; syncedWidth = null; gesture = null; settingsOpen = false; settingsExtra = 0; });
  win.webContents.on('console-message', (_e, details) => { if (details.level === 'error') recordError(details.message); });
  win.webContents.on('preload-error', (_e, _p, error) => recordError(error));
  win.webContents.on('render-process-gone', (_e, details) => { ready = false; recordError(`Renderer stopped: ${details.reason}`); });
  win.webContents.on('did-fail-load', (_e, code, description) => recordError(`Load ${code}: ${description}`));
  win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
  for (const event of ['show', 'hide', 'minimize', 'restore']) win.on(event, () => { if (event === 'hide' || event === 'minimize') cancelGesture(); void syncPaused(); refreshMenu(); });
  // Focus changes deliberately do not suspend a visible widget.
  powerMonitor.on('suspend', () => { cancelGesture(); sleeping = true; void syncPaused(); });
  powerMonitor.on('resume', () => { sleeping = false; place(); void syncPaused(); });
  powerMonitor.on('lock-screen', () => { cancelGesture(); locked = true; void syncPaused(); });
  powerMonitor.on('unlock-screen', () => { locked = false; void syncPaused(); });
  screen.on('display-metrics-changed', place);
  screen.on('display-added', () => { place(); refreshMenu(); });
  screen.on('display-removed', () => { place(); refreshMenu(); });
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico')));
  tray.on('click', show);
  tray.on('double-click', show);
  refreshMenu();

  ipcMain.on('muyu:bootstrap', event => {
    event.returnValue = trusted(event) ? { reduced: false, periods: settings.periods, bpm: settings.bpm, width: pose().rect.width } : { reduced: false, width: 480 };
  });
  ipcMain.on('muyu:message', (event, message) => {
    if (!trusted(event) || !validMessage(message)) return;
    const { type, data } = message;
    if (type === 'settings') { settings = cleanSettings({ ...settings, periods: data.periods, bpm: data.bpm }); persist(); }
    else if (type === 'layout') {
      if (settingsOpen !== data.settingsOpen) cancelGesture();
      settingsOpen = data.settingsOpen; settingsExtra = settingsOpen ? Math.ceil(data.extra) : 0; place();
    }
    else if (type === 'desktopGesture') desktopGesture(data);
    else if (type === 'desktopSize') setDesktopWidth(data.width);
    else if (type === 'desktopScale') setDesktopWidth(pose().rect.width + data.delta);
    else if (type === 'menu') { refreshMenu(); menu.popup({ window: win }); }
    else if (type === 'error') recordError(data);
    else if (type === 'ready' || type === 'status') {
      latest = { count: data.count, bpm: data.bpm, sound: data.sound, mode: data.mode, paused: data.paused };
      if (type === 'ready') { ready = true; place(); void syncPaused(); }
      refreshMenu();
    }
  });
  place();
  await win.loadURL(APP_URL);
  win.show();
  win.setAlwaysOnTop(settings.pinned, 'screen-saver');
  await syncPaused();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) show(); });
  app.on('before-quit', () => { quitting = true; if (settingsPath && settings) persist(); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.on('will-quit', () => tray?.destroy());
  app.whenReady().then(start).catch(error => {
    recordError(error);
    dialog.showErrorBox('一念木鱼无法启动', '请完整解压下载的 ZIP 后运行 YinianMuyu.exe。\n' + String(error.message));
    app.quit();
  });
}

// Main-process exports support acceptance tests; nothing is exposed to the page.
module.exports = { getWindow: () => win, getMenu: () => menu, getSettings: () => ({ ...settings }), getErrors: () => [...errors] };
