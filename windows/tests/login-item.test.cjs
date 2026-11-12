const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoginItem, registrationAvailable, LOGIN_NAME, LOGIN_ARGS } = require('../login-item.cjs');
const executable = 'C:\\Users\\Example\\Documents\\My Muyu\\YinianMuyu.exe';
const temp = 'C:\\Users\\Example\\AppData\\Local\\Temp';
function fixture() {
  const writes = [], reads = [];
  let raw = { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] };
  const app = {
    isPackaged: true, getPath: () => temp,
    getLoginItemSettings: options => { reads.push(options); return raw; },
    setLoginItemSettings: options => {
      writes.push(options);
      raw = { openAtLogin: options.openAtLogin, executableWillLaunchAtLogin: options.enabled,
        launchItems: options.openAtLogin ? [{ name: LOGIN_NAME, scope: 'user', path: executable, args: [...LOGIN_ARGS], enabled: options.enabled }] : [] };
    },
  };
  return { app, writes, reads, setRaw: value => { raw = value; }, controller: createLoginItem(app, { platform: 'win32', executable }) };
}
test('development, temporary and unpacked executables cannot create startup entries', () => {
  const valid = { packaged: true, platform: 'win32', executable, temp };
  assert.equal(registrationAvailable(valid), true);
  for (const change of [{ packaged: false }, { platform: 'darwin' }, { executable: 'YinianMuyu.exe' },
    { executable: temp + '\\extract\\YinianMuyu.exe' }, { executable: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe' },
    { executable: 'C:\\repo\\.stage\\YinianMuyu.exe' }]) assert.equal(registrationAvailable({ ...valid, ...change }), false);
  const f = fixture(); f.app.isPackaged = false;
  const dev = createLoginItem(f.app, { platform: 'win32', executable });
  assert.equal(dev.read().available, false); assert.throws(() => dev.setEnabled(true));
  assert.equal(f.writes.length, 0);
});
test('reading real startup status never registers or re-enables an item', () => {
  const f = fixture();
  assert.deepEqual(f.controller.read(), { available: true, enabled: false, registered: false, systemDisabled: false });
  f.setRaw({ openAtLogin: true, executableWillLaunchAtLogin: false,
    launchItems: [{ name: LOGIN_NAME, scope: 'user', path: executable, args: LOGIN_ARGS, enabled: false }] });
  assert.deepEqual(f.controller.read(), { available: true, enabled: false, registered: true, systemDisabled: true });
  assert.equal(f.writes.length, 0);
});
test('only explicit toggles register the exact EXE with fixed login arguments', () => {
  const f = fixture();
  assert.equal(f.controller.setEnabled(true).enabled, true);
  assert.deepEqual(f.writes[0], { path: executable, args: ['--muyu-login'], name: LOGIN_NAME, openAtLogin: true, enabled: true });
  assert.deepEqual(f.reads[0], { path: executable, args: ['--muyu-login'] });
  assert.equal(f.controller.setEnabled(false).enabled, false);
  assert.equal(f.writes[1].openAtLogin, false);
});
test('a different launch entry cannot mask the system-disabled owned item', () => {
  const f = fixture();
  f.setRaw({ openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [
    { name: LOGIN_NAME, scope: 'user', path: executable, args: LOGIN_ARGS, enabled: false },
    { name: 'Other', scope: 'user', path: executable, args: LOGIN_ARGS, enabled: true },
  ] });
  assert.equal(f.controller.read().enabled, false);
});
test('the native full-command match handles argument mismatch and omitted switch details', () => {
  const f = fixture();
  const item = { name: LOGIN_NAME, scope: 'user', path: executable, args: [], enabled: true };
  f.setRaw({ openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [item] });
  assert.equal(f.controller.read().enabled, true);
  f.setRaw({ openAtLogin: false, executableWillLaunchAtLogin: true, launchItems: [item] });
  assert.equal(f.controller.read().enabled, false);
  f.setRaw({ openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [{ ...item, path: 'C:\\old\\YinianMuyu.exe' }] });
  assert.equal(f.controller.read().enabled, false);
});
