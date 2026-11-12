import AppKit

@main
struct MuyuMain {
    @MainActor
    static func main() {
        if LoginItemCommand.run(ProcessInfo.processInfo.arguments) { return }
        let application = NSApplication.shared
        let controller = AppDelegate()
        application.delegate = controller
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(controller) { application.run() }
    }
}
