"""Authoring-only renderer for the CutRoom PNGs. The runtime uses the committed bytes.

    python3 apps/cutroom/scripts/render.py [--sheet out.png]

Needs CairoSVG and Pillow. Writes the 24 fixture images to assets/ and the
history A/B thumbnails listed in scripts/history-episodes.json to
datasets/history/assets/. Title widths are measured from rendered pixels, so
each defect is placed deliberately:

  badge     the duration badge covers the end of the title
  clip      the title runs past the right edge of the frame
  contrast  the title is drawn in a colour close to the background behind it
  ok        the full title is legible and clear of the badge

Which candidate carries which defect varies per project (DEFECTS below); the
answer key is review/visual-checks.md, which is not served over MCP.
"""
import io
import json
import math
import sys
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
W, H = 480, 270
FONT = "Helvetica, Arial, sans-serif"
MONO = "Menlo, Courier New, monospace"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def png(svg):
    return cairosvg.svg2png(bytestring=svg.encode())


_widths = {}


def text_width(text, size):
    key = (text, size)
    if key not in _widths:
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="{size * 2}">'
               f'<text x="10" y="{int(size * 1.4)}" font-family="{FONT}" font-weight="bold" '
               f'font-size="{size}">{esc(text)}</text></svg>')
        box = Image.open(io.BytesIO(png(svg))).getchannel("A").getbbox()
        _widths[key] = (box[2] - 10) if box else 0
    return _widths[key]


def shade(hex_color, f):
    """Lighten (f > 0) or darken (f < 0) a #rrggbb colour."""
    c = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    c = [round(v + (255 - v) * f) if f > 0 else round(v * (1 + f)) for v in c]
    return "#" + "".join(f"{max(0, min(255, v)):02x}" for v in c)


# --- scene parts -----------------------------------------------------------

def wall_and_desk(p, y=205):
    return (f'<rect width="{W}" height="{H}" fill="{p["wall"]}"/>'
            f'<rect y="{y}" width="{W}" height="{H - y}" fill="{p["desk"]}"/>'
            f'<rect y="{y}" width="{W}" height="4" fill="{shade(p["desk"], .25)}"/>')


def laptop(x, y, w, screen, inner=""):
    h = round(w * .6)
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#1b2230"/>'
            f'<rect x="{x + 7}" y="{y + 7}" width="{w - 14}" height="{h - 14}" rx="3" fill="{screen}"/>'
            f'<g transform="translate({x + 7},{y + 7})">{inner}</g>'
            f'<path d="M{x - 16} {y + h}h{w + 32}l-12 11H{x - 4}z" fill="#a3adb8"/>')


def mug(x, y, color):
    return (f'<rect x="{x}" y="{y}" width="30" height="36" rx="4" fill="{color}"/>'
            f'<path d="M{x + 30} {y + 8}c14 0 14 20 0 20" fill="none" stroke="{color}" stroke-width="5"/>')


def wedge(cx, cy, r, a0, a1, color):
    x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    return f'<path d="M{cx} {cy}L{x0:.1f} {y0:.1f}A{r} {r} 0 0 1 {x1:.1f} {y1:.1f}Z" fill="{color}"/>'


def color_wheel(cx, cy, r):
    colors = ["#e0524f", "#e5b33f", "#7cc35b", "#3fb8c5", "#4f6fe0", "#c24fd6"]
    parts = [wedge(cx, cy, r, i * math.pi / 3, (i + 1) * math.pi / 3, c) for i, c in enumerate(colors)]
    return "".join(parts) + f'<circle cx="{cx}" cy="{cy}" r="{r * .35:.0f}" fill="#d9d9d9"/><circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#222" stroke-width="3"/>'


def person(cx, cy, skin, shirt, hair="#2b1d16", glasses=False, reflect=False):
    s = (f'<path d="M{cx - 70} {H}c4-52 30-72 70-72s66 20 70 72z" fill="{shirt}"/>'
         f'<rect x="{cx - 13}" y="{cy + 26}" width="26" height="24" fill="{shade(skin, -.12)}"/>'
         f'<ellipse cx="{cx}" cy="{cy}" rx="34" ry="40" fill="{skin}"/>'
         f'<path d="M{cx - 35} {cy - 6}c0-36 70-36 70 0c-8-16-56-20-70 0z" fill="{hair}"/>')
    if glasses:
        s += (f'<rect x="{cx - 27}" y="{cy - 6}" width="22" height="15" rx="4" fill="#cfd8e0" fill-opacity=".35" stroke="#111" stroke-width="2.5"/>'
              f'<rect x="{cx + 5}" y="{cy - 6}" width="22" height="15" rx="4" fill="#cfd8e0" fill-opacity=".35" stroke="#111" stroke-width="2.5"/>'
              f'<path d="M{cx - 5} {cy}h10" stroke="#111" stroke-width="2.5"/>')
        if reflect:
            s += (f'<rect x="{cx - 24}" y="{cy - 4}" width="12" height="9" fill="#ffffff"/>'
                  f'<rect x="{cx + 9}" y="{cy - 4}" width="12" height="9" fill="#ffffff"/>')
    else:
        s += (f'<circle cx="{cx - 12}" cy="{cy}" r="3.5" fill="#1a1a1a"/><circle cx="{cx + 12}" cy="{cy}" r="3.5" fill="#1a1a1a"/>')
    s += f'<path d="M{cx - 10} {cy + 18}q10 7 20 0" fill="none" stroke="#7a3b2e" stroke-width="2.5"/>'
    return s


def softbox(x, y, s=1.0, glow=.14, beam_to=None):
    pts = f"{x},{y} {x + 100 * s},{y + 18 * s} {x + 100 * s},{y + 112 * s} {x},{y + 130 * s}"
    out = ""
    if beam_to:
        bx, by = beam_to
        out += f'<polygon points="{x + 100 * s},{y + 18 * s} {bx},{by - 70} {bx},{by + 90} {x + 100 * s},{y + 112 * s}" fill="#fff8e0" fill-opacity="{glow}"/>'
    out += (f'<polygon points="{pts}" fill="#f7f3e3" stroke="#4b4b4b" stroke-width="4"/>'
            f'<line x1="{x + 50 * s}" y1="{y + 125 * s}" x2="{x + 50 * s}" y2="{H}" stroke="#3a3a3a" stroke-width="6"/>')
    return out


# --- scenes (one per episode topic) ---------------------------------------

def scene_battery(p, dx=0):
    inner = (f'<rect width="202" height="124" fill="#0f2233"/>'
             f'<rect x="46" y="34" width="100" height="52" rx="6" fill="none" stroke="#e8f1f5" stroke-width="5"/>'
             f'<rect x="148" y="50" width="8" height="20" rx="2" fill="#e8f1f5"/>'
             + "".join(f'<rect x="{53 + i * 23}" y="41" width="18" height="38" rx="2" fill="#62d26f"/>' for i in range(4))
             + '<path d="M101 30l-16 30h14l-8 30 22-36h-14l10-24z" fill="#ffd54a" stroke="#0f2233" stroke-width="2"/>')
    return (wall_and_desk(p) + mug(40 + dx, 168, p["accent2"]) + laptop(214 + dx, 74, 216, "#0f2233", inner)
            + f'<path d="M206 {214}c-40 10-80-4-150 14" fill="none" stroke="#e9e9e9" stroke-width="5"/>'
            + f'<rect x="40" y="222" width="22" height="14" rx="3" fill="#e9e9e9"/>')


def scene_color(p, dx=0):
    mon = (f'<rect x="{196 + dx}" y="36" width="256" height="150" rx="6" fill="#111"/>'
           f'<rect x="{204 + dx}" y="44" width="120" height="134" fill="#d9a066"/>'
           f'<rect x="{324 + dx}" y="44" width="120" height="134" fill="#3f8f8a"/>'
           f'<path d="M{204 + dx} 150q60-50 120-10t120-20v58H{204 + dx}z" fill="#2c3b2a" fill-opacity=".75"/>'
           f'<line x1="{324 + dx}" y1="44" x2="{324 + dx}" y2="178" stroke="#fff" stroke-width="2"/>'
           f'<rect x="{306 + dx}" y="186" width="36" height="20" fill="#222"/>')
    wheels = color_wheel(70 + dx // 2, 92, 30) + color_wheel(138 + dx // 2, 92, 30) + color_wheel(104 + dx // 2, 158, 30)
    return wall_and_desk(p) + f'<rect x="{26 + dx // 2}" y="54" width="158" height="146" rx="10" fill="#26292e"/>' + wheels + mon


def scene_fieldkit(p, dx=0):
    bag = (f'<rect x="{36 + dx}" y="64" width="132" height="178" rx="30" fill="{p["accent2"]}"/>'
           f'<path d="M{46 + dx} 96q56-44 112 0" fill="{shade(p["accent2"], -.2)}"/>'
           f'<rect x="{60 + dx}" y="150" width="84" height="64" rx="12" fill="{shade(p["accent2"], -.15)}"/>'
           f'<path d="M{70 + dx} 64q32-30 64 0" fill="none" stroke="#2b2b2b" stroke-width="6"/>')
    cam = (f'<rect x="{224 + dx}" y="128" width="116" height="74" rx="10" fill="#202226"/>'
           f'<rect x="{240 + dx}" y="114" width="36" height="16" rx="3" fill="#202226"/>'
           f'<circle cx="{284 + dx}" cy="165" r="31" fill="#34383f"/><circle cx="{284 + dx}" cy="165" r="18" fill="#6a8fb0"/>'
           f'<circle cx="{278 + dx}" cy="159" r="5" fill="#d7e6f2"/>')
    tri = (f'<rect x="{404 + dx}" y="70" width="34" height="14" rx="3" fill="#333"/>'
           f'<line x1="{421 + dx}" y1="84" x2="{392 + dx}" y2="250" stroke="#555" stroke-width="6"/>'
           f'<line x1="{421 + dx}" y1="84" x2="{421 + dx}" y2="250" stroke="#555" stroke-width="6"/>'
           f'<line x1="{421 + dx}" y1="84" x2="{452 + dx}" y2="250" stroke="#555" stroke-width="6"/>')
    bat = "".join(f'<rect x="{228 + dx + i * 30}" y="214" width="24" height="16" rx="2" fill="#e2c044"/>' for i in range(3))
    return wall_and_desk(p, 230) + bag + cam + tri + bat


def scene_lighting(p, dx=0):
    return (f'<rect width="{W}" height="{H}" fill="{p["wall"]}"/>'
            f'<rect y="236" width="{W}" height="34" fill="{p["desk"]}"/>'
            + softbox(30 + dx, 40, 1.0, .16, (330 + dx, 150))
            + person(330 + dx, 128, "#e0b48f", p["accent2"])
            + f'<circle cx="{450 + dx // 2}" cy="60" r="12" fill="#ffcf73" fill-opacity=".8"/>')


def scene_audio(p, dx=0):
    arm = (f'<path d="M{40 + dx} 0L{150 + dx} 88L{238 + dx} 58" fill="none" stroke="#3b3b3b" stroke-width="8" stroke-linejoin="round"/>'
           f'<g transform="rotate(-18 {262 + dx} 64)"><rect x="{236 + dx}" y="44" width="70" height="40" rx="18" fill="#2b2f36"/>'
           + "".join(f'<line x1="{246 + dx + i * 8}" y1="48" x2="{246 + dx + i * 8}" y2="80" stroke="#59606b" stroke-width="2"/>' for i in range(7))
           + '</g>')
    phones = (f'<path d="M{70 + dx} 222a40 40 0 0 1 80 0" fill="none" stroke="#1e1e1e" stroke-width="8"/>'
              f'<rect x="{60 + dx}" y="214" width="22" height="30" rx="8" fill="{p["accent2"]}"/>'
              f'<rect x="{138 + dx}" y="214" width="22" height="30" rx="8" fill="{p["accent2"]}"/>')
    bars = [18, 40, 62, 30, 74, 52, 24, 66, 38, 20, 48, 70, 34]
    mon = (f'<rect x="{300 + dx}" y="104" width="160" height="96" rx="5" fill="#111"/>'
           + "".join(f'<rect x="{310 + dx + i * 11}" y="{152 - b // 2}" width="7" height="{b}" fill="#6fd1c3"/>' for i, b in enumerate(bars)))
    return wall_and_desk(p) + mon + arm + phones


def scene_commute(p, dx=0):
    sky = p.get("sky", "#f0a35e")
    city = "".join(f'<rect x="{50 + i * 34}" y="{150 - hgt}" width="28" height="{hgt + 30}" fill="#3a3550"/>'
                   for i, hgt in enumerate([40, 70, 55, 90, 35, 64, 80, 48]))
    win = (f'<rect x="28" y="26" width="304" height="160" rx="26" fill="{sky}"/>'
           f'<g clip-path="url(#win)">{city}<line x1="30" y1="120" x2="330" y2="110" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></g>'
           f'<rect x="28" y="26" width="304" height="160" rx="26" fill="none" stroke="#c9ccd1" stroke-width="10"/>')
    timeline = ('<rect width="140" height="84" fill="#1d2430"/>'
                + "".join(f'<rect x="{6 + j * 10}" y="{50 + k * 10}" width="{16 + (j * 7 + k * 5) % 22}" height="7" fill="{c}"/>'
                          for k, c in enumerate(["#6a9be0", "#e0a26a", "#78c48c"]) for j in range(0, 12, 3))
                + '<rect x="6" y="8" width="128" height="36" fill="#2e3a4d"/>')
    return (f'<defs><clipPath id="win"><rect x="28" y="26" width="304" height="160" rx="26"/></clipPath></defs>'
            + wall_and_desk(p, 214) + win + laptop(318 + dx, 112, 154, "#1d2430", timeline))


def scene_keyboard(p, dx=0):
    keys = "".join(f'<rect x="{78 + dx + c * 27}" y="{136 + r * 22}" width="22" height="18" rx="3" fill="{p["accent2"] if (r + c) % 7 else shade(p["accent2"], -.3)}"/>'
                   for r in range(4) for c in range(12) if not (r == 1 and c == 6))
    gap = f'<rect x="{78 + dx + 6 * 27 + 7}" y="{136 + 22 + 5}" width="8" height="8" fill="#d33"/>'
    cap = f'<rect x="{230 + dx}" y="82" width="26" height="22" rx="3" fill="{p["accent2"]}" transform="rotate(-14 {243 + dx} 93)"/>'
    tweezers = f'<path d="M{300 + dx} 30L{252 + dx} 88M{312 + dx} 36L{258 + dx} 92" stroke="#bfc6cc" stroke-width="5"/>'
    return wall_and_desk(p, 120) + f'<rect x="{66 + dx}" y="126" width="348" height="108" rx="10" fill="#26282c"/>' + keys + gap + cap + tweezers


def scene_cables(p, dx=0):
    hub = (f'<rect x="{200 + dx}" y="186" width="120" height="34" rx="8" fill="#8f98a3"/>'
           + "".join(f'<rect x="{212 + dx + i * 20}" y="198" width="12" height="8" rx="2" fill="#2b2f36"/>' for i in range(5)))
    cables = "".join(f'<path d="M{218 + dx + i * 20} 186C{200 + i * 30} 120 {80 + i * 70} 140 {40 + i * 100} 60" fill="none" stroke="{c}" stroke-width="6"/>'
                     for i, c in enumerate(["#e05b5b", "#f2c14e", "#5bb6e0", "#7fd07a", "#c88ae0"]))
    tray = f'<rect x="40" y="232" width="400" height="14" rx="4" fill="#333"/>'
    return wall_and_desk(p, 180) + cables + hub + tray


def scene_camera(p, dx=0):
    rail = f'<rect x="40" y="196" width="400" height="14" rx="6" fill="#666"/><rect x="{170 + dx}" y="184" width="70" height="16" rx="4" fill="#333"/>'
    cam = (f'<rect x="{150 + dx}" y="106" width="110" height="78" rx="10" fill="#1f2125"/>'
           f'<circle cx="{205 + dx}" cy="145" r="30" fill="#3a3e45"/><circle cx="{205 + dx}" cy="145" r="17" fill="#5f88a8"/>')
    product = f'<rect x="{340 + dx // 2}" y="120" width="70" height="76" rx="6" fill="{p["accent2"]}"/><rect x="{350 + dx // 2}" y="132" width="50" height="10" fill="#fff" fill-opacity=".7"/>'
    return wall_and_desk(p, 200) + rail + cam + product


def scene_drives(p, dx=0):
    drives = "".join(f'<rect x="{120 + dx}" y="{90 + i * 44}" width="200" height="38" rx="6" fill="#2d3138"/>'
                     f'<rect x="{134 + dx}" y="{100 + i * 44}" width="80" height="18" fill="#f4f1e6"/>'
                     f'<rect x="{140 + dx}" y="{106 + i * 44}" width="{30 + i * 14}" height="5" fill="#333"/>'
                     f'<circle cx="{300 + dx}" cy="{109 + i * 44}" r="4" fill="{["#62d26f", "#62d26f", "#e0b04f"][i]}"/>'
                     for i in range(3))
    ssd = f'<rect x="{350 + dx}" y="190" width="60" height="38" rx="5" fill="{p["accent2"]}"/>'
    return wall_and_desk(p, 226) + drives + ssd


def scene_street(p, dx=0):
    bldg = "".join(f'<rect x="{i * 60}" y="{70 + (i * 37) % 60}" width="54" height="200" fill="#1f2333"/>'
                   + "".join(f'<rect x="{i * 60 + 8 + c * 16}" y="{86 + (i * 37) % 60 + r * 22}" width="8" height="10" fill="#f7d27a" fill-opacity="{.35 + .5 * ((i + r + c) % 2)}"/>'
                             for r in range(4) for c in range(3))
                   for i in range(8))
    rain = "".join(f'<line x1="{(i * 53) % W}" y1="{(i * 29) % 200}" x2="{(i * 53) % W - 8}" y2="{(i * 29) % 200 + 22}" stroke="#9fb6d0" stroke-opacity=".5" stroke-width="1.5"/>' for i in range(40))
    lamps = "".join(f'<circle cx="{x + dx}" cy="120" r="26" fill="#ffcf73" fill-opacity=".25"/><circle cx="{x + dx}" cy="120" r="7" fill="#ffe2a3"/>'
                    f'<line x1="{x + dx}" y1="126" x2="{x + dx}" y2="224" stroke="#222" stroke-width="4"/>' for x in (110, 300))
    road = f'<rect y="224" width="{W}" height="46" fill="#151821"/>' + "".join(
        f'<rect x="{x + dx - 4}" y="230" width="8" height="34" fill="#ffcf73" fill-opacity=".35"/>' for x in (110, 300))
    return f'<rect width="{W}" height="{H}" fill="#0d1020"/>' + bldg + lamps + road + rain


SCENES = {"battery": scene_battery, "color": scene_color, "fieldkit": scene_fieldkit, "lighting": scene_lighting,
          "audio": scene_audio, "commute": scene_commute, "keyboard": scene_keyboard, "cables": scene_cables,
          "camera": scene_camera, "drives": scene_drives, "street": scene_street}


# --- keyframes: frames from the cut, with the review copy's burned-in timecode ----

def burn_in(tc):
    return (f'<rect x="10" y="10" width="104" height="22" rx="3" fill="#000" fill-opacity=".72"/>'
            f'<text x="62" y="26" text-anchor="middle" font-family="{MONO}" font-size="14" fill="#fff">{tc}</text>')


def key_inbox(p):
    inbox = ('<rect width="306" height="166" fill="#f4f3ee"/>'
             f'<g font-family="{FONT}" fill="#14283b"><text x="18" y="34" font-size="22" font-weight="bold">Inbox</text>'
             '<text x="18" y="74" font-size="16">To: editor@example.test</text>'
             '<text x="18" y="104" font-size="16">Subject: Private review notes</text></g>'
             '<rect x="18" y="122" width="200" height="6" fill="#c8ccd2"/><rect x="18" y="136" width="150" height="6" fill="#c8ccd2"/>')
    return wall_and_desk(p, 222) + laptop(80, 34, 320, "#f4f3ee", inbox) + mug(20, 186, p["accent2"])


def key_green_skin(p):
    return (f'<rect width="{W}" height="{H}" fill="#3b4350"/>'
            f'<rect x="300" y="30" width="150" height="90" fill="#59606e"/>'
            + person(220, 126, "#9fb27a", "#2f4a6d", hair="#2a2a1e")
            + f'<text x="440" y="254" text-anchor="end" font-family="{MONO}" font-size="13" fill="#fff" fill-opacity=".8">B-CAM</text>')


def key_flatlay(p):
    items = (f'<rect width="{W}" height="{H}" fill="#5d6b5a"/>'
             f'<rect x="30" y="30" width="150" height="210" rx="28" fill="{p["accent2"]}"/>'
             f'<rect x="50" y="120" width="110" height="90" rx="14" fill="{shade(p["accent2"], -.2)}"/>'
             '<rect x="220" y="44" width="110" height="70" rx="10" fill="#202226"/><circle cx="275" cy="79" r="25" fill="#34383f"/><circle cx="275" cy="79" r="14" fill="#6a8fb0"/>'
             '<rect x="210" y="150" width="230" height="16" rx="6" fill="#4a4a4a"/><rect x="210" y="176" width="230" height="16" rx="6" fill="#4a4a4a"/>'
             '<rect x="430" y="146" width="22" height="50" rx="4" fill="#4a4a4a" fill-opacity=".7"/>'
             + "".join(f'<rect x="{360 + i * 28}" y="60" width="22" height="36" rx="3" fill="#e2c044"/>' for i in range(3))
             + '<path d="M220 226c40-24 80 24 120 0s60-10 100 6" fill="none" stroke="#111" stroke-width="5"/>')
    return f'<g filter="url(#soft)">{items}</g><defs><filter id="soft"><feGaussianBlur stdDeviation="1.6"/></filter></defs>'


def key_glasses(p):
    return (f'<rect width="{W}" height="{H}" fill="{p["wall"]}"/>'
            + softbox(360, 30, .8, .0)
            + person(210, 120, "#d8a98a", p["accent2"], glasses=True, reflect=True))


def key_meter(p):
    segs = "".join(f'<rect x="{392}" y="{226 - i * 14}" width="34" height="11" fill="{"#e0473f" if i >= 12 else "#f0c04a" if i >= 9 else "#62d26f"}"/>' for i in range(14))
    return (scene_audio(p, -40) + f'<rect x="380" y="20" width="58" height="222" rx="6" fill="#111" fill-opacity=".85"/>' + segs
            + f'<text x="409" y="16" text-anchor="middle" font-family="{MONO}" font-size="11" fill="#fff">dBFS</text>')


def key_glare(p):
    return (scene_commute(p) + '<polygon points="250,40 470,10 470,200 300,250" fill="#fffbe8" fill-opacity=".82"/>')


KEYFRAMES = {"inbox": key_inbox, "green_skin": key_green_skin, "flatlay": key_flatlay, "glasses": key_glasses,
             "meter": key_meter, "glare": key_glare}


# --- thumbnails ------------------------------------------------------------

def title_size(title, limit=300, top=46):
    size = top
    while size > 18 and text_width(title, size) > limit:
        size -= 1
    return size


def badge(duration):
    return (f'<rect x="356" y="224" width="109" height="37" rx="6" fill="#080f19"/>'
            f'<text x="410" y="250" text-anchor="middle" fill="white" font-family="{FONT}" font-size="20">{duration}</text>')


def title_svg(title, size, layout, p):
    w = text_width(title, size)
    t = lambda x, y, fill: f'<text x="{x}" y="{y}" font-family="{FONT}" font-weight="bold" font-size="{size}" fill="{fill}">{esc(title)}</text>'
    band = lambda x, y: f'<rect x="{x - 10}" y="{y - size - 2}" width="{w + 20}" height="{size + 16}" rx="6" fill="#0b1320" fill-opacity=".82"/>'
    kind, where = layout
    if kind == "ok":
        x, y = {"top": (20, 18 + size), "middle": (20, 120 + size // 2), "bottom": (20, 252)}[where]
        assert x + w <= (340 if where == "bottom" else 462), (title, where, w)
        return band(x, y) + t(x, y, "#ffde5a")
    if kind == "badge":
        x, y = max(16, 416 - w), 252
        assert x + w > 380, (title, w)
        return band(x, y) + t(x, y, "#ffde5a")
    if kind == "clip":
        overflow = max(44, round(w * .18))
        x, y = 480 - w + overflow, {"top": 18 + size, "middle": 120 + size // 2}[where]
        return band(x, y) + t(x, y, "#ffde5a")
    if kind == "contrast":
        # Pale yellow on a pale band: legible at full size only on close inspection,
        # unreadable at feed size whatever the scene behind it.
        x, y = 20, {"top": 18 + size, "middle": 120 + size // 2}[where]
        pale = f'<rect x="{x - 10}" y="{y - size - 2}" width="{w + 20}" height="{size + 16}" rx="6" fill="#f7f0cc"/>'
        return pale + t(x, y, "#efe3aa")
    raise ValueError(kind)


def frame(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"><g font-family="{FONT}">{body}</g></svg>'


PALETTES = [
    {"wall": "#193154", "desk": "#6b4e3a", "accent2": "#d3643b"},
    {"wall": "#2f3e3a", "desk": "#5a4a3c", "accent2": "#c9a227", "sky": "#e7b46a"},
    {"wall": "#3b2f4f", "desk": "#4f5a3a", "accent2": "#4f8fc2"},
    {"wall": "#24282f", "desk": "#3a3026", "accent2": "#b8463c"},
    {"wall": "#2d3d52", "desk": "#6a5644", "accent2": "#3d9a7f"},
    {"wall": "#46382c", "desk": "#2f3b47", "accent2": "#7e5bc2", "sky": "#f0a35e"},
]

# Fixture projects ep14..ep19: scene, keyframe, thumbnail title, duration, and
# the layout of candidates A, B, C. Exactly one candidate per project is "ok".
FIXTURE = [
    ("battery", "inbox", "00:08:45:00", "14 HOURS", "12:38",
     [("badge", "bottom"), ("ok", "top"), ("clip", "middle")]),
    ("color", "green_skin", "00:03:20:00", "GRADE IN 10 MIN", "11:52",
     [("ok", "middle"), ("clip", "top"), ("contrast", "top")]),
    ("fieldkit", "flatlay", "00:01:48:00", "PACK LIGHT", "9:47",
     [("contrast", "top"), ("badge", "bottom"), ("ok", "bottom")]),
    ("lighting", "glasses", "00:05:02:00", "$50 STUDIO LIGHT", "16:30",
     [("clip", "middle"), ("ok", "top"), ("badge", "bottom")]),
    ("audio", "meter", "00:02:41:00", "DESK AUDIO FIX", "8:58",
     [("ok", "bottom"), ("contrast", "middle"), ("badge", "bottom")]),
    ("commute", "glare", "00:06:17:00", "EDIT ON A TRAIN", "13:21",
     [("badge", "bottom"), ("contrast", "top"), ("ok", "middle")]),
]
SHIFT = [0, -24, 22]


def fixture_images():
    out = {}
    for i, (scene, key, tc, title, duration, layouts) in enumerate(FIXTURE):
        p = PALETTES[i]
        names = ("thumb-a", "thumb-b", "thumb-c", "keyframe-0845") if i == 0 else \
            tuple(f"ep{14 + i}-{s}" for s in ("thumb-a", "thumb-b", "thumb-c", "keyframe"))
        size = title_size(title)
        for j, layout in enumerate(layouts):
            out[names[j]] = frame(SCENES[scene](p, SHIFT[j]) + title_svg(title, size, layout, p) + badge(duration))
        out[names[3]] = frame(KEYFRAMES[key](p) + burn_in(tc))
    return out


def history_images():
    episodes = json.loads((ROOT / "scripts/history-episodes.json").read_text())["episodes"]
    out = {}
    for n, e in enumerate(x for x in episodes if x.get("ab")):
        p = PALETTES[(n + 2) % len(PALETTES)]
        size = title_size(e["short"], 290)
        duration = f'{8 + n % 9}:{(n * 17) % 60:02}'
        second = "bottom" if text_width(e["short"], size) <= 300 else "middle"
        for letter, (where, shift) in zip("ab", (("top", 0), (second, -20))):
            out[f'ep-{e["slot"]}-thumb-{letter}'] = frame(SCENES[e["scene"]](p, shift) + title_svg(e["short"], size, ("ok", where), p) + badge(duration))
    return out


def main():
    fixture, history = fixture_images(), history_images()
    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "datasets/history/assets").mkdir(parents=True, exist_ok=True)
    written = []
    for name, svg in fixture.items():
        f = ROOT / "assets" / f"{name}.png"
        f.write_bytes(png(svg)); written.append(f)
    for name, svg in history.items():
        f = ROOT / "datasets/history/assets" / f"{name}.png"
        f.write_bytes(png(svg)); written.append(f)
    total = sum(f.stat().st_size for f in written)
    print(f"wrote {len(fixture)} fixture and {len(history)} history PNGs, {total} bytes")
    if "--sheet" in sys.argv:
        files = written
        cols = 6
        sheet = Image.new("RGB", (cols * 244, math.ceil(len(files) / cols) * 150), "white")
        for k, f in enumerate(files):
            im = Image.open(f).convert("RGB").resize((240, 135))
            sheet.paste(im, ((k % cols) * 244, (k // cols) * 150))
        sheet.save(sys.argv[sys.argv.index("--sheet") + 1])


if __name__ == "__main__":
    main()
