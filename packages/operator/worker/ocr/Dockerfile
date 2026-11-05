# Pin by digest for the pool and record the image digest in ModelRegistry.runtimeDigest.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr python3 python3-pip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# pinned traineddata (tessdata_best for honest runs, tessdata_fast for the lazy-engine cheat)
RUN mkdir -p /usr/share/tessdata-best /usr/share/tessdata-fast \
    && curl -fsSL -o /usr/share/tessdata-best/eng.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/eng.traineddata \
    && curl -fsSL -o /usr/share/tessdata-fast/eng.traineddata https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY server.py .
# single-threaded Tesseract: removes one source of run-to-run variation
ENV OMP_THREAD_LIMIT=1 PYTHONHASHSEED=0
EXPOSE 9001
CMD ["python3", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9001"]
