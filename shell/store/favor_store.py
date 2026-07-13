#!/usr/bin/env python3
"""App Store submission driver for FAVOR (self-contained JWT; Nation's
asc_store.py pattern). Run with a venv that has pyjwt+cryptography+requests.

  favor_store.py status|metadata|agerating|pricing|availability|reviewdetail
  favor_store.py screenshots <dir> <IPHONE_69|IPAD_PRO_3GEN_129>
  favor_store.py attach <CFBundleVersion>
  favor_store.py submit

App privacy labels are NOT in the public API — set them in the ASC web UI.
"""
import hashlib
import json
import os
import sys
import time

import jwt
import requests

KEY_ID = "9Q9CJ93G2Z"
ISSUER_ID = "69a6de8d-27c4-47e3-e053-5b8c7c11a4d1"
KEY_PATH = os.path.expanduser("~/.appstoreconnect/private/AuthKey_9Q9CJ93G2Z.p8")
BASE = "https://api.appstoreconnect.apple.com"

APP_ID = "6790169069"                                   # FAVOR: Royal Succession
VID = "bce36ab5-b8b5-4a63-98cb-20ba4b56246b"            # appStoreVersion 1.0 (IOS)
INFO_ID = "bd8cacb1-e324-4a34-a613-fa0a88c3811d"        # appInfo
VLOC_ID = "aaa85257-d31b-4535-bcc6-1779496809ba"        # en-US version localization


def token():
    with open(KEY_PATH) as f:
        key = f.read()
    now = int(time.time())
    return jwt.encode({"iss": ISSUER_ID, "iat": now, "exp": now + 1000,
                       "aud": "appstoreconnect-v1"}, key, algorithm="ES256",
                      headers={"kid": KEY_ID, "typ": "JWT"})


def H():
    return {"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}


def get(path, **params):
    r = requests.get(BASE + path, headers=H(), params=params)
    r.raise_for_status()
    return r.json()


def post(path, body):
    r = requests.post(BASE + path, headers=H(), data=json.dumps(body))
    if r.status_code >= 300:
        print(f"POST {path} -> {r.status_code}\n{r.text[:600]}", file=sys.stderr)
    r.raise_for_status()
    return r.json() if r.text.strip() else {"data": {"id": "", "attributes": {}}}


def patch(path, body):
    r = requests.patch(BASE + path, headers=H(), data=json.dumps(body))
    if r.status_code >= 300:
        print(f"PATCH {path} -> {r.status_code}\n{r.text[:600]}", file=sys.stderr)
    r.raise_for_status()
    return r.json() if r.text.strip() else {}


# ---------- listing text ----------

DESCRIPTION = """The King has passed, and his heirs vie for the throne. The Queen will crown whoever wins the most Favor in her eyes — make that heir you.

FAVOR is the digital edition of the Corkscrew Games tabletop card game: a 3–5 player draft-and-pass duel of wits where every card you keep sends the rest into your rivals' hands.

EASY TO PICK UP, WICKED TO MASTER
• Draft a card, pass the hand — what you leave behind arms your rivals
• Play cards for skills and gold, discard for quick coin, or slide your ring to awaken new powers
• Take on the Missions of the Realm before their act closes — glory pays in Favor

TEN HEIRS, TEN GAME PLANS
• The Explorer, the Knight, the Fiddler, the Duchess, the Magician and more — each with their painted character board and its five-slot ring track
• Slide your ring to reshape your skills mid-act; every slot tells a different story
• Rulebook-true difficulty stars and tips for every hero

THREE ACTS. THREE MELEES. ONE CROWN.
• Every act ends in the Melee, where raw Power deals wounds and pays Prestige
• The royal score sheet tallies Missions, Adventures, Artifacts, Prestige, and Scorn — exactly like the table
• The heir with the most Favor takes the throne

A LIVING REALM
• Real multiplayer: pledge at Play Now and get matched with live rivals in moments — the realm fills any empty seats so a game always starts
• Cross the swords of the realm's own court: Lord Ashcroft, Count Balthazar, Lady Vespertine and their kin
• Three leaderboards — All-Time rating, lifetime Power, and Daily bests crowned nightly at 10 PM Eastern
• Earn Stars with every game, unlock new heroes in the Royal Emporium, and wear the crest of your choosing

FAITHFUL TO THE TABLE
Every card, mission, map, and character board matches the printed 1st Edition. The rules are never simplified.

Is fate dealt, or chosen?"""

PROMO = ("Draft cards, complete missions, and win the Queen's Favor. The tabletop card game "
         "of royal succession — live multiplayer, daily crowns, ten heroes to master.")

KEYWORDS = "card,draft,board,strategy,tabletop,royal,queen,mission,multiplayer,family,fantasy,deck"
SUBTITLE = "Draft cards. Win the crown."
SUPPORT_URL = "https://playfavor.net/support.html"
MARKETING_URL = "https://playfavor.net"
PRIVACY_URL = "https://playfavor.net/privacy.html"
COPYRIGHT = "© 2026 Corkscrew Games"

REVIEW_NOTES = """FAVOR is fully playable without any account or sign-in — tap PLAY NOW and a royal guest identity is created automatically on-device. There is nothing to register and nothing to purchase in this version (no in-app purchases; the earnable Stars currency unlocks cosmetic heroes).

This is the official digital edition of our physical card game FAVOR (Corkscrew Games, 1st Edition) — the full game: card drafting, missions, character boards, end-of-act melees, scoring, plus features beyond the table: real-time online multiplayer with live matchmaking, persistent leaderboards (all-time, lifetime power, and daily boards settled nightly), a progression economy of earnable Stars that unlock additional heroes, and player crests.

Multiplayer note for a single reviewer: hitting Play Now pledges you to a match; if no live players are queued within a few seconds, the realm fills the table so a full game ALWAYS starts. Every feature can be exercised alone.

The game requires a network connection (it is a live-service board game with server-backed leaderboards and matchmaking)."""


def cmd_metadata():
    assert len(KEYWORDS) <= 100, f"keywords too long ({len(KEYWORDS)})"
    assert len(SUBTITLE) <= 30, f"subtitle too long ({len(SUBTITLE)})"
    assert len(PROMO) <= 170, f"promo too long ({len(PROMO)})"
    patch(f"/v1/appStoreVersionLocalizations/{VLOC_ID}", {"data": {
        "type": "appStoreVersionLocalizations", "id": VLOC_ID,
        "attributes": {"description": DESCRIPTION, "keywords": KEYWORDS,
                       "promotionalText": PROMO, "supportUrl": SUPPORT_URL,
                       "marketingUrl": MARKETING_URL}}})
    print("version localization: description/keywords/promo/URLs set")

    patch(f"/v1/appStoreVersions/{VID}", {"data": {
        "type": "appStoreVersions", "id": VID,
        "attributes": {"copyright": COPYRIGHT}}})
    print("version: copyright set")

    ilocs = get(f"/v1/appInfos/{INFO_ID}/appInfoLocalizations")["data"]
    iloc = next((l for l in ilocs if l["attributes"].get("locale") == "en-US"), None)
    if iloc is None:
        post("/v1/appInfoLocalizations", {"data": {
            "type": "appInfoLocalizations",
            "attributes": {"locale": "en-US", "subtitle": SUBTITLE, "privacyPolicyUrl": PRIVACY_URL},
            "relationships": {"appInfo": {"data": {"type": "appInfos", "id": INFO_ID}}}}})
        print("appInfo localization: created with subtitle+privacyPolicyUrl")
    else:
        patch(f"/v1/appInfoLocalizations/{iloc['id']}", {"data": {
            "type": "appInfoLocalizations", "id": iloc["id"],
            "attributes": {"subtitle": SUBTITLE, "privacyPolicyUrl": PRIVACY_URL}}})
        print(f"appInfo localization: subtitle+privacy set (name stays '{iloc['attributes'].get('name')}')")

    patch(f"/v1/appInfos/{INFO_ID}", {"data": {
        "type": "appInfos", "id": INFO_ID,
        "relationships": {
            "primaryCategory": {"data": {"type": "appCategories", "id": "GAMES"}},
            "primarySubcategoryOne": {"data": {"type": "appCategories", "id": "GAMES_CARD"}},
            "primarySubcategoryTwo": {"data": {"type": "appCategories", "id": "GAMES_BOARD"}},
        }}})
    print("categories: GAMES / CARD / BOARD")

    patch(f"/v1/apps/{APP_ID}", {"data": {
        "type": "apps", "id": APP_ID,
        "attributes": {"contentRightsDeclaration": "DOES_NOT_USE_THIRD_PARTY_CONTENT"}}})
    print("content rights: DOES_NOT_USE_THIRD_PARTY_CONTENT")


def cmd_agerating():
    d = get(f"/v1/appInfos/{INFO_ID}/ageRatingDeclaration")["data"]
    decl_id, have = d["id"], d["attributes"]
    want = {
        "violenceCartoonOrFantasy": "INFREQUENT_OR_MILD",   # melees, painted swords
        "violenceRealistic": "NONE",
        "violenceRealisticProlongedGraphicOrSadistic": "NONE",
        "profanityOrCrudeHumor": "NONE",
        "matureOrSuggestiveThemes": "NONE",
        "horrorOrFearThemes": "NONE",
        "medicalOrTreatmentInformation": "NONE",
        "alcoholTobaccoOrDrugUseOrReferences": "NONE",
        "gamblingSimulated": "NONE",
        "sexualContentOrNudity": "NONE",
        "sexualContentGraphicAndNudity": "NONE",
        "contests": "NONE",
        "gambling": False,
        "unrestrictedWebAccess": False,
        "lootBox": False,
        "gunsOrOtherWeapons": "INFREQUENT_OR_MILD",         # bows/daggers in card art
        "healthOrWellnessTopics": False,
        "advertising": False,
        "ageAssurance": False,
        "parentalControls": False,
        "messagingAndChat": False,                          # no chat at all
        "userGeneratedContent": False,                      # royal aliases only
    }
    attrs = {k: v for k, v in want.items() if k in have}
    skipped = [k for k in want if k not in have]
    patch(f"/v1/ageRatingDeclarations/{decl_id}", {"data": {
        "type": "ageRatingDeclarations", "id": decl_id, "attributes": attrs}})
    print(f"age rating set ({len(attrs)} axes; skipped unknown: {skipped or 'none'})")


def cmd_pricing():
    pts = get(f"/v1/apps/{APP_ID}/appPricePoints", **{"filter[territory]": "USA", "limit": 1})
    free = pts["data"][0]
    assert free["attributes"]["customerPrice"] == "0.0", f"first price point isn't free: {free['attributes']}"
    post("/v1/appPriceSchedules", {
        "data": {"type": "appPriceSchedules",
                 "relationships": {
                     "app": {"data": {"type": "apps", "id": APP_ID}},
                     "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
                     "manualPrices": {"data": [{"type": "appPrices", "id": "${newprice}"}]}}},
        "included": [{"type": "appPrices", "id": "${newprice}",
                      "attributes": {"startDate": None},
                      "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": free["id"]}}}}],
    })
    print("pricing: FREE (USA base territory)")


def cmd_availability():
    url = "/v1/territories?limit=200"
    d = get(url)
    terrs = [t["id"] for t in d["data"]]
    while d.get("links", {}).get("next"):
        d = get(d["links"]["next"].replace(BASE, ""))
        terrs += [t["id"] for t in d["data"]]
    print(f"{len(terrs)} territories")
    body = {
        "data": {"type": "appAvailabilities",
                 "attributes": {"availableInNewTerritories": True},
                 "relationships": {
                     "app": {"data": {"type": "apps", "id": APP_ID}},
                     "territoryAvailabilities": {"data": [
                         {"type": "territoryAvailabilities", "id": f"${{t{t}}}"} for t in terrs]}}},
        "included": [{"type": "territoryAvailabilities", "id": f"${{t{t}}}",
                      "attributes": {"available": True},
                      "relationships": {"territory": {"data": {"type": "territories", "id": t}}}}
                     for t in terrs],
    }
    r = requests.post(BASE + "/v2/appAvailabilities", headers=H(), data=json.dumps(body))
    if r.status_code >= 300:
        print(f"POST /v2/appAvailabilities -> {r.status_code}\n{r.text[:500]}", file=sys.stderr)
    r.raise_for_status()
    print("availability: all territories, auto-available in new ones")


def cmd_reviewdetail():
    attrs = {"contactFirstName": "Wyatt", "contactLastName": "Gable",
             "contactPhone": "+1 845-587-8219", "contactEmail": "gablewyatt@gmail.com",
             "demoAccountRequired": False, "notes": REVIEW_NOTES}
    try:
        existing = get(f"/v1/appStoreVersions/{VID}/appStoreReviewDetail")["data"]
    except Exception:
        existing = None
    if existing:
        patch(f"/v1/appStoreReviewDetails/{existing['id']}", {"data": {
            "type": "appStoreReviewDetails", "id": existing["id"], "attributes": attrs}})
        print("review detail: updated")
    else:
        post("/v1/appStoreReviewDetails", {"data": {
            "type": "appStoreReviewDetails", "attributes": attrs,
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": VID}}}}})
        print("review detail: created")


DISPLAY_TYPES = {"IPHONE_69": "APP_IPHONE_67", "IPAD_PRO_3GEN_129": "APP_IPAD_PRO_3GEN_129"}


def cmd_screenshots():
    src_dir, kind = sys.argv[2], sys.argv[3]
    display_type = DISPLAY_TYPES[kind]
    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".png"))
    assert files, f"no PNGs in {src_dir}"

    sets = get(f"/v1/appStoreVersionLocalizations/{VLOC_ID}/appScreenshotSets")["data"]
    sset = next((s for s in sets if s["attributes"]["screenshotDisplayType"] == display_type), None)
    if sset is None:
        sset = post("/v1/appScreenshotSets", {"data": {
            "type": "appScreenshotSets",
            "attributes": {"screenshotDisplayType": display_type},
            "relationships": {"appStoreVersionLocalization": {
                "data": {"type": "appStoreVersionLocalizations", "id": VLOC_ID}}}}})["data"]
        print(f"created set {display_type}")
    set_id = sset["id"]

    existing = get(f"/v1/appScreenshotSets/{set_id}/appScreenshots", limit=50)["data"]
    have = {s["attributes"].get("fileName") for s in existing}
    for fn in files:
        if fn in have:
            print(f"  {fn}: already uploaded, skipping"); continue
        blob = open(os.path.join(src_dir, fn), "rb").read()
        shot = post("/v1/appScreenshots", {"data": {
            "type": "appScreenshots",
            "attributes": {"fileName": fn, "fileSize": len(blob)},
            "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
        for op in shot["attributes"]["uploadOperations"]:
            headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
            chunk = blob[op["offset"]: op["offset"] + op["length"]]
            r = requests.request(op["method"], op["url"], headers=headers, data=chunk)
            r.raise_for_status()
        patch(f"/v1/appScreenshots/{shot['id']}", {"data": {
            "type": "appScreenshots", "id": shot["id"],
            "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(blob).hexdigest()}}})
        print(f"  {fn}: uploaded + committed ({len(blob)//1024} KB)")
    print(f"screenshots done for {display_type}")


def cmd_attach():
    want_ver = sys.argv[2]
    d = get("/v1/builds", **{"filter[app]": APP_ID, "filter[version]": want_ver, "limit": 1})
    assert d["data"], f"no build with CFBundleVersion {want_ver}"
    b = d["data"][0]
    assert b["attributes"]["processingState"] == "VALID", f"build {want_ver} is {b['attributes']['processingState']}"
    patch(f"/v1/appStoreVersions/{VID}/relationships/build", {"data": {"type": "builds", "id": b["id"]}})
    print(f"attached build v{want_ver} ({b['id']}) to version 1.0")


def cmd_submit():
    subs = get("/v1/reviewSubmissions", **{"filter[app]": APP_ID, "filter[state]": "READY_FOR_REVIEW", "limit": 5})
    open_subs = [s for s in subs["data"]]
    if open_subs:
        sub = open_subs[0]
        print(f"reusing open submission {sub['id']} state={sub['attributes']['state']}")
    else:
        sub = post("/v1/reviewSubmissions", {"data": {
            "type": "reviewSubmissions",
            "attributes": {"platform": "IOS"},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}})["data"]
        print(f"created review submission {sub['id']}")
    items = get(f"/v1/reviewSubmissions/{sub['id']}/items", limit=10)["data"]
    if not items:
        post("/v1/reviewSubmissionItems", {"data": {
            "type": "reviewSubmissionItems",
            "relationships": {
                "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                "appStoreVersion": {"data": {"type": "appStoreVersions", "id": VID}}}}})
        print("added version 1.0 to the submission")
    else:
        print(f"submission already has {len(items)} item(s)")
    patch(f"/v1/reviewSubmissions/{sub['id']}", {"data": {
        "type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})
    print("SUBMITTED for App Review")


def cmd_status():
    v = get(f"/v1/appStoreVersions/{VID}", include="build")["data"]
    print("version 1.0 state:", v["attributes"]["appStoreState"], "| releaseType:", v["attributes"]["releaseType"])
    rel = v.get("relationships", {}).get("build", {}).get("data")
    print("attached build:", rel["id"] if rel else None)
    loc = get(f"/v1/appStoreVersionLocalizations/{VLOC_ID}")["data"]["attributes"]
    print("desc len:", len(loc.get("description") or ""), "| keywords:", bool(loc.get("keywords")),
          "| support:", loc.get("supportUrl"))
    sets = get(f"/v1/appStoreVersionLocalizations/{VLOC_ID}/appScreenshotSets", include="appScreenshots")["data"]
    for s in sets:
        print("shots:", s["attributes"]["screenshotDisplayType"],
              len(s.get("relationships", {}).get("appScreenshots", {}).get("data", [])))
    try:
        rd = get(f"/v1/appStoreVersions/{VID}/appStoreReviewDetail")["data"]
        print("review detail:", "present" if rd else "missing")
    except Exception:
        print("review detail: missing")
    subs = get("/v1/reviewSubmissions", **{"filter[app]": APP_ID, "limit": 5})
    for s in subs["data"]:
        print("submission:", s["id"], s["attributes"].get("state"))


if __name__ == "__main__":
    globals()[f"cmd_{sys.argv[1]}"]()
