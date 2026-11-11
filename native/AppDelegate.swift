import AppKit
import WebKit

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSMenuDelegate {
    static let identifier = "local.yinian.muyu"
    let testPath: String?
    let preferences: UserDefaults
    var panel: FloatingPanel!
    var webView: WKWebView!
    var statusItem: NSStatusItem!
    var htmlURL: URL!
    var latestState: [String: Any] = [:]
    var errors: [String] = []
    var ready = false, hidden = false, sleeping = false, testStarted = false
    var anchor: String
    var widgetWidth: CGFloat
    var isPinned: Bool
    var mouseMonitors: [Any] = []
    var settingsExtra: CGFloat = 0
    var diagnostic: DiagnosticRunner?
    var widgetSize: NSSize { NSSize(width: widgetWidth, height: min(preferredScreen().visibleFrame.height - 32, widgetWidth * 84 / 160 + 160 + settingsExtra)) }

    override init() {
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--self-test"), args.count > index + 1 {
            testPath = args[index + 1]
            preferences = UserDefaults(suiteName: Self.identifier + ".tests." + String(ProcessInfo.processInfo.processIdentifier))!
        } else { testPath = nil; preferences = .standard }
        anchor = preferences.string(forKey: "anchor") == "right" ? "right" : "left"
        widgetWidth = preferences.integer(forKey: "width") == 640 ? 640 : 480
        isPinned = preferences.object(forKey: "pinned") as? Bool ?? true
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if testPath == nil && NSRunningApplication.runningApplications(withBundleIdentifier: Self.identifier).contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            DistributedNotificationCenter.default().postNotificationName(Notification.Name(Self.identifier + ".show"), object: nil)
            NSApp.terminate(nil); return
        }
        guard let file = Bundle.main.url(forResource: "desktop", withExtension: "html") else { fail("木鱼资源缺失。"); return }
        htmlURL = file
        createMenuBar(); createPanel(); observeSystem()
        webView.loadFileURL(file, allowingReadAccessTo: file)
        if testPath != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 40) { [weak self] in
                guard let self, !self.testStarted else { return }; self.fail("网页加载超时。")
            }
        }
    }

    func createPanel() {
        panel = FloatingPanel(contentRect: NSRect(origin: .zero, size: widgetSize), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "一念木鱼"
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.isReleasedWhenClosed = false; panel.hidesOnDeactivate = false; panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true; panel.level = isPinned ? .floating : .normal
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.animationBehavior = .none
        panel.setAccessibilityLabel("一念木鱼桌面悬浮窗")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "muyu")
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        var initial: [String: Any] = ["reduced": reduced, "bpm": preferences.integer(forKey: "bpm")]
        if let saved = preferences.array(forKey: "periods") { initial["periods"] = saved }
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: initial), encoding: .utf8)!
        config.userContentController.addUserScript(WKUserScript(source: "window.__MUYU_NATIVE__ = " + encoded + ";", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: NSRect(origin: .zero, size: widgetSize), configuration: config)
        webView.autoresizingMask = [.width, .height]; webView.navigationDelegate = self
        webView.underPageBackgroundColor = .clear; webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        if webView.responds(to: NSSelectorFromString("setDrawsBackground:")) || webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) { webView.setValue(false, forKey: "drawsBackground") }
        panel.contentView = webView; placePanel()
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .leftMouseUp], handler: { [weak self] _ in DispatchQueue.main.async { self?.updateHitTesting() } }) { mouseMonitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .leftMouseUp], handler: { [weak self] event in self?.updateHitTesting(); return event }) { mouseMonitors.append(local) }
    }

    func preferredScreen() -> NSScreen {
        let saved = preferences.integer(forKey: "screen")
        return NSScreen.screens.first(where: { screenID($0) == saved }) ?? NSScreen.main ?? NSScreen.screens[0]
    }
    func screenID(_ screen: NSScreen) -> Int { (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0 }
    func placePanel() {
        guard panel != nil, !NSScreen.screens.isEmpty else { return }
        let area = preferredScreen().visibleFrame
        let x = anchor == "left" ? area.minX + 16 : area.maxX - widgetSize.width - 16
        panel.setFrame(NSRect(x: max(area.minX, x), y: max(area.minY, area.maxY - widgetSize.height - 16), width: widgetSize.width, height: widgetSize.height), display: true)
        updateHitTesting()
    }
    func updateHitTesting() {
        guard panel != nil, NSEvent.pressedMouseButtons & 1 == 0 else { return }
        let p = NSEvent.mouseLocation, r = panel.frame
        let x = (p.x - r.minX) / r.width * 160, y = (r.maxY - p.y) / r.width * 160
        let track = hypot(max(abs(x - 80) - 40, 0), y - 42) <= 33
        let lens = x >= 23 && x <= 137 && y >= 6 && y <= 78
        let toolbar = p.x >= r.minX + 12 && p.x <= r.maxX - 12 && y >= 84 && p.y >= r.minY + 8
        panel.ignoresMouseEvents = hidden || !(track || lens || toolbar)
    }
    func evaluate(_ script: String, completion: ((Any?, Error?) -> Void)? = nil) {
        webView.evaluateJavaScript(script) { [weak self] value, error in
            if let error { self?.errors.append(error.localizedDescription) }
            completion?(value, error)
        }
    }
    func observeSystem() {
        NotificationCenter.default.addObserver(self, selector: #selector(displayChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] { center.addObserver(self, selector: #selector(sleepStarted), name: name, object: nil) }
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] { center.addObserver(self, selector: #selector(wakeFinished), name: name, object: nil) }
        center.addObserver(self, selector: #selector(accessibilityChanged), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(showFromNotification), name: Notification.Name(Self.identifier + ".show"), object: nil)
    }
    @objc func displayChanged(_ n: Notification) { placePanel() }
    @objc func sleepStarted(_ n: Notification) { sleeping = true; if ready { evaluate("window.muyu.setPaused(true);") } }
    @objc func wakeFinished(_ n: Notification) { sleeping = false; if ready { evaluate("window.muyu.setPaused(\(hidden));") }; placePanel() }
    @objc func accessibilityChanged(_ n: Notification) { if ready { evaluate("window.muyu.setReduced(\(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion));") } }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.webView === webView, let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true; latestState = body["data"] as? [String: Any] ?? [:]; showPanel(); updateIcon()
            if testPath != nil && !testStarted { testStarted = true; diagnostic = DiagnosticRunner(app: self); diagnostic?.start() }
        case "status": latestState = body["data"] as? [String: Any] ?? [:]; updateIcon()
        case "settings":
            if let data = body["data"] as? [String: Any] {
                if let periods = data["periods"] as? [[String: Any]] { preferences.set(periods, forKey: "periods") }
                if let bpm = data["bpm"] as? Int, [40, 60, 90].contains(bpm) { preferences.set(bpm, forKey: "bpm") }
            }
        case "layout":
            if let data = body["data"] as? [String: Any], let extra = data["extra"] as? Double {
                settingsExtra = CGFloat(max(0, min(500, extra))); placePanel()
            }
        case "error": errors.append(String(describing: body["data"] ?? "JavaScript error"))
        case "menu": makeMenu().popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        default: break
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        decisionHandler(url?.isFileURL == true && url?.standardizedFileURL.path == htmlURL.standardizedFileURL.path ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { ready = false; webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL) }

    func createMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.target = self; statusItem.button?.action = #selector(statusClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem.button?.setAccessibilityLabel("一念木鱼，点击显示或隐藏，右键设置")
        updateIcon()
    }
    func updateIcon() {
        let active = latestState["active"] as? Bool ?? true
        let image = NSImage(systemSymbolName: active ? "waveform" : "pause.circle", accessibilityDescription: "一念木鱼")
        image?.isTemplate = true; statusItem?.button?.image = image
        statusItem?.button?.toolTip = "一念木鱼 · 已敲 \(latestState["count"] as? Int ?? 0) 声\n点击显示 / 隐藏 · 右键设置"
    }
    @objc func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp || NSApp.currentEvent?.modifierFlags.contains(.control) == true {
            if let button = statusItem.button { makeMenu().popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button) }
        } else { toggleVisible() }
    }
    func item(_ text: String, _ action: Selector?, state: Bool? = nil, tag: Int = 0) -> NSMenuItem {
        let item = NSMenuItem(title: text, action: action, keyEquivalent: ""); item.target = self; item.tag = tag
        if let state { item.state = state ? .on : .off }; if action == nil { item.isEnabled = false }; return item
    }
    func makeMenu() -> NSMenu { let menu = NSMenu(title: "一念木鱼"); menu.delegate = self; populate(menu); return menu }
    func menuNeedsUpdate(_ menu: NSMenu) { populate(menu) }
    func populate(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.addItem(item("一念木鱼 · 已敲 \(latestState["count"] as? Int ?? 0) 声", nil)); menu.addItem(.separator())
        menu.addItem(item("跟随当前时间", #selector(resumeClock), state: latestState["mode"] as? String == "clock"))
        menu.addItem(item("编辑每日敲击时段", #selector(editSchedule)))
        menu.addItem(item("木鱼声音", #selector(toggleSound), state: latestState["sound"] as? Bool ?? false))
        let tempo = NSMenu(title: "节奏")
        for rate in [40, 60, 90] { tempo.addItem(item("每分钟 \(rate) 次", #selector(setTempo(_:)), state: latestState["bpm"] as? Int == rate, tag: rate)) }
        let tempoItem = NSMenuItem(title: "节奏", action: nil, keyEquivalent: ""); tempoItem.submenu = tempo; menu.addItem(tempoItem)
        menu.addItem(item("本次次数清零", #selector(resetCount))); menu.addItem(.separator())
        menu.addItem(item("固定在左上角", #selector(moveLeft), state: anchor == "left")); menu.addItem(item("固定在右上角", #selector(moveRight), state: anchor == "right"))
        let sizes = NSMenu(title: "显示大小")
        for width in [480, 640] { sizes.addItem(item("\(width) px", #selector(resizeWidget(_:)), state: Int(widgetWidth) == width, tag: width)) }
        let sizeItem = NSMenuItem(title: "显示大小", action: nil, keyEquivalent: ""); sizeItem.submenu = sizes; menu.addItem(sizeItem)
        if NSScreen.screens.count > 1 {
            let screens = NSMenu(title: "显示屏")
            for screen in NSScreen.screens { screens.addItem(item(screen.localizedName, #selector(selectScreen(_:)), state: screenID(screen) == screenID(preferredScreen()), tag: screenID(screen))) }
            let displayItem = NSMenuItem(title: "显示屏", action: nil, keyEquivalent: ""); displayItem.submenu = screens; menu.addItem(displayItem)
        }
        menu.addItem(item("保持置顶", #selector(togglePinned), state: isPinned)); menu.addItem(item(hidden ? "显示木鱼" : "隐藏木鱼并暂停", #selector(toggleVisible)))
        menu.addItem(.separator()); let quit = item("退出一念木鱼", #selector(quit)); quit.keyEquivalent = "q"; menu.addItem(quit)
    }
    @objc func resumeClock() { if ready { evaluate("window.muyu.resumeClock();") } }
    @objc func editSchedule() { if ready { showPanel(); evaluate("window.muyu.showSettings(true);") } }
    @objc func toggleSound() { if ready { evaluate("void window.muyu.setSound(\(!(latestState["sound"] as? Bool ?? false)));") } }
    @objc func setTempo(_ sender: NSMenuItem) { if [40, 60, 90].contains(sender.tag), ready { evaluate("window.muyu.setTempo(\(sender.tag));") } }
    @objc func resetCount() { if ready { evaluate("window.muyu.resetCount();") } }
    @objc func moveLeft() { anchor = "left"; preferences.set(anchor, forKey: "anchor"); placePanel() }
    @objc func moveRight() { anchor = "right"; preferences.set(anchor, forKey: "anchor"); placePanel() }
    @objc func resizeWidget(_ sender: NSMenuItem) { guard [480, 640].contains(sender.tag) else { return }; widgetWidth = CGFloat(sender.tag); preferences.set(sender.tag, forKey: "width"); placePanel() }
    @objc func selectScreen(_ sender: NSMenuItem) { preferences.set(sender.tag, forKey: "screen"); placePanel() }
    @objc func togglePinned() { isPinned.toggle(); preferences.set(isPinned, forKey: "pinned"); panel.level = isPinned ? .floating : .normal }
    @objc func toggleVisible() { if hidden { showPanel() } else { hidden = true; panel.orderOut(nil); if ready { evaluate("window.muyu.setPaused(true);") } } }
    func showPanel() { hidden = false; placePanel(); panel.orderFrontRegardless(); if ready { evaluate("window.muyu.setPaused(\(sleeping));") } }
    @objc func showFromNotification(_ notification: Notification) { showPanel() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPanel(); return true }
    @objc func quit() { NSApp.terminate(nil) }
    func fail(_ message: String) {
        errors.append(message)
        if let testPath {
            if let data = try? JSONSerialization.data(withJSONObject: ["passed": false, "errors": errors]) { try? data.write(to: URL(fileURLWithPath: testPath)) }
        } else { let alert = NSAlert(); alert.messageText = "一念木鱼"; alert.informativeText = message; alert.runModal() }
        NSApp.terminate(nil)
    }
    func applicationWillTerminate(_ notification: Notification) {
        mouseMonitors.forEach { NSEvent.removeMonitor($0) }; NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self); DistributedNotificationCenter.default().removeObserver(self)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "muyu")
        if testPath != nil { preferences.removePersistentDomain(forName: Self.identifier + ".tests." + String(ProcessInfo.processInfo.processIdentifier)) }
    }
}
