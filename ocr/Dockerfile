# Orbyn's OCR service: baidu/Unlimited-OCR on CPU, behind a small HTTP
# server (server.py) that loads the model once and reads one page at a time.
#
# Built and run only where the `ocr` Compose profile is on (the production
# server), never on a development machine:
#   COMPOSE_PROFILES=...,ocr   OCR_URL=http://ocr:8000   in .env
#   docker compose up -d --build
#
# The Python stack follows the CPU stage of say4n/unlimited-ocr-container
# (MIT): CPU PyTorch, Transformers 4.57.1, float32 weights. The model's own
# code comes from Hugging Face (trust_remote_code), pinned by
# OCR_MODEL_REVISION, and is downloaded once into the ocr_models volume.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip setuptools wheel \
  && python -m pip install --index-url https://download.pytorch.org/whl/cpu \
    torch==2.10.0 \
    torchvision==0.25.0 \
  && python -m pip install \
    transformers==4.57.1 \
    Pillow==12.1.1 \
    matplotlib==3.10.8 \
    einops==0.8.2 \
    addict==2.4.0 \
    easydict==1.13 \
    pymupdf==1.27.2.2 \
    psutil==7.2.2

# An unprivileged user; the model cache volume is created owned by it.
RUN useradd --create-home --uid 10001 ocr \
  && mkdir -p /models/huggingface /app \
  && chown -R ocr:ocr /models

COPY server.py /app/server.py
USER ocr
WORKDIR /app
EXPOSE 8000
CMD ["python", "/app/server.py"]
