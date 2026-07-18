"""Scrape Font-grade distributions for bouldering areas worldwide from thetopo.com.

Only boulder data is collected: crags with boulder_count == 0 are skipped, and
only the "Boulder" bucket of each crag's route_counts histogram is decoded.
Sport/Trad/DWS routes are never included in the output.

Data source: each region page (/areas/{param_id}) embeds a "Mapbox" React
component whose `crags` field lists every crag in that region (id, name,
param_id, lat/lng, boulder_count, route_counts, ...). This means we only need
one request per region (~691 worldwide) instead of one per crag (~18k+).

The crag numeric-code grade histogram encoding was reverse engineered and
verified against a real crag's route list: code 0 = ungraded, and
code = 100 + 50*i maps to FONT_SEQUENCE[i] (see decode_grade below).

Usage:
    python scrape_thetopo.py            # full run (resumable)
    python scrape_thetopo.py --limit 5  # only process first 5 areas (smoke test)
"""

import argparse
import json
import random
import re
import sys
import time
from pathlib import Path

import requests

# Windows consoles default to a codepage (e.g. cp1252) that can't encode many
# area/crag names (Croatian, Greek, etc.) -- avoid crashing mid-scrape on print().
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "https://thetopo.com"
OUTPUT_PATH = Path(__file__).parent / "data" / "boulder_areas.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
MIN_DELAY_SECONDS = 3.0
MAX_DELAY_SECONDS = 6.0
REQUEST_TIMEOUT = 20
MAX_RETRIES = 3

# code 0 is a reserved "ungraded" sentinel, handled separately below.
FONT_SEQUENCE = [
    "3", "3+", "4", "4+", "5", "5+",
    "6A", "6A+", "6B", "6B+", "6C", "6C+",
    "7A", "7A+", "7B", "7B+", "7C", "7C+",
    "8A", "8A+", "8B", "8B+", "8C", "8C+",
    "9A", "9A+", "9B", "9B+", "9C",
]

NAV_SCRIPT_RE = re.compile(
    r'<script[^>]*data-component-name="Nav"[^>]*>(.*?)</script>', re.DOTALL
)
MAPBOX_SCRIPT_RE = re.compile(
    r'<script[^>]*data-component-name="Mapbox"[^>]*>(.*?)</script>', re.DOTALL
)


def make_session():
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
    })
    return session


def fetch(session, url):
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(2 * attempt)
            continue
        if resp.status_code == 200:
            return resp.text
        if resp.status_code in (429, 500, 502, 503, 504):
            last_error = f"HTTP {resp.status_code}"
            time.sleep(5 * attempt)
            continue
        raise RuntimeError(f"Unexpected status {resp.status_code} for {url}")
    raise RuntimeError(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {last_error}")


def polite_sleep():
    time.sleep(random.uniform(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS))


def decode_grade(code_str):
    # Verified against real crag route lists (route.grade strings vs.
    # route_counts codes) on two crags. Standard codes are 100 + 50*i, but
    # some crags also have odd in-between codes (e.g. 370, 380, 275) that
    # represent finer-grained assessed grades; they fall into the same
    # label as the standard code below them (floor division), e.g. 370/380
    # both collapse into the same bucket as 350 ("5+").
    code = int(code_str)
    if code == 0:
        return "ungraded"
    offset = code - 100
    if offset < 0:
        return f"unknown_code_{code}"
    index = offset // 50
    if index < len(FONT_SEQUENCE):
        return FONT_SEQUENCE[index]
    return f"unknown_code_{code}"


def get_all_areas(session):
    html = fetch(session, BASE_URL + "/")
    match = NAV_SCRIPT_RE.search(html)
    if not match:
        raise RuntimeError("Could not find Nav component on homepage")
    nav_data = json.loads(match.group(1))
    return nav_data["areas"]


def extract_area_crags(html):
    match = MAPBOX_SCRIPT_RE.search(html)
    if not match:
        return []
    mapbox_data = json.loads(match.group(1))
    crags_raw = mapbox_data.get("crags")
    if not crags_raw:
        return []
    parsed = json.loads(crags_raw) if isinstance(crags_raw, str) else crags_raw
    return parsed.get("crags", [])


def build_crag_record(crag, region_name, region_param_id, country):
    boulder_counts = crag.get("route_counts", {}).get("Boulder", {})
    grades = {}
    for code_str, count in boulder_counts.items():
        label = decode_grade(code_str)
        grades[label] = grades.get(label, 0) + count
    return {
        "name": crag["name"],
        "param_id": crag["param_id"],
        "url": f"{BASE_URL}/crags/{crag['param_id']}",
        "region": region_name,
        "region_url": f"{BASE_URL}/areas/{region_param_id}",
        "country": country,
        "latitude": float(crag["latitude"]) if crag.get("latitude") else None,
        "longitude": float(crag["longitude"]) if crag.get("longitude") else None,
        "boulder_count": crag["boulder_count"],
        "grades": grades,
    }


def load_output():
    if OUTPUT_PATH.exists():
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"scraped_area_param_ids": [], "crags": []}


def save_output(data):
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = OUTPUT_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(OUTPUT_PATH)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Only process the first N areas (for smoke testing).",
    )
    args = parser.parse_args()

    session = make_session()
    output = load_output()
    already_done = set(output["scraped_area_param_ids"])

    print("Fetching global area list...")
    areas = get_all_areas(session)
    print(f"Found {len(areas)} areas worldwide.")

    if args.limit is not None:
        areas = areas[: args.limit]

    todo = [a for a in areas if a["param_id"] not in already_done]
    print(f"{len(todo)} areas left to scrape ({len(already_done)} already done).")

    existing_param_ids = {c["param_id"] for c in output["crags"]}

    for i, area in enumerate(todo, 1):
        param_id = area["param_id"]
        country = area["country"]
        region_name = area["name"]
        url = f"{BASE_URL}/areas/{param_id}"
        print(f"[{i}/{len(todo)}] {region_name} ({country}) -> {url}")

        try:
            html = fetch(session, url)
            crags = extract_area_crags(html)
        except Exception as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            polite_sleep()
            continue

        new_count = 0
        for crag in crags:
            if crag.get("boulder_count", 0) <= 0:
                continue
            if crag["param_id"] in existing_param_ids:
                continue
            record = build_crag_record(crag, region_name, param_id, country)
            output["crags"].append(record)
            existing_param_ids.add(crag["param_id"])
            new_count += 1

        output["scraped_area_param_ids"].append(param_id)
        save_output(output)
        print(f"  +{new_count} boulder crags (total so far: {len(output['crags'])})")

        polite_sleep()

    print(f"Done. {len(output['crags'])} boulder crags saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
