"""Orbyn's OCR service: one page in, Markdown out.

POST /ocr with a page as the body:
  Content-Type: application/pdf   a one-page PDF (the converter cuts it out)
  Content-Type: image/png|jpeg    a photo or screenshot of notes
Answers {"markdown": "...", "ms": 1234}. The Markdown still carries the
model's region markers; the converter reads them to drop headers, footers
and page numbers, and to note figures.

GET /health answers 200 once the model is loaded (503 while it loads; the
first start downloads it, which takes a while).

The model runs on CPU in float32 (bfloat16 is slow or missing on most CPUs),
the way say4n/unlimited-ocr-container's CPU image runs it. One page at a
time: a second page at once would only fight for the same cores. Scale out
with more containers instead (docker compose up -d --scale ocr=2).

Settings (environment):
  OCR_MODEL           Hugging Face model id (baidu/Unlimited-OCR)
  OCR_MODEL_REVISION  commit to pin the model and its code to (main)
  OCR_IMAGE_MODE      gundam (crops, better on dense pages) or base
  OCR_MAX_TOKENS      longest answer for one page (8192)
  OCR_THREADS         CPU threads for PyTorch; 0 = PyTorch's default
  OCR_OFFLINE         1 = never reach the internet (after the first download)
  OCR_PDF_DPI         resolution a PDF page is rendered at (200)
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if os.environ.get("OCR_OFFLINE") == "1":
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

import torch  # noqa: E402
from transformers import AutoModel, AutoTokenizer  # noqa: E402

MODEL = os.environ.get("OCR_MODEL", "baidu/Unlimited-OCR")
REVISION = os.environ.get("OCR_MODEL_REVISION", "main") or "main"
IMAGE_MODE = os.environ.get("OCR_IMAGE_MODE", "gundam")
MAX_TOKENS = int(os.environ.get("OCR_MAX_TOKENS", "8192"))
THREADS = int(os.environ.get("OCR_THREADS", "0"))
PDF_DPI = int(os.environ.get("OCR_PDF_DPI", "200"))
MAX_BODY = 60 * 1024 * 1024
PROMPT = "<image>document parsing."

state: dict = {"model": None, "tokenizer": None, "error": None}
lock = threading.Lock()


def log(message: str, **extra) -> None:
    print(json.dumps({"service": "ocr", "message": message, **extra}), flush=True)


def install_cuda_shim() -> None:
    """The model's own code calls .cuda(); on CPU that must mean 'stay here'."""
    if torch.cuda.is_available():
        return
    cpu = torch.device("cpu")

    def tensor_cuda(self, device=None, non_blocking=False, memory_format=torch.preserve_format):
        if self.is_floating_point() and self.dtype == torch.bfloat16:
            return self.float().to(cpu)
        return self.to(cpu)

    def module_cuda(self, device=None):
        return self.to(cpu)

    torch.Tensor.cuda = tensor_cuda
    torch.nn.Module.cuda = module_cuda


def image_config() -> dict:
    if IMAGE_MODE == "base":
        return {"base_size": 1024, "image_size": 1024, "crop_mode": False}
    return {"base_size": 1024, "image_size": 640, "crop_mode": True}


def load() -> None:
    try:
        started = time.time()
        if THREADS > 0:
            torch.set_num_threads(THREADS)
        install_cuda_shim()
        tokenizer = AutoTokenizer.from_pretrained(
            MODEL, trust_remote_code=True, revision=REVISION
        )
        model = AutoModel.from_pretrained(
            MODEL,
            trust_remote_code=True,
            use_safetensors=True,
            revision=REVISION,
            dtype=torch.float32,
        )
        state["model"] = model.eval().to("cpu")
        state["tokenizer"] = tokenizer
        log("model loaded", seconds=round(time.time() - started), revision=REVISION)
    except Exception as error:  # noqa: BLE001
        state["error"] = str(error)
        log("model failed to load", error=str(error))


def page_image(body: bytes, content_type: str, folder: str) -> str:
    """The page as an image file the model can read."""
    if content_type == "application/pdf":
        import fitz  # PyMuPDF

        doc = fitz.open(stream=body, filetype="pdf")
        try:
            if doc.page_count < 1:
                raise ValueError("The PDF has no pages.")
            matrix = fitz.Matrix(PDF_DPI / 72, PDF_DPI / 72)
            path = os.path.join(folder, "page.png")
            doc[0].get_pixmap(matrix=matrix).save(path)
            return path
        finally:
            doc.close()
    ext = ".png" if content_type == "image/png" else ".jpg"
    path = os.path.join(folder, "page" + ext)
    Path(path).write_bytes(body)
    return path


def read_page(body: bytes, content_type: str) -> str:
    folder = tempfile.mkdtemp(prefix="ocr_")
    try:
        image = page_image(body, content_type, folder)
        out = os.path.join(folder, "out")
        os.makedirs(out, exist_ok=True)
        with lock, torch.inference_mode():
            returned = state["model"].infer(
                state["tokenizer"],
                prompt=PROMPT,
                image_file=image,
                output_path=out,
                max_length=MAX_TOKENS,
                no_repeat_ngram_size=35,
                ngram_window=128,
                save_results=True,
                **image_config(),
            )
        for name in ("result.md", "result.mmd"):
            saved = Path(out) / name
            if saved.exists():
                return saved.read_text(encoding="utf-8")
        return returned if isinstance(returned, str) else ""
    finally:
        shutil.rmtree(folder, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "orbyn-ocr"

    def reply(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # noqa: A002
        pass  # One JSON line per page is logged instead.

    def do_GET(self):  # noqa: N802
        if self.path != "/health":
            return self.reply(404, {"message": "Not found"})
        if state["model"] is not None:
            return self.reply(200, {"status": "ok", "service": "ocr"})
        if state["error"]:
            return self.reply(500, {"status": "failed", "message": state["error"]})
        return self.reply(503, {"status": "loading"})

    def do_POST(self):  # noqa: N802
        if self.path != "/ocr":
            return self.reply(404, {"message": "Not found"})
        if state["model"] is None:
            return self.reply(503, {"message": "The OCR model is still loading."})
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if content_type not in ("application/pdf", "image/png", "image/jpeg"):
            return self.reply(415, {"message": "Send a one-page PDF, a PNG or a JPEG."})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.reply(413, {"message": "The page is empty or too large."})
        body = self.rfile.read(length)
        started = time.time()
        try:
            markdown = read_page(body, content_type)
        except Exception as error:  # noqa: BLE001
            log("page failed", error=str(error))
            return self.reply(422, {"message": "This page couldn't be read."})
        ms = int((time.time() - started) * 1000)
        log("page read", ms=ms, chars=len(markdown))
        return self.reply(200, {"markdown": markdown, "ms": ms})


def main() -> None:
    threading.Thread(target=load, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    log("listening", port=8000, model=MODEL, mode=IMAGE_MODE)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
