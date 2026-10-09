#!/usr/bin/env python3
"""
PrintBooth Custom Bootloader Splash Generator — Light & Laser Red Matrix Edition
================================================================================
Generates high-definition Light & Red Matrix bootloader assets for:
  1. Plymouth graphical Matrix boot theme (cascading digital streams)
  2. Framebuffer early splash fallback (fbi / console)
  3. Pre-Chromium instant X11 canvas

Design Standards:
  - Theme: Light & Laser Red (Cybernetic Clean)
  - Background: Crisp Light Porcelain (#f8fafc / #ffffff)
  - Primary Accent: Laser Red (#dc2626)
  - Secondary Accent: Radiant Crimson (#ef4444)
  - Typography: Monospace Matrix Hardware Terminal
  - ZERO LOGO / ZERO EMBLEMS — Pure Digital Matrix Cyber Aesthetics
"""

import os
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR / "splash_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Character set for Matrix code streams
MATRIX_CHARS = "0123456789ABCDEF<>[]/*+=-:."


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
                font_main = ImageFont.truetype(font_path, 42)
                font_sub = ImageFont.truetype(font_path, 15)
                font_mono = ImageFont.truetype(font_path, 13)
                break
            except Exception:
                pass

    if not font_main:
        font_main = ImageFont.load_default()
        font_sub = font_main
        font_mono = font_main

    return font_main, font_sub, font_mono


def create_matrix_splash(width=1920, height=1080, progress=0.85, draw_progress=True) -> Image.Image:
    """Creates a high-definition Light & Red Matrix bootloader splash image (NO LOGO)."""
    # Crisp Light Porcelain background (#f8fafc)
    img = Image.new("RGBA", (width, height), (248, 250, 252, 255))
    draw = ImageDraw.Draw(img)

    font_main, font_sub, font_mono = get_fonts()
    cx, cy = width // 2, height // 2

    # 1. Subtle Cybernetic Coordinate Grid in light laser-red tint
    grid_spacing = 64
    grid_color = (220, 38, 38, 14)  # ~5% alpha red
    for x in range(0, width, grid_spacing):
        draw.line([(x, 0), (x, height)], fill=grid_color, width=1)
    for y in range(0, height, grid_spacing):
        draw.line([(0, y), (width, y)], fill=grid_color, width=1)

    # 2. Outer Cybernetic Framing HUD Brackets (Corner Brackets in Laser Red)
    pad = 48
    corner_len = 56
    line_w = 2
    bracket_color = (220, 38, 38, 160)  # Strong Laser Red
    # Top-Left
    draw.line([(pad, pad), (pad + corner_len, pad)], fill=bracket_color, width=line_w)
    draw.line([(pad, pad), (pad, pad + corner_len)], fill=bracket_color, width=line_w)
    # Top-Right
    draw.line([(width - pad - corner_len, pad), (width - pad, pad)], fill=bracket_color, width=line_w)
    draw.line([(width - pad, pad), (width - pad, pad + corner_len)], fill=bracket_color, width=line_w)
    # Bottom-Left
    draw.line([(pad, height - pad), (pad + corner_len, height - pad)], fill=bracket_color, width=line_w)
    draw.line([(pad, height - pad - corner_len), (pad, height - pad)], fill=bracket_color, width=line_w)
    # Bottom-Right
    draw.line([(width - pad - corner_len, height - pad), (width - pad, height - pad)], fill=bracket_color, width=line_w)
    draw.line([(width - pad, height - pad - corner_len), (width - pad, height - pad)], fill=bracket_color, width=line_w)

    # 3. Faint Background Matrix Streams (Light Red Digital Rain)
    random.seed(42)  # Deterministic aesthetic pattern
    col_width = 48
    for col_x in range(pad + 32, width - pad - 32, col_width):
        # Semi-transparent vertical matrix rain
        col_chars = random.randint(6, 18)
        start_y = random.randint(60, height - 300)
        for i in range(col_chars):
            ch = random.choice(MATRIX_CHARS)
            alpha = int(12 + (i / col_chars) * 38)
            y_pos = start_y + i * 22
            if y_pos < height - 70:
                draw.text((col_x, y_pos), ch, fill=(220, 38, 38, alpha), font=font_mono)

    # 4. Central Matrix Terminal Typography (NO LOGO)
    title = "P R I N T B O O T H"
    t_bbox = draw.textbbox((0, 0), title, font=font_main)
    tw = t_bbox[2] - t_bbox[0]
    # Laser-red drop shadow on text
    draw.text((cx - tw // 2 + 1, cy - 80 + 1), title, fill=(254, 202, 202, 180), font=font_main)
    draw.text((cx - tw // 2, cy - 80), title, fill=(220, 38, 38, 255), font=font_main)

    # Subtitle: Monospace Cyber Terminal Identifier
    subtitle = "[ SYSTEM MATRIX INITIALIZING · HARDWARE ENGINE ONLINE ]"
    s_bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
    sw = s_bbox[2] - s_bbox[0]
    draw.text((cx - sw // 2, cy - 18), subtitle, fill=(185, 28, 28, 220), font=font_sub)

    # 5. Optional Static Progress Bar (for Framebuffer Fallback)
    if draw_progress:
        bar_w = 460
        bar_h = 8
        bx1 = cx - bar_w // 2
        by1 = cy + 45
        bx2 = cx + bar_w // 2
        by2 = by1 + bar_h

        # Track background
        draw.rounded_rectangle([bx1, by1, bx2, by2], radius=4, fill=(241, 245, 249, 255), outline=(220, 38, 38, 120), width=1)
        # Laser-red active segment
        active_w = int(bar_w * max(0.05, min(1.0, progress)))
        draw.rounded_rectangle([bx1, by1, bx1 + active_w, by2], radius=4, fill=(220, 38, 38, 255))

        # Status telemetry text
        status_msg = "HEX: 0x4B494F534B // LOADING APPLIANCE FRAMEWORK..."
        m_bbox = draw.textbbox((0, 0), status_msg, font=font_mono)
        mw = m_bbox[2] - m_bbox[0]
        draw.text((cx - mw // 2, cy + 72), status_msg, fill=(185, 28, 28, 210), font=font_mono)

    # 6. Bottom Hardware Identifier
    footer_text = "MATRIX DIRECT-BOOT APPLIANCE // DEDICATED AUTONOMOUS KIOSK ENGINE"
    f_bbox = draw.textbbox((0, 0), footer_text, font=font_mono)
    fw = f_bbox[2] - f_bbox[0]
    draw.text((cx - fw // 2, height - pad - 18), footer_text, fill=(220, 38, 38, 140), font=font_mono)

    return img


def generate_matrix_stream_sprites():
    """Generates 4 vertical Laser-Red Matrix rain stream columns for dynamic Plymouth animation."""
    _, _, font_mono = get_fonts()
    random.seed(1337)

    col_w = 42
    col_h = 680

    for col_idx in range(1, 5):
        stream_img = Image.new("RGBA", (col_w, col_h), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(stream_img)

        rows = col_h // 22
        for r in range(rows):
            ch = random.choice(MATRIX_CHARS)
            # Gradient intensity down the stream: tail is faint red, head is bright laser red
            ratio = r / max(1, rows - 1)
            alpha = int(25 + ratio * 210)
            if ratio > 0.88:
                # Leading characters gleam with white-pink core
                color = (255, 255, 255, 255)
            else:
                color = (220, 38, 38, alpha)
            sdraw.text((8, r * 22), ch, fill=color, font=font_mono)

        filename = ASSETS_DIR / f"matrix_stream_{col_idx}.png"
        stream_img.save(filename)
        print(f"  [+] Created Matrix Stream Sprite: {filename}")


def generate_all_assets():
    print(f"[Splash Gen] Generating Light & Laser Red Matrix Bootloader Assets into: {ASSETS_DIR}")

    # 1. Main 1080p Static Boot Splash (for fbi early framebuffer)
    splash_1080 = create_matrix_splash(1920, 1080, progress=0.85, draw_progress=True)
    splash_1080.convert("RGB").save(ASSETS_DIR / "boot_splash_1080p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_1080p.png'}")

    # 2. 720p Touchscreen Edition
    splash_720 = create_matrix_splash(1280, 720, progress=0.85, draw_progress=True)
    splash_720.convert("RGB").save(ASSETS_DIR / "boot_splash_720p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_720p.png'}")

    # 3. Clean Background for Plymouth (Dynamic Matrix streams & bar rendered on top)
    plym_bg = create_matrix_splash(1920, 1080, draw_progress=False)
    plym_bg.convert("RGB").save(ASSETS_DIR / "plymouth_bg.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'plymouth_bg.png'}")

    # 4. Animated Matrix Rain Stream Sprites
    generate_matrix_stream_sprites()

    # 5. Laser-Red Progress Bar Components
    bar_width = 460
    bar_height = 8
    p_track = Image.new("RGBA", (bar_width, bar_height), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(p_track)
    tdraw.rounded_rectangle([0, 0, bar_width, bar_height], radius=4, fill=(241, 245, 249, 255), outline=(220, 38, 38, 140), width=1)
    p_track.save(ASSETS_DIR / "progress_track.png")

    p_bar = Image.new("RGBA", (bar_width, bar_height), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(p_bar)
    bdraw.rounded_rectangle([0, 0, bar_width, bar_height], radius=4, fill=(220, 38, 38, 255))
    p_bar.save(ASSETS_DIR / "progress_bar.png")

    # 6. Laser Red Glowing Progress Head
    glow_size = 24
    p_glow = Image.new("RGBA", (glow_size, glow_size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(p_glow)
    gdraw.ellipse([2, 2, glow_size - 2, glow_size - 2], fill=(239, 68, 68, 210))
    p_glow.save(ASSETS_DIR / "progress_glow.png")
    print("  [+] Created Laser-Red Matrix Progress Components")

    print("[Splash Gen] Complete! Light & Laser Red Matrix assets generated.")


if __name__ == "__main__":
    generate_all_assets()
