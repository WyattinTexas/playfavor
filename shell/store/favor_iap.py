#!/usr/bin/env python3
"""IN-APP PURCHASES for FAVOR: Royal Succession (app 6790169069) — the four
Apple star packs (GVT 0097's staging machinery, repointed).

  50 / 100 / 500 / 1000 Stars at $3.99 / $5.99 / $24.99 / $39.99 — the web
  Mint's own quantities at the nearest Apple tiers. SKUs are quantity-NEUTRAL
  (.s/.m/.l/.xl — ids are forever; a quantity retune is a display-name edit,
  never an id migration).

Usage: favor_iap.py <cmd>  — run with ~/wkspaces/Nation/tools/venv/bin/python3

  check          — assert every localized field is inside Apple's caps
                   (name ≤30, desc ≤45, no star glyphs, no price text),
                   print the table
  push           — create the 4 CONSUMABLES + en-US localization + USA base
                   price + all-territories availability (idempotent; an
                   agreement-gated 409 is printed VERBATIM and staging
                   continues — that 409 is the Wyatt gate surfacing)
  shots <dir>    — upload <dir>/iap-review-stars-{s,m,l,xl}.png as each
                   product's review screenshot (reserve→upload→commit-md5,
                   distinct fileNames per product — the dedupe-on-fileName law)
  status         — per-product report: state, localizations, price,
                   screenshot assetDeliveryState

⚠ Prices NEVER appear in localized copy — the storefront decides the money.
⚠ The Paid Applications agreement (Wyatt-only, ASC → Business) gates Apple
  APPROVING these; it does not gate one bit of this draft-side staging.
The .p8 key lives outside the repo (~/.appstoreconnect/private/); never commit it.
"""
import hashlib
import json
import os
import re
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from favor_store import APP_ID, BASE, H, get, post, patch  # noqa: E402

# ---------------------------------------------------------------- the packs --
# (sku-suffix, product id, reference name, USD customer price)
PACKS = [
    ("s",  "com.corkscrewgames.favor.stars.s",  "STARS POUCH",    "3.99"),
    ("m",  "com.corkscrewgames.favor.stars.m",  "STARS PURSE",    "5.99"),
    ("l",  "com.corkscrewgames.favor.stars.l",  "STARS CHEST",    "24.99"),
    ("xl", "com.corkscrewgames.favor.stars.xl", "STARS TREASURY", "39.99"),
]
QTY = {"s": "50", "m": "100", "l": "500", "xl": "1000"}

REVIEW_NOTE = (
    "The Star packs live inside the in-game store (the Royal Emporium): from "
    "the title screen open the store, then tap the 'Purchase Stars' button at "
    "the top right — the four packs appear in a sheet called The Royal Mint. "
    "Stars are FAVOR's existing spendable currency (earned by playing and by "
    "daily crowns); a pack simply adds to the same account balance, which "
    "follows the player across devices. Purchases are optional and nothing "
    "in the game requires them."
)

# name ≤30 chars, description ≤45 chars; numbers stay ASCII digits;
# NO currency amounts anywhere — the storefront owns the money.
L10N = {
    "en-US": {"s":  ("50 Stars",   "50 Stars, straight to your purse"),
              "m":  ("100 Stars",  "100 Stars, straight to your purse"),
              "l":  ("500 Stars",  "500 Stars, straight to your purse"),
              "xl": ("1000 Stars", "1000 Stars, straight to your purse")},
}


# ---------------------------------------------------------------- helpers ----
def products():
    """productId → product dict, from the app's V2 inventory."""
    out = {}
    d = get(f"/v1/apps/{APP_ID}/inAppPurchasesV2", limit=50)["data"]
    for p in d:
        out[p["attributes"]["productId"]] = p
    return out


def delete(path):
    r = requests.delete(BASE + path, headers=H())
    r.raise_for_status()


def post_tolerant(path, body, what):
    """POST that prints an agreement-class 409 VERBATIM and returns None
    instead of raising — that 409 is the Wyatt gate surfacing, not a bug."""
    r = requests.post(BASE + path, headers=H(), data=json.dumps(body))
    if r.status_code in (200, 201):
        return r.json()
    print(f"  ⚠ {what}: HTTP {r.status_code} — VERBATIM:")
    print("    " + r.text[:600].replace("\n", "\n    "))
    return None


# ---------------------------------------------------------------- check ------
STAR_GLYPHS = "★☆✪✦"


def cmd_check():
    bad = 0
    for loc, tbl in L10N.items():
        for suf, (name, desc) in tbl.items():
            probs = []
            if len(name) > 30:
                probs.append(f"name {len(name)}>30")
            if len(desc) > 45:
                probs.append(f"desc {len(desc)}>45")
            if any(g in name + desc for g in STAR_GLYPHS):
                probs.append("star glyph")
            if re.search(r"[$€£¥₩]|\d+[.,]\d\d\b", name + desc):
                probs.append("price text")
            if not re.search(rf"\b{QTY[suf]}", name.replace(",", "")) and QTY[suf] not in name:
                probs.append(f"quantity {QTY[suf]} missing from name")
            mark = "✗" if probs else "✓"
            if probs:
                bad += 1
            print(f"  {mark} {loc:8s} {suf:2s} {name!r:14s} {desc!r}  {'; '.join(probs)}")
    if any(g in REVIEW_NOTE for g in STAR_GLYPHS):
        bad += 1
        print("  ✗ review note carries a star glyph")
    print("ALL COPY INSIDE THE CAPS" if not bad else f"{bad} PROBLEMS")
    sys.exit(1 if bad else 0)


# ---------------------------------------------------------------- push -------
def push_products():
    have = products()
    for suf, pid, ref, _usd in PACKS:
        if pid in have:
            print(f"  {pid} exists (state {have[pid]['attributes'].get('state')})")
            continue
        r = post_tolerant("/v2/inAppPurchases", {"data": {
            "type": "inAppPurchases",
            "attributes": {"name": ref, "productId": pid,
                           "inAppPurchaseType": "CONSUMABLE",
                           "reviewNote": REVIEW_NOTE},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
        }}, f"create {pid}")
        if r:
            print(f"  {pid} CREATED → {r['data']['id']}")
    return products()


def push_l10n(have):
    for suf, pid, _ref, _usd in PACKS:
        if pid not in have:
            continue
        iid = have[pid]["id"]
        existing = {l["attributes"]["locale"]: l for l in
                    get(f"/v2/inAppPurchases/{iid}/inAppPurchaseLocalizations", limit=50)["data"]}
        for loc, tbl in L10N.items():
            name, desc = tbl[suf]
            if loc in existing:
                a = existing[loc]["attributes"]
                if a.get("name") == name and a.get("description") == desc:
                    continue
                patch(f"/v1/inAppPurchaseLocalizations/{existing[loc]['id']}", {"data": {
                    "type": "inAppPurchaseLocalizations", "id": existing[loc]["id"],
                    "attributes": {"name": name, "description": desc}}})
                print(f"  {pid} {loc:8s} updated")
                continue
            r = post_tolerant("/v1/inAppPurchaseLocalizations", {"data": {
                "type": "inAppPurchaseLocalizations",
                "attributes": {"locale": loc, "name": name, "description": desc},
                "relationships": {"inAppPurchaseV2": {
                    "data": {"type": "inAppPurchases", "id": iid}}},
            }}, f"{pid} loc {loc}")
            if r:
                print(f"  {pid} {loc:8s} created")


def push_prices(have):
    for suf, pid, _ref, usd in PACKS:
        if pid not in have:
            continue
        iid = have[pid]["id"]
        # is a schedule already in place?
        r = requests.get(BASE + f"/v2/inAppPurchases/{iid}/iapPriceSchedule",
                         headers=H())
        if r.status_code == 200 and r.json().get("data"):
            print(f"  {pid} price schedule already set")
            continue
        # find the USA price point whose customerPrice is exactly the target
        pts, nxt = [], f"/v2/inAppPurchases/{iid}/pricePoints?filter[territory]=USA&limit=200"
        while nxt:
            rr = requests.get(BASE + nxt if nxt.startswith("/") else nxt, headers=H()).json()
            pts += rr.get("data", [])
            nxt = rr.get("links", {}).get("next")
            if nxt and nxt.startswith(BASE):
                nxt = nxt[len(BASE):]
        point = next((p for p in pts if p["attributes"].get("customerPrice") == usd), None)
        if not point:
            print(f"  ⚠ {pid}: no USA price point at {usd} ({len(pts)} points seen) — is the "
                  "Paid Applications agreement unsigned? staging continues")
            continue
        body = {"data": {
            "type": "inAppPurchasePriceSchedules",
            "relationships": {
                "inAppPurchase": {"data": {"type": "inAppPurchases", "id": iid}},
                "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
                "manualPrices": {"data": [{"type": "inAppPurchasePrices", "id": "${p0}"}]},
            }},
            "included": [{
                "id": "${p0}", "type": "inAppPurchasePrices",
                "attributes": {"startDate": None},
                "relationships": {
                    "inAppPurchasePricePoint": {"data": {
                        "type": "inAppPurchasePricePoints", "id": point["id"]}}},
            }]}
        if post_tolerant("/v1/inAppPurchasePriceSchedules", body, f"{pid} price"):
            print(f"  {pid} priced: USA base {usd} (Apple derives every storefront)")


def push_availability(have):
    terr = [t["id"] for t in get("/v1/territories", limit=200)["data"]]
    for suf, pid, _ref, _usd in PACKS:
        if pid not in have:
            continue
        iid = have[pid]["id"]
        r = requests.get(BASE + f"/v2/inAppPurchases/{iid}/inAppPurchaseAvailability",
                         headers=H())
        if r.status_code == 200 and r.json().get("data"):
            print(f"  {pid} availability already set")
            continue
        body = {"data": {
            "type": "inAppPurchaseAvailabilities",
            "attributes": {"availableInNewTerritories": True},
            "relationships": {
                "inAppPurchase": {"data": {"type": "inAppPurchases", "id": iid}},
                "availableTerritories": {"data": [
                    {"type": "territories", "id": t} for t in terr]},
            }}}
        if post_tolerant("/v1/inAppPurchaseAvailabilities", body, f"{pid} availability"):
            print(f"  {pid} available in all {len(terr)} territories + future ones")


def cmd_push():
    print("products:")
    have = push_products()
    print("localizations:")
    push_l10n(have)
    print("prices:")
    push_prices(have)
    print("availability:")
    push_availability(have)
    print("done — run status")


# ---------------------------------------------------------------- shots ------
def cmd_shots():
    root = sys.argv[2]
    have = products()
    for suf, pid, _ref, _usd in PACKS:
        if pid not in have:
            print(f"  {pid} SKIP — product not created")
            continue
        iid = have[pid]["id"]
        path = os.path.join(root, f"iap-review-stars-{suf}.png")
        if not os.path.isfile(path):
            print(f"  {pid} SKIP — no {path}")
            continue
        r = requests.get(
            BASE + f"/v2/inAppPurchases/{iid}/appStoreReviewScreenshot", headers=H())
        if r.status_code == 200 and r.json().get("data"):
            st = r.json()["data"]["attributes"].get("assetDeliveryState", {}).get("state")
            print(f"  {pid} screenshot already there ({st})")
            continue
        blob = open(path, "rb").read()
        shot = post_tolerant("/v1/inAppPurchaseAppStoreReviewScreenshots", {"data": {
            "type": "inAppPurchaseAppStoreReviewScreenshots",
            "attributes": {"fileName": os.path.basename(path), "fileSize": len(blob)},
            "relationships": {"inAppPurchaseV2": {
                "data": {"type": "inAppPurchases", "id": iid}}},
        }}, f"{pid} screenshot reserve")
        if not shot:
            continue
        sid = shot["data"]["id"]
        for op in shot["data"]["attributes"]["uploadOperations"]:
            hdr = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
            requests.request(op["method"], op["url"], headers=hdr,
                             data=blob[op["offset"]: op["offset"] + op["length"]]
                             ).raise_for_status()
        patch(f"/v1/inAppPurchaseAppStoreReviewScreenshots/{sid}", {"data": {
            "type": "inAppPurchaseAppStoreReviewScreenshots", "id": sid,
            "attributes": {"uploaded": True,
                           "sourceFileChecksum": hashlib.md5(blob).hexdigest()}}})
        print(f"  {pid} screenshot uploaded ({len(blob)} bytes, md5 committed)")


# ---------------------------------------------------------------- status -----
def cmd_status():
    have = products()
    if not have:
        print("no IAP products exist")
        return
    for suf, pid, _ref, usd in PACKS:
        if pid not in have:
            print(f"{pid}: MISSING")
            continue
        p = have[pid]
        iid = p["id"]
        a = p["attributes"]
        locs = get(f"/v2/inAppPurchases/{iid}/inAppPurchaseLocalizations", limit=50)["data"]
        bad_locs = [l["attributes"]["locale"] for l in locs
                    if l["attributes"].get("state") == "REJECTED"]
        r = requests.get(BASE + f"/v1/inAppPurchasePriceSchedules/{iid}/manualPrices",
                         headers=H(), params={"include": "inAppPurchasePricePoint",
                                              "filter[territory]": "USA"})
        price = "NONE"
        if r.status_code == 200:
            inc = {i["id"]: i for i in r.json().get("included", [])}
            for mp in r.json().get("data", []):
                pp = mp["relationships"]["inAppPurchasePricePoint"]["data"]["id"]
                if pp in inc:
                    price = inc[pp]["attributes"].get("customerPrice")
        rs = requests.get(BASE + f"/v2/inAppPurchases/{iid}/appStoreReviewScreenshot",
                          headers=H())
        shot = "NONE"
        if rs.status_code == 200 and rs.json().get("data"):
            sa = rs.json()["data"]["attributes"]
            shot = (sa.get("assetDeliveryState") or {}).get("state")
        av = requests.get(BASE + f"/v2/inAppPurchases/{iid}/inAppPurchaseAvailability",
                          headers=H())
        avail = "set" if av.status_code == 200 and av.json().get("data") else "NONE"
        print(f"{pid}")
        print(f"  state {a.get('state')} · type {a.get('inAppPurchaseType')} · "
              f"name {a.get('name')!r}")
        print(f"  localizations {len(locs)}/1{' REJECTED:' + ','.join(bad_locs) if bad_locs else ''}"
              f" · price USA {price} (want {usd}) · screenshot {shot} · territories {avail}")


CMDS = {"check": cmd_check, "push": cmd_push, "shots": cmd_shots, "status": cmd_status}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        print(__doc__)
        sys.exit(2)
    CMDS[sys.argv[1]]()
