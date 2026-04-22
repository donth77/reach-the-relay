#!/usr/bin/env python3
"""
process_sheet.py — extract + re-pixelate frames from a Seedance-style
video-to-spritesheet export.

Source videos are 1–4 s at 30 fps → output spritesheets have 20–120
frames per loop. Any animation produced through this pipeline MUST be
registered in Phaser with frameRate: 30.

Pipeline per frame:
  1. Crop the character region out of its cell in the sheet (using the
     sheet's grid layout — see `detect_grid_layout` for the heuristics).
  2. Palette-quantize the cropped character against the palette of the
     source still PNG. Kills anti-aliasing / color bleed / edge softness
     introduced during video generation.
  3. Threshold the alpha channel to {0, 255} so silhouettes are hard,
     no feathered edges.
  4. Nearest-neighbor resize to the target character size.
  5. Paste into the final canvas (e.g. 136×136) at the feet anchor.
  6. Save as frame_NNN.png into the target folder.

Drift check (BBOX stability across the loop) is printed at the end.

Usage:
  python3 scripts/process_sheet.py \
      --source sprite-dev/vanguard/world/south.png \
      --sheet  sprite-dev/vanguard/world/sheet.png \
      --out    public/assets/sprites/party/vanguard/anim/worldwalk-south \
      --canvas 136 --char-w 35 --char-h 64 --feet-y 105 \
      --also-update-static public/assets/sprites/party/vanguard/world/south.png \
      --static-from-frame 20
"""

import argparse
import glob
import os
from PIL import Image


# -----------------------------------------------------------------
# Grid detection
# -----------------------------------------------------------------

def detect_grid_layout(sheet: Image.Image):
    """Detect the 2D grid of populated cells on an RGBA spritesheet.

    Returns a list of (x0, y0, x1, y1) tuples — one per populated cell,
    in row-major order. Cells are determined by finding contiguous runs
    of solid columns + rows (where "solid" = any pixel has alpha > 0).
    """
    alpha = sheet.split()[-1]
    w, h = sheet.size
    col_has = [any(alpha.getpixel((x, y)) > 0 for y in range(h)) for x in range(w)]
    row_has = [any(alpha.getpixel((x, y)) > 0 for x in range(w)) for y in range(h)]

    def runs(flags):
        out, start, cur = [], 0, flags[0]
        for i in range(1, len(flags)):
            if flags[i] != cur:
                out.append((cur, start, i - 1))
                start, cur = i, flags[i]
        out.append((cur, start, len(flags) - 1))
        return out

    col_solids = [(s, e) for (t, s, e) in runs(col_has) if t]
    row_solids = [(s, e) for (t, s, e) in runs(row_has) if t]

    # Enumerate row × column combinations; skip cells whose crop is
    # entirely transparent (happens on partially-filled final rows like
    # our 5×5 grid with 4 empty trailing cells = 21 populated frames).
    cells = []
    for r in row_solids:
        for c in col_solids:
            x0, y0, x1, y1 = c[0], r[0], c[1] + 1, r[1] + 1
            crop = sheet.crop((x0, y0, x1, y1))
            if crop.getbbox() is None:
                continue
            cells.append((x0, y0, x1, y1))
    return cells


# -----------------------------------------------------------------
# Palette quantize + alpha threshold
# -----------------------------------------------------------------

def build_palette(source_still_path: str, n_colors: int = 24) -> Image.Image:
    """Quantize the source still to an indexed-palette image.

    Returns a PIL 'P'-mode image whose palette captures the canonical
    colors of the character. Used as the target palette for every
    frame of the spritesheet.

    Two knobs matter for the "flicker" artifact when applied to
    video-generated frames:
      - smaller n_colors → bigger per-color buckets → Seedance's
        slightly-different anti-aliased pixels map to the SAME palette
        color more often → less frame-to-frame flicker.
      - capping n_colors at the number of distinct opaque colors in
        the source avoids PIL inventing intermediate shades that
        wouldn't be present in hand-drawn pixel art anyway.
    """
    src = Image.open(source_still_path).convert('RGBA')
    # Drop fully-transparent pixels before quantizing so the palette
    # doesn't waste a slot on the background color.
    bg = Image.new('RGBA', src.size, (0, 0, 0, 0))
    alpha = src.split()[-1]
    opaque = Image.composite(src, bg, alpha)
    rgb = opaque.convert('RGB')
    # Cap palette size at the actual distinct color count of the source
    # when we can count them (maxcolors=256 limit in PIL for this API).
    counted = rgb.getcolors(maxcolors=256)
    if counted is not None:
        n_colors = min(n_colors, max(2, len(counted)))
    return rgb.quantize(colors=n_colors)


def repixelate(rgba: Image.Image, palette_img: Image.Image) -> Image.Image:
    """Palette-quantize `rgba` against `palette_img` and threshold alpha
    to {0, 255} so edges are hard. Returns an RGBA image the same size.
    """
    alpha = rgba.split()[-1]
    # Threshold the alpha FIRST so any partially-transparent edge pixels
    # are forced to either visible or gone before quantizing RGB.
    hard_alpha = alpha.point(lambda a: 255 if a >= 128 else 0)
    rgb = rgba.convert('RGB')
    q = rgb.quantize(palette=palette_img).convert('RGB')
    r, g, b = q.split()
    return Image.merge('RGBA', (r, g, b, hard_alpha))


# -----------------------------------------------------------------
# Main extract loop
# -----------------------------------------------------------------

def extract(
    source_still_path: str,
    sheet_path: str,
    out_folder: str,
    canvas: int,
    char_w: int,
    char_h: int,
    feet_y: int,
    n_palette_colors: int = 24,
    also_update_static: str | None = None,
    static_from_frame: int = 0,
):
    os.makedirs(out_folder, exist_ok=True)
    # Clear existing frame_*.png
    for f in os.listdir(out_folder):
        if f.startswith('frame_'):
            os.remove(os.path.join(out_folder, f))

    sheet = Image.open(sheet_path).convert('RGBA')
    palette = build_palette(source_still_path, n_palette_colors)
    cells = detect_grid_layout(sheet)

    paste_x = (canvas - char_w) // 2
    paste_y = feet_y - char_h

    for i, (x0, y0, x1, y1) in enumerate(cells):
        # Extract the non-empty region of the cell as the character.
        cell = sheet.crop((x0, y0, x1, y1))
        # Quantize to palette BEFORE downscaling — cleaner edges survive
        # the nearest-neighbor resize better than an anti-aliased source.
        quantized = repixelate(cell, palette)
        # Resize to the target character size, nearest-neighbor only.
        resized = quantized.resize((char_w, char_h), Image.Resampling.NEAREST)
        # Paste into the final canvas.
        final = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        final.paste(resized, (paste_x, paste_y), resized)
        out_path = os.path.join(out_folder, f'frame_{i:03d}.png')
        final.save(out_path)

    print(f'wrote {len(cells)} frames to {out_folder}')

    # Drift check
    frame_paths = sorted(glob.glob(f'{out_folder}/frame_*.png'))
    bbs = [Image.open(p).getbbox() for p in frame_paths]
    if bbs and all(bbs):
        print('drift  left:', max(b[0] for b in bbs) - min(b[0] for b in bbs),
              'top:', max(b[1] for b in bbs) - min(b[1] for b in bbs),
              'right:', max(b[2] for b in bbs) - min(b[2] for b in bbs),
              'bottom:', max(b[3] for b in bbs) - min(b[3] for b in bbs))

    # Refresh an idle static from a chosen frame (useful for keeping the
    # idle pose in sync with the loop's end pose — avoids a pop when the
    # animation starts / stops).
    if also_update_static is not None:
        src = os.path.join(out_folder, f'frame_{static_from_frame:03d}.png')
        if os.path.exists(src):
            Image.open(src).save(also_update_static)
            print(f'updated static: {also_update_static} <- frame_{static_from_frame:03d}.png')


# -----------------------------------------------------------------

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', required=True, help='Source still PNG (palette reference)')
    p.add_argument('--sheet', required=True, help='Spritesheet PNG from video export')
    p.add_argument('--out', required=True, help='Output folder for frame_*.png')
    p.add_argument('--canvas', type=int, default=128, help='Target canvas size (square)')
    p.add_argument('--char-w', type=int, required=True, help='Target character width in px')
    p.add_argument('--char-h', type=int, required=True, help='Target character height in px')
    p.add_argument('--feet-y', type=int, required=True, help='Feet y position on the target canvas')
    p.add_argument('--palette-colors', type=int, default=24, help='Palette size (default 24)')
    p.add_argument('--also-update-static', default=None, help='Path to idle static PNG to refresh')
    p.add_argument('--static-from-frame', type=int, default=0, help='Which frame index to copy as the static')
    args = p.parse_args()

    extract(
        source_still_path=args.source,
        sheet_path=args.sheet,
        out_folder=args.out,
        canvas=args.canvas,
        char_w=args.char_w,
        char_h=args.char_h,
        feet_y=args.feet_y,
        n_palette_colors=args.palette_colors,
        also_update_static=args.also_update_static,
        static_from_frame=args.static_from_frame,
    )


if __name__ == '__main__':
    main()
