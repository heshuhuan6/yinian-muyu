# 一念木鱼 · Windows

Windows 10/11 x64 自包含便携版。完整解压发布 ZIP 后双击 `YinianMuyu.exe`，用户无需安装 Node、Python 或浏览器。软件默认静音，默认左上角并置顶，右键小窗或系统托盘图标可以切换位置、显示大小、显示屏、置顶及隐藏。

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
```

产物为 `windows/build/Yinian-Muyu-1.0.0-Windows-x64.zip`，旁边有 `.sha256` 校验文件。`npm run windows` 内部也会执行前端构建。包内 EXE、DLL、resources、locales 等文件应保持在一起。

## 宿主实现

- 复用原始前端，无需改动 `src/` 或 Mac `native/`。
- Electron 45.3.0 / Chromium 156；独立 `windows/package-lock.json` 固定 Windows 构建依赖。
- 开启 `contextIsolation` 和 `sandbox`，关闭所有 `nodeIntegration`、WebView、生产 DevTools、外部窗口与导航。
- 通过自定义 `muyu://app/` 协议读取打包时白名单中的本地文件；严格 CSP 拒绝连接、子框架和外部脚本。
- 所有 Electron 会话拒绝外部请求、下载和权限。会话级拼写服务关闭、词典地址改为本地协议，防止 Chromium 自动下载词典。另禁用 DNS 解析及 QUIC，并用不可用的本地代理隔离后台网络服务。
- 不含更新器、遥测、远程素材、服务器或运行时依赖下载。生产 EXE 禁止 RunAsNode、NODE_OPTIONS，并只加载 app.asar。
- 仅白名单 IPC 消息生效，校验主窗口、主 frame、来源地址和字段范围；不向网页暴露 `ipcRenderer` 或 Node API。
- 设置原子写入 `%APPDATA%\一念木鱼\settings.json`。声音与次数不跨启动保存；声音默认关闭。
- 隐藏、最小化、锁屏、休眠调用前端 `setPaused`；唤醒重置帧计时，不补敲。失焦不暂停。
- 通过 Windows `screen-saver` 置顶层级保证覆盖普通应用；可在原生菜单关闭。窗口尺寸根据设置内容和显示器工作区调整。

## 验收

`windows:test` 检查 IPC、偏好与资源路径；`windows:verify` 用真实 Electron + Playwright 检查拖动、边界、跨午夜、节奏、声音信号、窗口生命周期、离线及安全约束。仅测试驱动导出诊断入口，该驱动不会进入成品。

`verify:packaged` 启动最终 EXE，检查自包含启动、实际沙箱参数、单实例、离线重载、声音默认关闭、控制台及熔丝。JSON 报告与 PNG 位于 `windows/test-results/`，不会打包到用户程序。

已在 Windows 11 Pro x64（build 26200，125% DPI）实际运行并操作原生菜单及拖动。Windows 10 未在第二台实体机实测；物理睡眠未中断当前工作机，休眠/唤醒使用 Electron powerMonitor 事件模拟。离线测试在应用网络层断开，另外对正常启动进行了进程 TCP 与 Chromium NetLog 检查。未进行代码签名。

## 许可

项目为 MIT，版权归 2026 Yinian Muyu contributors。发布包包含项目 MIT、Electron `LICENSE`、`LICENSES.chromium.html`、React/React DOM/Scheduler 的原始 MIT 许可，以及 Vite 许可（构建生成的模块预加载代码）。图标由 `icon.mjs` 原创程序绘制，无第三方图像。

相关实现依据：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)、[会话与拼写词典](https://www.electronjs.org/docs/latest/api/session)、[powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)。
