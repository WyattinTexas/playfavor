import UIKit
import WebKit

// The whole app: playfavor.net full-bleed in a WKWebView.
//
// - UA carries "FavorShell-iOS" — the site hides the PayPal Royal Mint for
//   this shell (Apple 3.1.1: no external purchase rails for digital goods).
// - localStorage persists via the default website data store (favorUid,
//   crest, owned heroes all survive relaunches).
// - Links leaving playfavor.net open in Safari; the table itself never
//   navigates away.
// - Network failure shows a native parchment-dark retry screen instead of
//   a WebKit error page.
class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    private let gameURL = URL(string: "https://playfavor.net/")!
    private var webView: WKWebView!
    private var retryOverlay: UIView?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x1D / 255.0, green: 0x11 / 255.0, blue: 0x06 / 255.0, alpha: 1)

        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "FavorShell-iOS/1.0"
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        // The game manages its own stage — no outer rubber-banding. Panels
        // inside the page still scroll (their own overflow containers).
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        view.addSubview(webView)

        webView.load(URLRequest(url: gameURL))
    }

    // ── Navigation policy: the shell holds the table; everything else → Safari ──

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let host = url.host ?? ""
        if host.isEmpty || host == "playfavor.net" || host.hasSuffix(".playfavor.net")
            || host.contains("firebaseio.com") || host.contains("googleapis.com") {
            decisionHandler(.allow)
            return
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // target=_blank etc. — never spawn a second web view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if (url.host ?? "").hasSuffix("playfavor.net") {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    // ── Offline: honest native retry, styled like the realm ──

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showRetry()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorNotConnectedToInternet || code == NSURLErrorNetworkConnectionLost {
            showRetry()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryOverlay?.removeFromSuperview()
        retryOverlay = nil
    }

    private func showRetry() {
        guard retryOverlay == nil else { return }
        let overlay = UIView(frame: view.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = view.backgroundColor

        let title = UILabel()
        title.text = "The Realm Is Unreachable"
        title.font = UIFont(name: "Georgia-Bold", size: 24) ?? .boldSystemFont(ofSize: 24)
        title.textColor = UIColor(red: 0xFF / 255.0, green: 0xD9 / 255.0, blue: 0x7A / 255.0, alpha: 1)
        title.textAlignment = .center

        let sub = UILabel()
        sub.text = "Check your connection, then try again."
        sub.font = UIFont(name: "Georgia-Italic", size: 15) ?? .italicSystemFont(ofSize: 15)
        sub.textColor = UIColor(white: 0.9, alpha: 0.7)
        sub.textAlignment = .center

        let button = UIButton(type: .system)
        button.setTitle("Return to the Table", for: .normal)
        button.titleLabel?.font = UIFont(name: "Georgia-Bold", size: 17) ?? .boldSystemFont(ofSize: 17)
        button.setTitleColor(UIColor(red: 0x2B / 255.0, green: 0x1A / 255.0, blue: 0x06 / 255.0, alpha: 1), for: .normal)
        button.backgroundColor = UIColor(red: 0xE0 / 255.0, green: 0xB4 / 255.0, blue: 0x5E / 255.0, alpha: 1)
        button.layer.cornerRadius = 22
        button.contentEdgeInsets = UIEdgeInsets(top: 10, left: 26, bottom: 10, right: 26)
        button.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, sub, button])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
        ])

        view.addSubview(overlay)
        retryOverlay = overlay
    }

    @objc private func retryTapped() {
        retryOverlay?.removeFromSuperview()
        retryOverlay = nil
        webView.load(URLRequest(url: gameURL))
    }
}
