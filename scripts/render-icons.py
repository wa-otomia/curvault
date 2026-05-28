#!/usr/bin/env python3
"""
Render the Curvault app icon — a miniature of the Card Sticker design:
rounded-square dark blue radial gradient, dotted texture overlay, then the
Curvault C-curve mark centered on top.

Outputs PNG (32 / 128 / 128@2x / 512), ICO (Windows), and ICNS (macOS).

Pure stdlib — no Pillow / Inkscape / rsvg required, so the same script
runs in CI containers and on dev machines.
"""

import math
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"

SIZES = {
    "32x32.png":      32,
    "128x128.png":    128,
    "128x128@2x.png": 256,
    "icon.png":       512,
}

# Background radial gradient (centre ~ upper-right of the canvas).
GRAD = [
    (0.00, (0x16, 0x26, 0x4f)),
    (0.48, (0x0b, 0x14, 0x30)),
    (1.00, (0x06, 0x0b, 0x1a)),
]

# C-curve logo geometry, in viewBox 120x120 units.
LOGO_VB = 120.0
LOGO_CENTER = 60.0
OUTER_R = 38.0
OUTER_HALF = 9.0 / 2
INNER_R = 24.0
INNER_HALF = 6.0 / 2
DOT_R = 6.5
GAP_HALF_DEG = 45.0

# Gradient stops for the outer C arc (top-left → bottom-right).
ARC_G0 = (0x36, 0xc5, 0xff)
ARC_G1 = (0x1b, 0x4f, 0xd6)

# Dot pattern (mirrors the Card Sticker JS exactly).
DOT_COLS = 26
DOT_ROWS = 26
DOT_COLOR_BRIGHT = (0x46, 0xc8, 0xff)
DOT_COLOR_DIM    = (0x3a, 0x6f, 0xd8)


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def grad_color(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(GRAD) - 1):
        t0, c0 = GRAD[i]
        t1, c1 = GRAD[i + 1]
        if t <= t1:
            k = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return (lerp(c0[0], c1[0], k),
                    lerp(c0[1], c1[1], k),
                    lerp(c0[2], c1[2], k))
    return GRAD[-1][1]


def precompute_dot_grid():
    """One alpha value per grid cell, replicating the canvas formula."""
    grid = [[0.0] * DOT_COLS for _ in range(DOT_ROWS)]
    for r in range(DOT_ROWS):
        for c in range(DOT_COLS):
            x = (c + 0.5) / DOT_COLS * 100
            y = (r + 0.5) / DOT_ROWS * 100
            wave = math.sin(x * 0.12 + y * 0.16 - 1.2)
            band = math.cos((x - y) * 0.07)
            a = max(0.0, min(1.0, (wave * 0.5 + 0.5) * (band * 0.4 + 0.6))) * 0.5
            grid[r][c] = a
    return grid


def rounded_mask_alpha(x, y, size, r):
    """1.0 inside the rounded square, 0.0 outside, smooth at the corner."""
    if x < 0 or x >= size or y < 0 or y >= size:
        return 0.0
    cx, cy = None, None
    if x < r and y < r:
        cx, cy = r, r
    elif x >= size - r and y < r:
        cx, cy = size - r, r
    elif x < r and y >= size - r:
        cx, cy = r, size - r
    elif x >= size - r and y >= size - r:
        cx, cy = size - r, size - r
    if cx is None:
        return 1.0
    d = math.hypot(x - cx, y - cy)
    aa = 0.85
    if d <= r:
        return 1.0
    if d >= r + aa:
        return 0.0
    return 1.0 - (d - r) / aa


def render(size):
    grid = precompute_dot_grid() if size >= 64 else None

    corner_r = size * 0.225
    grad_cx = size * 0.8
    grad_cy = size * 0.08
    grad_max = size * 1.05

    logo_frac = 0.72   # logo fills ~72 % of the canvas
    logo_size = size * logo_frac
    logo_x0 = (size - logo_size) / 2
    logo_y0 = (size - logo_size) / 2
    aa_svg = 0.85 * (LOGO_VB / logo_size)  # anti-alias band in viewBox units

    raw = bytearray()
    for py in range(size):
        raw.append(0)  # PNG filter byte for this scanline
        for px in range(size):
            mx = px + 0.5
            my = py + 0.5

            # 1) rounded outer mask
            mask = rounded_mask_alpha(mx, my, size, corner_r)
            if mask <= 0.0:
                raw.extend((0, 0, 0, 0))
                continue

            # 2) base background gradient
            t = math.hypot(mx - grad_cx, my - grad_cy) / grad_max
            R, G, B = grad_color(t)

            # 3) dotted overlay
            if grid is not None:
                col = min(DOT_COLS - 1, int(mx / size * DOT_COLS))
                row = min(DOT_ROWS - 1, int(my / size * DOT_ROWS))
                a = grid[row][col]
                if a >= 0.04:
                    gx = (col + 0.5) / DOT_COLS * size
                    gy = (row + 0.5) / DOT_ROWS * size
                    d = math.hypot(mx - gx, my - gy)
                    dot_r = (0.25 + a * 0.5) * (size / 100)
                    aa_dot = 0.6
                    if d <= dot_r + aa_dot:
                        edge = 1.0 if d <= dot_r else (dot_r + aa_dot - d) / aa_dot
                        eff = a * edge
                        dc = DOT_COLOR_BRIGHT if a > 0.32 else DOT_COLOR_DIM
                        R = lerp(R, dc[0], eff)
                        G = lerp(G, dc[1], eff)
                        B = lerp(B, dc[2], eff)

            # 4) C-curve mark
            if logo_x0 <= mx <= logo_x0 + logo_size \
               and logo_y0 <= my <= logo_y0 + logo_size:
                lx = (mx - logo_x0) / logo_size * LOGO_VB
                ly = (my - logo_y0) / logo_size * LOGO_VB
                dlx = lx - LOGO_CENTER
                dly = ly - LOGO_CENTER
                rr = math.hypot(dlx, dly)
                angle = math.degrees(math.atan2(dly, dlx))
                in_gap = -GAP_HALF_DEG < angle < GAP_HALF_DEG

                if not in_gap:
                    d_out = abs(rr - OUTER_R) - OUTER_HALF
                    if d_out < aa_svg:
                        alpha = max(0.0, min(1.0, (aa_svg - d_out) / aa_svg))
                        kt = max(0.0, min(1.0, (lx + ly) / (2 * LOGO_VB)))
                        gr = lerp(ARC_G0[0], ARC_G1[0], kt)
                        gg = lerp(ARC_G0[1], ARC_G1[1], kt)
                        gb = lerp(ARC_G0[2], ARC_G1[2], kt)
                        R = lerp(R, gr, alpha)
                        G = lerp(G, gg, alpha)
                        B = lerp(B, gb, alpha)

                    d_in = abs(rr - INNER_R) - INNER_HALF
                    if d_in < aa_svg:
                        alpha = max(0.0, min(1.0, (aa_svg - d_in) / aa_svg)) * 0.9
                        R = lerp(R, 255, alpha)
                        G = lerp(G, 255, alpha)
                        B = lerp(B, 255, alpha)

                d_dot = rr - DOT_R
                if d_dot < aa_svg:
                    alpha = max(0.0, min(1.0, (aa_svg - d_dot) / aa_svg))
                    R = lerp(R, 255, alpha)
                    G = lerp(G, 255, alpha)
                    B = lerp(B, 255, alpha)

            A = int(round(mask * 255))
            raw.extend((R, G, B, A))
    return bytes(raw)


def png(size, raw_rgba):
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(typ, data):
        ln = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return ln + typ + data + crc

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    compressed = zlib.compress(raw_rgba, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def ico_from_pngs(items):
    head = struct.pack("<HHH", 0, 1, len(items))
    entries = b""
    blobs = b""
    offset = 6 + len(items) * 16
    for size, blob in items:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        blobs += blob
        offset += len(blob)
    return head + entries + blobs


def icns_from_pngs(by_size):
    type_map = {
        32:   b"ic11",
        64:   b"ic12",
        128:  b"ic07",
        256:  b"ic13",
        512:  b"ic09",
        1024: b"ic10",
    }
    parts = []
    for s, t in type_map.items():
        if s in by_size:
            parts.append((t, by_size[s]))
    body = b""
    for t, blob in parts:
        body += t + struct.pack(">I", 8 + len(blob)) + blob
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    by_size = {}
    for name, size in SIZES.items():
        print(f"  rendering {name} ({size}x{size}) …")
        raw = render(size)
        blob = png(size, raw)
        by_size[size] = blob
        (OUT_DIR / name).write_bytes(blob)
        print(f"    wrote {len(blob):,} B")

    ico_payload = ico_from_pngs([(32, by_size[32]), (128, by_size[128]), (256, by_size[256])])
    (OUT_DIR / "icon.ico").write_bytes(ico_payload)
    print(f"  wrote icon.ico ({len(ico_payload):,} B)")

    icns_payload = icns_from_pngs({k: by_size[k] for k in (32, 128, 256, 512) if k in by_size})
    (OUT_DIR / "icon.icns").write_bytes(icns_payload)
    print(f"  wrote icon.icns ({len(icns_payload):,} B)")


if __name__ == "__main__":
    main()
