#!/usr/bin/env python3
"""Attach a processed build to FAVOR's TestFlight groups (internal +
external) — the explicit one-line step every new build needs.

  tf_attach.py <CFBundleVersion>      e.g. tf_attach.py 2

Waits for the build to finish PROCESSING (polls up to ~25 min), then
POSTs it onto every beta group. Idempotent — re-attaching is a no-op.
Run with the same venv favor_store.py uses (pyjwt+cryptography+requests).
"""
import sys
import time

from favor_store import APP_ID, get, post

want = sys.argv[1] if len(sys.argv) > 1 else "2"

build = None
for i in range(50):                       # ~25 min of patience
    d = get("/v1/builds", **{"filter[app]": APP_ID, "filter[version]": want,
                             "sort": "-uploadedDate", "limit": 1})
    if d["data"]:
        b = d["data"][0]
        state = b["attributes"]["processingState"]
        print(f"build {want}: {state}")
        if state == "VALID":
            build = b
            break
        if state in ("FAILED", "INVALID"):
            sys.exit(f"build {want} landed {state} — see App Store Connect")
    else:
        print(f"build {want}: not visible yet")
    time.sleep(30)

if not build:
    sys.exit(f"build {want} never finished processing — check ASC")

groups = get("/v1/betaGroups", **{"filter[app]": APP_ID, "limit": 50})["data"]
for g in groups:
    name = g["attributes"]["name"]
    if g["attributes"].get("isInternalGroup"):
        # Internal groups receive every build automatically — ASC 422s an
        # explicit assign ("Builds cannot be assigned to this internal group").
        print(f"skipped internal group '{name}' (gets builds automatically)")
        continue
    post(f"/v1/betaGroups/{g['id']}/relationships/builds",
         {"data": [{"type": "builds", "id": build["id"]}]})
    print(f"attached build {want} -> group '{name}'")

# Attaching alone is NOT enough: without a betaAppReviewSubmission the build
# sits READY_FOR_BETA_SUBMISSION forever and external testers never see it
# (build 2 taught us, 7/17). Subsequent builds of an approved app clear
# instantly — the POST flips them straight to IN_BETA_TESTING.
detail = get(f"/v1/builds/{build['id']}/buildBetaDetail")["data"]
state = detail["attributes"]["externalBuildState"]
if state == "READY_FOR_BETA_SUBMISSION":
    try:
        post("/v1/betaAppReviewSubmissions",
             {"data": {"type": "betaAppReviewSubmissions",
                       "relationships": {"build": {"data": {"type": "builds", "id": build["id"]}}}}})
        state = get(f"/v1/builds/{build['id']}/buildBetaDetail")["data"]["attributes"]["externalBuildState"]
        print(f"beta review submitted -> externalBuildState {state}")
    except Exception as e:
        # One build per train may sit in review (b18 blocked b19, 7/21).
        # The attach above already stuck; re-run this script once the
        # earlier build clears and the submission goes through.
        if "ANOTHER_BUILD_IN_REVIEW" in str(getattr(getattr(e, "response", None), "text", "")):
            print(f"beta review NOT submitted — another build in this train is "
                  f"already in review. Re-run `tf_attach.py {want}` once it clears.")
        else:
            raise
else:
    print(f"externalBuildState already {state}")

print("DONE — public link: https://testflight.apple.com/join/7CpFEaAN")
