"""Generate flat dark-themed plate/fork PWA icons (192x192, 512x512).

Why a script, not hand-drawn PNGs: keeps the icon reproducible/editable
without a design tool, per spec ("no other icon tool available").
"""
from typing import Tuple
from PIL import Image, ImageDraw

BG: Tuple[int, int, int] = (18, 18, 18)      # #121212 dark background
PLATE: Tuple[int, int, int] = (240, 240, 235)
ACCENT: Tuple[int, int, int] = (230, 126, 34)  # warm accent for the food


def draw_icon(size: int) -> Image.Image:
    """Draw a simple flat plate + fork icon, padded for maskable safe-zone."""
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    # Maskable safe zone is the inner ~80% circle - keep artwork inside it.
    plate_r = size * 0.34
    d.ellipse([cx - plate_r, cy - plate_r, cx + plate_r, cy + plate_r], fill=PLATE)
    inner_r = plate_r * 0.62
    d.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=ACCENT)

    # Fork: handle + three tines, laid diagonally across the plate's lower-right.
    fork_w = size * 0.045
    handle_len = size * 0.30
    fx, fy = cx + plate_r * 0.78, cy + plate_r * 0.78
    d.line([fx, fy, fx - handle_len * 0.6, fy - handle_len * 0.6], fill=PLATE, width=int(fork_w))
    tine_base_x, tine_base_y = fx - handle_len * 0.55, fy - handle_len * 0.55
    tine_len = size * 0.09
    for off in (-1, 0, 1):
        ox, oy = off * fork_w * 1.4, -off * fork_w * 1.4
        d.line(
            [tine_base_x + ox, tine_base_y + oy,
             tine_base_x + ox - tine_len * 0.7, tine_base_y + oy - tine_len * 0.7],
            fill=PLATE, width=int(fork_w * 0.7),
        )
    return img


if __name__ == "__main__":
    for s in (192, 512):
        draw_icon(s).save(f"icon-{s}.png")
    print("wrote icon-192.png, icon-512.png")
