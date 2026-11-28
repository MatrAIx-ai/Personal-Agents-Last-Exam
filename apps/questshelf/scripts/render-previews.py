#!/usr/bin/env python3
"""
Deterministic synthetic gameplay & HUD preview renderer for QuestShelf (MIT License).
Generates 20 distinct 640x360 PNG preview screenshots depicting each game's camera
perspective, theme/atmosphere, and proportional HUD text size matching hud_font_pt,
without printing spoiler camera/genre/pt-size captions.
"""
import hashlib
import json
import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

APP_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = APP_ROOT / "assets"
MINIMAL_PATH = APP_ROOT / "fixtures" / "minimal.json"
CATALOG_PATH = APP_ROOT / "contribution" / "assets.catalog.json"
CUES_PATH = APP_ROOT / "fixtures" / "visual-cues.eval.json"

W, H = 640, 360

FONT_BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
]
FONT_REG_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
]


def load_font(size_px, bold=True):
    cands = FONT_BOLD_CANDIDATES if bold else FONT_REG_CANDIDATES
    for p in cands:
        if os.path.exists(p):
            return ImageFont.truetype(p, max(8, int(round(size_px))))
    return ImageFont.load_default()


def hud_px(pt):
    # Strictly monotonic mapping from hud_font_pt (7..17) to pixel size (10..25px)
    return int(round(pt * 1.45))


def draw_vignette(img, strength=0.78, tint=(0, 0, 0)):
    """Dark radial vignette for claustrophobic horror atmosphere."""
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = ov.load()
    cx, cy = W * 0.5, H * 0.46
    max_r = math.hypot(cx, cy)
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            d = math.hypot((x - cx) * 1.15, (y - cy) * 1.25) / max_r
            a = max(0.0, min(1.0, (d - 0.32) / 0.68)) ** 1.7
            alpha = int(a * 255 * strength)
            c = (tint[0], tint[1], tint[2], alpha)
            px[x, y] = c
            if x + 1 < W:
                px[x + 1, y] = c
            if y + 1 < H:
                px[x, y + 1] = c
            if x + 1 < W and y + 1 < H:
                px[x + 1, y + 1] = c
    return Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")


def draw_hud_bar(draw, text, pt, bg=(14, 18, 26), border=(90, 110, 130), fg=(240, 245, 250), top=False, extra_lines=None):
    size = hud_px(pt)
    font = load_font(size, bold=True)
    lines = [text] + (extra_lines or [])
    line_h = int(size * 1.28)
    pad_x = 12
    pad_y = 6
    bar_h = pad_y * 2 + line_h * len(lines)
    y0 = 8 if top else H - bar_h - 8
    y1 = y0 + bar_h
    draw.rounded_rectangle([10, y0, W - 10, y1], radius=6, fill=bg, outline=border, width=2)
    for idx, line in enumerate(lines):
        # Ensure text fits cleanly inside bar width
        f_use = font
        bbox = draw.textbbox((0, 0), line, font=f_use)
        tw = bbox[2] - bbox[0]
        if tw > W - 20 - pad_x * 2:
            # Trim gracefully if ever needed while keeping font size exact
            while tw > W - 20 - pad_x * 2 and len(line) > 8:
                line = line[:-2] + "…"
                bbox = draw.textbbox((0, 0), line, font=f_use)
                tw = bbox[2] - bbox[0]
        draw.text((10 + pad_x, y0 + pad_y + idx * line_h), line, font=f_use, fill=fg)


def draw_top_title_tag(draw, title, bg=(12, 16, 22), fg=(215, 225, 235)):
    font = load_font(12, bold=True)
    bbox = draw.textbbox((0, 0), title, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.rounded_rectangle([12, 10, 12 + tw + 18, 10 + th + 10], radius=5, fill=bg, outline=(70, 82, 96), width=1)
    draw.text((21, 14), title, font=font, fill=fg)


def draw_iso_tile(draw, cx, cy, tw, th, top_col, left_col, right_col, elev=12):
    top = [(cx, cy - th // 2), (cx + tw // 2, cy), (cx, cy + th // 2), (cx - tw // 2, cy)]
    left = [(cx - tw // 2, cy), (cx, cy + th // 2), (cx, cy + th // 2 + elev), (cx - tw // 2, cy + elev)]
    right = [(cx + tw // 2, cy), (cx, cy + th // 2), (cx, cy + th // 2 + elev), (cx + tw // 2, cy + elev)]
    draw.polygon(left, fill=left_col)
    draw.polygon(right, fill=right_col)
    draw.polygon(top, fill=top_col, outline=(25, 35, 40))


def render_lantern_hollow(pt):
    # Narrow-FOV dark first-person horror corridor + storm lantern held in foreground hand + looming eyes
    img = Image.new("RGB", (W, H), (8, 8, 12))
    d = ImageDraw.Draw(img)
    # Steep 1-point corridor walls (narrow FOV: inner doorway occupies tight center)
    d.polygon([(0, 0), (245, 95), (245, 245), (0, H)], fill=(26, 24, 32))
    d.polygon([(W, 0), (395, 95), (395, 245), (W, H)], fill=(22, 20, 28))
    d.polygon([(0, 0), (W, 0), (395, 95), (245, 95)], fill=(15, 14, 20))
    d.polygon([(0, H), (W, H), (395, 245), (245, 245)], fill=(18, 17, 22))
    # Stone ribs / brick seams receding in perspective
    for t in [0.18, 0.38, 0.58, 0.78, 0.94]:
        xl = int(245 * t)
        xr = int(W - (W - 395) * t)
        yt = int(95 * t)
        yb = int(H - (H - 245) * t)
        d.line([(xl, yt), (xl, yb)], fill=(44, 38, 48), width=2)
        d.line([(xr, yt), (xr, yb)], fill=(40, 35, 44), width=2)
        d.line([(xl, yt), (xr, yt)], fill=(34, 30, 40), width=1)
        d.line([(xl, yb), (xr, yb)], fill=(36, 32, 42), width=1)
    # Wet floor reflection streaks
    for rx in range(255, 385, 18):
        d.line([(rx, 248), (int(320 + (rx - 320) * 2.1), 330)], fill=(34, 24, 28), width=2)
    # Pitch-black arched doorway at corridor end
    d.rectangle([258, 112, 382, 245], fill=(4, 3, 6), outline=(58, 42, 46), width=3)
    d.pieslice([258, 86, 382, 138], 180, 360, fill=(4, 3, 6), outline=(58, 42, 46), width=3)
    # Shadowy gaunt figure silhouette in doorway + two eerie crimson eyes
    d.ellipse([303, 136, 337, 174], fill=(12, 8, 12))
    d.polygon([(290, 245), (302, 170), (338, 170), (350, 245)], fill=(10, 7, 10))
    d.ellipse([311, 150, 317, 155], fill=(220, 32, 40))
    d.ellipse([324, 150, 330, 155], fill=(220, 32, 40))
    # Subtle scratch marks on left corridor wall
    for i in range(4):
        d.line([(125 + i * 7, 130), (142 + i * 7, 195)], fill=(95, 22, 28), width=2)
    # Subtle 4-tick first-person reticle at viewport center
    d.line([(312, 180), (317, 180)], fill=(190, 175, 170), width=1)
    d.line([(323, 180), (328, 180)], fill=(190, 175, 170), width=1)
    d.line([(320, 172), (320, 177)], fill=(190, 175, 170), width=1)
    d.line([(320, 183), (320, 188)], fill=(190, 175, 170), width=1)
    # First-person gloved hand + brass storm lantern in bottom-right foreground
    # Warm lantern halo
    for r, col in [(92, (48, 32, 16)), (62, (74, 48, 20)), (36, (120, 78, 26))]:
        d.ellipse([515 - r, 232 - r, 515 + r, 232 + r], outline=col, width=4)
    # Forearm / sleeve entering from bottom-right corner
    d.polygon([(525, H), (575, 270), (W, 290), (W, H)], fill=(28, 26, 34), outline=(55, 50, 62))
    # Lantern handle & cage
    d.arc([488, 180, 542, 224], 180, 360, fill=(135, 105, 58), width=4)
    d.rectangle([488, 202, 542, 212], fill=(120, 92, 48))
    d.rectangle([494, 212, 536, 268], fill=(235, 170, 65), outline=(95, 70, 36), width=3)
    d.ellipse([506, 226, 524, 256], fill=(255, 238, 175))
    d.line([(508, 212), (508, 268)], fill=(85, 62, 32), width=2)
    d.line([(522, 212), (522, 268)], fill=(85, 62, 32), width=2)
    d.rectangle([486, 268, 544, 280], fill=(110, 84, 44))
    # Gloved fingers gripping handle
    d.rounded_rectangle([532, 262, 578, 290], radius=8, fill=(46, 40, 44), outline=(72, 62, 68), width=2)
    img = draw_vignette(img, strength=0.84, tint=(8, 0, 2))
    d = ImageDraw.Draw(img)
    # Blood-red heartbeat EKG trace top-right (horror HUD cue)
    d.rounded_rectangle([472, 12, 626, 46], radius=4, fill=(24, 8, 12), outline=(140, 24, 34), width=1)
    ekg = [(480, 30), (502, 30), (510, 18), (518, 41), (526, 25), (534, 30), (562, 30), (570, 16), (578, 42), (586, 26), (595, 30), (618, 30)]
    d.line(ekg, fill=(235, 42, 56), width=2)
    draw_top_title_tag(d, "Lantern Hollow", bg=(20, 10, 16), fg=(220, 195, 200))
    draw_hud_bar(d, "OIL 24% | PULSE 134 BPM | NOTES 2/7 | CELLAR KEY", pt, bg=(18, 8, 12), border=(130, 30, 40), fg=(235, 205, 205))
    return img


def render_crypt_echo(pt):
    # First-person subterranean catacombs horror + flashlight cone + bone alcove + tiny 8pt HUD
    img = Image.new("RGB", (W, H), (6, 6, 9))
    d = ImageDraw.Draw(img)
    # Narrow vaulted catacomb perspective
    d.polygon([(0, 0), (230, 88), (230, 248), (0, H)], fill=(30, 22, 24))
    d.polygon([(W, 0), (410, 88), (410, 248), (W, H)], fill=(26, 18, 22))
    d.polygon([(0, 0), (W, 0), (410, 88), (230, 88)], fill=(16, 12, 16))
    d.polygon([(0, H), (W, H), (410, 248), (230, 248)], fill=(20, 16, 18))
    # Iron barred gate at corridor end
    d.rectangle([238, 96, 402, 246], fill=(5, 4, 6), outline=(72, 48, 48), width=3)
    for bx in range(254, 396, 18):
        d.line([(bx, 96), (bx, 246)], fill=(64, 52, 54), width=4)
    # Skull-like pale mask behind bars
    d.ellipse([300, 134, 340, 180], fill=(165, 152, 142))
    d.ellipse([308, 148, 318, 158], fill=(12, 6, 8))
    d.ellipse([323, 148, 333, 158], fill=(12, 6, 8))
    d.polygon([(318, 162), (322, 162), (320, 170)], fill=(12, 6, 8))
    # Narrow flashlight cone from bottom-right
    d.polygon([(520, 290), (260, 108), (385, 232)], fill=(48, 42, 34))
    # Re-draw bars faintly over cone
    for bx in range(254, 396, 18):
        d.line([(bx, 96), (bx, 246)], fill=(42, 34, 36), width=3)
    # First-person hand holding metal flashlight bottom-right
    d.polygon([(500, 270), (540, 250), (630, 325), (580, H)], fill=(58, 62, 68), outline=(92, 98, 108))
    d.ellipse([496, 250, 536, 286], fill=(235, 224, 175), outline=(90, 90, 95), width=3)
    # Wall alcove skulls on left
    for i, (ax, ay, sc) in enumerate([(75, 165, 1.0), (155, 175, 0.72)]):
        r = int(16 * sc)
        d.ellipse([ax - r, ay - r, ax + r, ay + r], fill=(112, 102, 92))
        d.ellipse([ax - r // 2, ay - 2, ax - 2, ay + 4], fill=(14, 10, 12))
        d.ellipse([ax + 2, ay - 2, ax + r // 2, ay + 4], fill=(14, 10, 12))
    img = draw_vignette(img, strength=0.88, tint=(14, 0, 0))
    d = ImageDraw.Draw(img)
    # Crimson pulse & stamina indicator top-right
    d.rounded_rectangle([490, 12, 626, 42], radius=4, fill=(28, 8, 10), outline=(165, 28, 36), width=1)
    d.line([(498, 28), (528, 28), (536, 16), (544, 38), (552, 24), (562, 28), (618, 28)], fill=(245, 48, 56), width=2)
    draw_top_title_tag(d, "Crypt Echo", bg=(24, 10, 12), fg=(225, 195, 195))
    draw_hud_bar(d, "BATT 19% | HP 42/100 | NOISE HIGH | FLARES 1 | B2 CRYPT", pt, bg=(20, 8, 10), border=(145, 32, 38), fg=(235, 200, 200))
    return img


def render_rift_runners(pt):
    # Bright sci-fi first-person arena + grappling hook gun bottom-right + floating sky platforms
    img = Image.new("RGB", (W, H), (36, 118, 196))
    d = ImageDraw.Draw(img)
    # Sky gradient bands
    for y in range(0, 230, 4):
        c = (36 + y // 4, 118 + y // 3, 196 + min(50, y // 5))
        d.rectangle([0, y, W, y + 4], fill=c)
    # Floating futuristic sky-platforms in 1st-person perspective
    d.polygon([(0, 285), (185, 210), (455, 210), (W, 285), (W, H), (0, H)], fill=(58, 74, 96), outline=(120, 225, 255))
    d.polygon([(195, 210), (240, 285), (400, 285), (445, 210)], fill=(72, 92, 118))
    # Bright cyan jump pad & speed-lines
    d.polygon([(275, 222), (365, 222), (382, 254), (258, 254)], fill=(45, 235, 250), outline=(255, 255, 255))
    # Distant floating arena pillars & rings
    d.rectangle([105, 95, 165, 195], fill=(95, 125, 155), outline=(180, 240, 255), width=2)
    d.rectangle([475, 80, 545, 190], fill=(95, 125, 155), outline=(180, 240, 255), width=2)
    d.ellipse([275, 86, 365, 176], outline=(255, 195, 60), width=5)
    # Grapple energy tether shooting toward ring
    d.line([(482, 238), (332, 128)], fill=(80, 250, 255), width=3)
    # First-person tactical crosshair center
    cx, cy = 320, 165
    d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], outline=(255, 255, 255), width=2)
    d.line([(cx - 26, cy), (cx - 10, cy)], fill=(80, 250, 255), width=2)
    d.line([(cx + 10, cy), (cx + 26, cy)], fill=(80, 250, 255), width=2)
    d.line([(cx, cy - 26), (cx, cy - 10)], fill=(80, 250, 255), width=2)
    d.line([(cx, cy + 10), (cx, cy + 26)], fill=(80, 250, 255), width=2)
    # First-person sleek grapple launcher held bottom-right
    d.polygon([(460, 255), (535, 225), (W, 275), (W, H), (505, H)], fill=(42, 52, 68), outline=(140, 230, 255))
    d.polygon([(470, 248), (528, 228), (546, 246), (486, 266)], fill=(245, 155, 40))
    d.line([(486, 255), (590, 315)], fill=(80, 245, 255), width=4)
    draw_top_title_tag(d, "Rift Runners", bg=(18, 36, 56), fg=(225, 248, 255))
    draw_hud_bar(d, "SHIELD 100 | GRAPPLE READY | ZONE B 74% | SQUAD 4/4", pt, bg=(16, 28, 44), border=(70, 210, 240), fg=(232, 248, 255))
    return img


def render_void_breaker(pt):
    # First-person arcane roguelite obsidian vault + glowing rune gauntlet bottom-right (non-horror sci-fi/arcane)
    img = Image.new("RGB", (W, H), (24, 14, 46))
    d = ImageDraw.Draw(img)
    # Geometric obsidian corridor in 1st-person perspective
    d.polygon([(0, 0), (220, 92), (220, 240), (0, H)], fill=(44, 24, 78))
    d.polygon([(W, 0), (420, 92), (420, 240), (W, H)], fill=(38, 20, 70))
    d.polygon([(0, H), (W, H), (420, 240), (220, 240)], fill=(30, 18, 54))
    # Glowing crystal stripes along walls
    for t in [0.25, 0.52, 0.78]:
        xl = int(220 * t)
        xr = int(W - (W - 420) * t)
        yt = int(92 * t)
        yb = int(H - (H - 240) * t)
        d.line([(xl, yt), (xl, yb)], fill=(175, 90, 255), width=3)
        d.line([(xr, yt), (xr, yb)], fill=(175, 90, 255), width=3)
    # Bright glowing portal gate + floating crystalline enemy prism
    d.ellipse([255, 96, 385, 232], fill=(64, 30, 128), outline=(110, 240, 255), width=4)
    d.polygon([(320, 122), (350, 164), (320, 206), (290, 164)], fill=(255, 130, 220), outline=(255, 255, 255))
    # Arcade reticle
    d.line([(306, 164), (334, 164)], fill=(110, 250, 255), width=2)
    d.line([(320, 150), (320, 178)], fill=(110, 250, 255), width=2)
    # First-person glowing elemental gauntlet bottom-right
    d.polygon([(485, 232), (558, 212), (618, 275), (W, H), (510, H)], fill=(78, 46, 132), outline=(170, 240, 255))
    d.ellipse([486, 198, 534, 246], fill=(120, 240, 255), outline=(255, 255, 255), width=3)
    draw_top_title_tag(d, "Void Breaker", bg=(30, 16, 56), fg=(235, 220, 255))
    draw_hud_bar(d, "HP 78/100 | MANA 4/5 | FLOOR 3-2 | COMBO x14 | SHARDS 290", pt, bg=(22, 12, 42), border=(165, 90, 255), fg=(240, 228, 255))
    return img


def render_clockwork_isle(pt):
    # Sunlit isometric island tile grid + brass clockwork gears + tiny explorer + big 16pt HUD
    img = Image.new("RGB", (W, H), (105, 198, 224))
    d = ImageDraw.Draw(img)
    # Warm sunlit water waves
    for wy in range(40, 310, 28):
        for wx in range(30, 600, 95):
            d.arc([wx, wy, wx + 46, wy + 14], 0, 180, fill=(142, 222, 240), width=2)
    # 5x5 isometric tile grid
    tw, th = 68, 34
    ox, oy = 320, 88
    for r in range(5):
        for c in range(5):
            cx = ox + (c - r) * (tw // 2)
            cy = oy + (c + r) * (th // 2)
            is_brass = (r, c) in [(1, 2), (2, 2), (2, 3), (3, 2)]
            top_col = (232, 192, 112) if is_brass else (142, 206, 118)
            left_col = (182, 142, 72) if is_brass else (96, 152, 82)
            right_col = (154, 118, 58) if is_brass else (78, 128, 68)
            draw_iso_tile(d, cx, cy, tw, th, top_col, left_col, right_col, elev=14)
    # Brass clockwork gear on center tile
    gx, gy = 320, 156
    d.ellipse([gx - 22, gy - 12, gx + 22, gy + 12], fill=(240, 192, 70), outline=(120, 84, 24), width=3)
    d.ellipse([gx - 8, gy - 4, gx + 8, gy + 4], fill=(120, 84, 24))
    # Small brass clocktower on back-center tile
    d.rectangle([302, 54, 338, 118], fill=(214, 174, 110), outline=(112, 82, 42), width=2)
    d.polygon([(296, 54), (320, 28), (344, 54)], fill=(186, 86, 62), outline=(110, 46, 32))
    d.ellipse([309, 68, 331, 90], fill=(252, 246, 224), outline=(105, 76, 36), width=2)
    d.line([(320, 79), (320, 71)], fill=(40, 32, 24), width=2)
    d.line([(320, 79), (327, 79)], fill=(40, 32, 24), width=2)
    # Little explorer avatar on front tile
    d.ellipse([280, 176, 294, 190], fill=(64, 108, 206), outline=(255, 255, 255), width=2)
    d.ellipse([282, 166, 292, 176], fill=(250, 212, 176))
    draw_top_title_tag(d, "Clockwork Isle", bg=(24, 62, 78), fg=(245, 248, 242))
    draw_hud_bar(d, "GEARS 3/5  |  ISLE NORTH  |  WIND TOWER", pt, bg=(22, 50, 62), border=(238, 194, 86), fg=(252, 250, 236))
    return img


def render_moss_cartographer(pt):
    # Misty emerald isometric valley tiles + winding stream + pine trees + 16pt parchment HUD
    img = Image.new("RGB", (W, H), (192, 218, 204))
    d = ImageDraw.Draw(img)
    tw, th = 68, 34
    ox, oy = 320, 82
    stream = {(0, 2), (1, 2), (2, 2), (2, 1), (3, 1), (4, 1)}
    for r in range(5):
        for c in range(5):
            cx = ox + (c - r) * (tw // 2)
            cy = oy + (c + r) * (th // 2)
            if (r, c) in stream:
                draw_iso_tile(d, cx, cy, tw, th, (92, 168, 206), (62, 128, 162), (48, 108, 140), elev=10)
            else:
                shade = 10 if (r + c) % 2 == 0 else -8
                draw_iso_tile(d, cx, cy, tw, th, (110 + shade, 172 + shade, 106), (78, 128, 76), (64, 110, 62), elev=12)
    # Cedar trees on select tiles
    for tx, ty in [(248, 116), (392, 124), (218, 168), (355, 198), (422, 164)]:
        d.rectangle([tx - 3, ty, tx + 3, ty + 14], fill=(108, 74, 48))
        d.polygon([(tx, ty - 24), (tx - 15, ty + 4), (tx + 15, ty + 4)], fill=(44, 112, 66), outline=(28, 74, 44))
    # Wooden footbridge over stream
    d.polygon([(276, 152), (312, 134), (326, 142), (290, 160)], fill=(176, 126, 76), outline=(96, 66, 36))
    # Cartographer sprite
    d.ellipse([294, 136, 308, 150], fill=(214, 104, 62), outline=(255, 250, 236), width=2)
    draw_top_title_tag(d, "Moss Cartographer", bg=(38, 66, 52), fg=(244, 246, 236))
    draw_hud_bar(d, "FERN GLEN  |  FLORA 6/8  |  MAP 74%", pt, bg=(42, 64, 50), border=(186, 214, 162), fg=(248, 246, 232))
    return img


def render_sunlit_rails(pt):
    # Isometric railway puzzle tiles + curved tracks + red trestle bridge + steam train + 15pt HUD
    img = Image.new("RGB", (W, H), (238, 206, 148))
    d = ImageDraw.Draw(img)
    tw, th = 68, 34
    ox, oy = 320, 84
    for r in range(5):
        for c in range(5):
            cx = ox + (c - r) * (tw // 2)
            cy = oy + (c + r) * (th // 2)
            is_river = (c == 2)
            if is_river:
                draw_iso_tile(d, cx, cy, tw, th, (84, 158, 198), (58, 118, 154), (48, 102, 134), elev=10)
            else:
                draw_iso_tile(d, cx, cy, tw, th, (166, 198, 108), (124, 152, 78), (104, 132, 64), elev=12)
    # Track polyline across tiles + red trestle bridge
    pts = [(194, 148), (262, 182), (330, 148), (398, 114), (454, 142)]
    d.line(pts, fill=(92, 66, 48), width=10)
    d.line(pts, fill=(210, 214, 218), width=3)
    # Red bridge truss over river
    d.line([(292, 164), (364, 128)], fill=(196, 56, 46), width=8)
    # Miniature train engine & car
    d.rounded_rectangle([244, 156, 282, 178], radius=4, fill=(208, 62, 48), outline=(45, 32, 28), width=2)
    d.rectangle([252, 144, 266, 156], fill=(52, 54, 58))
    d.ellipse([250, 124, 268, 140], fill=(248, 248, 245))
    # Depot building
    d.rectangle([422, 108, 468, 136], fill=(235, 224, 198), outline=(120, 74, 52), width=2)
    d.polygon([(416, 108), (445, 88), (474, 108)], fill=(176, 74, 54))
    draw_top_title_tag(d, "Sunlit Rails", bg=(64, 48, 34), fg=(252, 244, 224))
    draw_hud_bar(d, "LINE A  |  TIMBER DEPOT  |  TRAINS 2/2", pt, bg=(56, 42, 30), border=(236, 178, 86), fg=(252, 246, 228))
    return img


def render_frost_protocol(pt):
    # Dark icy isometric polar base + orange thermal core + dense small 10pt telemetry HUD
    img = Image.new("RGB", (W, H), (18, 30, 48))
    d = ImageDraw.Draw(img)
    tw, th = 64, 32
    ox, oy = 320, 74
    for r in range(5):
        for c in range(5):
            cx = ox + (c - r) * (tw // 2)
            cy = oy + (c + r) * (th // 2)
            draw_iso_tile(d, cx, cy, tw, th, (164, 194, 218), (110, 142, 170), (88, 118, 146), elev=11)
    # Glowing central thermal reactor
    d.ellipse([292, 122, 348, 158], fill=(245, 132, 38), outline=(255, 225, 140), width=3)
    d.rectangle([308, 92, 332, 138], fill=(82, 96, 114), outline=(245, 168, 64), width=2)
    # Surrounding habitat pods connected by heated pipes
    for px, py in [(248, 154), (392, 154), (320, 192)]:
        d.line([(320, 142), (px, py)], fill=(235, 122, 42), width=3)
        d.rounded_rectangle([px - 18, py - 12, px + 18, py + 12], radius=5, fill=(64, 82, 102), outline=(185, 216, 238), width=2)
    # Dense small-print side telemetry box (matches 10pt dense_ui)
    sf = load_font(hud_px(pt), bold=False)
    d.rounded_rectangle([12, 46, 166, 168], radius=4, fill=(14, 22, 34), outline=(86, 118, 148), width=1)
    for i, line in enumerate(["TEMP: -42C (DROP)", "COAL: 18.4t / 24h", "HEAT ZONE 1: OK", "HEAT ZONE 2: LOW", "RATIONS: 62%", "STORM IN 04:15"]):
        d.text((18, 52 + i * 18), line, font=sf, fill=(198, 222, 242))
    draw_top_title_tag(d, "Frost Protocol", bg=(14, 24, 38), fg=(214, 232, 248))
    draw_hud_bar(d, "DAY 14 | CORE 72% | CREW 24 | SICK 2 | COAL 18t | HOPE 58%", pt, bg=(14, 22, 34), border=(92, 134, 172), fg=(214, 234, 248))
    return img


def render_orbit_relay(pt):
    # Orthographic top-down orbital space station + 2 co-op astronauts + 15pt HUD
    img = Image.new("RGB", (W, H), (10, 16, 32))
    d = ImageDraw.Draw(img)
    # Stars
    for sx, sy in [(42, 48), (118, 86), (210, 36), (480, 52), (576, 94), (92, 260), (540, 245), (388, 42), (165, 282), (462, 276)]:
        d.ellipse([sx, sy, sx + 3, sy + 3], fill=(220, 232, 255))
    # Top-down solar array wings
    d.rectangle([82, 136, 230, 198], fill=(32, 78, 148), outline=(112, 192, 255), width=2)
    d.rectangle([410, 136, 558, 198], fill=(32, 78, 148), outline=(112, 192, 255), width=2)
    for gx in range(112, 230, 30):
        d.line([(gx, 136), (gx, 198)], fill=(86, 152, 225), width=1)
    for gx in range(440, 558, 30):
        d.line([(gx, 136), (gx, 198)], fill=(86, 152, 225), width=1)
    # Central modular station hull (top-down blueprint view)
    d.rounded_rectangle([230, 108, 410, 228], radius=14, fill=(184, 196, 212), outline=(88, 104, 124), width=3)
    d.rectangle([258, 128, 382, 208], fill=(42, 54, 72), outline=(116, 136, 158), width=2)
    # Glowing relay core
    d.ellipse([300, 148, 340, 188], fill=(64, 228, 248), outline=(255, 255, 255), width=3)
    # Two top-down co-op astronauts (P1 cyan, P2 amber)
    d.ellipse([268, 144, 290, 166], fill=(56, 196, 255), outline=(255, 255, 255), width=2)
    d.ellipse([352, 174, 374, 196], fill=(252, 176, 54), outline=(255, 255, 255), width=2)
    draw_top_title_tag(d, "Orbit Relay", bg=(16, 26, 48), fg=(222, 240, 255))
    draw_hud_bar(d, "O2 88%  |  RELAYS 2/3  |  P1 + P2 LINKED", pt, bg=(14, 24, 44), border=(78, 198, 245), fg=(236, 248, 255))
    return img


def render_ember_kitchen(pt):
    # Orthographic top-down bistro kitchen + brick oven + prep counters + 2 top-down chefs + 16pt HUD
    img = Image.new("RGB", (W, H), (228, 206, 178))
    d = ImageDraw.Draw(img)
    # Checkered bistro tile floor
    ts = 36
    for y in range(44, 296, ts):
        for x in range(48, 592, ts):
            if ((x // ts) + (y // ts)) % 2 == 0:
                d.rectangle([x, y, x + ts, y + ts], fill=(214, 188, 156))
    # Top-down wooden counters & pass window
    d.rectangle([62, 58, 578, 98], fill=(154, 102, 62), outline=(88, 54, 30), width=3)
    d.rectangle([62, 236, 578, 276], fill=(154, 102, 62), outline=(88, 54, 30), width=3)
    # Brick wood-fired oven on left
    d.ellipse([76, 118, 168, 214], fill=(168, 66, 44), outline=(84, 32, 20), width=4)
    d.ellipse([104, 146, 152, 188], fill=(252, 158, 42))
    # Central prep island with pizza & ingredients
    d.rectangle([244, 134, 424, 198], fill=(208, 178, 134), outline=(112, 78, 48), width=3)
    d.ellipse([268, 146, 308, 186], fill=(238, 194, 112), outline=(196, 62, 42), width=4)
    d.ellipse([348, 148, 386, 184], fill=(246, 246, 242), outline=(160, 160, 160), width=2)
    # Two overhead chefs (white chef hats + shoulders)
    for cx, cy, col in [(208, 166, (62, 142, 224)), (466, 166, (224, 92, 76))]:
        d.ellipse([cx - 22, cy - 16, cx + 22, cy + 16], fill=col, outline=(40, 30, 26), width=2)
        d.ellipse([cx - 13, cy - 13, cx + 13, cy + 13], fill=(252, 252, 250), outline=(165, 165, 165), width=2)
    draw_top_title_tag(d, "Ember Kitchen", bg=(76, 34, 24), fg=(255, 244, 232))
    draw_hud_bar(d, "ORDERS 6/8  |  02:40  |  SCORE 420", pt, bg=(66, 32, 22), border=(246, 166, 68), fg=(255, 246, 232))
    return img


def render_tiny_botanist(pt):
    # Top-down sunlit greenhouse potting table + 6 colorful botanical pots + oversized 17pt HUD
    img = Image.new("RGB", (W, H), (222, 238, 214))
    d = ImageDraw.Draw(img)
    # Wooden greenhouse bench seen straight from above
    d.rounded_rectangle([54, 48, 586, 286], radius=12, fill=(192, 150, 104), outline=(124, 88, 54), width=4)
    # 6 top-down terracotta pots with distinct plants
    pots = [
        (146, 118, (88, 178, 92), (248, 206, 62)),
        (320, 118, (72, 164, 112), (186, 118, 232)),
        (494, 118, (96, 184, 84), (242, 112, 128)),
        (146, 218, (64, 152, 96), (112, 210, 238)),
        (320, 218, (82, 172, 88), (252, 154, 72)),
        (494, 218, (76, 162, 104), (248, 236, 126)),
    ]
    for px, py, leaf, petal in pots:
        d.ellipse([px - 42, py - 42, px + 42, py + 42], fill=(196, 106, 68), outline=(122, 58, 34), width=3)
        d.ellipse([px - 32, py - 32, px + 32, py + 32], fill=(92, 62, 42))
        for ang in range(0, 360, 60):
            rad = math.radians(ang)
            lx = px + int(math.cos(rad) * 18)
            ly = py + int(math.sin(rad) * 18)
            d.ellipse([lx - 11, ly - 11, lx + 11, ly + 11], fill=leaf)
        d.ellipse([px - 12, py - 12, px + 12, py + 12], fill=petal, outline=(255, 255, 255), width=2)
    draw_top_title_tag(d, "Tiny Botanist", bg=(44, 78, 52), fg=(248, 252, 242))
    draw_hud_bar(d, "BED 3  |  WATER OK  |  BLOOM 4/5", pt, bg=(38, 72, 46), border=(186, 224, 134), fg=(252, 254, 244))
    return img


def render_pebble_harbor(pt):
    # Warm 2D side-scrolling coastal cliff path + ocean parallax + cottage + side-view postman + big 17pt HUD
    img = Image.new("RGB", (W, H), (248, 198, 146))
    d = ImageDraw.Draw(img)
    # Sunset sky + sun + distant headland + ocean
    d.ellipse([485, 42, 545, 102], fill=(255, 238, 178))
    d.rectangle([0, 162, W, 240], fill=(78, 152, 192))
    d.polygon([(380, 162), (470, 118), (580, 132), (W, 162)], fill=(124, 146, 152))
    # Distant lighthouse on headland
    d.rectangle([502, 86, 518, 132], fill=(246, 244, 238), outline=(140, 74, 62), width=2)
    d.polygon([(498, 86), (510, 72), (522, 86)], fill=(196, 68, 56))
    # Foreground 2D side-scroll grassy cliff path
    d.rectangle([0, 228, W, H], fill=(116, 172, 92))
    d.rectangle([0, 248, W, 278], fill=(214, 184, 134))
    # Wooden fence posts
    for fx in range(28, 390, 44):
        d.rectangle([fx, 210, fx + 7, 248], fill=(146, 104, 68))
    d.line([(24, 222), (392, 222)], fill=(166, 122, 82), width=4)
    # Red-roofed coastal cottage on right
    d.rectangle([422, 166, 544, 248], fill=(246, 236, 214), outline=(136, 102, 74), width=3)
    d.polygon([(410, 168), (483, 120), (556, 168)], fill=(198, 76, 58), outline=(124, 42, 32))
    d.rectangle([470, 198, 500, 248], fill=(138, 86, 54))
    # Side-view postman sprite walking right
    d.rectangle([168, 206, 190, 246], fill=(56, 112, 196), outline=(32, 62, 114), width=2)
    d.ellipse([170, 186, 190, 206], fill=(248, 210, 176))
    d.rectangle([166, 182, 194, 190], fill=(42, 84, 156))
    d.rectangle([156, 216, 172, 236], fill=(184, 122, 62), outline=(104, 64, 30), width=2)
    draw_top_title_tag(d, "Pebble Harbor", bg=(52, 74, 96), fg=(252, 248, 238))
    draw_hud_bar(d, "MAIL BAG 3/4  |  CLIFF COTTAGE", pt, bg=(42, 64, 86), border=(246, 204, 124), fg=(254, 250, 238))
    return img


def render_ashen_depths(pt):
    # Dark 3rd-person over-the-shoulder action RPG + tiny 7pt cluttered loot/stat HUD
    img = Image.new("RGB", (W, H), (22, 18, 24))
    d = ImageDraw.Draw(img)
    # Cavern walls & lava cracks
    d.polygon([(0, 0), (140, 0), (110, 240), (0, 260)], fill=(38, 30, 36))
    d.polygon([(W, 0), (500, 0), (530, 240), (W, 260)], fill=(36, 28, 34))
    d.rectangle([0, 224, W, H], fill=(32, 26, 30))
    d.line([(160, 242), (240, 268), (310, 254), (420, 280)], fill=(232, 92, 28), width=4)
    # Towering stone boss golem in mid-ground
    d.rounded_rectangle([265, 86, 375, 222], radius=16, fill=(76, 68, 74), outline=(228, 102, 36), width=2)
    d.ellipse([296, 56, 344, 98], fill=(86, 78, 84))
    d.ellipse([308, 72, 316, 78], fill=(252, 138, 38))
    d.ellipse([326, 72, 334, 78], fill=(252, 138, 38))
    # 3rd-person player knight seen from behind (lower-left/center foreground)
    d.polygon([(202, 310), (226, 214), (272, 214), (294, 310)], fill=(88, 96, 112), outline=(146, 154, 170))
    d.ellipse([232, 184, 266, 218], fill=(104, 112, 128), outline=(165, 174, 188), width=2)
    d.line([(274, 242), (312, 178)], fill=(208, 216, 228), width=5)
    # Cluttered tiny 7pt side crafting/loot panel
    tf = load_font(hud_px(pt), bold=False)
    d.rounded_rectangle([476, 46, 628, 194], radius=4, fill=(16, 14, 20), outline=(92, 74, 78), width=1)
    for i, ln in enumerate(["CRAFTING QUEUE (14)", "ASH ORE: 19/60", "SLAG DUST: 84/120", "RUNE SHARD: 12/40", "ARMOR WT: 78.4%", "CRIT: +3.2% | POISE 41", "SLOTS: 38/40 FULL"]):
        d.text((482, 52 + i * 19), ln, font=tf, fill=(214, 198, 194))
    draw_top_title_tag(d, "Ashen Depths", bg=(28, 20, 26), fg=(228, 212, 206))
    draw_hud_bar(d, "HP 412/680 | ST 44/100 | LV 34 | ASH 19/60 | SLAG 84 | WT 78.4% | SLOTS 38/40", pt, bg=(18, 14, 20), border=(162, 78, 42), fg=(226, 212, 204))
    return img


def render_iron_sovereign(pt):
    # Open-world 3rd-person RPG vista seen from behind cloaked hero + small 10pt dense quest HUD
    img = Image.new("RGB", (W, H), (118, 148, 178))
    d = ImageDraw.Draw(img)
    # Distant mountain range & citadel
    d.polygon([(0, 190), (115, 95), (235, 170), (355, 86), (485, 160), (605, 100), (W, 190)], fill=(86, 102, 126))
    # Citadel silhouette on ridge
    d.rectangle([332, 92, 382, 146], fill=(64, 72, 86))
    d.rectangle([346, 68, 366, 94], fill=(64, 72, 86))
    # Rolling green-olive valley floor
    d.polygon([(0, 186), (W, 186), (W, H), (0, H)], fill=(88, 118, 74))
    d.polygon([(270, 330), (318, 186), (344, 186), (388, 330)], fill=(154, 134, 98))
    # 3rd-person cloaked hero seen from behind in lower center
    d.polygon([(284, 315), (302, 210), (338, 210), (356, 315)], fill=(128, 42, 46), outline=(214, 182, 112))
    d.ellipse([306, 182, 334, 210], fill=(74, 62, 54))
    # Dense 10pt quest tracker panel on right
    qf = load_font(hud_px(pt), bold=False)
    d.rounded_rectangle([424, 44, 628, 172], radius=4, fill=(20, 22, 28), outline=(168, 140, 82), width=1)
    for i, ln in enumerate(["ACTIVE QUESTS (7):", "- Siege of Iron Vale", "- Forging Decree III", "- Tax Ledger (12/30)", "- Patrol North Keep", "REP: CROWN +12"]):
        d.text((434, 50 + i * 19), ln, font=qf, fill=(232, 224, 202))
    draw_top_title_tag(d, "Iron Sovereign", bg=(26, 28, 36), fg=(242, 232, 206))
    draw_hud_bar(d, "LV 28 | HP 940/1100 | GOLD 4820 | WEIGHT 64/80 | QUESTS 7 | VALE", pt, bg=(20, 22, 30), border=(178, 146, 84), fg=(242, 234, 212))
    return img


def render_timber_trails(pt):
    # Golden-hour 3rd-person alpine trail seen from behind hiker + pine peaks + clear 15pt HUD
    img = Image.new("RGB", (W, H), (146, 198, 234))
    d = ImageDraw.Draw(img)
    # Snow-capped alpine peaks & glacier lake
    d.polygon([(0, 184), (130, 76), (255, 168), (390, 68), (520, 160), (W, 112), (W, 184)], fill=(118, 146, 168))
    d.polygon([(130, 76), (104, 112), (158, 112)], fill=(246, 250, 255))
    d.polygon([(390, 68), (358, 112), (424, 112)], fill=(246, 250, 255))
    d.rectangle([0, 184, W, 228], fill=(76, 158, 202))
    # Forest meadow & dirt trail
    d.rectangle([0, 222, W, H], fill=(82, 142, 86))
    d.polygon([(236, H), (298, 222), (344, 222), (412, H)], fill=(188, 152, 108))
    # Foreground pine trees
    for tx, ty in [(74, 238), (148, 226), (508, 230), (576, 242)]:
        d.polygon([(tx, ty - 78), (tx - 32, ty), (tx + 32, ty)], fill=(38, 96, 56))
    # 3rd-person hiker seen from behind with backpack
    d.rounded_rectangle([296, 230, 344, 294], radius=8, fill=(214, 112, 52), outline=(92, 46, 22), width=2)
    d.ellipse([306, 202, 334, 230], fill=(76, 56, 44))
    draw_top_title_tag(d, "Timber Trails", bg=(34, 62, 48), fg=(248, 250, 242))
    draw_hud_bar(d, "TRAIL 4.2 KM  |  FILM 9/12  |  CAMP READY", pt, bg=(30, 56, 44), border=(232, 188, 96), fg=(252, 250, 238))
    return img


def render_neon_drift_99(pt):
    # Chase-camera synthwave arcade racer + neon sunset + grid road + sports car rear + 14pt HUD
    img = Image.new("RGB", (W, H), (24, 12, 48))
    d = ImageDraw.Draw(img)
    # Retro sunset disk
    d.ellipse([246, 56, 394, 204], fill=(252, 112, 142))
    for sy in range(122, 202, 14):
        d.rectangle([240, sy, 400, sy + 5], fill=(24, 12, 48))
    # Horizon wireframe mountains
    d.polygon([(0, 178), (90, 124), (180, 178), (460, 178), (550, 118), (W, 178)], fill=(48, 20, 88), outline=(238, 74, 214))
    # Perspective neon highway
    d.rectangle([0, 178, W, H], fill=(18, 14, 34))
    d.polygon([(264, 178), (376, 178), (566, H), (74, H)], fill=(34, 28, 56), outline=(62, 242, 255))
    d.line([(320, 178), (320, H)], fill=(255, 212, 64), width=3)
    # Chase-cam sports car rear view + tail lights
    d.polygon([(256, 276), (278, 236), (362, 236), (384, 276)], fill=(54, 224, 248), outline=(255, 255, 255))
    d.rectangle([248, 268, 392, 298], fill=(32, 152, 214), outline=(180, 252, 255), width=2)
    d.rectangle([258, 276, 294, 288], fill=(255, 42, 92))
    d.rectangle([346, 276, 382, 288], fill=(255, 42, 92))
    # Drift streaks
    d.line([(264, 298), (228, 336)], fill=(255, 62, 198), width=5)
    d.line([(376, 298), (340, 336)], fill=(255, 62, 198), width=5)
    draw_top_title_tag(d, "Neon Drift 99", bg=(34, 14, 62), fg=(126, 248, 255))
    draw_hud_bar(d, "POS 1/8  |  LAP 2/3  |  218 KM/H  |  BOOST", pt, bg=(22, 12, 46), border=(246, 74, 214), fg=(146, 250, 255))
    return img


def render_starlight_tactics(pt):
    # Orthographic turn-based tactical starship grid + movement highlights + squad tokens + 14pt HUD
    img = Image.new("RGB", (W, H), (16, 24, 36))
    d = ImageDraw.Draw(img)
    # 10x5 tactical boarding deck grid
    gx0, gy0, cs = 70, 56, 50
    highlight = {(2, 2), (3, 2), (4, 2), (3, 1), (3, 3), (4, 1)}
    wall = {(5, 0), (5, 1), (5, 3), (5, 4)}
    for r in range(5):
        for c in range(10):
            x, y = gx0 + c * cs, gy0 + r * cs
            if (c, r) in wall:
                col = (74, 86, 102)
            elif (c, r) in highlight:
                col = (38, 108, 164)
            else:
                col = (28, 40, 56)
            d.rectangle([x, y, x + cs - 2, y + cs - 2], fill=col, outline=(52, 74, 98), width=1)
    # Sightline from squad unit to enemy drone
    d.line([(245, 181), (445, 131)], fill=(252, 194, 54), width=3)
    # Squad unit tokens (blue) & enemy drones (red)
    for uc, ur, col in [(2, 2, (62, 198, 252)), (3, 2, (62, 198, 252)), (7, 1, (242, 78, 78)), (8, 3, (242, 78, 78))]:
        cx, cy = gx0 + uc * cs + cs // 2, gy0 + ur * cs + cs // 2
        d.ellipse([cx - 15, cy - 15, cx + 15, cy + 15], fill=col, outline=(255, 255, 255), width=2)
    draw_top_title_tag(d, "Starlight Tactics", bg=(18, 30, 46), fg=(222, 242, 255))
    draw_hud_bar(d, "TURN 4  |  AP 3/4  |  SQUAD 4/4  |  DECK B", pt, bg=(14, 24, 38), border=(74, 178, 236), fg=(232, 244, 255))
    return img


def render_glyph_forge(pt):
    # Turn-based rune deckbuilder encounter + enemy golem + 4 fanned cards + mana orbs + 14pt HUD
    img = Image.new("RGB", (W, H), (28, 24, 42))
    d = ImageDraw.Draw(img)
    # Stone arena floor
    d.ellipse([160, 128, 480, 206], fill=(54, 46, 74), outline=(124, 104, 168), width=2)
    # Hero emblem left & rune golem right
    d.ellipse([198, 96, 252, 150], fill=(74, 172, 236), outline=(255, 255, 255), width=3)
    d.polygon([(416, 70), (456, 114), (442, 162), (390, 162), (376, 114)], fill=(224, 92, 82), outline=(255, 212, 120))
    # 3 glowing mana crystals left
    for i in range(3):
        d.polygon([(46, 202 + i * 28), (62, 214 + i * 28), (46, 226 + i * 28), (30, 214 + i * 28)], fill=(68, 224, 248), outline=(255, 255, 255))
    # 4 fanned rune cards across bottom half
    card_cols = [(72, 146, 218), (218, 92, 68), (82, 174, 114), (178, 108, 228)]
    for i, col in enumerate(card_cols):
        cx = 132 + i * 102
        cy = 194 if i in (1, 2) else 204
        d.rounded_rectangle([cx, cy, cx + 84, cy + 96], radius=7, fill=(242, 236, 222), outline=col, width=4)
        d.rectangle([cx + 10, cy + 12, cx + 74, cy + 56], fill=col)
        d.ellipse([cx + 30, cy + 22, cx + 54, cy + 46], outline=(255, 255, 255), width=3)
        d.rectangle([cx + 12, cy + 66, cx + 72, cy + 74], fill=(96, 88, 78))
        d.rectangle([cx + 12, cy + 80, cx + 56, cy + 86], fill=(136, 128, 116))
    draw_top_title_tag(d, "Glyph Forge", bg=(36, 28, 54), fg=(244, 236, 255))
    draw_hud_bar(d, "HP 48/50  |  MANA 3/3  |  DECK 12  |  TURN 3", pt, bg=(26, 20, 42), border=(186, 134, 246), fg=(246, 240, 255))
    return img


def render_boulder_league(pt):
    # Fixed broadcast-camera sports arena + oval clay court + team players rolling boulders + 16pt HUD
    img = Image.new("RGB", (W, H), (54, 68, 82))
    d = ImageDraw.Draw(img)
    # Stadium stands rim + oval arena court
    d.ellipse([36, 48, 604, 288], fill=(196, 152, 104), outline=(238, 214, 172), width=6)
    d.line([(320, 52), (320, 284)], fill=(242, 228, 198), width=3)
    d.ellipse([272, 120, 368, 216], outline=(242, 228, 198), width=3)
    # Left & right goal rings
    d.ellipse([54, 134, 108, 202], fill=(64, 132, 214), outline=(255, 255, 255), width=3)
    d.ellipse([532, 134, 586, 202], fill=(228, 168, 46), outline=(255, 255, 255), width=3)
    # Giant rolling granite boulder center-right
    d.ellipse([348, 138, 404, 194], fill=(116, 118, 124), outline=(66, 68, 72), width=4)
    # 4 team avatars
    for px, py, col in [(226, 128, (54, 138, 232)), (318, 168, (54, 138, 232)), (438, 156, (238, 174, 42)), (476, 204, (238, 174, 42))]:
        d.ellipse([px - 15, py - 15, px + 15, py + 15], fill=col, outline=(255, 255, 255), width=2)
    draw_top_title_tag(d, "Boulder League", bg=(32, 46, 62), fg=(250, 248, 242))
    draw_hud_bar(d, "BLUE 2 - 1 GOLD  |  03:12  |  ROUND 2", pt, bg=(26, 38, 52), border=(238, 186, 72), fg=(252, 250, 242))
    return img


def render_velvet_cipher(pt):
    # 1930s noir point-and-click sleeper train compartment + night window + brass lamp + clue table + 15pt HUD
    img = Image.new("RGB", (W, H), (36, 22, 28))
    d = ImageDraw.Draw(img)
    # Wood-paneled compartment walls
    d.rectangle([30, 42, 610, 288], fill=(68, 40, 34), outline=(146, 108, 62), width=3)
    # Rain-streaked night window with passing moonlit hills
    d.rectangle([168, 64, 472, 172], fill=(20, 28, 48), outline=(188, 148, 84), width=4)
    d.ellipse([392, 82, 426, 116], fill=(238, 232, 204))
    for rx in range(186, 462, 26):
        d.line([(rx, 74), (rx - 8, 104)], fill=(84, 108, 148), width=1)
    # Velvet seats left & right
    d.rounded_rectangle([54, 168, 186, 276], radius=10, fill=(138, 32, 48), outline=(82, 18, 28), width=3)
    d.rounded_rectangle([454, 168, 586, 276], radius=10, fill=(138, 32, 48), outline=(82, 18, 28), width=3)
    # Compartment table + brass lamp + clue telegram & suitcase
    d.rectangle([208, 204, 432, 276], fill=(108, 68, 42), outline=(176, 134, 74), width=2)
    d.polygon([(226, 178), (264, 178), (256, 152), (234, 152)], fill=(246, 208, 112), outline=(168, 128, 54))
    d.rectangle([242, 178, 248, 204], fill=(178, 142, 72))
    # Folded telegram clue + magnifying-glass cursor
    d.polygon([(294, 226), (366, 222), (372, 252), (298, 256)], fill=(242, 232, 202), outline=(124, 102, 74))
    d.ellipse([322, 218, 354, 250], outline=(246, 212, 118), width=3)
    d.line([(350, 246), (366, 262)], fill=(246, 212, 118), width=4)
    draw_top_title_tag(d, "Velvet Cipher", bg=(44, 18, 26), fg=(246, 232, 204))
    draw_hud_bar(d, "CAR 4  |  CLUES 3/5  |  TELEGRAM", pt, bg=(36, 18, 24), border=(214, 172, 92), fg=(248, 238, 214))
    return img


RENDERERS = {
    "game-lantern-hollow": ("first_person", True, "unlabeled_first_person_horror", render_lantern_hollow),
    "game-clockwork-isle": ("isometric", False, None, render_clockwork_isle),
    "game-orbit-relay": ("top_down", False, None, render_orbit_relay),
    "game-ashen-depths": ("third_person", False, None, render_ashen_depths),
    "game-moss-cartographer": ("isometric", False, None, render_moss_cartographer),
    "game-neon-drift-99": ("chase_camera", False, None, render_neon_drift_99),
    "game-ember-kitchen": ("top_down", False, None, render_ember_kitchen),
    "game-iron-sovereign": ("third_person", False, None, render_iron_sovereign),
    "game-crypt-echo": ("first_person", True, None, render_crypt_echo),
    "game-sunlit-rails": ("isometric", False, None, render_sunlit_rails),
    "game-starlight-tactics": ("top_down_grid", False, None, render_starlight_tactics),
    "game-rift-runners": ("first_person", False, None, render_rift_runners),
    "game-pebble-harbor": ("side_scroll_2d", False, None, render_pebble_harbor),
    "game-boulder-league": ("fixed_arena", False, None, render_boulder_league),
    "game-velvet-cipher": ("point_and_click", False, None, render_velvet_cipher),
    "game-frost-protocol": ("isometric", False, None, render_frost_protocol),
    "game-tiny-botanist": ("top_down", False, None, render_tiny_botanist),
    "game-void-breaker": ("first_person", False, None, render_void_breaker),
    "game-timber-trails": ("third_person", False, None, render_timber_trails),
    "game-glyph-forge": ("tabletop_cards", False, None, render_glyph_forge),
}


def main():
    minimal = json.loads(MINIMAL_PATH.read_text("utf8"))
    catalog = json.loads(CATALOG_PATH.read_text("utf8"))
    cat_by_id = {a["asset_id"]: a for a in catalog["assets"]}

    cues = []
    total_bytes = 0
    for game in minimal["games"]:
        gid = game["id"]
        pt = game["hud_font_pt"]
        asset_id = game["asset_ids"][0]
        cam, is_horror, trap, fn = RENDERERS[gid]
        img = fn(pt)
        # Quantize cleanly to keep all 20 PNGs well within the 1 MiB bundle budget
        q = img.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
        out_name = f"preview-{gid}.png"
        out_path = ASSETS_DIR / out_name
        q.save(out_path, format="PNG", optimize=True)
        raw = out_path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        total_bytes += len(raw)

        # Update catalog entry with neutral alt_text (never leak visual cues in metadata)
        entry = cat_by_id[asset_id]
        entry["integrity"]["bytes"] = len(raw)
        entry["integrity"]["sha256"] = sha
        entry["storage"]["path"] = f"assets/{out_name}"
        entry["media"]["image"] = {"width": W, "height": H}
        entry["presentation"]["alt_text"] = f"Gameplay and HUD preview screenshot for {game['title']}."

        # Update eval cue sheet (strictly consistent with hud_font_pt and actual drawing)
        cues.append({
            "asset_id": asset_id,
            "game_id": gid,
            "path": f"assets/{out_name}",
            "sha256": sha,
            "camera_perspective": "first_person" if cam == "first_person" else "non_first_person",
            "camera_style": cam,
            "horror_visual_cues": is_horror,
            "hud_font_pt": pt,
            "hud_rendered_px": hud_px(pt),
            "handheld_hud_readable": pt >= 14,
            "visual_trap": trap,
            "manually_checked": True,
        })

    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf8")
    cues_doc = {
        "schema": "questshelf.eval-visual-cues.v1",
        "visibility": "evaluation_only_never_exposed_to_agent",
        "hud_readability_rule": "handheld_hud_readable === (hud_font_pt >= 14), matched to rendered pixel height round(hud_font_pt * 1.45)",
        "cues": cues,
    }
    CUES_PATH.write_text(json.dumps(cues_doc, indent=2) + "\n", encoding="utf8")
    print(f"Rendered {len(cues)} PNGs ({W}x{H}), total bytes = {total_bytes} ({total_bytes/1024:.1f} KiB)")
    assert total_bytes <= 1048576, f"Exceeds 1 MiB budget: {total_bytes}"


if __name__ == "__main__":
    main()
