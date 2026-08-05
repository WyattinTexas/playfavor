import Foundation
import WebKit
import StoreKit

// Apple Star Shipments bridge — GVT 0097's proven pattern, worn FAVOR's way.
// The page posts {cmd:...} on webkit.messageHandlers.favorIAP and everything
// returns through FLB._iapProducts / _iapTx / _iapResult.
//
// The shell knows the four SKUs and NOTHING about quantities or prices:
// packs are the page's business and money display is the storefront's.
//
// The credit contract (the part that matters): a verified transaction is
// pushed to the page and kept in `unacked`; finish() runs ONLY when the page
// answers {cmd:'ack'} — which it does only after the credit is confirmed in
// the realm's database. Anything unfinished from an earlier run replays at
// launch through Transaction.unfinished, and Ask-to-Buy approvals /
// interrupted purchases arrive for life through Transaction.updates. Every
// delivery funnels into the same page push; the page ledger dedupes, so
// re-delivery is the mechanism, not a bug.
final class FavorIAPBridge: NSObject, WKScriptMessageHandler {

    weak var webView: WKWebView?

    private static let skus = [
        "com.corkscrewgames.favor.stars.s",
        "com.corkscrewgames.favor.stars.m",
        "com.corkscrewgames.favor.stars.l",
        "com.corkscrewgames.favor.stars.xl",
    ]
    private var products: [String: Product] = [:]      // sku → Product (main thread only)
    private var unacked: [String: Transaction] = [:]   // txid → verified, delivered, not yet acked
    private var buying = false                          // one payment sheet at a time

    override init() {
        super.init()
        Task { [weak self] in
            for await r in Transaction.unfinished { await MainActor.run { self?.deliver(r) } }
        }
        Task { [weak self] in
            for await r in Transaction.updates { await MainActor.run { self?.deliver(r) } }
        }
    }

    // main thread. NEVER credits unverified; a revoked (refunded) transaction
    // is closed out without a push — the page ledger would refuse it anyway.
    private func deliver(_ result: VerificationResult<Transaction>) {
        guard case .verified(let tx) = result else { return }
        guard tx.revocationDate == nil else {
            Task { await tx.finish() }
            return
        }
        unacked[String(tx.id)] = tx
        pushTx(tx)
    }

    private func pushTx(_ tx: Transaction) {
        send("_iapTx", ["tx": String(tx.id), "sku": tx.productID])
    }

    // the page (re)loaded — re-offer anything still waiting for its ack
    func pageReady() {
        for tx in unacked.values { pushTx(tx) }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "favorIAP",
              let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "products":
            Task { [weak self] in
                let loaded = (try? await Product.products(for: Self.skus)) ?? []
                await MainActor.run { self?.gotProducts(loaded) }
            }
        case "buy":
            if let sku = body["sku"] as? String { startBuy(sku) }
        case "ack":
            // double-ack is a no-op: the map only ever holds a transaction once
            if let txid = body["tx"] as? String,
               let tx = unacked.removeValue(forKey: txid) {
                Task { await tx.finish() }
            }
        default:
            break
        }
    }

    private func gotProducts(_ loaded: [Product]) {
        var list: [[String: Any]] = []
        for p in loaded where p.type == .consumable {
            products[p.id] = p
            list.append(["sku": p.id, "price": p.displayPrice])
        }
        send("_iapProducts", list)
        // the page asking for products doubles as its READY signal — a
        // transaction delivered before the page could hear it goes again now
        pageReady()
    }

    private func startBuy(_ sku: String) {
        guard !buying else { return }                   // the page busy-guards too
        guard let product = products[sku] else {
            send("_iapResult", ["sku": sku, "state": "fail"])
            return
        }
        buying = true
        Task { [weak self] in
            var state: String? = nil
            var detail = ""
            var delivered: VerificationResult<Transaction>? = nil
            do {
                switch try await product.purchase() {
                case .success(let v):
                    if case .verified = v { delivered = v } else { state = "fail"; detail = "unverified" }
                case .userCancelled: state = "cancel"
                case .pending:       state = "pending"
                @unknown default:    state = "fail"
                }
            } catch StoreKitError.userCancelled {
                state = "cancel"
            } catch {
                state = "fail"
                detail = String(describing: error).prefix(120).description
            }
            await MainActor.run {
                guard let self = self else { return }
                self.buying = false
                if let v = delivered { self.deliver(v) }
                if let s = state { self.send("_iapResult", ["sku": sku, "state": s, "err": detail]) }
            }
        }
    }

    private func send(_ fn: String, _ payload: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.FLB && FLB.\(fn) && FLB.\(fn)(\(json));",
                completionHandler: nil)
        }
    }
}
