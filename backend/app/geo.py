"""Chainage along a work's alignment. Local flat projection is accurate to a few metres at district scale."""
import json
import math
from typing import Optional

M_LAT = 110570.0


def _m_lng(lat):
    return 111320.0 * math.cos(math.radians(lat))


def load_line(alignment: Optional[str]):
    return json.loads(alignment) if alignment else None


def project(line, lat, lng):
    """Return (chainage_km, offset_m) of a point onto the polyline."""
    lat0 = line[0][0]
    mx = _m_lng(lat0)
    px, py = (lng - line[0][1]) * mx, (lat - lat0) * M_LAT
    best, run = (None, float("inf")), 0.0
    for (a_lat, a_lng), (b_lat, b_lng) in zip(line, line[1:]):
        ax, ay = (a_lng - line[0][1]) * mx, (a_lat - lat0) * M_LAT
        bx, by = (b_lng - line[0][1]) * mx, (b_lat - lat0) * M_LAT
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy) or 1e-9
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (seg * seg)))
        cx, cy = ax + t * dx, ay + t * dy
        d = math.hypot(px - cx, py - cy)
        if d < best[1]:
            best = ((run + t * seg) / 1000.0, d)
        run += seg
    return round(best[0], 3), round(best[1], 1)


def line_length_km(line):
    return sum(math.hypot((b[1] - a[1]) * _m_lng(a[0]), (b[0] - a[0]) * M_LAT) for a, b in zip(line, line[1:])) / 1000.0


def point_at(line, km):
    """Lat/lng at a chainage (km) along the polyline."""
    target, run = km * 1000.0, 0.0
    for a, b in zip(line, line[1:]):
        seg = math.hypot((b[1] - a[1]) * _m_lng(a[0]), (b[0] - a[0]) * M_LAT)
        if run + seg >= target:
            t = (target - run) / (seg or 1e-9)
            return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
        run += seg
    return list(line[-1])


BIN_KM = 0.5


def bins(length_km):
    n = max(1, math.ceil(length_km / BIN_KM - 1e-9))
    return [(round(i * BIN_KM, 3), round(min((i + 1) * BIN_KM, length_km), 3)) for i in range(n)]


def merge_ranges(rs):
    out = []
    for a, b in sorted(rs):
        if out and abs(out[-1][1] - a) < 1e-6:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


def fmt_ranges(rs):
    return ", ".join(f"{a:.1f}–{b:.1f}" for a, b in rs)
