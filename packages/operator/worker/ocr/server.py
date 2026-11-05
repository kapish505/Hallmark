"""Hallmark OCR worker: pinned Tesseract 5 over HTTP.

Tesseract is the default CANDIDATE engine; gate G3 chooses between PaddleOCR, Tesseract 5 and
EasyOCR on measured determinism and separation. Tesseract runs on CPU with fixed threads, which is
the configuration G3 prefers. Every setting is fixed here or in the image env.
"""
import io
import os
import subprocess
import tempfile
import time

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image

MAX_BYTES = int(os.environ.get("MAX_INPUT_BYTES", "2000000"))
MAX_PIXELS = int(os.environ.get("MAX_PIXELS", "4000000"))
LANG = os.environ.get("OCR_LANG", "eng")
PSM = os.environ.get("OCR_PSM", "3")
# honest = tessdata_best LSTM models; the lazy-engine demo cheat uses tessdata_fast
TESSDATA = {"best": "/usr/share/tessdata-best", "fast": "/usr/share/tessdata-fast"}

app = FastAPI(title="hallmark-ocr-worker")


def version() -> str:
    return subprocess.run(["tesseract", "--version"], capture_output=True, text=True).stdout.splitlines()[0]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "task": "ocr", "engine": version(), "lang": LANG, "psm": PSM,
            "omp_thread_limit": os.environ.get("OMP_THREAD_LIMIT")}


@app.post("/ocr")
async def ocr(input: UploadFile = File(...), engine: str = Form(default="best"),
              scale: float = Form(default=1.0), crop: float = Form(default=1.0)) -> dict:
    data = await input.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "input too large")
    if engine not in TESSDATA or not (0.1 <= scale <= 1.0) or not (0.1 <= crop <= 1.0):
        raise HTTPException(400, "bad parameters")
    try:
        img = Image.open(io.BytesIO(data))
        if img.format != "PNG":
            raise HTTPException(415, "input must be PNG")
        img.load()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(415, f"bad image: {e}")
    if img.width * img.height > MAX_PIXELS:
        raise HTTPException(413, "image too large")
    img = img.convert("L")  # canonical: 8-bit grayscale, decoded inside the pinned image
    if crop < 1.0:  # demo cheat: keep the top `crop` fraction
        img = img.crop((0, 0, img.width, max(1, int(img.height * crop))))
    if scale < 1.0:  # demo cheat: downscale
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.BILINEAR)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        img.save(f.name, format="PNG")
        t0 = time.time()
        out = subprocess.run(
            ["tesseract", f.name, "stdout", "--tessdata-dir", TESSDATA[engine], "-l", LANG, "--psm", PSM, "--oem", "1"],
            capture_output=True, text=True, timeout=60,
        )
    if out.returncode != 0:
        raise HTTPException(500, out.stderr[-500:])
    return {"text": out.stdout.strip(), "engine": engine, "seconds": round(time.time() - t0, 3)}
