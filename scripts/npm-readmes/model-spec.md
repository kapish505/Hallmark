# @kapish505/hallmark-model-spec

Model manifests for [Hallmark](https://github.com/kapish505/Hallmark): schema, validator, `hallmark-calibrate`
and `hallmark-models`. Adding a model means measuring it, not changing code. **0.x alpha.**

```bash
npm install -g @kapish505/hallmark-model-spec
hallmark-calibrate models/my-model.json ./dataset --workers http://a:9000,http://b:9000 --honest-cost-tinybar 4000000
hallmark-models propose models/my-model.calibrated.json   # anyone; stored disabled
hallmark-models enable  models/my-model.calibrated.json   # registry owner; pinned to the proposal hash
```

```js
import { validateManifest, loadManifests, bondWindowFor } from "@kapish505/hallmark-model-spec";
```

`hallmark-calibrate` re-runs every input on several machines, measures how often each cheat is caught and
the honest false-alarm rate, and refuses to emit an enabled manifest when no bond both deters cheats and
spares honest operators. The live manifests (speech-to-text, OCR) ship in `models/`.

Guide: https://github.com/kapish505/Hallmark/blob/main/docs/ADD_A_MODEL.md · MIT
