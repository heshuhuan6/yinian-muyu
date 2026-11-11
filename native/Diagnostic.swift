import AppKit
import WebKit

@MainActor
final class DiagnosticRunner {
    let app: AppDelegate
    var checks: [[String: Any]] = []
    init(app: AppDelegate) { self.app = app }
    func record(_ name: String, _ passed: Bool, _ detail: Any = "") { checks.append(["name": name, "passed": passed, "detail": detail]) }
    func state(_ completion: @escaping ([String: Any]) -> Void) { app.evaluate("window.muyu.inspect();") { value, _ in completion(value as? [String: Any] ?? [:]) } }
    func after(_ delay: Double, _ work: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: { work() }) }
    func start() {
        record("Native WebGL2, real clock and muted launch", app.latestState["backend"] as? String == "webgl2" && app.latestState["mode"] as? String == "clock" && app.latestState["sound"] as? Bool == false, app.latestState)
        record("Readable transparent desktop panel", app.panel.frame.width == 480 && !app.panel.isOpaque && app.panel.level == .floating && app.panel.styleMask.contains(.nonactivatingPanel))
        record("Capsule-only panel has no toolbar space", abs(app.panel.frame.height - 480 * 84 / 160) < 1 && app.settingsExtra == 0 && !app.settingsOpen)
        app.moveLeft(); let left = app.panel.frame, area = app.preferredScreen().visibleFrame
        record("Left corner", abs(left.minX - area.minX - 16) < 1 && abs(left.maxY - area.maxY + 16) < 1)
        app.moveRight(); let right = app.panel.frame
        record("Right corner and preference", abs(right.maxX - area.maxX + 16) < 1 && app.preferences.string(forKey: "anchor") == "right")
        app.evaluate("window.muyu.setTime(510);")
        after(1.25) {
            self.state { value in
                self.record("Automatic strikes advance on desktop", (value["count"] as? Int ?? 0) >= 1 && value["paused"] as? Bool == false, value)
                self.app.evaluate("window.muyu.setTime(780);") { result, _ in
                    let baseline = (result as? [String: Any])?["count"] as? Int
                    self.after(1.05) {
                        self.state { value in
                            self.record("Lunch break stops automatic counting", value["count"] as? Int == baseline && value["active"] as? Bool == false, value)
                            self.testControls()
                        }
                    }
                }
            }
        }
    }
    func testControls() {
        let tempo = NSMenuItem(); tempo.tag = 90; app.setTempo(tempo)
        state { value in
            self.record("Native tempo menu reaches engine", value["bpm"] as? Int == 90, value)
            self.app.resetCount()
            self.state { value in
                self.record("Reset counter", value["count"] as? Int == 0, value)
                self.capture(3.4, name: "敲击") { self.capture(7.5, name: "静候") { self.testPause() } }
            }
        }
    }
    func capture(_ t: Double, name: String, then: @escaping () -> Void) {
        app.evaluate("window.__render(\(t));") { _, _ in
            self.after(0.2) {
                self.app.webView.takeSnapshot(with: nil) { image, error in
                    var detail: [String: Any] = [:], passed = false
                    if let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
                        let url = URL(fileURLWithPath: self.app.testPath!).deletingLastPathComponent().appendingPathComponent("Mac-" + name + ".png")
                        try? png.write(to: url)
                        let alpha = bitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? 1
                        passed = error == nil && alpha < 0.01
                        detail = ["width": bitmap.pixelsWide, "height": bitmap.pixelsHigh, "cornerAlpha": alpha]
                    }
                    self.record("Transparent native snapshot: " + name, passed, detail); then()
                }
            }
        }
    }
    func testPause() {
        app.evaluate("window.muyu.resumeClock();") { _, _ in
            self.app.toggleVisible()
            self.state { value in
                self.record("Hiding pauses engine", !self.app.panel.isVisible && value["paused"] as? Bool == true, value)
                self.app.showPanel()
                self.state { value in
                    self.record("Showing resumes engine", self.app.panel.isVisible && value["paused"] as? Bool == false, value)
                    self.app.sleepStarted(Notification(name: NSWorkspace.willSleepNotification))
                    self.state { value in
                        self.record("Sleep pauses", value["paused"] as? Bool == true, value)
                        self.app.wakeFinished(Notification(name: NSWorkspace.didWakeNotification))
                        self.state { value in
                            self.record("Wake resumes", value["paused"] as? Bool == false, value)
                            let size = NSMenuItem(); size.tag = 640; self.app.resizeWidget(size)
                            self.after(0.2) {
                                self.state { value in
                                    let pixelScale = value["pixelScale"] as? Double ?? 0
                                    self.record("Large size uses integer pixels", self.app.panel.frame.width == 640 && pixelScale >= 1 && floor(pixelScale) == pixelScale, value)
                                    self.app.togglePinned(); self.record("Pin toggle", self.app.panel.level == .normal)
                                    self.testScheduleSettings()
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    func testScheduleSettings() {
        let base = app.panel.frame.height
        app.editSchedule()
        after(0.25) {
            self.record("Schedule editor expands readable panel", self.app.settingsExtra > 80 && self.app.panel.frame.height > base)
            self.app.evaluate("window.muyu.setPeriods([{id:'test-a',start:480,end:720},{id:'test-b',start:870,end:1050}]); window.muyu.setTime(870);") { value, _ in
                let state = value as? [String: Any] ?? [:]
                self.record("14:30 begins scheduled activity", state["active"] as? Bool == true, state)
                self.after(0.1) {
                    self.record("Schedule saved in native preferences", self.app.preferences.array(forKey: "periods")?.count == 2)
                    self.app.evaluate("window.muyu.setTime(1050);") { value, _ in
                        let state = value as? [String: Any] ?? [:]
                        self.record("17:30 stops scheduled activity", state["active"] as? Bool == false, state)
                        self.app.resumeClock()
                        self.state { value in
                            self.record("Return to current local time", value["mode"] as? String == "clock", value)
                            self.testCustomPlacement()
                        }
                    }
                }
            }
        }
    }
    func testCustomPlacement() {
        app.evaluate("window.muyu.showSettings(false); window.muyu.resumeClock();") { _, _ in
            self.after(0.15) {
                self.app.setWidgetWidth(517)
                self.after(0.15) {
                    let frame = self.app.panel.frame
                    self.record("Arbitrary width 517 px keeps capsule aspect", abs(frame.width - 517) < 1 && abs(frame.height - 517 * 84 / 160) < 1)
                    self.app.moveLeft()
                    let origin = self.app.panel.frame
                    self.app.evaluate("window.webkit.messageHandlers.muyu.postMessage({type:'desktopGesture',data:{action:'begin',mode:'move',dx:0,dy:0}}); window.webkit.messageHandlers.muyu.postMessage({type:'desktopGesture',data:{action:'end',mode:'move',dx:137,dy:91}}); null;") { _, _ in
                        self.after(0.15) {
                            let moved = self.app.panel.frame
                            self.record("Move bridge repositions native window freely", abs(moved.minX - origin.minX - 137) < 1 && abs(moved.maxY - origin.maxY + 91) < 1 && self.app.anchor == "free", ["x": moved.minX, "top": moved.maxY])
                            let expected = self.app.customPosition
                            self.app.showPanel()
                            self.record("Showing preserves a free position", self.app.customPosition == expected && self.app.panel.frame == moved)
                            self.app.evaluate("window.webkit.messageHandlers.muyu.postMessage({type:'desktopGesture',data:{action:'begin',mode:'resize',dx:0,dy:0}}); window.webkit.messageHandlers.muyu.postMessage({type:'desktopGesture',data:{action:'end',mode:'resize',dx:63,dy:33.075}}); null;") { _, _ in
                                self.after(0.15) {
                                    self.record("Resize bridge changes actual native size", abs(self.app.widgetWidth - 580) < 1 && abs(self.app.panel.frame.width - 580) < 1)
                                    let restored = AppDelegate()
                                    self.record("Width and arbitrary position survive preference reload", restored.anchor == "free" && abs(restored.widgetWidth - 580) < 1 && restored.customPosition == self.app.customPosition)
                                    let stable = self.app.customPosition
                                    self.app.editSchedule()
                                    self.after(0.15) {
                                        self.app.evaluate("window.muyu.showSettings(false);") { _, _ in
                                            self.after(0.15) {
                                                self.record("Closing settings restores pure capsule and position", !self.app.settingsOpen && self.app.settingsExtra == 0 && self.app.customPosition == stable && abs(self.app.panel.frame.height - 580 * 84 / 160) < 1)
                                                self.app.setWidgetWidth(900); self.record("Maximum size is bounded", self.app.widgetWidth <= 800)
                                                self.app.setWidgetWidth(100); self.record("Minimum size is bounded", self.app.widgetWidth == 240)
                                                self.app.setWidgetWidth(480); self.app.moveLeft(); self.app.resumeClock()
                                                self.finish()
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    func finish() {
        record("Zero JavaScript bridge errors", app.errors.isEmpty, app.errors)
        let report: [String: Any] = ["passed": checks.allSatisfy { $0["passed"] as? Bool == true }, "checks": checks, "errors": app.errors, "platform": ProcessInfo.processInfo.operatingSystemVersionString]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: app.testPath!)) }
        NSApp.terminate(nil)
    }
}
