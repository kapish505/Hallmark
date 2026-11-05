"""Hallmark ASR worker: pinned faster-whisper over HTTP (section 7 G3 settings).

Honest operators must run the SAME image digest on the SAME hardware/OS class with the SAME env, so
that honest outputs agree as often as possible. Every setting that can change output is fixed here
or in the image env; /health reports all of them so calibrate.ts can record them.
"""
import io
import os
import time
import wave

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "large-v3")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.environ.get("WHISPER_CPU_THREADS", "4"))
MAX_BYTES = int(os.environ.get("MAX_INPUT_BYTES", "1000000"))
# The lazy-small-model demo cheat may ask for one of these; anything else is refused.
CHEAT_MODELS = {"tiny", "base", "small"}

# G3 determinism settings: temperature 0 ONLY (a one-element list disables the temperature
# fallback), and every threshold that can trigger a fallback is off. Fixed language, no conditioning
# on previous text, greedy decoding, no VAD.
DECODE = dict(
    beam_size=1,
    best_of=1,
    temperature=[0.0],
    compression_ratio_threshold=None,
    log_prob_threshold=None,
    no_speech_threshold=None,
    condition_on_previous_text=False,
    vad_filter=False,
    without_timestamps=True,
    language="en",
)

app = FastAPI(title="hallmark-asr-worker")
_models: dict[str, WhisperModel] = {}


def model(name: str) -> WhisperModel:
    if name not in _models:
        _models[name] = WhisperModel(name, device=DEVICE, compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS, num_workers=1)
    return _models[name]


def decode_canonical_wav(data: bytes) -> np.ndarray:
    """Canonical input only: PCM16, 16 kHz, mono. Decoded here, inside the pinned image (edge case 23)."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise HTTPException(415, "input must be 16 kHz mono 16-bit PCM WAV")
            pcm = w.readframes(w.getnframes())
    except wave.Error as e:
        raise HTTPException(415, f"bad WAV: {e}")
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


@app.on_event("startup")
def warm() -> None:
    model(MODEL)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "task": "asr", "model": MODEL, "device": DEVICE, "compute_type": COMPUTE_TYPE,
            "cpu_threads": CPU_THREADS, "decode": {k: str(v) for k, v in DECODE.items()}}


@app.post("/asr")
async def asr(input: UploadFile = File(...), model_name: str = Form(default="")) -> dict:
    data = await input.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "input too large")
    name = model_name or MODEL
    if name != MODEL and name not in CHEAT_MODELS:
        raise HTTPException(400, f"model {name} not allowed")
    audio = decode_canonical_wav(data)
    t0 = time.time()
    segments, info = model(name).transcribe(audio, **DECODE)
    text = "".join(s.text for s in segments).strip()
    return {"text": text, "model": name, "seconds": round(time.time() - t0, 3), "duration": info.duration}
