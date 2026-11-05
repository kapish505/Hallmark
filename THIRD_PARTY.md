# Third-party code

No templates or example projects were copied. Libraries are dependencies at exact versions (lockfile / install script).

| Package | Version | Use | License |
|---|---|---|---|
| OpenZeppelin Contracts | 5.1.0 | `Ownable`, `ReentrancyGuard` (inlined in `contracts/flat/`) | MIT |
| forge-std | 1.9.4 | Foundry tests and scripts | MIT / Apache-2.0 |
| @x402/core, @x402/express, @x402/fetch, @x402/hedera | 2.28.0 | x402 server, client, Hedera scheme, Hiero SDK re-export | Apache-2.0 |
| ethers | 6.13.1 | EVM client | MIT |
| express, multer, better-sqlite3, zod | see lockfile | gateway | MIT |
| React, @tanstack/react-query, Vite | see lockfile | web | MIT |
| faster-whisper, FastAPI, uvicorn, numpy | see `packages/operator/worker/asr/requirements.txt` | ASR worker | MIT / BSD |
| Whisper large-v3 weights (via faster-whisper) | pinned in the image | ASR model | MIT |
| Tesseract 5 + tessdata_best / tessdata_fast 4.1.0 | Debian package + pinned traineddata | OCR worker (candidate engine) | Apache-2.0 |
| Pillow | 11.0.0 | OCR worker image decoding | MIT-CMU |
