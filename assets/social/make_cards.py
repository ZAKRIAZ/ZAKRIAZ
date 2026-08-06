#!/usr/bin/env python3
"""
Generate the 1280x640 GitHub social-preview cards for ZAKRIAZ repos.

    python3 assets/social/make_cards.py            # write both PNGs
    python3 assets/social/make_cards.py --preview  # also write 600px-wide legibility proofs

Design contract (matches the profile's established identity):
  crimson #b71c1c · deep #8b0000 · near-black #0a0a0b · ink #e8e6e3 · dim #9a9a9a
  Dark CRT / arcade cabinet: hard edges, scanlines, no rounded corners, no drop
  shadows, no emoji, no gradients beyond a subtle vignette.

Font: Press Start 2P (OFL). NOT committed - fetched to a temp dir at build time:
  curl -sL -o /tmp/PressStart2P-Regular.ttf \
    https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf
Point FONT_PATH at it, or drop it in one of FONT_CANDIDATES below. Press Start 2P
is a 8x8 pixel face, so every size here is a multiple of 8: that keeps the glyph
edges pixel-exact instead of antialiased mush. If the font is missing the script
refuses to write (the pixel face IS the identity); --allow-fallback-font forces a
bold system monospace for quick layout proofs only.

The play triangle is drawn as geometry on the same 8px grid, not typed: the
font's own U+25B6 is a lumpy stepped shape that reads as a mistake at a glance.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- identity ---

CRIMSON = (183, 28, 28)  # #b71c1c  primary accent
DEEP = (139, 0, 0)  # #8b0000  crimson shade
NEAR_BLACK = (10, 10, 11)  # #0a0a0b  background
INK = (232, 230, 227)  # #e8e6e3  light text
DIM = (154, 154, 154)  # #9a9a9a  secondary text
OK_GREEN = (92, 224, 138)  # #5ce08a  BIOS "OK" lines only (unused here)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, ...]:
    """t=0 -> a, t=1 -> b."""
    return tuple(int(round(ca + (cb - ca) * t)) for ca, cb in zip(a, b))

# ------------------------------------------------------------------ canvas ---

W, H = 1280, 640
FRAME_INSET = 88  # >= 80px safe margin: GitHub/X crop the edges
FRAME_STROKE = 3
PAD = 46  # frame -> text padding, so text sits at 134px in
TICK_LEN = 44
TICK_W = 5

# Press Start 2P is an 8px face; use multiples of 8 only.
SIZE_EYEBROW = 24
SIZE_HEADLINE = 56
SIZE_SUB = 24
SIZE_STRIP = 32
SIZE_URL = 24

TRACK_EYEBROW = 6  # wide-spaced label, terminal style
STRIP_PAD_X, STRIP_PAD_Y = 22, 18
# The play triangle is DRAWN, not typed: Press Start 2P's U+25B6 is a lumpy
# stepped blob that reads as an accident at a glance. Geometry also keeps the
# mark out of emoji-font territory on any renderer.
GLYPH_GAP = 20  # triangle -> label
CAP_RATIO = 7 / 8  # Press Start 2P: cap ink is 7 of the 8 grid units

SCANLINE_PERIOD = 4
SCANLINE_ALPHA = 38
VIGNETTE_STRENGTH = 0.55
PANEL_LIFT = (6, 6, 7)  # barely-there lift inside the frame so scanlines read
PANEL = tuple(c + l for c, l in zip(NEAR_BLACK, PANEL_LIFT))
# The frame line is knocked back toward the panel so the crimson corner ticks
# are the thing that reads as the accent - at full brightness they vanish into it.
FRAME_LINE = mix(DEEP, PANEL, 0.42)

FONT_CANDIDATES = [
    os.environ.get("FONT_PATH", ""),
    "/tmp/PressStart2P-Regular.ttf",
    "/tmp/psp/PressStart2P-Regular.ttf",
    str(Path(__file__).with_name("PressStart2P-Regular.ttf")),
    os.path.expanduser("~/Library/Fonts/PressStart2P-Regular.ttf"),
]
FALLBACK_FONTS = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
]


def resolve_font() -> tuple[str, bool]:
    """Return (path, is_pixel_font)."""
    for cand in FONT_CANDIDATES:
        if cand and Path(cand).is_file():
            return cand, True
    for cand in FALLBACK_FONTS:
        if Path(cand).is_file():
            print(
                "WARNING: Press Start 2P not found - falling back to bold system "
                f"monospace ({cand}). Fetch the pixel font for the real look:\n"
                "  curl -sL -o /tmp/PressStart2P-Regular.ttf https://github.com/"
                "google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf",
                file=sys.stderr,
            )
            return cand, False
    sys.exit("No usable font found. Set FONT_PATH to a .ttf.")


FONT_PATH, IS_PIXEL_FONT = resolve_font()
_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def font(size: int) -> ImageFont.FreeTypeFont:
    if size not in _font_cache:
        _font_cache[size] = ImageFont.truetype(FONT_PATH, size)
    return _font_cache[size]


# -------------------------------------------------------------- text utils ---


def text_width(s: str, size: int, track: int = 0) -> int:
    w = int(round(font(size).getlength(s)))
    return w + track * max(0, len(s) - 1) if track else w


def draw_text(
    d: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    s: str,
    size: int,
    fill: tuple[int, int, int],
    track: int = 0,
) -> None:
    """Top-left anchored draw. Manual advance when tracking, so spacing is exact."""
    f = font(size)
    if not track:
        d.text(xy, s, font=f, fill=fill)
        return
    x, y = xy
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill)
        x += int(round(f.getlength(ch))) + track


# ------------------------------------------------------------- furniture -----


def background() -> Image.Image:
    img = Image.new("RGB", (W, H), NEAR_BLACK)
    d = ImageDraw.Draw(img)

    # Panel: a hair lighter inside the frame, hard-edged.
    d.rectangle(
        [FRAME_INSET, FRAME_INSET, W - FRAME_INSET - 1, H - FRAME_INSET - 1],
        fill=PANEL,
    )

    # Subtle CRT vignette (the only gradient allowed).
    mask = Image.radial_gradient("L").resize((W, H), Image.BILINEAR)
    mask = mask.point(lambda v: int(v * VIGNETTE_STRENGTH))
    img = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), img, mask)

    # Scanlines, under the type so downscaling never chews the glyphs.
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, SCANLINE_PERIOD):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, SCANLINE_ALPHA))
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def frame(d: ImageDraw.ImageDraw) -> None:
    x0, y0 = FRAME_INSET, FRAME_INSET
    x1, y1 = W - FRAME_INSET - 1, H - FRAME_INSET - 1

    # Quiet frame line in the knocked-back crimson shade...
    d.rectangle([x0, y0, x1, y1], outline=FRAME_LINE, width=FRAME_STROKE)

    # ...loud corner ticks in crimson, so the accent lands on the corners.
    for cx, cy, sx, sy in (
        (x0, y0, 1, 1),
        (x1, y0, -1, 1),
        (x0, y1, 1, -1),
        (x1, y1, -1, -1),
    ):
        d.rectangle(
            sorted_box(cx, cy, cx + sx * TICK_LEN, cy + sy * TICK_W), fill=CRIMSON
        )
        d.rectangle(
            sorted_box(cx, cy, cx + sx * TICK_W, cy + sy * TICK_LEN), fill=CRIMSON
        )


def sorted_box(x0: int, y0: int, x1: int, y1: int) -> list[int]:
    return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]


def glyph_box(size: int) -> tuple[int, int, int]:
    """(unit, width, height) of the drawn play triangle at a given type size."""
    unit = max(2, size // 8)  # one pixel-font grid cell
    return unit, 7 * unit, 7 * unit  # 7x7 cells: slope-2 edges, cap-height tall


def play_triangle(d: ImageDraw.ImageDraw, x: int, y: int, size: int, fill) -> None:
    """Hard-edged pixel triangle on the font's own 8x8 grid. Top-left anchored."""
    unit, _, _ = glyph_box(size)
    for row, cells in enumerate((1, 3, 5, 7, 5, 3, 1)):
        d.rectangle(
            [x, y + row * unit, x + cells * unit - 1, y + (row + 1) * unit - 1],
            fill=fill,
        )


def strip_width(label: str) -> int:
    _, gw, _ = glyph_box(SIZE_STRIP)
    return text_width(label, SIZE_STRIP) + gw + GLYPH_GAP + STRIP_PAD_X * 2


def strip(img: Image.Image, x: int, y: int, label: str) -> int:
    """Crimson call-to-action block. Returns its height."""
    w = strip_width(label)
    h = SIZE_STRIP + STRIP_PAD_Y * 2
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=CRIMSON)

    # Same scanlines continue across the block - it is on the same tube.
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for yy in range(0, H, SCANLINE_PERIOD):
        if y <= yy <= y + h:
            od.line([(x, yy), (x + w, yy)], fill=(0, 0, 0, SCANLINE_ALPHA + 12))
    img.paste(
        Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"), (0, 0)
    )

    # Cap ink is only 7/8 of the type size, so nudge it down half the shortfall:
    # that leaves equal optical padding above and below inside the block.
    cap = int(round(SIZE_STRIP * CAP_RATIO))
    ink_y = y + STRIP_PAD_Y + (SIZE_STRIP - cap) // 2
    unit, gw, _ = glyph_box(SIZE_STRIP)

    d = ImageDraw.Draw(img)
    play_triangle(d, x + STRIP_PAD_X, ink_y, SIZE_STRIP, INK)
    d.text((x + STRIP_PAD_X + gw + GLYPH_GAP, ink_y), label, font=font(SIZE_STRIP), fill=INK)
    return h


# ----------------------------------------------------------------- cards -----


def build(headline: str, cta: str, url: str, subtitle: str | None = None) -> Image.Image:
    img = background()
    d = ImageDraw.Draw(img)
    frame(d)

    left = FRAME_INSET + PAD
    right = W - FRAME_INSET - PAD
    top = FRAME_INSET + PAD
    bottom = H - FRAME_INSET - PAD

    eyebrow = "ZAKARIAE BELFKIH"
    gap_eyebrow, gap_sub, gap_strip = 26, 30, 40
    strip_h = SIZE_STRIP + STRIP_PAD_Y * 2

    stack = SIZE_EYEBROW + gap_eyebrow + SIZE_HEADLINE + gap_strip + strip_h
    if subtitle:
        stack += gap_sub + SIZE_SUB

    # Vertically centre the stack in the space above the url row.
    region_bottom = bottom - SIZE_URL - 28
    y = top + (region_bottom - top - stack) // 2

    draw_text(d, (left, y), eyebrow, SIZE_EYEBROW, DIM, track=TRACK_EYEBROW)
    y += SIZE_EYEBROW + gap_eyebrow

    draw_text(d, (left, y), headline, SIZE_HEADLINE, INK)
    y += SIZE_HEADLINE

    if subtitle:
        y += gap_sub
        draw_text(d, (left, y), subtitle, SIZE_SUB, DIM)
        y += SIZE_SUB

    y += gap_strip
    strip(img, left, y, cta)

    d = ImageDraw.Draw(img)
    draw_text(
        d,
        (right - text_width(url, SIZE_URL), bottom - SIZE_URL),
        url,
        SIZE_URL,
        DIM,
    )

    assert_safe_margins(headline, cta, url, subtitle)
    return img


def assert_safe_margins(headline: str, cta: str, url: str, subtitle: str | None) -> None:
    """Nothing may cross the 80px crop-safe margin."""
    inner = W - 2 * (FRAME_INSET + PAD)
    widest = max(
        [
            text_width(headline, SIZE_HEADLINE),
            strip_width(cta),
            text_width(url, SIZE_URL),
            text_width("ZAKARIAE BELFKIH", SIZE_EYEBROW, TRACK_EYEBROW),
        ]
        + ([text_width(subtitle, SIZE_SUB)] if subtitle else [])
    )
    if widest > inner:
        raise SystemExit(f"Content {widest}px exceeds the {inner}px safe box.")
    if FRAME_INSET < 80:
        raise SystemExit("Frame is inside the 80px crop-safe margin.")


CARDS = {
    "portfolio": dict(
        headline="ARCADE PORTFOLIO",
        cta="INSERT COIN",
        url="zakriaz.github.io/portfolio",
    ),
    "reality-editor": dict(
        headline="REALITY EDITOR",
        cta="OPEN WITH CAMERA",
        url="zakriaz.github.io/reality-editor",
        subtitle="frame the world with your hands",
    ),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent))
    ap.add_argument(
        "--preview",
        action="store_true",
        help="also write 600px-wide proofs to check small-scale legibility",
    )
    ap.add_argument(
        "--preview-dir",
        default=tempfile.gettempdir(),
        help="where the proofs go (default: temp dir - they are not repo assets)",
    )
    ap.add_argument(
        "--allow-fallback-font",
        action="store_true",
        help="write cards even without Press Start 2P (off the identity - proofs only)",
    )
    args = ap.parse_args()

    if not IS_PIXEL_FONT and not args.allow_fallback_font:
        sys.exit(
            "Refusing to overwrite the committed cards with fallback-font output: "
            "the pixel face IS the identity. Fetch the font (see the module "
            "docstring) or pass --allow-fallback-font."
        )

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print(f"font: {FONT_PATH} ({'pixel' if IS_PIXEL_FONT else 'FALLBACK mono'})")

    for name, spec in CARDS.items():
        img = build(**spec)
        path = out / f"{name}.png"
        img.save(path, "PNG", optimize=True)
        print(f"{path}  {path.stat().st_size} bytes  {img.size[0]}x{img.size[1]}")
        if args.preview:
            p = Path(args.preview_dir) / f"preview-{name}-600.png"
            img.resize((600, 300), Image.LANCZOS).save(p, "PNG")
            print(f"  proof: {p}")


if __name__ == "__main__":
    main()
