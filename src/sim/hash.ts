/** FNV-1a style rolling hash over 32-bit integers. */
export class Hasher {
  private h = 0x811c9dc5;

  int(v: number): this {
    this.h ^= v | 0;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
    return this;
  }

  get value(): number {
    return this.h >>> 0;
  }
}
