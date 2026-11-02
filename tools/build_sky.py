"""Builds data/sky.json (stars and constellation figures) from d3-celestial.

Usage: python tools/build_sky.py RAW_DIR
RAW_DIR must hold stars.6.json, constellations.json and constellations.lines.json
from https://github.com/ofrohn/d3-celestial/tree/master/data (BSD-3-Clause,
(c) 2015 Olaf Frohn). Coordinates are RA/Dec (J2000) in degrees.
"""

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "sky.json"
MAX_MAG = 5.0
# The brighter, better-known figures (d3-celestial ranks 1-2), plus the zodiac,
# Crux and Ursa Minor (for Polaris).
EXTRA = {"Cnc", "Lib", "Cap", "Aqr", "Psc", "Cru", "UMi"}


def ra(x):
    return round(x % 360, 3)


def main(raw):
    raw = Path(raw)
    stars = json.loads((raw / "stars.6.json").read_text())["features"]
    names = {f["id"]: f for f in json.loads((raw / "constellations.json").read_text())["features"]}
    lines = json.loads((raw / "constellations.lines.json").read_text())["features"]

    out_stars = []
    for s in stars:
        mag = s["properties"]["mag"]
        if mag > MAX_MAG:
            continue
        lon, lat = s["geometry"]["coordinates"]
        try:
            bv = round(float(s["properties"]["bv"]), 2)
        except (TypeError, ValueError):
            bv = 0.6
        out_stars.append([ra(lon), round(lat, 3), round(mag, 2), bv])

    out_cons = []
    for f in lines:
        cid = f["id"]
        rank = int(f["properties"]["rank"])
        if rank > 2 and cid not in EXTRA:
            continue
        info = names[cid]
        lon, lat = info["geometry"]["coordinates"]
        out_cons.append({
            "id": cid,
            "name": info["properties"]["name"],
            "rank": rank,
            "label": [ra(lon), round(lat, 2)],
            "lines": [[[ra(x), round(y, 3)] for x, y in seg] for seg in f["geometry"]["coordinates"]],
        })

    OUT.write_text(json.dumps({
        "source": "d3-celestial (Olaf Frohn, BSD-3-Clause); stars to magnitude %.1f" % MAX_MAG,
        "stars": out_stars,
        "constellations": out_cons,
    }, separators=(",", ":"), ensure_ascii=False))
    print(len(out_stars), "stars,", len(out_cons), "constellations")


if __name__ == "__main__":
    main(sys.argv[1])
