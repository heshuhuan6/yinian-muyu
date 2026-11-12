import Foundation
import ServiceManagement

@main
struct LoginItemTests {
    @MainActor
    static func main() {
        var checks: [[String: Any]] = []
        func check(_ name: String, _ passed: Bool) { checks.append(["name": name, "passed": passed]) }
        var state = SMAppService.Status.notRegistered
        var registers = 0, unregisters = 0
        let controller = LoginItemController(readStatus: { state }, register: { registers += 1; state = .enabled }, unregister: { unregisters += 1; state = .notRegistered })
        check("Reading status never creates a login item", !controller.isEnabled && registers == 0)
        do {
            try controller.setEnabled(true)
            check("Explicit enable registers once", controller.isEnabled && registers == 1)
            try controller.setEnabled(true)
            check("Repeated enable is idempotent", registers == 1)
            try controller.setEnabled(false)
            check("Disable removes the login item", !controller.isEnabled && unregisters == 1)
            try controller.setEnabled(false)
            check("Repeated disable is idempotent", unregisters == 1)
            state = .requiresApproval
            check("System denial is displayed as pending approval", controller.needsApproval && !controller.isEnabled && controller.title.contains("待系统允许"))
            try controller.setEnabled(true)
            check("Pending approval is never overridden", registers == 1 && unregisters == 1 && controller.needsApproval)
            try controller.setEnabled(false)
            check("A pending login item can be cancelled", state == .notRegistered && unregisters == 2)
            state = .notFound
            try controller.setEnabled(true)
            check("Missing service can be registered by explicit request", controller.isEnabled && registers == 2)
        } catch { check("Unexpected error: \(error)", false) }
        var failedState = SMAppService.Status.notRegistered
        let failing = LoginItemController(readStatus: { failedState }, register: { throw NSError(domain: "LoginItemTest", code: 1) }, unregister: { throw NSError(domain: "LoginItemTest", code: 2) })
        do { try failing.setEnabled(true); check("Registration failure is reported", false) }
        catch { check("Registration failure is reported without a false checkmark", !failing.isEnabled) }
        failedState = .enabled
        do { try failing.setEnabled(false); check("Unregister failure is reported", false) }
        catch { check("Unregister failure preserves actual system status", failing.isEnabled) }
        let passed = checks.allSatisfy { $0["passed"] as? Bool == true }
        let report: [String: Any] = ["passed": passed, "checks": checks, "systemLoginItemsModified": false]
        let data = try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        exit(passed ? 0 : 1)
    }
}
