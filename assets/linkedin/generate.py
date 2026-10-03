"""Generate Orbyn's LinkedIn SVGs with outlined, bundled DM Sans lettering.

Run with Python + fonttools[woff] installed in an isolated environment.
PNG exports are rendered from these SVGs; no app dependencies are needed.
"""

from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FONT = ROOT / "desktop/src/assets/fonts/dm-sans-latin-wght-normal.woff2"
GREEN = "#376c51"
WHITE = "#ffffff"
LIGHT = "#f7f8fa"
MARK = '''<path d="M20.341 6.484A10 10 0 0 1 10.266 21.85"/>
<path d="M3.659 17.516A10 10 0 0 1 13.74 2.152"/>
<circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/>
<circle cx="5" cy="19" r="2"/>'''


def mark(x, y, size, color=WHITE):
    return f'''<g transform="translate({x} {y}) scale({size / 24})"
fill="none" stroke="{color}" stroke-width="1.9"
stroke-linecap="round" stroke-linejoin="round">{MARK}</g>'''


def lettering(text, x, y, size, weight, color):
    font = instantiateVariableFont(TTFont(FONT), {"wght": weight})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    cursor = 0
    paths = []
    for character in text:
        name = cmap[ord(character)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        if pen.getCommands():
            paths.append(f'<path transform="translate({cursor} 0)" d="{pen.getCommands()}"/>')
        cursor += glyphs[name].width
    return f'<g fill="{color}" aria-label="{text}" transform="translate({x} {y}) scale({scale} {-scale})">' + "".join(paths) + "</g>"


def svg(width, height, title, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title">
<title id="title">{title}</title>
{body}
</svg>\n'''


profile = f'<rect width="400" height="400" fill="{GREEN}"/>' + mark(75, 75, 250)
(HERE / "orbyn-linkedin-profile.svg").write_text(svg(400, 400, "Orbyn orbit logo", profile))

for variant, background, foreground in [
    ("", LIGHT, GREEN),
    ("-green", GREEN, WHITE),
]:
    body = f'<rect width="1512" height="256" fill="{background}"/>'
    body += mark(545, 79, 90, foreground)
    body += lettering("Orbyn", 663, 150, 94, 500, foreground)
    body += lettering("orbyn.dev", 668, 189, 18, 400, foreground)
    title = "Orbyn — orbyn.dev"
    (HERE / f"orbyn-linkedin-cover{variant}.svg").write_text(svg(1512, 256, title, body))
