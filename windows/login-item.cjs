'use strict';
const path = require('node:path');

const LOGIN_NAME = 'local.yinian.muyu';
const LOGIN_ARG = '--muyu-login';
const LOGIN_ARGS = [LOGIN_ARG];
const samePath = (a, b) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
const inside = (file, directory) => {
  const relative = path.win32.relative(directory, file);
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !path.win32.isAbsolute(relative));
};

function registrationAvailable({ packaged, platform, executable, temp }) {
  return packaged && platform === 'win32' && path.win32.isAbsolute(executable) &&
    path.win32.basename(executable).toLowerCase() === 'yinianmuyu.exe' &&
    !inside(executable, temp) && !executable.split(/[\\/]/).some(part => ['node_modules', '.stage'].includes(part.toLowerCase()));
}

function createLoginItem(app, { platform = process.platform, executable = process.execPath } = {}) {
  const available = registrationAvailable({ packaged: app.isPackaged, platform, executable, temp: app.getPath('temp') });
  const options = { path: executable, args: [...LOGIN_ARGS] };
  function read() {
    if (!available) return { available: false, enabled: false, registered: false, systemDisabled: false };
    const raw = app.getLoginItemSettings(options);
    // openAtLogin compares our AppUserModelId's full quoted command, including
    // args. launchItems.args comes from Chromium GetArgs(), which omits switches
    // such as --muyu-login, so use launchItems only for identity/approval state.
    const items = (raw.launchItems ?? []).filter(item => item.name === LOGIN_NAME && item.scope === 'user' &&
      typeof item.path === 'string' && samePath(item.path, executable));
    const registered = raw.openAtLogin && items.length > 0;
    const enabled = registered && raw.executableWillLaunchAtLogin && items.some(item => item.enabled);
    return { available, enabled: !!enabled, registered: !!registered, systemDisabled: !!registered && !enabled };
  }
  function setEnabled(enabled) {
    if (!available) throw new Error('请将便携版完整解压到固定文件夹后，再设置开机自动启动。');
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid login-item state');
    // The full current EXE path is passed unquoted to Electron, which quotes it
    // when writing Run. Never inherit dev, inspect, or other process arguments.
    app.setLoginItemSettings({ ...options, name: LOGIN_NAME, openAtLogin: enabled, enabled });
    const state = read();
    if (state.enabled !== enabled) throw new Error('Windows 未能更新自启动状态，请检查系统“启动应用”设置。');
    return state;
  }
  return { read, setEnabled };
}

module.exports = { LOGIN_NAME, LOGIN_ARG, LOGIN_ARGS, createLoginItem, registrationAvailable };
