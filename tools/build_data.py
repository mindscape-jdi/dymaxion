"""Builds the transport layers in data/ from public sources.

Usage:
    pip install searoute
    python tools/build_data.py RAW_DIR

RAW_DIR must contain the OpenFlights files airports.dat and routes.dat
(https://github.com/jpatokal/openflights). Railways are built separately with
tools/build_rail.sh.

Outputs:
    data/shipping.json  container shipping lanes, traced over Eurostat's
                        maritime network (via the searoute package) between
                        the world's biggest container ports
    data/flights.json   the busiest direct airport pairs from OpenFlights
"""

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import searoute

OUT = Path(__file__).resolve().parent.parent / "data"

# Major container ports (lon, lat), roughly the top of the world TEU rankings
# plus regional hubs so that every main trade lane is represented.
PORTS = {
    "Shanghai": (122.07, 30.63),
    "Ningbo": (121.85, 29.93),
    "Shenzhen": (113.88, 22.48),
    "Guangzhou": (113.6, 22.65),
    "Qingdao": (120.3, 36.0),
    "Tianjin": (117.8, 38.98),
    "Xiamen": (118.07, 24.45),
    "Hong Kong": (114.13, 22.33),
    "Busan": (128.83, 35.08),
    "Kaohsiung": (120.27, 22.6),
    "Yokohama": (139.67, 35.45),
    "Singapore": (103.8, 1.26),
    "Port Klang": (101.3, 3.0),
    "Tanjung Pelepas": (103.55, 1.36),
    "Laem Chabang": (100.88, 13.08),
    "Cai Mep": (107.03, 10.53),
    "Jakarta": (106.88, -6.1),
    "Colombo": (79.85, 6.95),
    "Mundra": (69.7, 22.73),
    "Jebel Ali": (55.03, 25.0),
    "Salalah": (54.0, 16.95),
    "Jeddah": (39.15, 21.47),
    "Port Said": (32.3, 31.25),
    "Piraeus": (23.6, 37.93),
    "Valencia": (-0.32, 39.44),
    "Algeciras": (-5.43, 36.13),
    "Tanger Med": (-5.5, 35.88),
    "Rotterdam": (4.05, 51.95),
    "Antwerp": (4.3, 51.27),
    "Hamburg": (9.93, 53.53),
    "Felixstowe": (1.32, 51.95),
    "Lagos": (3.37, 6.43),
    "Durban": (31.03, -29.87),
    "Santos": (-46.3, -23.97),
    "Colon": (-79.9, 9.37),
    "Cartagena": (-75.53, 10.4),
    "New York": (-74.13, 40.67),
    "Savannah": (-81.1, 32.08),
    "Los Angeles": (-118.27, 33.73),
    "Vancouver": (-123.1, 49.29),
    "Manzanillo": (-104.32, 19.07),
    "Melbourne": (144.92, -37.83),
    "Sydney": (151.2, -33.97),
}

# Main container trade lanes as port-to-port legs.
LANES = [
    # Asia - North Europe (via Malacca and Suez)
    ["Shanghai", "Ningbo", "Xiamen", "Hong Kong", "Shenzhen", "Singapore", "Colombo",
     "Port Said", "Algeciras", "Rotterdam", "Hamburg"],
    ["Busan", "Qingdao", "Shanghai"],
    ["Tianjin", "Qingdao"],
    ["Tanjung Pelepas", "Jebel Ali"],
    ["Port Said", "Tanger Med", "Felixstowe", "Antwerp", "Rotterdam"],
    # Asia - Mediterranean
    ["Port Said", "Piraeus", "Valencia", "Algeciras"],
    # Transpacific
    ["Shanghai", "Los Angeles"], ["Ningbo", "Los Angeles"], ["Yokohama", "Los Angeles"],
    ["Busan", "Vancouver"], ["Kaohsiung", "Los Angeles"], ["Hong Kong", "Kaohsiung"],
    ["Shenzhen", "Los Angeles"], ["Busan", "Manzanillo"],
    # Asia - US East Coast via Panama
    ["Shanghai", "Colon", "Savannah", "New York"],
    ["Busan", "Colon"],
    # Transatlantic
    ["Rotterdam", "New York"], ["Hamburg", "Savannah"], ["Antwerp", "New York"],
    ["Felixstowe", "Savannah"], ["Algeciras", "New York"], ["Valencia", "New York"],
    # Asia - Middle East / South Asia
    ["Singapore", "Port Klang", "Mundra", "Jebel Ali"],
    ["Shanghai", "Singapore"], ["Port Klang", "Colombo", "Salalah", "Jeddah", "Port Said"],
    # Intra-Asia
    ["Shanghai", "Busan", "Yokohama"], ["Singapore", "Laem Chabang"],
    ["Singapore", "Cai Mep", "Hong Kong"], ["Singapore", "Jakarta"], ["Guangzhou", "Hong Kong"],
    # Oceania
    ["Singapore", "Melbourne", "Sydney"], ["Shanghai", "Sydney"],
    # Africa
    ["Singapore", "Durban", "Santos"], ["Rotterdam", "Lagos", "Durban"],
    ["Algeciras", "Lagos"], ["Jebel Ali", "Durban"],
    # Latin America
    ["Rotterdam", "Santos"], ["Colon", "Cartagena", "Rotterdam"], ["Savannah", "Santos"],
    ["Manzanillo", "Colon"], ["Los Angeles", "Manzanillo"],
]


def rnd(c):
    return (round(c[0], 2), round(c[1], 2))


def build_shipping():
    usage = Counter()
    seen = set()
    for lane in LANES:
        for a, b in zip(lane, lane[1:]):
            if (a, b) in seen or (b, a) in seen:
                continue
            seen.add((a, b))
            route = searoute.searoute(list(PORTS[a]), list(PORTS[b]), units="km")
            coords = [rnd(c) for c in route["geometry"]["coordinates"]]
            for p, q in zip(coords, coords[1:]):
                if p != q:
                    usage[tuple(sorted((p, q)))] += 1

    # Join segments of the same traffic class into polylines.
    bins = defaultdict(list)
    for seg, n in usage.items():
        bins[1 if n == 1 else 2 if n <= 3 else 3].append(seg)
    lines = {}
    for cls, segs in bins.items():
        lines[cls] = join_segments(segs)

    ports = [[name, *xy] for name, xy in PORTS.items()]
    out = {
        "source": "Lanes traced with searoute (Eurostat MARNET network) between major container ports",
        "ports": ports,
        "lanes": {str(k): v for k, v in sorted(lines.items())},
    }
    write("shipping.json", out)
    print("shipping:", {k: len(v) for k, v in lines.items()}, "polylines")


def join_segments(segs):
    adj = defaultdict(list)
    for p, q in segs:
        adj[p].append(q)
        adj[q].append(p)
    used = set()
    lines = []

    def key(p, q):
        return (p, q) if p <= q else (q, p)

    # Start at endpoints and junctions first, then sweep remaining loops.
    starts = [p for p in adj if len(adj[p]) != 2] + list(adj)
    for s in starts:
        for n in adj[s]:
            if key(s, n) in used:
                continue
            line = [s, n]
            used.add(key(s, n))
            cur, prev = n, s
            while len(adj[cur]) == 2:
                nxt = adj[cur][0] if adj[cur][1] == prev else adj[cur][1]
                if key(cur, nxt) in used:
                    break
                used.add(key(cur, nxt))
                line.append(nxt)
                prev, cur = cur, nxt
            lines.append([list(p) for p in line])
    return lines


def build_flights(raw, top=2500):
    airports = {}
    with open(raw / "airports.dat", newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            iata = row[4]
            if len(iata) == 3:
                airports[iata] = (round(float(row[7]), 3), round(float(row[6]), 3), row[2])

    airlines = defaultdict(set)
    with open(raw / "routes.dat", newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            src, dst, stops = row[2], row[4], row[7]
            if stops != "0" or src not in airports or dst not in airports or src == dst:
                continue
            airlines[tuple(sorted((src, dst)))].add(row[0])

    degree = Counter()
    for (a, b) in airlines:
        degree[a] += 1
        degree[b] += 1

    ranked = sorted(airlines, key=lambda p: (-len(airlines[p]), -(degree[p[0]] + degree[p[1]])))[:top]
    codes = sorted({c for p in ranked for c in p})
    index = {c: i for i, c in enumerate(codes)}
    out = {
        "source": "OpenFlights route database (2014), busiest direct airport pairs by number of airlines",
        "airports": [[c, airports[c][0], airports[c][1], airports[c][2]] for c in codes],
        "routes": [[index[a], index[b], len(airlines[(a, b)])] for a, b in ranked],
    }
    write("flights.json", out)
    print("flights:", len(ranked), "routes,", len(codes), "airports")


def write(name, obj):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":")))


if __name__ == "__main__":
    raw = Path(sys.argv[1])
    build_shipping()
    build_flights(raw)
