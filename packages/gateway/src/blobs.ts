import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256 } from "ethers";

/**
 * Evidence store, gate G4: content-addressed blobs keyed by keccak256 (inputs). Readers verify the
 * hash themselves, so the gateway is trusted for availability only, never for integrity (T1).
 */
export class BlobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private path(hash: string) {
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("bad hash");
    return join(this.dir, hash.slice(2));
  }
  put(bytes: Uint8Array): string {
    const h = keccak256(bytes).toLowerCase();
    const p = this.path(h);
    if (!existsSync(p)) {
      writeFileSync(`${p}.tmp`, bytes);
      renameSync(`${p}.tmp`, p);
    }
    return h;
  }
  get(hash: string): Uint8Array | null {
    const p = this.path(hash.toLowerCase());
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  }
}
