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
    var settingsOpen = false
    var customPosition: NSPoint?
    var dragScreenID: Int?
    var desktopGesture: (mode: String, origin: NSPoint, width: CGFloat)?
    var diagnostic: DiagnosticRunner?
    var widgetSize: NSSize {
        let area = preferredScreen().visibleFrame
        return NSSize(width: min(area.width, settingsOpen ? max(480, widgetWidth) : widgetWidth), height: min(area.height - 16, widgetWidth * 84 / 160 + settingsExtra))
    }

    override init() {
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--self-test"), args.count > index + 1 {
            testPath = args[index + 1]
            preferences = UserDefaults(suiteName: Self.identifier + ".tests." + String(ProcessInfo.processInfo.processIdentifier))!
        } else { testPath = nil; preferences = .standard }
        let savedAnchor = preferences.string(forKey: "anchor") ?? "left"
        anchor = ["left", "right", "free"].contains(savedAnchor) ? savedAnchor : "left"
        let width = preferences.object(forKey: "width") as? Double ?? 480
        widgetWidth = width.isFinite ? CGFloat(max(240, min(800, width))) : 480
        if let x = preferences.object(forKey: "positionX") as? Double, let top = preferences.object(forKey: "positionTop") as? Double, x.isFinite, top.isFinite { customPosition = NSPoint(x: x, y: top) }
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
        var initial: [String: Any] = ["reduced": reduced, "bpm": preferences.integer(forKey: "bpm"), "width": widgetWidth]
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
        let saved = dragScreenID ?? preferences.integer(forKey: "screen")
        return NSScreen.screens.first(where: { screenID($0) == saved }) ?? NSScreen.main ?? NSScreen.screens[0]
    }
    func screenID(_ screen: NSScreen) -> Int { (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0 }
    func placePanel() {
        guard panel != nil, !NSScreen.screens.isEmpty else { return }
        let area = preferredScreen().visibleFrame
        let size = widgetSize
        let position = anchor == "free" ? customPosition ?? NSPoint(x: area.minX + 16, y: area.maxY - 16)
            : NSPoint(x: anchor == "right" ? area.maxX - widgetWidth - 16 : area.minX + 16, y: area.maxY - 16)
        let x = position.x - (size.width - widgetWidth) / 2
        panel.setFrame(NSRect(x: min(max(area.minX, x), area.maxX - size.width), y: min(max(area.minY, position.y - size.height), area.maxY - size.height), width: size.width, height: size.height), display: true)
        updateHitTesting()
    }
    func savePlacement() {
        preferences.set(anchor, forKey: "anchor"); preferences.set(Double(widgetWidth), forKey: "width")
        if let p = customPosition { preferences.set(Double(p.x), forKey: "positionX"); preferences.set(Double(p.y), forKey: "positionTop") }
        if let id = dragScreenID { preferences.set(id, forKey: "screen") }
    }
    func setWidgetWidth(_ width: CGFloat, persist: Bool = true) {
        guard width.isFinite else { return }
        let area = preferredScreen().visibleFrame
        widgetWidth = min(max(240, width), min(800, area.width - 16, (area.height - 16) * 160 / 84))
        placePanel()
        if ready { evaluate("window.muyu.setDesktopSize(\(widgetWidth));") }
        if persist { savePlacement() }
    }
    func handleDesktopGesture(_ data: [String: Any]) {
        guard let action = data["action"] as? String, let mode = data["mode"] as? String, ["move", "resize"].contains(mode), let dx = data["dx"] as? Double, let dy = data["dy"] as? Double, dx.isFinite, dy.isFinite, abs(dx) <= 20000, abs(dy) <= 20000 else { return }
        if action == "begin" {
            desktopGesture = (mode, NSPoint(x: panel.frame.minX + (panel.frame.width - widgetWidth) / 2, y: panel.frame.maxY), widgetWidth)
            return
        }
        guard let gesture = desktopGesture, gesture.mode == mode else { return }
        if action == "update" || action == "end" {
            anchor = "free"
            if mode == "move" {
                let candidate = NSPoint(x: gesture.origin.x + dx, y: gesture.origin.y - dy)
                let center = NSPoint(x: candidate.x + widgetWidth / 2, y: candidate.y - widgetWidth * 42 / 160)
                let screen = NSScreen.screens.min { a, b in
                    func distance(_ s: NSScreen) -> CGFloat { let f = s.visibleFrame; return hypot(max(f.minX - center.x, 0, center.x - f.maxX), max(f.minY - center.y, 0, center.y - f.maxY)) }
                    return distance(a) < distance(b)
                } ?? preferredScreen()
                dragScreenID = screenID(screen)
                let area = screen.visibleFrame
                customPosition = NSPoint(x: min(max(candidate.x, area.minX), area.maxX - widgetWidth), y: min(max(candidate.y, area.minY + widgetWidth * 84 / 160), area.maxY))
                placePanel()
            } else {
                customPosition = gesture.origin
                let ratio = 84.0 / 160.0
                setWidgetWidth(gesture.width + CGFloat((dx + dy * ratio) / (1 + ratio * ratio)), persist: false)
            }
        }
        if action == "end" || action == "cancel" { desktopGesture = nil; savePlacement(); updateHitTesting() }
    }
    func updateHitTesting() {
        guard panel != nil, NSEvent.pressedMouseButtons & 1 == 0 else { return }
        let p = NSEvent.mouseLocation, r = panel.frame
        let x = (p.x - r.minX - (r.width - widgetWidth) / 2) / widgetWidth * 160, y = (r.maxY - p.y) / widgetWidth * 160
        let track = hypot(max(abs(x - 80) - 40, 0), y - 42) <= 33
        let lensX = 45 + (latestState["position"] as? Double ?? 0.5) * 70
        let lens = hypot(x - lensX, max(abs(y - 42) - 15, 0)) <= 22
        let toolbar = settingsOpen && p.x >= r.minX + 12 && p.x <= r.maxX - 12 && y >= 84 && p.y >= r.minY + 8
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
                settingsOpen = data["settingsOpen"] as? Bool ?? false
                settingsExtra = settingsOpen ? CGFloat(max(0, min(1200, extra))) : 0; placePanel()
            }
        case "desktopGesture": if let data = body["data"] as? [String: Any] { handleDesktopGesture(data) }
        case "desktopSize": if let data = body["data"] as? [String: Any], let width = data["width"] as? Double, width.isFinite { setWidgetWidth(CGFloat(width)) }
        case "desktopScale": if let data = body["data"] as? [String: Any], let delta = data["delta"] as? Double, delta.isFinite, abs(delta) <= 60 { setWidgetWidth(widgetWidth + CGFloat(delta)) }
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
        menu.addItem(item("拖动庭院移动 · 滚轮缩放", nil))
        menu.addItem(item("固定在左上角", #selector(moveLeft), state: anchor == "left")); menu.addItem(item("固定在右上角", #selector(moveRight), state: anchor == "right"))
        let sizes = NSMenu(title: "显示大小")
        for width in [240, 320, 480, 640, 800] { sizes.addItem(item("\(width) px", #selector(resizeWidget(_:)), state: Int(widgetWidth) == width, tag: width)) }
        sizes.addItem(.separator()); sizes.addItem(item("自定义大小…", #selector(editSize)))
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
    @objc func editSize() { if ready { showPanel(); evaluate("window.muyu.showSettings(true); document.querySelector('.widget-size-number').focus();") } }
    @objc func toggleSound() { if ready { evaluate("void window.muyu.setSound(\(!(latestState["sound"] as? Bool ?? false)));") } }
    @objc func setTempo(_ sender: NSMenuItem) { if [40, 60, 90].contains(sender.tag), ready { evaluate("window.muyu.setTempo(\(sender.tag));") } }
    @objc func resetCount() { if ready { evaluate("window.muyu.resetCount();") } }
    @objc func moveLeft() { anchor = "left"; savePlacement(); placePanel() }
    @objc func moveRight() { anchor = "right"; savePlacement(); placePanel() }
    @objc func resizeWidget(_ sender: NSMenuItem) { setWidgetWidth(CGFloat(sender.tag)) }
    @objc func selectScreen(_ sender: NSMenuItem) { dragScreenID = sender.tag; preferences.set(sender.tag, forKey: "screen"); if anchor == "free" { anchor = "left" }; savePlacement(); placePanel() }
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
