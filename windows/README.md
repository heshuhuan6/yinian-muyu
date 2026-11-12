# 一念木鱼 · Windows 1.2.0

Windows 10/11 x64 自包含便携版。完整解压发布 ZIP 后双击 `YinianMuyu.exe`，用户无需安装 Node、Python 或浏览器。默认静音，桌面只显示玻璃胶囊，新用户位于右上角；右键小窗或系统托盘图标打开设置，也可切换位置、显示屏、置顶及隐藏。

拖庭院移动窗口，拖玻璃镜头预览时间；Alt+拖动任意位置也可移动。悬停出现的右下手柄可等比例缩放，滚轮也可缩放。设置支持 240–800 的任意宽度，位置与大小在重新启动后保留。打开设置暂时扩展窗口；关闭或 Esc 后回到原胶囊位置和大小。

## 登录 Windows 后自动打开

完整解压到固定文件夹后，在右键或托盘菜单勾选“开机自动启动”。这是当前 Windows 用户登录后启动；不需要管理员权限。新安装默认不注册，旧设置和自由位置保持。菜单可选择四个角落，右下/左下以显示器工作区定位，避开任务栏，缩放仍保持贴角。拖动窗口会改为自由位置。

登录项绑定当前完整 EXE 路径，带空格的目录可用。移动便携文件夹后，在新位置打开并重新勾选以更新路径；删除程序前先取消勾选。应用读取系统的真实注册及 StartupApproved 状态，系统禁用后不会在启动时强制恢复；明确再次勾选才会启用。开发 Electron 和系统临时目录中的副本不能注册。

初次打开及登录启动使用 `showInactive()`，显示纯胶囊但不抢焦点；读取当前时钟、默认静音，不恢复预览、抽屉或本次计数。重复登录命令不会创建新实例、显示已有隐藏窗口或打断当前操作；用户主动双击程序或点击托盘仍可唤起。

## 本机构建

构建机需要 Windows x64、Node.js 22.12 或更新版本与 PowerShell。首次安装构建依赖需要网络；运行成品不需要网络。

```powershell
npm ci
npm --prefix windows ci
npm run build
npm run lint
npm run windows:test
npm run windows:verify
npm run windows
npm --prefix windows run verify:packaged
npm --prefix windows run verify:startup
```

产物为 `windows/build/Yinian-Muyu-1.2.0-Windows-x64.zip`，旁边有 `.sha256` 校验文件。`npm run windows` 内部也会执行前端构建。包内 EXE、DLL、resources、locales 等文件应保持在一起。

## 宿主实现

- 使用 Mac 提供的 1.1 前端；Windows 实施只改动 `windows/`，未再修改 `src/`、根配置或 Mac `native/`。
- Electron 45.3.0 / Chromium 156；独立 `windows/package-lock.json` 固定 Windows 构建依赖。
- 开启 `contextIsolation` 和 `sandbox`，关闭所有 `nodeIntegration`、WebView、生产 DevTools、外部窗口与导航。
- 通过自定义 `muyu://app/` 协议读取打包时白名单中的本地文件；严格 CSP 拒绝连接、子框架和外部脚本。
- 所有 Electron 会话拒绝外部请求、下载和权限。会话级拼写服务关闭、词典地址改为本地协议，防止 Chromium 自动下载词典。另禁用 DNS 解析及 QUIC，并用不可用的本地代理隔离后台网络服务。
- 不含更新器、遥测、远程素材、服务器或运行时依赖下载。生产 EXE 禁止 RunAsNode、NODE_OPTIONS，并只加载 app.asar。
- 仅白名单 IPC 消息生效，校验主窗口、主 frame、来源地址和字段范围；不向网页暴露 `ipcRenderer` 或 Node API。
- 设置原子写入 `%APPDATA%\一念木鱼\settings.json`。声音与次数不跨启动保存；声音默认关闭。
- 隐藏、最小化、锁屏、休眠调用前端 `setPaused`；唤醒重置帧计时，不补敲。失焦不暂停。
- 通过 Windows `screen-saver` 置顶层级保证覆盖普通应用；可在原生菜单关闭。窗口尺寸根据设置内容和显示器工作区调整。
- 几何使用 Windows DIP；闭合尺寸为 width × ceil(width × 84/160)。任意宽度与自定义位置单独持久化，设置抽屉的临时居中、扩高与越屏夹取不会写回位置。在 125% 等非整数 DPI 下，原生外框报告可能向外取整 1 DIP；设置值与前端尺寸同步仍保持所选值。
- `desktopGesture` 只接受有效 begin/update/end/cancel 序列；位移为相对起点的 screenX/Y CSS px，取消保留并保存最后有效位置。缩放将位移投影到 (1, 0.525) 对角线；角落模式保持所选角落，自由位置保持左上角，越屏时夹取。
- `desktopSize` 是 240–800 绝对宽度，`desktopScale` 是有限宽度增量；主进程调用 `setDesktopSize` 同步，前端不会反向再发尺寸 IPC。`layout.settingsOpen` 决定抽屉状态，`layout.extra` 仅决定临时扩高。
- 位置支持负坐标显示器；显示器移除时临时夹取到可见屏幕。旧 1.0 配置可直接迁移。

## 验收

`windows:test` 检查几何、抽屉恢复、多显示器、IPC、偏好迁移与资源路径；`windows:verify` 用真实 Electron + Playwright 检查庭院/Alt 移动、镜头预览、手柄缩放、滚轮、517/533 任意宽度、抽屉关闭、进程重启记忆，以及时段、声音、离线和安全回归。仅测试驱动导出诊断入口，该驱动不会进入成品。

`verify:packaged` 启动最终 EXE，检查纯胶囊自包含启动、实际沙箱参数、单实例、离线重载、533 px 和位置在重启后恢复、控制台及熔丝。JSON 报告与 PNG 位于 `windows/test-results/v1.2/`，不会打包到用户程序。

1.2 已通过构建、Lint、19 项单元测试、27 项功能检查、6 项最终 EXE 检查和 8 项真实登录项专项检查。已在 Windows 11 Pro x64（build 26200，125% DPI）实际运行，使用不含调试参数的原始登录项命令启动最终 EXE，并确认纯胶囊及原生菜单。Windows 10 未在第二台实体机实测；没有重启或注销电脑；物理睡眠未中断当前工作机，休眠/锁屏使用 Electron powerMonitor 事件模拟。多显示器覆盖使用几何测试，没有插拔实体显示器。离线测试在应用网络层断开，正常登录命令启动后的四个进程检查为零 TCP/UDP 端点。未进行代码签名。

自启动验收会保存并恢复仅属于 `local.yinian.muyu` 的 HKCU Run/StartupApproved 值以及原用户设置，使用带空格的最终 EXE 路径验证勾选、取消、系统禁用、真实进程重开和重复登录命令；不重启或注销电脑。注册逻辑仅在明确菜单点击时调用 `app.setLoginItemSettings`。

官方 API：[登录项](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions-macos-windows)、[不抢焦点显示](https://www.electronjs.org/docs/latest/api/browser-window#winshowinactive)。

Electron 45 的 `launchItems.args` 使用 Chromium `GetArgs()`，不会返回 `--muyu-login` 这类开关；本实现由 `openAtLogin` 校验当前 AppUserModelId 对应的完整路径与参数，再以当前用户同名同路径的 `launchItems.enabled` 判断系统批准状态。对应[官方源码](https://github.com/electron/electron/blob/v45.3.0/shell/browser/browser_win.cc)。

## 许可

项目为 MIT，版权归 2026 Yinian Muyu contributors。发布包包含项目 MIT、Electron `LICENSE`、`LICENSES.chromium.html`、React/React DOM/Scheduler 的原始 MIT 许可，以及 Vite 许可（构建生成的模块预加载代码）。图标由 `icon.mjs` 原创程序绘制，无第三方图像。

相关实现依据：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)、[会话与拼写词典](https://www.electronjs.org/docs/latest/api/session)、[powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)。
