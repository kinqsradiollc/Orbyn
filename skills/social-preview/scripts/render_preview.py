#!/usr/bin/env python3
"""Render a local social brief to portable HTML and copyable text; no dependencies."""

import argparse
import base64
from html import escape
import json
from pathlib import Path
import re


def text_field(data, key, default=""):
    value = data.get(key, default)
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string")
    return value


def check_keys(data, allowed, label):
    if not isinstance(data, dict):
        raise ValueError(f"{label} must be an object")
    unknown = set(data) - set(allowed.split())
    if unknown:
        raise ValueError(f"Unknown {label} fields: {', '.join(sorted(unknown))}")


def image_url(path):
    with path.open("rb") as source:
        data = source.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("Images must be at most 10 MiB")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data.startswith((b"GIF87a", b"GIF89a")):
        mime = "image/gif"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise ValueError("Image must have a PNG, JPEG, GIF or WebP signature")
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def render(brief, base):
    check_keys(brief, "platform author subtitle post background foreground accent aspect slides", "brief")
    post = text_field(brief, "post")
    if not post.strip():
        raise ValueError("post must be nonempty")
    aspect = text_field(brief, "aspect", "square")
    ratios = {"square": (1, 1), "portrait": (4, 5), "landscape": (191, 100)}
    if aspect not in ratios:
        raise ValueError("aspect must be square, portrait or landscape")
    width, height = ratios[aspect]
    colors = {}
    for key, default in [("background", "#142436"), ("foreground", "#FFFFFF"), ("accent", "#90E0CD")]:
        value = text_field(brief, key, default)
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError(f"{key} must be a six-digit hex color")
        colors[key] = value
    slides = brief.get("slides", [])
    if not isinstance(slides, list):
        raise ValueError("slides must be a list")
    cards = []
    for index, slide in enumerate(slides, 1):
        check_keys(slide, "eyebrow title body footer image alt", f"slide {index}")
        fields = {key: text_field(slide, key) for key in ("eyebrow", "title", "body", "footer", "image", "alt")}
        if not fields["title"].strip():
            raise ValueError(f"Slide {index} title must be nonempty")
        picture = ""
        if fields["image"]:
            if not fields["alt"].strip():
                raise ValueError(f"Slide {index} image needs alt text")
            src = image_url(base / fields["image"])
            picture = f'<img src="{src}" alt="{escape(fields["alt"], quote=True)}">'
        fields = {key: escape(value, quote=True) for key, value in fields.items()}
        cards.append(f'''<div class="card"><div class="art">
<p class="eyebrow">{fields['eyebrow']}</p><h3>{fields['title']}</h3>
<p class="body">{fields['body']}</p>{picture}
<footer><span>{fields['footer']}</span><span>{index} / {len(slides)}</span></footer>
</div></div>''')
    deck = "" if not cards else '<div class="deck" tabindex="0" aria-label="Scroll through carousel">' + "".join(cards) + '</div>'
    feeds = []
    author = escape(text_field(brief, "author", "Author"))
    subtitle = escape(text_field(brief, "subtitle"))
    for label, size in [("Wide feed · 600px", "wide"), ("Narrow feed · 360px", "narrow")]:
        feeds.append(f'''<section class="feed {size}"><h2>{label}</h2><article>
<header><strong>{author}</strong><span>{subtitle}</span></header>
<details><summary><span class="caption">{escape(post)}</span><span class="expand">Expand / collapse post</span></summary></details>
{deck}</article></section>''')
    exports = "".join(f'<section class="export-card">{card}</section>' for card in cards)
    if not cards:
        exports = f'<pre class="text-export">{escape(post)}</pre>'
    template = (Path(__file__).parent.parent / "assets/preview.html").read_text(encoding="utf-8")
    values = {
        "PLATFORM": escape(text_field(brief, "platform", "LinkedIn")),
        "BACKGROUND": colors["background"], "FOREGROUND": colors["foreground"],
        "ACCENT": colors["accent"], "RATIO": f"{width} / {height}",
        "PAGE_HEIGHT": f"{108 * height / width:.4f}",
        "FEEDS": "".join(feeds), "EXPORTS": exports,
    }
    # One substitution pass: user text containing template tokens remains literal.
    html = re.sub(r"@@([A-Z_]+)@@", lambda match: values[match[1]], template)
    return html, post


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brief", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        brief = json.loads(args.brief.read_text(encoding="utf-8"))
        html, post = render(brief, args.brief.resolve().parent)
        args.output.mkdir(parents=True, exist_ok=False)
        (args.output / "preview.html").write_text(html, encoding="utf-8")
        (args.output / "post.txt").write_text(post, encoding="utf-8")
    except (OSError, ValueError) as error:
        parser.exit(2, f"Preview error: {error}\n")
    print(f"Created {args.output.resolve() / 'preview.html'} and post.txt (HTML/text only).")


if __name__ == "__main__":
    main()
