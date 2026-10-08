#!/usr/bin/env python3
"""
PrintBooth Custom Bootloader Splash Generator
=============================================
Generates high-resolution branded boot splash assets for:
  1. Plymouth Linux graphical bootloader theme
  2. Framebuffer bootloader splash (fbi / early console)
  3. Pre-Chromium instant X11 background canvas

Design Standards:
  - Background: Deep Capitalio Obsidian (#06110D)
  - Primary Accent: Synthetic Lime (#c8ff00)
  - Secondary Accent: Laser Red (#dc2626)
  - High-contrast crisp typography and hardware kiosk indicators
"""

import os
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR / "splash_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


def create_splash_image(width=1920, height=1080, progress=0.7) -> Image.Image:
    """Creates a high-definition 1920x1080 PrintBooth bootloader splash image."""
    img = Image.new("RGBA", (width, height), (6, 17, 13, 255))  # #06110D
    draw = ImageDraw.Draw(img)

    # 1. Subtle radial ambient glow in center
    cx, cy = width // 2, height // 2
    max_radius = int(math.hypot(width, height) // 2)
    for r in range(max_radius, 0, -40):
        alpha = int(18 * (1.0 - (r / max_radius)) ** 2)
        # Deep emerald-obsidian glow
        glow_color = (15, 38, 28, alpha)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=glow_color)

    # 2. Modern subtle geometric grid overlay
    grid_spacing = 60
    grid_color = (20, 35, 27, 40)
    for x in range(0, width, grid_spacing):
        draw.line([(x, 0), (x, height)], fill=grid_color, width=1)
    for y in range(0, height, grid_spacing):
        draw.line([(0, y), (width, y)], fill=grid_color, width=1)

    # 3. Outer HUD framing brackets (corners)
    pad = 48
    corner_len = 54
    line_w = 2
    accent_muted = (200, 255, 0, 90)  # Lime muted
    # Top-Left
    draw.line([(pad, pad), (pad + corner_len, pad)], fill=accent_muted, width=line_w)
    draw.line([(pad, pad), (pad, pad + corner_len)], fill=accent_muted, width=line_w)
    # Top-Right
    draw.line([(width - pad - corner_len, pad), (width - pad, pad)], fill=accent_muted, width=line_w)
    draw.line([(width - pad, pad), (width - pad, pad + corner_len)], fill=accent_muted, width=line_w)
    # Bottom-Left
    draw.line([(pad, height - pad), (pad + corner_len, height - pad)], fill=accent_muted, width=line_w)
    draw.line([(pad, height - pad - corner_len), (pad, height - pad)], fill=accent_muted, width=line_w)
    # Bottom-Right
    draw.line([(width - pad - corner_len, height - pad), (width - pad, height - pad)], fill=accent_muted, width=line_w)
    draw.line([(width - pad, height - pad - corner_len), (width - pad, height - pad)], fill=accent_muted, width=line_w)

    # 4. Central Emblem / Icon Shield
    icon_w, icon_h = 96, 96
    ix1, iy1 = cx - icon_w // 2, cy - 140 - icon_h // 2
    ix2, iy2 = cx + icon_w // 2, cy - 140 + icon_h // 2

    # Emblem outer glow
    draw.rounded_rectangle([ix1 - 8, iy1 - 8, ix2 + 8, iy2 + 8], radius=24, fill=(200, 255, 0, 15))
    draw.rounded_rectangle([ix1, iy1, ix2, iy2], radius=20, fill=(11, 26, 20, 255), outline=(200, 255, 0, 200), width=2)

    # Laser-red printer aperture dot
    draw.ellipse([cx - 14, cy - 140 - 14, cx + 14, cy - 140 + 14], fill=(220, 38, 38, 255))  # #dc2626
    draw.ellipse([cx - 5, cy - 140 - 5, cx + 5, cy - 140 + 5], fill=(255, 255, 255, 240))

    # 5. Typographic Branding: PRINTBOOTH
    # Fallback to default bitmap or system font if ttf unavailable
    font_main = None
    font_sub = None
    font_mono = None
    for font_path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
    ]:
        if os.path.exists(font_path):
            try:
                font_main = ImageFont.truetype(font_path, 46)
                font_sub = ImageFont.truetype(font_path, 15)
                font_mono = ImageFont.truetype(font_path, 12)
                break
            except Exception:
                pass

    if not font_main:
        font_main = ImageFont.load_default()
        font_sub = font_main
        font_mono = font_main

    # Title: PRINTBOOTH
    title = "P R I N T B O O T H"
    t_bbox = draw.textbbox((0, 0), title, font=font_main)
    tw = t_bbox[2] - t_bbox[0]
    draw.text((cx - tw // 2, cy - 50), title, fill=(255, 255, 255, 255), font=font_main)

    # Subtitle: AUTONOMOUS TOUCHSCREEN TERMINAL
    subtitle = "AUTONOMOUS HARDWARE KIOSK APPLIANCE"
    s_bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
    sw = s_bbox[2] - s_bbox[0]
    draw.text((cx - sw // 2, cy + 18), subtitle, fill=(160, 185, 170, 220), font=font_sub)

    # 6. Sleek Hardware Progress Bar
    bar_w = 420
    bar_h = 6
    bx1 = cx - bar_w // 2
    by1 = cy + 70
    bx2 = cx + bar_w // 2
    by2 = by1 + bar_h

    # Bar background track
    draw.rounded_rectangle([bx1, by1, bx2, by2], radius=3, fill=(25, 45, 35, 255))
    # Active filled segment (Synthetic Lime)
    active_w = int(bar_w * max(0.05, min(1.0, progress)))
    draw.rounded_rectangle([bx1, by1, bx1 + active_w, by2], radius=3, fill=(200, 255, 0, 255))

    # Glow around progress head
    draw.ellipse([bx1 + active_w - 6, by1 - 3, bx1 + active_w + 6, by2 + 3], fill=(200, 255, 0, 160))

    # 7. Status Text / Boot Diagnostic indicator
    status_msg = "INITIALIZING SECURE HARDWARE SUBSYSTEMS..."
    m_bbox = draw.textbbox((0, 0), status_msg, font=font_mono)
    mw = m_bbox[2] - m_bbox[0]
    draw.text((cx - mw // 2, cy + 96), status_msg, fill=(120, 150, 135, 200), font=font_mono)

    # 8. Bottom Hardware Identifier
    footer_text = "ZERO-QUEUE HARDWARE ENGINE · AUTOMATIC SPOOL PURGE ON REBOOT"
    f_bbox = draw.textbbox((0, 0), footer_text, font=font_mono)
    fw = f_bbox[2] - f_bbox[0]
    draw.text((cx - fw // 2, height - pad - 18), footer_text, fill=(75, 105, 90, 180), font=font_mono)

    return img


def generate_all_assets():
    print(f"[Splash Gen] Generating PrintBooth bootloader graphics into: {ASSETS_DIR}")

    # 1. Main 1080p Boot Splash
    splash_1080 = create_splash_image(1920, 1080, progress=0.85)
    splash_1080.convert("RGB").save(ASSETS_DIR / "boot_splash_1080p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_1080p.png'}")

    # 2. 720p Touchscreen Edition (for official 7-inch Raspberry Pi Display 800x480 / 1280x720)
    splash_720 = create_splash_image(1280, 720, progress=0.85)
    splash_720.convert("RGB").save(ASSETS_DIR / "boot_splash_720p.png", quality=95)
    print(f"  [+] Created {ASSETS_DIR / 'boot_splash_720p.png'}")

    # 3. Plymouth Centered Watermark & Box
    box_img = Image.new("RGBA", (500, 240), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(box_img)
    # Emblem
    bdraw.rounded_rectangle([250 - 40, 20, 250 + 40, 100], radius=16, fill=(11, 26, 20, 255), outline=(200, 255, 0, 240), width=2)
    bdraw.ellipse([250 - 12, 60 - 12, 250 + 12, 60 + 12], fill=(220, 38, 38, 255))
    bdraw.ellipse([250 - 4, 60 - 4, 250 + 4, 60 + 4], fill=(255, 255, 255, 240))
    box_img.save(ASSETS_DIR / "plymouth_watermark.png")
    print(f"  [+] Created {ASSETS_DIR / 'plymouth_watermark.png'}")

    # 4. Progress bar frame for Plymouth
    p_track = Image.new("RGBA", (400, 8), (25, 45, 35, 255))
    p_track.save(ASSETS_DIR / "progress_track.png")

    p_bar = Image.new("RGBA", (400, 8), (200, 255, 0, 255))
    p_bar.save(ASSETS_DIR / "progress_bar.png")
    print("  [+] Created Plymouth animation primitives")

    print("[Splash Gen] Complete! Assets ready for Plymouth and Framebuffer splash.")


if __name__ == "__main__":
    generate_all_assets()
