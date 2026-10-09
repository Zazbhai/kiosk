#!/usr/bin/env python3
"""
PrintBooth Custom Bootloader Splash Generator — Minimalist Glitch Edition
==========================================================================
Generates ultra-clean, minimal Capitalio Obsidian & Laser Red bootloader assets:
  1. Pure velvet obsidian background (#06110D) — ZERO grid lines, ZERO scanline noise.
  2. High-precision typography with digital glitch effect (chromatic aberration, horizontal slice tears).
  3. Pre-rendered glitch animation sequence frames for Plymouth bootloader.
  4. Ultra-minimal hairline laser-red progress indicator.
  5. Static frame-buffer fallback splashes for 1080p and 720p displays.
"""

import os
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR / "splash_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


def get_fonts():
    font_main = None
    font_sub = None
    font_mono = None
    for font_path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:\\Windows\\Fonts\\consola.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
    ]:
        if os.path.exists(font_path):
            try:
                font_main = ImageFont.truetype(font_path, 54)
                font_sub = ImageFont.truetype(font_path, 13)
                font_mono = ImageFont.truetype(font_path, 11)
                break
            except Exception:
                pass

    if not font_main:
        font_main = ImageFont.load_default()
        font_sub = font_main
        font_mono = font_main

    return font_main, font_sub, font_mono


def create_minimal_background(width=1920, height=1080) -> Image.Image:
    """Creates a pure, sleek Capitalio Obsidian (#06110D) background canvas with subtle ambient falloff."""
    img = Image.new("RGBA", (width, height), (6, 17, 13, 255))
    cx, cy = width // 2, height // 2

    # Very soft, subtle central ambient crimson glow (zero grids, zero scanlines)
    radial_canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    r_draw = ImageDraw.Draw(radial_canvas)
    max_radius = int(min(width, height) * 0.45)
    for r in range(max_radius, 0, -20):
        alpha = int(14 * (1.0 - (r / max_radius) ** 2))
        if alpha > 0:
            r_draw.ellipse(
                [cx - r, cy - 30 - r, cx + r, cy - 30 + r],
                fill=(220, 38, 38, alpha),
            )
    img = Image.alpha_composite(img, radial_canvas)
    return img


def render_base_text_layer(canvas_w=900, canvas_h=220) -> Image.Image:
    """Renders the pristine base typography layer on transparent canvas."""
    img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font_main, font_sub, _ = get_fonts()
    cx = canvas_w // 2

    # Title: P R I N T B O O T H
    title = "PRINTBOOTH"
    t_box = draw.textbbox((0, 0), title, font=font_main)
    tw = t_box[2] - t_box[0]
    tx = cx - tw // 2
    ty = 40

    # Soft laser-red ambient text glow
    for ox, oy in [(-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1)]:
        draw.text((tx + ox, ty + oy), title, fill=(220, 38, 38, 80), font=font_main)

    # Core text: Pure brilliant porcelain
    draw.text((tx, ty), title, fill=(255, 255, 255, 255), font=font_main)

    # Subtitle: Minimal monospace hardware badge
    subtitle = "AUTONOMOUS PRINT APPLIANCE  //  PB-001"
    s_box = draw.textbbox((0, 0), subtitle, font=font_sub)
    sw = s_box[2] - s_box[0]
    sx = cx - sw // 2
    sy = ty + 72
    draw.text((sx, sy), subtitle, fill=(239, 68, 68, 230), font=font_sub)

    return img


def apply_chromatic_and_slice_glitch(base_img: Image.Image, seed_val: int = 1) -> Image.Image:
    """Applies authentic digital slice tears, RGB split, and chromatic aberration to text."""
    random.seed(seed_val)
    w, h = base_img.size

    # 1. Chromatic aberration (RGB channel horizontal displacement)
    # Split channels
    r, g, b, a = base_img.split()

    # Red shifted left, Blue/Cyan shifted right
    offset_r = random.choice([-4, -3, -2, -5])
    offset_b = random.choice([2, 3, 4, 5])

    r_shifted = ImageChops.offset(r, offset_r, 0)
    b_shifted = ImageChops.offset(b, offset_b, 0)

    # Composite with alpha mask
    chroma_img = Image.merge("RGBA", (r_shifted, g, b_shifted, a))

    # 2. Horizontal slice tears (staggered micro-shift)
    glitched = chroma_img.copy()
    num_slices = random.randint(2, 4)

    for _ in range(num_slices):
        slice_y = random.randint(30, 140)
        slice_h = random.randint(6, 22)
        shift_x = random.choice([-14, -8, 8, 14, 18])

        if slice_y + slice_h < h:
            box = (0, slice_y, w, slice_y + slice_h)
            slice_crop = glitched.crop(box)
            # Clear original band
            empty = Image.new("RGBA", (w, slice_h), (0, 0, 0, 0))
            glitched.paste(empty, (0, slice_y))
            # Paste back shifted
            glitched.paste(slice_crop, (shift_x, slice_y), slice_crop)

    # 3. Add 1-2 subtle laser glitch hairline artifacts
    draw = ImageDraw.Draw(glitched)
    for _ in range(random.randint(1, 3)):
        line_y = random.randint(35, 130)
        line_x1 = random.randint(50, w // 2)
        line_len = random.randint(60, 220)
        color = random.choice([(220, 38, 38, 220), (0, 240, 255, 190), (255, 255, 255, 210)])
        draw.line([(line_x1, line_y), (line_x1 + line_len, line_y)], fill=color, width=1)

    return glitched


def generate_glitch_frames():
    """Generates the normal base frame + 4 distinct glitch keyframes for Plymouth animation."""
    print("  Generating minimal typography with digital glitch effect...")
    base_text = render_base_text_layer(900, 220)

    # Frame 0: Pristine normal
    base_text.save(ASSETS_DIR / "glitch_text_normal.png")
    print(f"  [+] Created {ASSETS_DIR / 'glitch_text_normal.png'}")

    # Frames 1 to 4: Glitch keyframes
    for idx, seed in enumerate([101, 202, 303, 404], start=1):
        g_frame = apply_chromatic_and_slice_glitch(base_text, seed_val=seed)
        fname = ASSETS_DIR / f"glitch_text_{idx}.png"
        g_frame.save(fname)
        print(f"  [+] Created Glitch Keyframe: {fname}")


def create_minimal_progress_components():
    """Generates a sleek, ultra-minimal 3px hairline progress indicator."""
    bar_width = 420
    bar_height = 3

    # Track: Subtle translucent slate hairline
    p_track = Image.new("RGBA", (bar_width, bar_height), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(p_track)
    tdraw.rounded_rectangle([0, 0, bar_width, bar_height], radius=1, fill=(30, 41, 59, 210))
    p_track.save(ASSETS_DIR / "progress_track.png")

    # Bar: Vibrant laser red active fill
    p_bar = Image.new("RGBA", (bar_width, bar_height), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(p_bar)
    bdraw.rounded_rectangle([0, 0, bar_width, bar_height], radius=1, fill=(220, 38, 38, 255))
    p_bar.save(ASSETS_DIR / "progress_bar.png")

    # Transparent dummy spark for Plymouth backwards-compatibility
    spark = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    spark.save(ASSETS_DIR / "progress_spark.png")
    spark.save(ASSETS_DIR / "progress_glow.png")
    print(f"  [+] Created Minimal Hairline Progress Components in {ASSETS_DIR}")


def create_static_boot_splash(width=1920, height=1080) -> Image.Image:
    """Creates the minimal static boot splash image with glitch text & hairline progress."""
    img = create_minimal_background(width, height)
    cx, cy = width // 2, height // 2
    _, _, font_mono = get_fonts()

    # Paste text (slight chromatic glitch)
    base_text = render_base_text_layer(900, 220)
    glitched_text = apply_chromatic_and_slice_glitch(base_text, seed_val=42)
    tx = cx - glitched_text.width // 2
    ty = cy - 100
    img.alpha_composite(glitched_text, (tx, ty))

    draw = ImageDraw.Draw(img)

    # Minimal progress bar
    bar_w = 420
    bar_h = 3
    bx1 = cx - bar_w // 2
    by1 = cy + 50
    bx2 = cx + bar_w // 2
    by2 = by1 + bar_h

    # Track
    draw.rounded_rectangle([bx1, by1, bx2, by2], radius=1, fill=(30, 41, 59, 210))
    # Active fill (82%)
    draw.rounded_rectangle([bx1, by1, bx1 + int(bar_w * 0.82), by2], radius=1, fill=(220, 38, 38, 255))

    # Clean minimal status text
    status_txt = "SYSTEM READY // INITIALIZING DISPLAY"
    s_box = draw.textbbox((0, 0), status_txt, font=font_mono)
    sw = s_box[2] - s_box[0]
    draw.text((cx - sw // 2, by1 + 18), status_txt, fill=(148, 163, 184, 200), font=font_mono)

    return img


def generate_all_assets():
    print(f"[Splash Gen] Generating Minimalist Glitch Bootloader Assets into: {ASSETS_DIR}")

    # 1. Static 1080p Boot Splash
    splash_1080 = create_static_boot_splash(1920, 1080)
    splash_1080.convert("RGB").save(ASSETS_DIR / "boot_splash_1080p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_1080p.png'}")

    # 2. Static 720p Boot Splash
    splash_720 = create_static_boot_splash(1280, 720)
    splash_720.convert("RGB").save(ASSETS_DIR / "boot_splash_720p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_720p.png'}")

    # 3. Clean Background for Plymouth (pure obsidian, zero grid)
    plym_bg = create_minimal_background(1920, 1080)
    plym_bg.convert("RGB").save(ASSETS_DIR / "plymouth_bg.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'plymouth_bg.png'}")

    # 4. Glitch Text Animation Keyframes
    generate_glitch_frames()

    # 5. Minimal Hairline Progress Bar Components
    create_minimal_progress_components()

    print("[Splash Gen] Complete! Minimalist Glitch Bootloader Assets generated successfully.")


if __name__ == "__main__":
    generate_all_assets()
