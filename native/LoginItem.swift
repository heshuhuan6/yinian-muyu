import ServiceManagement
import Foundation

/// The operating system is the source of truth. Reading this controller never
/// re-enables a login item that the user disabled in System Settings.
@MainActor
final class LoginItemController {
    private let readStatus: () -> SMAppService.Status
    private let register: () throws -> Void
    private let unregister: () throws -> Void

    init(readStatus: @escaping () -> SMAppService.Status = { SMAppService.mainApp.status },
         register: @escaping () throws -> Void = { try SMAppService.mainApp.register() },
         unregister: @escaping () throws -> Void = { try SMAppService.mainApp.unregister() }) {
        self.readStatus = readStatus; self.register = register; self.unregister = unregister
    }

    var status: SMAppService.Status { readStatus() }
    var isEnabled: Bool { status == .enabled }
    var needsApproval: Bool { status == .requiresApproval }
    var title: String { needsApproval ? "开机自动启动（待系统允许）" : "开机自动启动" }

    func setEnabled(_ enabled: Bool) throws {
        let current = status
        if enabled {
            // Pending approval must be resolved by the user, not by repeatedly
            // unregistering and trying to override their system preference.
            if current == .enabled || current == .requiresApproval { return }
            try register()
        } else if current == .enabled || current == .requiresApproval {
            try unregister()
        }
    }
}

/// A small command-line entry point for installation and release verification.
/// It runs without a window and never changes login settings without an explicit
/// enable/disable command. Normal launches do not enter this path.
@MainActor
enum LoginItemCommand {
    static func run(_ arguments: [String]) -> Bool {
        guard let index = arguments.firstIndex(of: "--login-item") else { return false }
        let controller = LoginItemController()
        var failure: String?
        do {
            guard arguments.count > index + 1 else { throw NSError(domain: "Muyu", code: 1, userInfo: [NSLocalizedDescriptionKey: "需要 status、enable 或 disable 参数。"] ) }
            switch arguments[index + 1] {
            case "status": break
            case "enable": try controller.setEnabled(true)
            case "disable": try controller.setEnabled(false)
            default: throw NSError(domain: "Muyu", code: 1, userInfo: [NSLocalizedDescriptionKey: "登录项参数仅支持 status、enable 或 disable。"] )
            }
        } catch { failure = error.localizedDescription }
        let status: String
        switch controller.status {
        case .notRegistered: status = "not-registered"
        case .enabled: status = "enabled"
        case .requiresApproval: status = "requires-approval"
        case .notFound: status = "not-found"
        @unknown default: status = "unknown"
        }
        var result: [String: Any] = ["status": status, "enabled": controller.isEnabled, "needsApproval": controller.needsApproval, "bundlePath": Bundle.main.bundleURL.path]
        if let failure { result["error"] = failure }
        let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        if failure != nil { exit(1) }
        return true
    }
}
