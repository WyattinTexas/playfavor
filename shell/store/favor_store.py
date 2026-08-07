#!/usr/bin/env python3
"""App Store submission driver for FAVOR (self-contained JWT; Nation's
asc_store.py pattern). Run with a venv that has pyjwt+cryptography+requests.

  favor_store.py newversion <version>     open the next version + release notes
  favor_store.py status|metadata|agerating|pricing|availability|reviewdetail
  favor_store.py screenshots <dir> <IPHONE_69|IPAD_PRO_3GEN_129>
  favor_store.py attach <CFBundleVersion>
  favor_store.py submit

Every command but `newversion` targets whichever version ASC still lets us
edit — resolved at startup, never pinned. A released version is immutable, so
shipping an update always starts with `newversion`.

  Shipping 1.1:  newversion 1.1 && metadata && attach 20 && status && submit

App privacy labels are NOT in the public API — set them in the ASC web UI.
Needs ~/.appstoreconnect/private/AuthKey_9Q9CJ93G2Z.p8 (not in this repo).
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
INFO_ID = "bd8cacb1-e324-4a34-a613-fa0a88c3811d"        # appInfo of the LIVE version


def editable_info_id():
    """The appInfo ASC will accept edits to. Once a released app has an open
    version, ASC keeps TWO appInfos: the sealed READY_FOR_SALE one (INFO_ID)
    and an editable PREPARE_FOR_SUBMISSION twin. PATCHing the sealed one 409s
    INVALID_STATE (measured 8/7), so name/subtitle edits must aim at the twin."""
    infos = get(f"/v1/apps/{APP_ID}/appInfos")["data"]
    open_infos = [i for i in infos
                  if i["attributes"].get("appStoreState") not in SEALED_STATES]
    return open_infos[0]["id"] if open_infos else INFO_ID

# VID/VLOC_ID are RESOLVED AT STARTUP now, not pinned. They used to name the
# 1.0 records by hand; 1.0 went READY_FOR_SALE on 7/21, and a released version
# is immutable — every command was aimed at a record Apple will never accept
# another edit to. `newversion` opens the next one; everything else finds it.
VID = None          # the appStoreVersion being edited
VLOC_ID = None      # its en-US localization

# States in which Apple treats a version as final — nothing about it changes.
SEALED_STATES = {"READY_FOR_SALE", "REPLACED_BY_NEW_VERSION",
                 "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"}


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


def resolve_targets():
    """The version ASC will still let us edit, and its en-US localization."""
    # /v1/appStoreVersions?filter[app] started returning 403 FORBIDDEN_ERROR
    # (measured 8/7); the app-scoped relationship route is the one that works.
    vs = get(f"/v1/apps/{APP_ID}/appStoreVersions", limit=50)["data"]
    openv = [v for v in vs if v["attributes"]["appStoreState"] not in SEALED_STATES]
    if not openv:
        live = ", ".join(sorted(v["attributes"]["versionString"] for v in vs)) or "?"
        sys.exit(f"No editable version (live and sealed: {live}).\n"
                 f"Open the next one first:  favor_store.py newversion <version>")
    v = openv[0]
    locs = get(f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations")["data"]
    loc = next((l for l in locs if l["attributes"].get("locale") == "en-US"), None)
    if loc is None:
        sys.exit(f"version {v['attributes']['versionString']} has no en-US localization — "
                 f"run:  favor_store.py newversion {v['attributes']['versionString']}")
    print(f"→ editing version {v['attributes']['versionString']} "
          f"({v['attributes']['appStoreState']})")
    return v["id"], loc["id"], v["attributes"]["versionString"]


def cmd_newversion():
    """Open the next App Store version and give it its release notes."""
    ver = sys.argv[2]
    vs = get(f"/v1/apps/{APP_ID}/appStoreVersions", limit=50)["data"]
    ex = next((v for v in vs if v["attributes"]["versionString"] == ver), None)
    if ex:
        v_id = ex["id"]
        print(f"version {ver} already exists ({v_id}, {ex['attributes']['appStoreState']})")
    else:
        v_id = post("/v1/appStoreVersions", {"data": {
            "type": "appStoreVersions",
            "attributes": {"platform": "IOS", "versionString": ver,
                           "releaseType": "AFTER_APPROVAL"},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}})["data"]["id"]
        print(f"created version {ver} ({v_id})")
    locs = get(f"/v1/appStoreVersions/{v_id}/appStoreVersionLocalizations")["data"]
    loc = next((l for l in locs if l["attributes"].get("locale") == "en-US"), None)
    if loc is None:
        post("/v1/appStoreVersionLocalizations", {"data": {
            "type": "appStoreVersionLocalizations",
            "attributes": {"locale": "en-US", "whatsNew": WHATS_NEW},
            "relationships": {"appStoreVersion": {
                "data": {"type": "appStoreVersions", "id": v_id}}}}})
        print("created en-US localization with release notes")
    else:
        patch(f"/v1/appStoreVersionLocalizations/{loc['id']}", {"data": {
            "type": "appStoreVersionLocalizations", "id": loc["id"],
            "attributes": {"whatsNew": WHATS_NEW}}})
        print("release notes set")
    print(f"\nNext:  favor_store.py metadata"
          f"\n       favor_store.py attach <CFBundleVersion>"
          f"\n       favor_store.py status      # read it before submitting"
          f"\n       favor_store.py submit")


# ---------- listing text ----------

# Rewritten 8/7 per store feedback (robotic, dash heavy, read like AI): zero
# em-dashes, no bullet scaffolds, prose first. Every claim re-verified against
# the live game 8/7 — the old copy named court AIs that don't exist under those
# spellings (game: Lord Ashcropt, The Lady Vespurine; Skirmish/Rival ONLY),
# said "Three leaderboards" (the game shows four tabs), "five-slot ring" (slot
# counts vary), and "pledge at Play Now" (the button says Play).
DESCRIPTION = """FAVOR is a card game of royal scheming for 3 to 5 players, brought to your phone straight from the Corkscrew Games table. The whole game turns on one wicked rule: draft a card, then pass your hand to the player beside you. What you keep makes you stronger. What you pass might crown your neighbor instead.

The King has passed. The Queen will hand the throne to whichever heir wins the most Favor in her eyes, and she is not sentimental. Make her choose you.

Tap Play and you're at a live table in moments. Pick a table of 3, 4, or 5. If the realm runs short of rivals, courtiers take the empty chairs, so a game always starts. Host a Private Game for your friends, or slip into a Skirmish and try your luck against the court's own schemers: Count Balthazar, Dame Rosalind, Lord Cassius and their kin.

The cards do exactly what the printed ones do. Endeavors grow your skills. Weapons bank Power for the Melee that ends every act. Artifacts and Adventures pay Favor. Potions go off the moment you throw them. Missions hang over the table, daring you to finish them before the act closes. After three acts and three Melees the court tallies everything, Scorn included, and the heir with the most Favor takes the throne.

No two heirs play alike. The Duchess, the Bandit, the Fisherman, the Magician: ten heroes in all, each with a painted character board and a sliding ring that lets you rewire your skills in the middle of an act. Every finished game pays Stars, and Stars unlock new heroes in the Royal Emporium.

The realm keeps its own calendar. A new rival's face goes up on the WANTED plaque each day; finish ahead of them and the bounty is yours. Daily Champions are crowned at 10 PM Eastern. And once a night the Throne Room opens to the whole realm at once, with a board all its own for anyone standing in the hall when the doors bar.

It is all the real game. Every card, mission, and character board matches the printed 1st Edition, and the rules are never simplified. New to FAVOR? Your first game teaches you at the table, turn by turn, the way a friend would.

Take your seat. The court is waiting."""

PROMO = ("Every card you keep makes you stronger. Every card you pass arms a rival. "
         "FAVOR is the tabletop game of royal succession, live on your phone. "
         "The Queen is watching.")

# 1.1's release notes. Only NATIVE changes belong here — the realm itself is
# web and reaches every phone the moment it deploys, so features that shipped
# to playfavor.net after 1.0 are already in players' hands and are not news.
# ⚠ The Royal Mint line is only true if the 4 star IAPs ride 1.1's review —
# if they slip to a later version, delete that paragraph before submitting.
WHATS_NEW = """Sign in with Apple has arrived. Seal your court to your Apple ID and your heroes, your rating, and your Stars follow you to any device.

Your account now lives in the Keychain, so deleting and reinstalling FAVOR no longer strands a thing.

The Court Seal is back on the standing screen. Copy it on one phone, paste it on another, and take your seat there.

And the Royal Mint now takes Apple. Pouches of Stars, straight from the store."""

KEYWORDS = "card,draft,board,strategy,tabletop,royal,queen,mission,multiplayer,family,fantasy,deck"
SUBTITLE = "Draft cards. Win the crown."
SUPPORT_URL = "https://playfavor.net/support.html"
MARKETING_URL = "https://playfavor.net"
PRIVACY_URL = "https://playfavor.net/privacy.html"
COPYRIGHT = "© 2026 Corkscrew Games"

# ⚠ The Purchases paragraph assumes the 4 star IAPs ride this version's
# review — if they slip to a later version, restore the old "nothing to
# purchase (no in-app purchases)" wording before submitting.
REVIEW_NOTES = """FAVOR is fully playable without any account or sign-in: tap Play and a royal guest identity is created automatically on-device. Sign in with Apple is offered and optional.

This is the official digital edition of our physical card game FAVOR (Corkscrew Games, 1st Edition): the full game (card drafting, missions, character boards, end-of-act melees, scoring) plus features beyond the table: real-time online multiplayer with live matchmaking, persistent leaderboards (all-time rating, daily boards settled nightly, top scores, and Throne night results), a daily WANTED rival, a nightly Throne Room event, and a progression economy of earnable Stars that unlock additional heroes.

Purchases: this version adds four optional consumable Star bundles (50, 100, 500, and 1000 Stars). Stars are also earned by finishing any game; nothing is locked behind payment.

Multiplayer note for a single reviewer: tapping Play pledges you to a match; if no live players are queued within a few seconds, the realm fills the table so a full game ALWAYS starts. Every feature can be exercised alone.

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

    info_id = editable_info_id()
    ilocs = get(f"/v1/appInfos/{info_id}/appInfoLocalizations")["data"]
    iloc = next((l for l in ilocs if l["attributes"].get("locale") == "en-US"), None)
    if iloc is None:
        post("/v1/appInfoLocalizations", {"data": {
            "type": "appInfoLocalizations",
            "attributes": {"locale": "en-US", "subtitle": SUBTITLE, "privacyPolicyUrl": PRIVACY_URL},
            "relationships": {"appInfo": {"data": {"type": "appInfos", "id": info_id}}}}})
        print("appInfo localization: created with subtitle+privacyPolicyUrl")
    else:
        patch(f"/v1/appInfoLocalizations/{iloc['id']}", {"data": {
            "type": "appInfoLocalizations", "id": iloc["id"],
            "attributes": {"subtitle": SUBTITLE, "privacyPolicyUrl": PRIVACY_URL}}})
        print(f"appInfo localization: subtitle+privacy set (name stays '{iloc['attributes'].get('name')}')")

    patch(f"/v1/appInfos/{info_id}", {"data": {
        "type": "appInfos", "id": info_id,
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
    d = get(f"/v1/appInfos/{editable_info_id()}/ageRatingDeclaration")["data"]
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
    print(f"attached build v{want_ver} ({b['id']}) to version {VER_STR}")


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
        print(f"added version {VER_STR} to the submission")
    else:
        print(f"submission already has {len(items)} item(s)")
    patch(f"/v1/reviewSubmissions/{sub['id']}", {"data": {
        "type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})
    print("SUBMITTED for App Review")


def cmd_status():
    v = get(f"/v1/appStoreVersions/{VID}", include="build")["data"]
    print(f"version {VER_STR} state:", v["attributes"]["appStoreState"], "| releaseType:", v["attributes"]["releaseType"])
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
    cmd = sys.argv[1]
    # newversion is the one command that runs BEFORE an editable version
    # exists — everything else resolves the open version first.
    if cmd != "newversion":
        VID, VLOC_ID, VER_STR = resolve_targets()
    globals()[f"cmd_{cmd}"]()
