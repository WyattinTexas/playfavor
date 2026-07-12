# FAVOR star-purchase IPN service (deployed on the Hivelocity box)

Real-money Stars for playfavor.net via PayPal — mirror of Nation's rail.

- **Deployed at**: root@74.50.97.139 `/opt/favor-ipn/ipn_server.py`
- **Service**: `favor-ipn.service` (systemd, www-data, ALLOW_SANDBOX=0,
  STATE_DIR=/var/lib/favor-ipn) listening on 127.0.0.1:8712
- **nginx**: `location /api/favor/` in sites-enabled/nationgame.live →
  https://nationgame.live/api/favor/paypal/ipn (+ /health)
- **Flow**: client (js/meta.js Royal Mint) opens a PayPal `_xclick` tab —
  business gablewyatt@gmail.com, invoice `<favorUid>.<packId>.<ts14>`,
  notify_url = the box. PayPal POSTs the IPN here; we postback-verify with
  ipnpb.paypal.com, check receiver/amount/pack, dedup (local file + a
  Firebase `favor/purchases/{txn}` create-once CAS), then credit
  `favor/players/{uid}/stars` by ETag compare-and-set and queue a
  `star_purchase` msgQueue congrats the client celebrates.
- **Packs** (must match js/meta.js STAR_PACKS exactly):
  50/$4 · 100/$6 · 500/$25 · 1000/$40
- **Test**: `python3 test_ipn_local.py` (stubs the PayPal postback, exercises
  grants/dedup/rejects against the real RTDB on a scratch uid, scrubs after).
- **Logs on box**: /var/lib/favor-ipn/ipn.log · `journalctl -u favor-ipn`
- **Redeploy**: scp ipn_server.py to /opt/favor-ipn/ && systemctl restart favor-ipn
