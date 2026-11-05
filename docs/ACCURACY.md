# Accuracy (add-on A2)

Hallmark's checks show that a result is **faithful to the pinned model**. They do not show that the text is correct.
This page reports how often the pinned model itself is wrong, measured against human-checked references.

**Status (2026-11-06): not measured.** G3 has not run, so no error rate exists yet. The manifest, results and UI show
"error rate not measured yet" until `expectedErrorBps` and `errorSampleSize` are set in the registry from the numbers below.

| Task | Metric | Normalization | Inputs | Reference units | Corpus error | Bootstrap 95% CI | Source |
|---|---|---|---|---|---|---|---|
| asr (Whisper large-v3, pinned) | WER | NORM_ASR_V1 | pending | pending | pending | pending | `scripts/calibrate.ts --task asr` (G3) |
| ocr (engine chosen at G3) | CER | NORM_OCR_V1B | pending | pending | pending | pending | `scripts/calibrate.ts --task ocr` (G3) |

How it is computed: every G3 input has a human-checked `<name>.ref.txt`. The reference and the pinned model's modal honest
output both go through the production normalizer. Corpus error = total edits / total reference units (words for WER,
characters for CER). The 95% interval is a bootstrap over inputs (2,000 resamples, fixed seed). The script prints the registry
values (`ASR_ERROR_BPS`, `ASR_ERROR_N`, `OCR_ERROR_BPS`, `OCR_ERROR_N`) for `Deploy.s.sol`.

Limits, stated plainly:
- The number describes the pinned model **on this test set**, not any single job.
- The set is small (G3 asks for at least 8 inputs per task), so the interval is wide.
- It is informational only. It never changes a price, a bond or a payout, and it is **not a guarantee**.
