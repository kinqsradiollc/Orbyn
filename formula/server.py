"""Orbyn's formula model: pictures of equations in, LaTeX out.

POST /formulas with a page image as the body (image/png or image/jpeg) and
the boxes to read in an `X-Boxes` header, as JSON: [[left, top, width,
height], ...] in the image's pixels. Answers {"latex": ["...", ...]}, one
per box ("" where a box couldn't be read).

GET /health answers 200 once the model is loaded.

The model is pix2tex (LaTeX-OCR, MIT), about 1 GB of RAM on CPU. One image
at a time; the converter only sends lines OCR couldn't read that look like
maths.
"""

from __future__ import annotations

import io
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

MAX_BODY = 40 * 1024 * 1024
MAX_BOXES = 60
PAD = 8

state: dict = {"model": None, "error": None}
lock = threading.Lock()


def log(message: str, **extra) -> None:
    print(json.dumps({"service": "formula", "message": message, **extra}), flush=True)


def load() -> None:
    try:
        started = time.time()
        from pix2tex.cli import LatexOCR

        state["model"] = LatexOCR()
        log("model loaded", seconds=round(time.time() - started))
    except Exception as error:  # noqa: BLE001
        state["error"] = str(error)
        log("model failed to load", error=str(error))


def read(image: Image.Image, boxes: list) -> list[str]:
    out: list[str] = []
    width, height = image.size
    for box in boxes[:MAX_BOXES]:
        try:
            left, top, w, h = (int(v) for v in box)
            crop = image.crop(
                (
                    max(0, left - PAD),
                    max(0, top - PAD),
                    min(width, left + w + PAD),
                    min(height, top + h + PAD),
                )
            )
            if crop.width < 8 or crop.height < 8:
                out.append("")
                continue
            with lock:
                out.append(str(state["model"](crop)).strip())
        except Exception as error:  # noqa: BLE001
            log("box failed", error=str(error))
            out.append("")
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "orbyn-formula"

    def reply(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # noqa: A002
        pass

    def do_GET(self):  # noqa: N802
        if self.path != "/health":
            return self.reply(404, {"message": "Not found"})
        if state["model"] is not None:
            return self.reply(200, {"status": "ok", "service": "formula"})
        if state["error"]:
            return self.reply(500, {"status": "failed", "message": state["error"]})
        return self.reply(503, {"status": "loading"})

    def do_POST(self):  # noqa: N802
        if self.path != "/formulas":
            return self.reply(404, {"message": "Not found"})
        if state["model"] is None:
            return self.reply(503, {"message": "The formula model is still loading."})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.reply(413, {"message": "The image is empty or too large."})
        try:
            boxes = json.loads(self.headers.get("X-Boxes") or "[]")
            assert isinstance(boxes, list)
        except Exception:  # noqa: BLE001
            return self.reply(400, {"message": "X-Boxes must be a JSON list."})
        body = self.rfile.read(length)
        started = time.time()
        try:
            image = Image.open(io.BytesIO(body)).convert("RGB")
        except Exception:  # noqa: BLE001
            return self.reply(415, {"message": "Send a PNG or JPEG image."})
        latex = read(image, boxes)
        log("formulas read", boxes=len(boxes), ms=int((time.time() - started) * 1000))
        return self.reply(200, {"latex": latex})


def main() -> None:
    threading.Thread(target=load, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    log("listening", port=8000)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
