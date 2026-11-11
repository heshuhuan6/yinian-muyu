import AppKit

@main
struct MuyuMain {
    @MainActor
    static func main() {
        let application = NSApplication.shared
        let controller = AppDelegate()
        application.delegate = controller
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(controller) { application.run() }
    }
}
