import UIKit
import WebKit
import AuthenticationServices
import Security

// Court Sign-In bridge (b18). The page posts {cmd:...} on
// webkit.messageHandlers.favorSign and results return through
// FLB._appleResult(...). The Keychain holds the account uid (and the Apple
// sub) OUTSIDE webview storage, so a reinstall — which evicts localStorage
// and used to strand the account — walks back into its court silently via
// the documentStart user script in GameViewController.

enum FavorKeychain {
    private static let service = "com.corkscrewgames.favor"

    static func set(_ key: String, _ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        // Readable after first unlock, survives reinstall — the whole point.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        query[kSecAttrAccessible as String] = nil
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

final class FavorSignBridge: NSObject, WKScriptMessageHandler,
    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {

    weak var webView: WKWebView?
    weak var host: UIViewController?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "favorSign",
              let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "apple_signin":
            startAppleSignIn()
        case "keychain_uid":
            // The page mirrors whichever court this glass holds; only ever
            // store the app's own uid alphabet.
            if let uid = body["uid"] as? String {
                let clean = uid.filter { $0.isLetter || $0.isNumber }
                if !clean.isEmpty { FavorKeychain.set("favorUid", clean) }
            }
        default:
            break
        }
    }

    private func startAppleSignIn() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // Name only on the FIRST grant (Apple's rule); no email needed —
        // the game keys accounts on the stable user identifier alone.
        request.requestedScopes = [.fullName]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential else {
            sendResult(["ok": false, "error": "credential"])
            return
        }
        FavorKeychain.set("appleSub", cred.user)
        var payload: [String: Any] = ["ok": true, "sub": cred.user]
        if let components = cred.fullName {
            let name = PersonNameComponentsFormatter().string(from: components)
                .trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { payload["name"] = name }
        }
        sendResult(payload)
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        let canceled = (error as? ASAuthorizationError)?.code == .canceled
        sendResult(["ok": false, "error": canceled ? "canceled" : "failed"])
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        host?.view.window ?? ASPresentationAnchor()
    }

    private func sendResult(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.FLB && FLB._appleResult && FLB._appleResult(\(json));",
                completionHandler: nil)
        }
    }
}
