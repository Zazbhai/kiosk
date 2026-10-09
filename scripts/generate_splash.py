#!/usr/bin/env python3
"""
PrintBooth Custom Bootloader Splash Generator — Extraordinary Cyber Matrix Edition
===================================================================================
Generates cinematic, high-definition Cyber Matrix bootloader assets for:
  1. Plymouth graphical boot theme:
     - Dual counter-rotating cybernetic reticle dials
     - Pulsating laser core aperture
     - Full-screen holographic laser scanline beam
     - 6 cascading digital matrix stream columns with white-hot leading nodes
     - Precision progress bar with traveling spark particle flare
  2. Framebuffer early splash fallback (fbi / console)
  3. Pre-Chromium instant X11 canvas (#06110D)

Design Standards:
  - Theme: Capitalio Obsidian & Radiant Laser Red (#06110D / #dc2626 / #ef4444)
  - Aesthetics: Aerospace IoT Appliance · Quantum Hardware Chassis
  - Typography: Monospace Cybernetic Hardware Terminal
"""

import os
import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR / "splash_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Character set for Matrix code streams (hex, glyphs, logic gates)
MATRIX_CHARS = "0123456789ABCDEF<>[]/*+=-:.~#|ΔΩΨ"


def get_fonts():
    font_main = None
    font_sub = None
    font_mono = None
    font_micro = None
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
                font_main = ImageFont.truetype(font_path, 40)
                font_sub = ImageFont.truetype(font_path, 14)
                font_mono = ImageFont.truetype(font_path, 12)
                font_micro = ImageFont.truetype(font_path, 10)
                break
            except Exception:
                pass

    if not font_main:
        font_main = ImageFont.load_default()
        font_sub = font_main
        font_mono = font_main
        font_micro = font_main

    return font_main, font_sub, font_mono, font_micro


def create_cyber_background(width=1920, height=1080, draw_static_overlay=False, progress=0.82) -> Image.Image:
    """Creates a high-definition Capitalio Obsidian & Laser Red Cybernetic background canvas."""
    img = Image.new("RGBA", (width, height), (6, 17, 13, 255))  # #06110D pure obsidian
    draw = ImageDraw.Draw(img)
    font_main, font_sub, font_mono, font_micro = get_fonts()
    cx, cy = width // 2, height // 2

    # 1. Atmospheric Ambient Radial Glow in center
    # Create radial gradient ring around center reticle/typography
    radial_canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    r_draw = ImageDraw.Draw(radial_canvas)
    max_radius = int(min(width, height) * 0.55)
    for r in range(max_radius, 0, -24):
        alpha = int(22 * (1.0 - (r / max_radius) ** 1.5))
        if alpha > 0:
            r_draw.ellipse(
                [cx - r, cy - 80 - r, cx + r, cy - 80 + r],
                fill=(220, 38, 38, alpha),
            )
    img = Image.alpha_composite(img, radial_canvas)
    draw = ImageDraw.Draw(img)

    # 2. Precision Isometric Cybernetic Coordinate Grid
    grid_spacing = 60
    grid_color = (220, 38, 38, 16)  # Subtle 6% laser red
    for x in range(0, width, grid_spacing):
        draw.line([(x, 0), (x, height)], fill=grid_color, width=1)
    for y in range(0, height, grid_spacing):
        draw.line([(0, y), (width, y)], fill=grid_color, width=1)

    # Subtle major grid accents every 4 cells
    major_grid = grid_spacing * 4
    major_color = (220, 38, 38, 32)
    for x in range(0, width, major_grid):
        draw.line([(x, 0), (x, height)], fill=major_color, width=1)
    for y in range(0, height, major_grid):
        draw.line([(0, y), (width, y)], fill=major_color, width=1)

    # Micro crosshairs (+) at grid intersections
    for x in range(major_grid, width - major_grid + 1, major_grid):
        for y in range(major_grid, height - major_grid + 1, major_grid):
            draw.line([(x - 4, y), (x + 4, y)], fill=(239, 68, 68, 65), width=1)
            draw.line([(x, y - 4), (x, y + 4)], fill=(239, 68, 68, 65), width=1)

    # 3. Outer Tactical HUD Framing Brackets (Laser Red with Sub-Pixel Crosshairs)
    pad = 42
    corner_len = 64
    bracket_col = (220, 38, 38, 220)
    tick_col = (239, 68, 68, 140)

    # Top-Left Bracket
    draw.line([(pad, pad), (pad + corner_len, pad)], fill=bracket_col, width=2)
    draw.line([(pad, pad), (pad, pad + corner_len)], fill=bracket_col, width=2)
    draw.line([(pad + 12, pad + 6), (pad + 12, pad + 12)], fill=tick_col, width=1)
    draw.line([(pad + 24, pad + 6), (pad + 24, pad + 12)], fill=tick_col, width=1)
    draw.text((pad + 14, pad + 16), "SYS_POS: [00.00, 00.00] // SECTOR-A", fill=(220, 38, 38, 150), font=font_micro)

    # Top-Right Bracket
    draw.line([(width - pad - corner_len, pad), (width - pad, pad)], fill=bracket_col, width=2)
    draw.line([(width - pad, pad), (width - pad, pad + corner_len)], fill=bracket_col, width=2)
    draw.line([(width - pad - 12, pad + 6), (width - pad - 12, pad + 12)], fill=tick_col, width=1)
    draw.line([(width - pad - 24, pad + 6), (width - pad - 24, pad + 12)], fill=tick_col, width=1)
    draw.text((width - pad - 210, pad + 16), "HARDWARE BUS: CM4-ARM64 // ONLINE", fill=(220, 38, 38, 150), font=font_micro)

    # Bottom-Left Bracket
    draw.line([(pad, height - pad), (pad + corner_len, height - pad)], fill=bracket_col, width=2)
    draw.line([(pad, height - pad - corner_len), (pad, height - pad)], fill=bracket_col, width=2)
    draw.text((pad + 14, height - pad - 24), "ENCLAVE: AES-256-GCM // CUPS ACTIVE", fill=(220, 38, 38, 150), font=font_micro)

    # Bottom-Right Bracket
    draw.line([(width - pad - corner_len, height - pad), (width - pad, height - pad)], fill=bracket_col, width=2)
    draw.line([(width - pad, height - pad - corner_len), (width - pad, height - pad)], fill=bracket_col, width=2)
    draw.text((width - pad - 200, height - pad - 24), "STATION IDENT: PB-KIOSK-001", fill=(220, 38, 38, 150), font=font_micro)

    # 4. Top Status Header Pill
    hdr_text = "● PRINTBOOTH AUTONOMOUS TERMINAL // SECURE HARDWARE BOOT"
    h_box = draw.textbbox((0, 0), hdr_text, font=font_mono)
    hw = h_box[2] - h_box[0]
    pill_w = hw + 36
    pill_h = 26
    px1 = cx - pill_w // 2
    py1 = pad + 8
    draw.rounded_rectangle([px1, py1, px1 + pill_w, py1 + pill_h], radius=13, fill=(15, 23, 42, 220), outline=(220, 38, 38, 130), width=1)
    draw.text((cx - hw // 2, py1 + 6), hdr_text, fill=(248, 113, 113, 240), font=font_mono)

    # 5. Central Typography HUD (Rendered on background)
    title = "P R I N T B O O T H"
    t_bbox = draw.textbbox((0, 0), title, font=font_main)
    tw = t_bbox[2] - t_bbox[0]
    ty = cy + 22

    # High-intensity laser red glow behind text
    for offset in [-2, -1, 1, 2]:
        draw.text((cx - tw // 2 + offset, ty), title, fill=(220, 38, 38, 60), font=font_main)
        draw.text((cx - tw // 2, ty + offset), title, fill=(220, 38, 38, 60), font=font_main)

    # Text core in pure brilliant porcelain with slight red specular
    draw.text((cx - tw // 2, ty), title, fill=(255, 255, 255, 255), font=font_main)

    # Subtitle: Monospace Cyber Terminal Identifier
    subtitle = "[ AUTONOMOUS HARDWARE PRINTING APPLIANCE · HIGH-PERFORMANCE BUS ]"
    s_bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
    sw = s_bbox[2] - s_bbox[0]
    draw.text((cx - sw // 2, ty + 54), subtitle, fill=(239, 68, 68, 220), font=font_sub)

    # 6. Static Overlay for early framebuffer splash (if draw_static_overlay=True)
    if draw_static_overlay:
        # Draw central reticle placeholder
        r_radius = 110
        rcy = cy - 110
        draw.ellipse([cx - r_radius, rcy - r_radius, cx + r_radius, rcy + r_radius], outline=(220, 38, 38, 160), width=2)
        draw.ellipse([cx - 70, rcy - 70, cx + 70, rcy + 70], outline=(239, 68, 68, 190), width=1)
        draw.ellipse([cx - 25, rcy - 25, cx + 25, rcy + 25], fill=(220, 38, 38, 120), outline=(255, 255, 255, 220), width=1)

        # Progress bar
        bar_w = 480
        bar_h = 10
        bx1 = cx - bar_w // 2
        by1 = cy + 124
        bx2 = cx + bar_w // 2
        by2 = by1 + bar_h

        draw.rounded_rectangle([bx1, by1, bx2, by2], radius=5, fill=(15, 23, 42, 230), outline=(220, 38, 38, 160), width=1)
        active_w = int(bar_w * max(0.05, min(1.0, progress)))
        draw.rounded_rectangle([bx1 + 1, by1 + 1, bx1 + active_w, by2 - 1], radius=4, fill=(220, 38, 38, 255))

        status_msg = "// [STAGE 06/06] ENCRYPTED SPOOL ENGINE SYNCHRONIZED -> 100%"
        m_bbox = draw.textbbox((0, 0), status_msg, font=font_mono)
        mw = m_bbox[2] - m_bbox[0]
        draw.text((cx - mw // 2, by1 + 24), status_msg, fill=(248, 113, 113, 230), font=font_mono)

    return img


def create_reticle_sprites():
    """
    Generates 3 concentric high-precision cybernetic reticle dials for Plymouth rotation:
      1. reticle_outer.png (280x280): Precision outer HUD dial with millimeter tick marks
      2. reticle_mid.png (190x190): Segmented inner arc sectors with dot matrix perforations
      3. reticle_core.png (110x110): Radiant pulsating laser core aperture
    """
    # 1. RETICLE OUTER (280 x 280)
    size_outer = 280
    img_outer = Image.new("RGBA", (size_outer, size_outer), (0, 0, 0, 0))
    d_out = ImageDraw.Draw(img_outer)
    ocx, ocy = size_outer // 2, size_outer // 2
    radius_outer = 126

    # Outer circle track
    d_out.ellipse([ocx - radius_outer, ocy - radius_outer, ocx + radius_outer, ocy + radius_outer], outline=(220, 38, 38, 140), width=1)

    # 72 radial tick marks around circumference
    for i in range(72):
        angle = (2 * math.pi / 72) * i
        is_major = (i % 6 == 0)
        tick_len = 10 if is_major else 5
        color = (255, 255, 255, 220) if is_major else (220, 38, 38, 160)
        width = 2 if is_major else 1

        x1 = ocx + (radius_outer - tick_len) * math.cos(angle)
        y1 = ocy + (radius_outer - tick_len) * math.sin(angle)
        x2 = ocx + radius_outer * math.cos(angle)
        y2 = ocy + radius_outer * math.sin(angle)
        d_out.line([(x1, y1), (x2, y2)], fill=color, width=width)

    # 4 Cardinal outer brackets
    for angle_deg in [0, 90, 180, 270]:
        rad = math.radians(angle_deg)
        bx = ocx + (radius_outer + 8) * math.cos(rad)
        by = ocy + (radius_outer + 8) * math.sin(rad)
        d_out.ellipse([bx - 3, by - 3, bx + 3, by + 3], fill=(239, 68, 68, 240))

    img_outer.save(ASSETS_DIR / "reticle_outer.png")
    print(f"  [+] Created Reticle Outer: {ASSETS_DIR / 'reticle_outer.png'}")

    # 2. RETICLE MID (190 x 190)
    size_mid = 190
    img_mid = Image.new("RGBA", (size_mid, size_mid), (0, 0, 0, 0))
    d_mid = ImageDraw.Draw(img_mid)
    mcx, mcy = size_mid // 2, size_mid // 2
    r_mid = 82

    # 6 Segmented arcs with precision gaps
    for seg in range(6):
        start_deg = seg * 60 + 8
        end_deg = (seg + 1) * 60 - 8
        d_mid.arc([mcx - r_mid, mcy - r_mid, mcx + r_mid, mcy + r_mid], start=start_deg, end=end_deg, fill=(239, 68, 68, 210), width=2)

    # Dot array inside segments
    r_dots = 62
    for i in range(24):
        ang = (2 * math.pi / 24) * i
        dx = mcx + r_dots * math.cos(ang)
        dy = mcy + r_dots * math.sin(ang)
        alpha = 240 if (i % 4 == 0) else 120
        d_mid.ellipse([dx - 1.5, dy - 1.5, dx + 1.5, dy + 1.5], fill=(255, 255, 255, alpha))

    img_mid.save(ASSETS_DIR / "reticle_mid.png")
    print(f"  [+] Created Reticle Mid: {ASSETS_DIR / 'reticle_mid.png'}")

    # 3. RETICLE CORE (110 x 110)
    size_core = 110
    img_core = Image.new("RGBA", (size_core, size_core), (0, 0, 0, 0))
    d_core = ImageDraw.Draw(img_core)
    ccx, ccy = size_core // 2, size_core // 2

    # Glowing radial gradient disc
    for r in range(48, 0, -3):
        a = int(180 * (1.0 - (r / 48) ** 1.8))
        d_core.ellipse([ccx - r, ccy - r, ccx + r, ccy + r], fill=(220, 38, 38, a))

    # Precision Laser Diamond
    diamond = [
        (ccx, ccy - 24),
        (ccx + 24, ccy),
        (ccx, ccy + 24),
        (ccx - 24, ccy),
    ]
    d_core.polygon(diamond, outline=(255, 255, 255, 240), fill=(220, 38, 38, 160))

    # White-hot intense core focal node
    d_core.ellipse([ccx - 6, ccy - 6, ccx + 6, ccy + 6], fill=(255, 255, 255, 255))
    d_core.line([(ccx - 36, ccy), (ccx + 36, ccy)], fill=(255, 255, 255, 180), width=1)
    d_core.line([(ccx, ccy - 36), (ccx, ccy + 36)], fill=(255, 255, 255, 180), width=1)

    img_core.save(ASSETS_DIR / "reticle_core.png")
    print(f"  [+] Created Reticle Core: {ASSETS_DIR / 'reticle_core.png'}")


def create_laser_scanline():
    """Generates horizontal holographic laser sweep beam (1920x8 px)."""
    width = 1920
    height = 8
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    for y in range(height):
        # Vertical gaussian-like falloff
        dist = abs(y - height // 2)
        if dist == 0:
            alpha = 240
            color = (255, 255, 255, alpha)
        elif dist == 1:
            alpha = 180
            color = (248, 113, 113, alpha)
        else:
            alpha = int(90 * (1.0 - dist / (height // 2)))
            color = (220, 38, 38, alpha)
        draw.line([(0, y), (width, y)], fill=color, width=1)

    img.save(ASSETS_DIR / "laser_scanline.png")
    print(f"  [+] Created Laser Scanline: {ASSETS_DIR / 'laser_scanline.png'}")


def generate_matrix_stream_sprites():
    """Generates 6 vertical Laser-Red Matrix rain stream columns with glowing white-hot heads."""
    _, _, font_mono, _ = get_fonts()
    random.seed(2026)

    col_w = 42
    col_h = 720

    for col_idx in range(1, 7):
        stream_img = Image.new("RGBA", (col_w, col_h), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(stream_img)

        rows = col_h // 22
        for r in range(rows):
            ch = random.choice(MATRIX_CHARS)
            ratio = r / max(1, rows - 1)

            # Gradient alpha down the stream
            alpha = int(18 + ratio * 220)
            if ratio > 0.90:
                # Leading 2 characters gleam with brilliant incandescent white core
                color = (255, 255, 255, 255)
            elif ratio > 0.75:
                # Glowing radiant laser-red halo
                color = (248, 113, 113, alpha)
            else:
                # Fading crimson tail
                color = (220, 38, 38, alpha)

            sdraw.text((8, r * 22), ch, fill=color, font=font_mono)

        filename = ASSETS_DIR / f"matrix_stream_{col_idx}.png"
        stream_img.save(filename)
        print(f"  [+] Created Matrix Stream: {filename}")


def create_progress_components():
    """Generates high-precision laser progress bar with traveling spark flare."""
    bar_width = 480
    bar_height = 10

    # 1. Track: Glassy container with hairline laser-red border and internal division ticks
    p_track = Image.new("RGBA", (bar_width, bar_height), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(p_track)
    tdraw.rounded_rectangle([0, 0, bar_width, bar_height], radius=5, fill=(15, 23, 42, 220), outline=(220, 38, 38, 160), width=1)

    # Vertical division notches at 10%, 20% ... 90%
    for step in range(1, 10):
        tx = int(bar_width * (step / 10.0))
        tdraw.line([(tx, 2), (tx, bar_height - 3)], fill=(220, 38, 38, 90), width=1)
    p_track.save(ASSETS_DIR / "progress_track.png")

    # 2. Bar: Glowing laser red active fill
    p_bar = Image.new("RGBA", (bar_width, bar_height), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(p_bar)
    bdraw.rounded_rectangle([0, 0, bar_width, bar_height], radius=5, fill=(220, 38, 38, 255))
    # Specular upper highlight
    bdraw.line([(3, 2), (bar_width - 3, 2)], fill=(255, 255, 255, 120), width=1)
    p_bar.save(ASSETS_DIR / "progress_bar.png")

    # 3. Traveling Spark Particle Flare (32x32)
    spark_size = 32
    p_spark = Image.new("RGBA", (spark_size, spark_size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(p_spark)
    scx, scy = spark_size // 2, spark_size // 2

    # Radial corona
    for r in range(15, 0, -2):
        sa = int(190 * (1.0 - (r / 15) ** 1.5))
        sdraw.ellipse([scx - r, scy - r, scx + r, scy + r], fill=(220, 38, 38, sa))

    # 4-point cross starburst
    sdraw.line([(scx - 14, scy), (scx + 14, scy)], fill=(255, 255, 255, 230), width=2)
    sdraw.line([(scx, scy - 14), (scx, scy + 14)], fill=(255, 255, 255, 230), width=2)
    sdraw.ellipse([scx - 4, scy - 4, scx + 4, scy + 4], fill=(255, 255, 255, 255))

    p_spark.save(ASSETS_DIR / "progress_spark.png")
    # Also save progress_glow.png for backwards compatibility
    p_spark.save(ASSETS_DIR / "progress_glow.png")
    print(f"  [+] Created Laser Progress Components in {ASSETS_DIR}")


def generate_all_assets():
    print(f"[Splash Gen] Generating Extraordinary Cyber Matrix Bootloader Assets into: {ASSETS_DIR}")

    # 1. Main 1080p Static Boot Splash (for fbi early framebuffer)
    splash_1080 = create_cyber_background(1920, 1080, draw_static_overlay=True, progress=0.88)
    splash_1080.convert("RGB").save(ASSETS_DIR / "boot_splash_1080p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_1080p.png'}")

    # 2. 720p Touchscreen Edition
    splash_720 = create_cyber_background(1280, 720, draw_static_overlay=True, progress=0.88)
    splash_720.convert("RGB").save(ASSETS_DIR / "boot_splash_720p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_720p.png'}")

    # 3. Clean Background for Plymouth (Dynamic Matrix streams, reticle, scanline & bar rendered on top)
    plym_bg = create_cyber_background(1920, 1080, draw_static_overlay=False)
    plym_bg.convert("RGB").save(ASSETS_DIR / "plymouth_bg.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'plymouth_bg.png'}")

    # 4. Rotating Reticle Dials (Outer, Mid, Core)
    create_reticle_sprites()

    # 5. Holographic Laser Scanline
    create_laser_scanline()

    # 6. Animated Matrix Rain Stream Sprites (6 columns)
    generate_matrix_stream_sprites()

    # 7. Laser Progress Bar Components & Spark
    create_progress_components()

    print("[Splash Gen] Complete! Extraordinary Cyber Matrix assets generated successfully.")


if __name__ == "__main__":
    generate_all_assets()
