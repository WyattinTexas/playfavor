import UIKit

// FAVOR iOS shell — a fullscreen WKWebView over https://playfavor.net/.
// The game itself ships from the web (one codebase); this wrapper gives it
// a home screen icon, landscape lock, persistent storage and TestFlight.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = UIColor(red: 0x1D / 255.0, green: 0x11 / 255.0, blue: 0x06 / 255.0, alpha: 1)
        w.rootViewController = GameViewController()
        w.makeKeyAndVisible()
        window = w
        // A card table never sleeps mid-game.
        application.isIdleTimerDisabled = true
        return true
    }
}
