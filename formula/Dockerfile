# Orbyn's formula model: pix2tex (LaTeX-OCR, MIT) turns pictures of equations
# into LaTeX for scanned pages. Small (about 1 GB of RAM), CPU only.
#
# Off unless the `formula` Compose profile is on:
#   COMPOSE_PROFILES=...,formula   FORMULA_URL=http://formula:8000   in .env
# The model's weights are downloaded while the image is built, so the running
# container never needs the internet.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=2

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN python -m pip install --upgrade pip \
  && python -m pip install --index-url https://download.pytorch.org/whl/cpu \
    torch==2.2.2 torchvision==0.17.2 \
  && python -m pip install -r /app/requirements.txt

# Fetch the weights now (into the package), not when the first page arrives.
RUN python -c "from pix2tex.cli import LatexOCR; LatexOCR()"

RUN useradd --create-home --uid 10002 formula
COPY server.py /app/server.py
USER formula
WORKDIR /app
EXPOSE 8000
CMD ["python", "/app/server.py"]
