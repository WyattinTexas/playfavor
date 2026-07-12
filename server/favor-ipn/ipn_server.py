#!/usr/bin/env python3
"""FAVOR star-purchase IPN server (playfavor.net → Wyatt's PayPal).

Receives PayPal Instant Payment Notifications for FAVOR star purchases,
verifies them with PayPal's postback endpoint, and credits Stars to the
buyer's Firebase RTDB profile (testroom-75200, favor/players/{uid}).

Mirror of the proven Nation rail (/opt/nation-ipn/ipn_server.py) with the
PlayFab grant swapped for Firebase REST. Client side: js/meta.js builds a
_xclick checkout with invoice <favorUid>.<itemId>.<yyyyMMddHHmmss> and
notify_url https://nationgame.live/api/favor/paypal/ipn.

Star packs must match the client's FLB.STAR_PACKS table exactly:
  favor.stars50=$4  favor.stars100=$6  favor.stars500=$25  favor.stars1000=$40

Stdlib only — no pip dependencies. Run behind nginx (proxy /api/favor/paypal/ipn).
"""
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_ADDR = ("127.0.0.1", 8712)
FIREBASE_BASE = "https://testroom-75200-default-rtdb.firebaseio.com/favor"
RECEIVER_EMAIL = "gablewyatt@gmail.com"
ALLOW_SANDBOX = os.environ.get("ALLOW_SANDBOX", "0") == "1"

PAYPAL_VERIFY_LIVE = "https://ipnpb.paypal.com/cgi-bin/webscr"
PAYPAL_VERIFY_SANDBOX = "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr"

STAR_PACKS = {
    "favor.stars50": (50, "4.00"),
    "favor.stars100": (100, "6.00"),
    "favor.stars500": (500, "25.00"),
    "favor.stars1000": (1000, "40.00"),
}

# uid = 'u' + Math.random base36 (≤8) + Date.now base36 (8) — see meta.js uid().
INVOICE_RE = re.compile(r"(u[a-z0-9]{10,30})\.(favor\.stars\d+)\.(\d{14})")

STATE_DIR = os.environ.get("STATE_DIR", "/var/lib/favor-ipn")
PROCESSED_FILE = os.path.join(STATE_DIR, "processed_txns.json")
LOG_FILE = os.path.join(STATE_DIR, "ipn.log")

os.makedirs(STATE_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler()],
)
log = logging.getLogger("favor-ipn")

_lock = threading.Lock()


def load_processed():
    try:
        with open(PROCESSED_FILE) as f:
            return set(json.load(f))
    except (FileNotFoundError, ValueError):
        return set()


def save_processed(txns):
    tmp = PROCESSED_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(sorted(txns), f)
    os.replace(tmp, PROCESSED_FILE)


def verify_with_paypal(raw_body: bytes, sandbox: bool) -> bool:
    """Post the notification back to PayPal; PayPal replies VERIFIED or INVALID."""
    url = PAYPAL_VERIFY_SANDBOX if sandbox else PAYPAL_VERIFY_LIVE
    req = urllib.request.Request(
        url,
        data=b"cmd=_notify-validate&" + raw_body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Favor-IPN/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode().strip() == "VERIFIED"


# ── Firebase RTDB REST ────────────────────────────────────────────────

def fb_request(path: str, method="GET", body=None, headers=None):
    req = urllib.request.Request(
        f"{FIREBASE_BASE}/{path}.json",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    return urllib.request.urlopen(req, timeout=20)


def claim_txn(txn_id: str, record: dict) -> bool:
    """Create favor/purchases/{txn} exactly once (ETag CAS on absent node).
    Returns False if the txn was already claimed — the durable dedup."""
    try:
        with fb_request(f"purchases/{txn_id}", "PUT", record,
                        {"if-match": "null_etag"}):
            return True
    except urllib.error.HTTPError as e:
        if e.code == 412:
            return False
        raise


def grant_stars(uid: str, amount: int) -> int:
    """Compare-and-set increment of players/{uid}/stars. Returns new balance."""
    for _ in range(6):
        req = urllib.request.Request(
            f"{FIREBASE_BASE}/players/{uid}/stars.json",
            headers={"X-Firebase-ETag": "true"},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            etag = r.headers["ETag"]
            current = json.load(r) or 0
        new_balance = int(current) + amount
        try:
            with fb_request(f"players/{uid}/stars", "PUT", new_balance,
                            {"if-match": etag}):
                return new_balance
        except urllib.error.HTTPError as e:
            if e.code == 412:
                continue        # raced a game payout — reread and retry
            raise
    raise RuntimeError(f"stars CAS failed for {uid} after 6 attempts")


def queue_congrats(uid: str, stars: int, item_id: str, txn_id: str):
    """The client's msgQueue drain shows a royal overlay on next visit."""
    import time
    with fb_request(f"players/{uid}/msgQueue", "POST", {
        "type": "star_purchase", "stars": stars, "item": item_id,
        "txn": txn_id, "at": int(time.time() * 1000),
    }):
        pass


# ── HTTP handler ──────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "FavorIPN/1.0"

    def log_message(self, fmt, *args):
        log.info("http: " + fmt % args)

    def do_GET(self):
        if self.path == "/api/favor/paypal/health":
            self._respond(200, "ok")
        else:
            self._respond(405, "POST only")

    def do_POST(self):
        if self.path != "/api/favor/paypal/ipn":
            self._respond(404, "not found")
            return
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 65536:
            self._respond(400, "bad length")
            return
        raw = self.rfile.read(length)
        # Ack immediately; PayPal only needs a 200. Processing happens after.
        self._respond(200, "")
        try:
            self.process(raw)
        except Exception:
            log.exception("IPN processing failed; raw=%r", raw[:2000])

    def _respond(self, code, text):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def process(self, raw: bytes):
        params = {k: v[0] for k, v in urllib.parse.parse_qs(raw.decode("utf-8", "replace")).items()}
        txn_id = params.get("txn_id", "")
        invoice = params.get("invoice", "")
        sandbox = params.get("test_ipn") == "1"
        log.info(
            "IPN received: txn=%s invoice=%s status=%s gross=%s %s sandbox=%s payer=%s",
            txn_id, invoice, params.get("payment_status"), params.get("mc_gross"),
            params.get("mc_currency"), sandbox, params.get("payer_email"),
        )

        if sandbox and not ALLOW_SANDBOX:
            log.warning("REJECT: sandbox IPN but ALLOW_SANDBOX is off")
            return
        if not verify_with_paypal(raw, sandbox):
            log.warning("REJECT: PayPal postback says INVALID (possible forgery)")
            return
        if params.get("payment_status") != "Completed":
            log.info("SKIP: payment_status=%s (nothing to grant)", params.get("payment_status"))
            return
        if params.get("receiver_email", params.get("business", "")).lower() != RECEIVER_EMAIL and not sandbox:
            log.warning("REJECT: unexpected receiver %s", params.get("receiver_email"))
            return

        m = INVOICE_RE.fullmatch(invoice)
        if not m:
            log.warning("REJECT: malformed invoice %r", invoice)
            return
        uid, item_id = m.group(1), m.group(2)
        if item_id not in STAR_PACKS:
            log.warning("REJECT: unknown item %s", item_id)
            return
        stars, expected_usd = STAR_PACKS[item_id]
        if params.get("mc_currency") != "USD" or params.get("mc_gross") != expected_usd:
            log.warning(
                "REJECT: price mismatch for %s: got %s %s, expected %s USD",
                item_id, params.get("mc_gross"), params.get("mc_currency"), expected_usd,
            )
            return
        if not txn_id:
            log.warning("REJECT: missing txn_id")
            return

        with _lock:
            # Belt: local processed file. Suspenders: the purchases-node
            # CAS below survives box reinstalls and double-delivery races.
            processed = load_processed()
            if txn_id in processed:
                log.info("SKIP: txn %s already processed (local)", txn_id)
                return

            import time
            claimed = claim_txn(txn_id, {
                "uid": uid, "item": item_id, "stars": stars,
                "usd": expected_usd, "at": int(time.time() * 1000),
                "status": "granting", "sandbox": sandbox,
            })
            if not claimed:
                log.info("SKIP: txn %s already claimed (firebase)", txn_id)
                processed.add(txn_id)
                save_processed(processed)
                return

            new_balance = grant_stars(uid, stars)
            with fb_request(f"purchases/{txn_id}/status", "PUT", "granted"):
                pass
            with fb_request(f"purchases/{txn_id}/balance", "PUT", new_balance):
                pass
            try:
                queue_congrats(uid, stars, item_id, txn_id)
            except Exception:
                log.exception("msgQueue congrats failed (stars already granted)")

            processed.add(txn_id)
            save_processed(processed)
            log.info("GRANTED: +%d stars to %s (txn %s, %s) — balance %d",
                     stars, uid, txn_id, item_id, new_balance)


def main():
    log.info("FAVOR IPN server starting on %s:%s (sandbox allowed: %s)",
             LISTEN_ADDR[0], LISTEN_ADDR[1], ALLOW_SANDBOX)
    ThreadingHTTPServer(LISTEN_ADDR, Handler).serve_forever()


if __name__ == "__main__":
    main()
