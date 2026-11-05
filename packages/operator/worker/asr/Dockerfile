# Pin the base by digest when building for the pool (replace the tag with @sha256:...), then record
# the resulting image digest in ModelRegistry.runtimeDigest. Every honest operator runs that digest.
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
ENV WHISPER_MODEL=large-v3 WHISPER_DEVICE=cpu WHISPER_COMPUTE_TYPE=int8 WHISPER_CPU_THREADS=4 \
    OMP_NUM_THREADS=4 PYTHONHASHSEED=0
# weights baked into the image so the digest covers them (cheat models included for the demo)
RUN python -c "from faster_whisper import WhisperModel as M; [M(n, device='cpu', compute_type='int8') for n in ('large-v3','small','base','tiny')]"
EXPOSE 9000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9000"]
