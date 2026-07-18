"""Build the compact JSON dataset consumed by the docs/ map frontend.

Reads data/boulder_areas.json (produced by scrape_thetopo.py) and
writes docs/data/crags.json: same records, minus the redundant `param_id`
field (already encoded in `url`), lat/lng rounded to 5 decimals (~1m
precision, plenty for this map), and no indentation to keep the payload
small.
"""

import json
from pathlib import Path

SOURCE_PATH = Path(__file__).parent / "data" / "boulder_areas.json"
DEST_PATH = Path(__file__).parent / "docs" / "data" / "crags.json"


def main():
    with open(SOURCE_PATH, "r", encoding="utf-8") as f:
        source = json.load(f)

    crags = []
    for crag in source["crags"]:
        crags.append({
            "name": crag["name"],
            "url": crag["url"],
            "region": crag["region"],
            "region_url": crag["region_url"],
            "country": crag["country"],
            "lat": round(crag["latitude"], 5) if crag["latitude"] is not None else None,
            "lng": round(crag["longitude"], 5) if crag["longitude"] is not None else None,
            "boulder_count": crag["boulder_count"],
            "grades": crag["grades"],
        })

    DEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DEST_PATH, "w", encoding="utf-8") as f:
        json.dump(crags, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = DEST_PATH.stat().st_size / 1024
    print(f"Wrote {len(crags)} crags to {DEST_PATH} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
