#!/usr/bin/env python3
"""
Render the Curvault icon to PNG/ICO/ICNS at the sizes Tauri's bundler expects.

Uses only Python stdlib so it can run inside CI containers without setup.
The renderer is a hand-written rasteriser for the specific SVG geometry — it
does NOT parse arbitrary SVG. If the brand logo changes substantively, edit
the constants at the top of this file or replace with `tauri icon` in CI.
"""

import math
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"

# Sizes Tauri expects in src-tauri/icons/.
SIZES = {
    "32x32.png":      32,
    "128x128.png":    128,
    "128x128@2x.png": 256,
    "icon.png":       512,
}

# Geometry mirrors the SVG viewBox 120x120.
VB = 120.0
CENTER = 60.0
OUTER_R = 38.0
OUTER_HALF = 9.0 / 2     # stroke-width / 2
INNER_R = 24.0
INNER_HALF = 6.0 / 2
DOT_R = 6.5
GAP_HALF_DEG = 45.0      # arc opens to the right (-45° .. +45°)
AA_PX_LOGICAL = 0.75

# Gradient stops (top-left to bottom-right).
G0 = (0x36, 0xc5, 0xff)
G1 = (0x1b, 0x4f, 0xd6)


def lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def gradient_at(nx: float, ny: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, (nx + ny) * 0.5))
    return (lerp(G0[0], G1[0], t), lerp(G0[1], G1[1], t), lerp(G0[2], G1[2], t))


def render(size: int) -> bytes:
    scale = size / VB
    aa = AA_PX_LOGICAL  # in logical (viewBox) units
    raw = bytearray()
    for py in range(size):
        raw.append(0)  # PNG filter type for this scanline
        ly = (py + 0.5) / scale
        for px in range(size):
            lx = (px + 0.5) / scale
            dx = lx - CENTER
            dy = ly - CENTER
            r = math.hypot(dx, dy)
            angle_deg = math.degrees(math.atan2(dy, dx))
            in_gap = -GAP_HALF_DEG < angle_deg < GAP_HALF_DEG

            R = G = B = 0
            A = 0

            if not in_gap:
                d = abs(r - OUTER_R) - OUTER_HALF
                if d < aa:
                    alpha = max(0.0, min(1.0, (aa - d) / aa))
                    nx = px / max(1, size - 1)
                    ny = py / max(1, size - 1)
                    gr, gg, gb = gradient_at(nx, ny)
                    R, G, B, A = gr, gg, gb, int(alpha * 255)

                d2 = abs(r - INNER_R) - INNER_HALF
                if d2 < aa:
                    alpha = max(0.0, min(1.0, (aa - d2) / aa)) * 0.9
                    Ai = int(alpha * 255)
                    if Ai > A:
                        R, G, B, A = 255, 255, 255, Ai

            d3 = r - DOT_R
            if d3 < aa:
                alpha = max(0.0, min(1.0, (aa - d3) / aa))
                Ai = int(alpha * 255)
                if Ai > A:
                    R, G, B, A = 255, 255, 255, Ai

            raw.extend((R, G, B, A))
    return bytes(raw)


def png(size: int, raw_rgba: bytes) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(typ: bytes, data: bytes) -> bytes:
        ln = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return ln + typ + data + crc

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    compressed = zlib.compress(raw_rgba, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def ico_from_pngs(items: list[tuple[int, bytes]]) -> bytes:
    """Pack multiple PNG-encoded images into a single .ico container."""
    head = struct.pack("<HHH", 0, 1, len(items))  # reserved, type=1 (icon), count
    entries = b""
    blobs = b""
    offset = 6 + len(items) * 16
    for size, blob in items:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        entries += struct.pack(
            "<BBBBHHII",
            w, h, 0, 0, 1, 32, len(blob), offset,
        )
        blobs += blob
        offset += len(blob)
    return head + entries + blobs


def icns_from_pngs(by_size: dict[int, bytes]) -> bytes:
    """Build a minimal .icns containing the standard macOS sizes we generated."""
    type_map = {
        32: b"ic11",   # 32x32@1x
        64: b"ic12",   # 32x32@2x
        128: b"ic07",  # 128x128
        256: b"ic13",  # 128x128@2x  (aka 256x256@1x)
        512: b"ic09",  # 512x512
        1024: b"ic10", # 512x512@2x
    }
    parts = []
    total = 8
    for size, ostype in type_map.items():
        if size not in by_size:
            continue
        blob = by_size[size]
        parts.append((ostype, blob))
        total += 8 + len(blob)
    body = b""
    for ostype, blob in parts:
        body += ostype + struct.pack(">I", 8 + len(blob)) + blob
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    by_size: dict[int, bytes] = {}
    for name, size in SIZES.items():
        raw = render(size)
        blob = png(size, raw)
        by_size[size] = blob
        (OUT_DIR / name).write_bytes(blob)
        print(f"  wrote {name} ({size}x{size}, {len(blob)} B)")

    # ico needs 16/32/48/256; we have 32, 128, 256.
    ico_payload = ico_from_pngs([(32, by_size[32]), (128, by_size[128]), (256, by_size[256])])
    (OUT_DIR / "icon.ico").write_bytes(ico_payload)
    print(f"  wrote icon.ico ({len(ico_payload)} B)")

    # icns: we have 32, 128, 256, 512.
    icns_payload = icns_from_pngs({k: by_size[k] for k in (32, 128, 256, 512) if k in by_size})
    (OUT_DIR / "icon.icns").write_bytes(icns_payload)
    print(f"  wrote icon.icns ({len(icns_payload)} B)")


if __name__ == "__main__":
    main()
