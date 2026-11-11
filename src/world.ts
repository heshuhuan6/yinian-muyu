/** All artwork is rasterized on the CPU. No canvas paths, images, or random(). */
export const WORLD_W = 144;
export const WORLD_H = 76;
export const BAYER = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

export function xorshift(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

type Keys = readonly [string, string, string, string];
type Material = { colors: Uint32Array; lit: Uint32Array };
const materials: Material[] = [{ colors: new Uint32Array(12), lit: new Uint32Array(12) }];

function packed(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function material(keys: Keys): number {
  const colors = new Uint32Array(12);
  const lit = new Uint32Array(12);
  keys.forEach((hex, key) => {
    const n = Number.parseInt(hex, 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let shade = 0; shade < 3; shade++) {
      const factor = shade === 0 ? 1.15 : shade === 2 ? 0.73 : 1;
      const c = rgb.map(channel => Math.min(255, Math.round(channel * factor + (shade === 0 ? 6 : 0))));
      colors[key * 3 + shade] = packed(c[0]!, c[1]!, c[2]!);
      // A separate fully illuminated surface, retaining the selected light key.
      const full = rgb.map(channel => Math.min(249, Math.round(channel * (shade === 2 ? 1 : 1.04) + 4)));
      lit[key * 3 + shade] = packed(full[0]!, full[1]!, full[2]!);
    }
  });
  materials.push({ colors, lit });
  return materials.length - 1;
}

// Still moonlight → cool morning → apricot light → warm tea light.
const M = {
  sky: material(['526b70', '91a59c', 'd7c5a1', 'e9dbb9']),
  haze: material(['6c8180', 'b6bfa5', 'e8d3aa', 'f6e5c2']),
  outline: material(['263c40', '3a5148', '604c3c', '60452e']),
  far: material(['415e61', '7e9b88', 'aaa986', 'b6be90']),
  near: material(['344d4d', '5e806d', '8b9870', '8f9d68']),
  floor: material(['687776', '9fa995', 'c5b495', 'd7c4a0']),
  floorLight: material(['7c8981', 'b6bda5', 'dfcaab', 'eddbb8']),
  floorDark: material(['4c6563', '839881', 'a49779', 'b1a483']),
  leaf: material(['3e6461', '58856d', '7b9157', '6f8a4a']),
  leafLight: material(['73937c', '9cae78', 'b6bb76', 'b0bd6e']),
  bamboo: material(['657e6e', '8c9b6c', 'a5a66d', 'aeb36e']),
  wood: material(['816e5c', 'a68b5d', 'bd8b51', 'c58b47']),
  woodLight: material(['b4a381', 'cdb784', 'e5ba75', 'f0c181']),
  woodDark: material(['4d4b44', '725f42', '895535', '8f512d']),
  groove: material(['283e3c', '4c4838', '603d2b', '653923']),
  red: material(['71554c', 'aa7960', 'b9724c', 'b86943']),
  redLight: material(['92705a', 'c9946b', 'd89a65', 'd99962']),
  stone: material(['728383', 'a0b1a0', 'b3af94', 'b9b49b']),
  wall: material(['91a09a', 'd0cfb5', 'e8d7b3', 'f4e4c6']),
  lattice: material(['4a5a52', '7d8060', 'a59466', 'b49b69']),
  light: material(['c8ca9e', 'dbd8a2', 'ffe0a2', 'ffe7b0']),
  water: material(['36595a', '6b9990', '9cb9a3', '9ab5a0']),
  wave: material(['7caaa4', 'bad1b1', 'd8d6b0', 'e0dfb7']),
  cat: material(['a4957d', 'd2be8d', 'e4c18f', 'f0d2a5']),
  flower: material(['9d9e97', 'd1c6af', 'e8c2a2', 'efc8a7']),
};

/** A reusable sprite is a union of filled shapes with an automatic 1px outline. */
class Sprite {
  readonly mask: Uint8Array;
  constructor(readonly width: number, readonly height: number) {
    this.mask = new Uint8Array(width * height);
  }
  rect(x: number, y: number, w: number, h: number, mat: number): this {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        if (xx >= 0 && yy >= 0 && xx < this.width && yy < this.height)
          this.mask[yy * this.width + xx] = mat;
    return this;
  }
  poly(points: readonly (readonly [number, number])[], mat: number): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i]!;
          const b = points[j]!;
          if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
            inside = !inside;
        }
        if (inside) this.mask[y * this.width + x] = mat;
      }
    }
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, mat: number): this {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(this.height - 1, cy + ry); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(this.width - 1, cx + rx); x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.mask[y * this.width + x] = mat;
    return this;
  }
  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.mask[y * this.width + x]!;
  }
}

const woodfish = new Sprite(48, 34)
  .ellipse(24, 19, 22, 14, M.wood)
  .ellipse(22, 13, 19, 10, M.wood)
  .poly([[5, 22], [11, 29], [38, 29], [44, 23], [41, 30], [33, 33], [15, 33], [7, 28]], M.woodDark)
  .poly([[7, 12], [12, 7], [24, 5], [34, 8], [25, 8], [15, 10], [10, 14]], M.woodLight)
  .poly([[5, 21], [12, 18], [25, 17], [35, 18], [45, 21], [44, 24], [33, 21], [23, 20], [12, 21], [5, 24]], M.groove)
  .rect(12, 22, 16, 1, M.woodLight)
  .rect(15, 25, 15, 1, M.woodLight)
  .rect(34, 12, 5, 5, M.woodDark)
  .rect(35, 13, 3, 3, M.woodLight)
  .rect(36, 14, 1, 1, M.groove)
  .rect(17, 12, 9, 1, M.woodLight)
  .rect(13, 14, 4, 1, M.woodLight);
const pillow = new Sprite(58, 12)
  .ellipse(29, 6, 28, 5, M.red)
  .rect(6, 3, 46, 3, M.redLight)
  .rect(8, 8, 43, 2, M.red)
  .rect(11, 9, 3, 2, M.woodLight)
  .rect(45, 9, 3, 2, M.woodLight);
const catAwake = new Sprite(15, 12)
  .ellipse(7, 8, 6, 3, M.cat).rect(8, 2, 5, 6, M.cat)
  .poly([[7, 3], [8, 0], [10, 3]], M.cat).poly([[11, 3], [14, 0], [14, 5]], M.cat)
  .rect(9, 4, 1, 1, M.groove).rect(12, 4, 1, 1, M.groove)
  .rect(0, 5, 2, 4, M.cat).rect(1, 8, 3, 2, M.cat);
const catSleeping = new Sprite(15, 10)
  .ellipse(7, 6, 7, 3, M.cat).rect(9, 2, 4, 4, M.cat)
  .rect(10, 1, 1, 2, M.cat).rect(13, 1, 1, 3, M.cat)
  .rect(10, 4, 3, 1, M.woodDark).rect(2, 6, 7, 1, M.woodLight);

export interface WorldState {
  time: number; position: number; parallaxX: number; parallaxY: number; reduced: boolean;
  phase: number; sinceHit: number; committed: boolean; light: number;
}
export class PixelWorld {
  readonly scene = new Uint8Array(WORLD_W * WORLD_H * 4);
  readonly lit = new Uint8Array(WORLD_W * WORLD_H * 4);
  readonly glow = new Uint8Array(WORLD_W * WORLD_H * 4);
  private readonly pixels = new Uint32Array(this.scene.buffer);
  private readonly litPixels = new Uint32Array(this.lit.buffer);
  private readonly glowPixels = new Uint32Array(this.glow.buffer);
  private key = 0;
  private nextKey = 0;
  private fraction = 0;
  private readonly dust: { x: number; y: number; phase: number }[];
  constructor() {
    const random = xorshift(0x7eab00d);
    this.dust = Array.from({ length: 32 }, () => ({ x: Math.floor(random() * WORLD_W), y: Math.floor(random() * WORLD_H), phase: random() * 6.283 }));
  }
  private pixel(x: number, y: number, mat: number, shade = 1, emission = 0): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return;
    const k = (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < this.fraction ? this.nextKey : this.key;
    const palette = materials[mat]!;
    const color = palette.colors[k * 3 + shade]!;
    const index = y * WORLD_W + x;
    this.pixels[index] = color;
    this.litPixels[index] = palette.lit[k * 3 + shade]!;
    this.glowPixels[index] = emission > 0
      ? packed(Math.round((color & 255) * emission), Math.round(((color >> 8) & 255) * emission), Math.round(((color >> 16) & 255) * emission))
      : 0;
  }

  private rect(x: number, y: number, width: number, height: number, mat: number, shade = 1, emission = 0): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let yy = y; yy < y + height; yy++)
      for (let xx = x; xx < x + width; xx++) this.pixel(xx, yy, mat, shade, emission);
  }

  private ellipse(cx: number, cy: number, rx: number, ry: number, mat: number, emission = 0): void {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.pixel(x, y, mat, 1, emission);
  }

  private poly(points: readonly (readonly [number, number])[], mat: number, coverage = 16): void {
    const lowY = Math.max(0, Math.floor(Math.min(...points.map(p => p[1]))));
    const highY = Math.min(WORLD_H - 1, Math.ceil(Math.max(...points.map(p => p[1]))));
    for (let y = lowY; y <= highY; y++) {
      const xs: number[] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!;
        const b = points[j]!;
        if ((a[1] > y) !== (b[1] > y))
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.ceil(xs[i]!); x <= xs[i + 1]!; x++)
          if (BAYER[(y & 3) * 4 + (x & 3)]! < coverage) this.pixel(x, y, mat);
    }
  }

  private sprite(sprite: Sprite, x: number, y: number, outline = M.outline, emission = 0): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let sy = -1; sy <= sprite.height; sy++) {
      for (let sx = -1; sx <= sprite.width; sx++) {
        const mat = sprite.at(sx, sy);
        if (mat) {
          const shade = !sprite.at(sx, sy - 1) ? 0 : !sprite.at(sx, sy + 1) ? 2 : 1;
          this.pixel(x + sx, y + sy, mat, shade, mat === M.light ? emission : 0);
        } else if (sprite.at(sx - 1, sy) || sprite.at(sx + 1, sy) || sprite.at(sx, sy - 1) || sprite.at(sx, sy + 1)) {
          this.pixel(x + sx, y + sy, outline);
        }
      }
    }
  }

  private ring(cx: number, cy: number, rx: number, ry: number, mat: number, coverage = 16): void {
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
      if (BAYER[(y & 3) * 4 + (x & 3)]! < coverage) this.pixel(x, y, mat, 1, 0.12);
    }
  }

  draw(state: WorldState): void {
    const active = state.committed ? 1 : 0;
    const daylight = Math.max(0, Math.min(1, state.light));
    const light = daylight * 3;
    this.key = Math.floor(light); this.nextKey = Math.min(3, this.key + 1); this.fraction = light - this.key;
    this.glowPixels.fill(0);
    const t = state.reduced ? 0 : state.time;
    const px = state.reduced ? 0 : state.parallaxX + Math.sin(t * 0.18) * 0.4;
    const far = Math.round(px * 0.6), middle = Math.round(px * 1.3), front = Math.round(px * 2);
    const phase = state.reduced ? 0 : state.phase;
    const since = state.reduced ? 10 : state.sinceHit;
    const pulse = Math.exp(-since * 12);

    // 1. Mist, a moon-to-sun disc and two layers of distant hills.
    this.rect(0, 0, WORLD_W, WORLD_H, M.sky);
    for (let y = 20; y < 46; y++) for (let x = 0; x < WORLD_W; x++)
      if (BAYER[(y & 3) * 4 + (x & 3)]! < (y - 20) * 0.6) this.pixel(x, y, M.haze);
    this.ellipse(101 + far, 19, 9, 9, M.light, 0.1 + daylight * 0.15);
    if (daylight < 0.45) this.ellipse(98 + far, 16, 8, 8, M.sky);
    this.poly([[0, 43], [11 + far, 27], [26 + far, 35], [43 + far, 24], [64, 43]], M.far);
    this.poly([[83, 43], [111 + far, 33], [122, 37], [139 + far, 26], [144, 44]], M.far);
    this.poly([[0, 47], [17 + middle, 37], [37, 42], [55, 36], [83, 47]], M.near);

    // 2. A paper-screen alcove. The open gate frames the sound ritual.
    this.rect(46 + middle, 18, 38, 29, M.lattice, 2);
    this.rect(48 + middle, 20, 34, 25, M.wall);
    for (let x = 51; x < 82; x += 7) this.rect(x + middle, 20, 1, 25, M.lattice);
    this.rect(48 + middle, 30, 34, 1, M.lattice);
    this.rect(48 + middle, 39, 34, 1, M.lattice);
    this.poly([[42 + middle, 18], [51, 13], [79, 13], [88 + middle, 18]], M.outline);
    this.rect(44 + middle, 17, 42, 2, M.woodDark);
    this.rect(47 + middle, 17, 35, 1, M.woodLight);

    // 3. Gravel, stepping stones and a shallow pool which hears every tap.
    this.rect(0, 46, WORLD_W, 30, M.floor);
    this.poly([[0, 61], [34, 53], [67, 55], [80, 76], [0, 76]], M.floorLight);
    for (let row = 0; row < 4; row++) this.ring(25 + front, 64, 17 + row * 6, 4 + row * 2, M.floorDark, 8);
    this.ellipse(125 + front, 62, 28, 15, M.floorDark);
    this.ellipse(125 + front, 61, 26, 13, M.water);
    this.ring(126 + front, 63, 5 + (since % 2) * 11, 2 + (since % 2) * 4, M.wave, state.committed ? 11 : 4);
    this.ellipse(106 + front, 69, 5, 2, M.leaf);
    this.ellipse(135 + front, 58, 4, 2, M.leaf);
    if (active > 0.45) {
      this.ellipse(107 + front, 67, 3, 1, M.flower);
      this.pixel(107 + front, 66, M.light, 1, active * 0.2);
    } else this.rect(106 + front, 67, 2, 2, M.leafLight);
    for (const [x, y, rx] of [[13, 67, 5], [32, 62, 6], [45, 68, 4], [106, 53, 4]] as const) {
      this.ellipse(x + middle, y, rx + 1, 3, M.floorDark);
      this.ellipse(x + middle, y - 1, rx, 2, M.stone);
    }

    // 4. Bamboo sways with the active rhythm. A little cat listens, then curls up.
    for (let i = 0; i < 4; i++) {
      const x = 13 + i * 6 + middle + Math.round(Math.sin(t * 0.7 + i) * active);
      const top = 10 + (i % 3) * 5;
      this.rect(x, top, 2, 44 - top, M.bamboo);
      this.rect(x + 1, top, 1, 44 - top, M.leaf, 2);
      for (let y = top + 6; y < 43; y += 9) {
        this.rect(x - 1, y, 4, 1, M.leafLight);
        this.poly([[x, y], [x - 9, y - 5], [x - 4, y]], M.leaf);
        this.poly([[x + 1, y - 1], [x + 10, y - 6], [x + 7, y - 1]], M.leafLight);
      }
    }
    this.sprite(active > 0.5 ? catAwake : catSleeping, 24 + middle, 48 + Math.round(Math.sin(t * 1.4) * 0.35));
    if (active > 0.5 && pulse > 0.45) this.pixel(35 + middle, 50, M.light, 1, 0.3);

    // 5. Lantern and incense; sparks and smoke drift only while the garden is awake.
    this.rect(125 + middle, 28, 2, 22, M.woodDark);
    this.poly([[117 + middle, 28], [125 + middle, 22], [134 + middle, 28]], M.outline);
    this.rect(120 + middle, 29, 11, 11, M.woodDark);
    this.rect(121 + middle, 30, 9, 8, M.light, 1, (1 - daylight) * 0.55 + active * 0.15);
    this.rect(125 + middle, 30, 1, 9, M.lattice);
    this.rect(118 + middle, 40, 15, 2, M.woodDark);
    this.ellipse(44 + middle, 53, 6, 2, M.woodDark);
    this.rect(43 + middle, 38, 1, 15, M.woodDark);
    this.pixel(43 + middle, 38, M.redLight, 1, active * 0.8);
    if (active > 0.2) for (let i = 0; i < 10; i++) {
      const y = 36 - i;
      const x = 43 + middle + Math.round(Math.sin(t * 0.65 - i * 0.65) * (i * 0.16 + 0.5));
      if ((i + Math.floor(t * 2)) % 3 !== 0) this.pixel(x, y, M.haze);
    }

    // 6. The wooden fish sits on a stitched cushion and gives at the impact.
    const hit = Math.round(pulse * 1.2);
    this.ellipse(77 + front, 66, 32, 5, M.floorDark);
    this.sprite(pillow, 48 + front, 57);
    this.sprite(woodfish, 53 + front, 29 + hit);

    // 7. A filled-shape mallet rotates about its handle. The head meets the crown.
    const lift = state.committed ? Math.pow(Math.sin(Math.PI * phase), 1.2) : 0;
    const angle = state.committed ? -2.72 + lift * 0.83 : -0.15;
    const pivotX = 105 + front, pivotY = state.committed ? 39 : 58;
    const headX = pivotX + Math.cos(angle) * 27, headY = pivotY + Math.sin(angle) * 27;
    const nx = -Math.sin(angle) * 1.1, ny = Math.cos(angle) * 1.1;
    const mallet = new Sprite(64, 64);
    mallet.poly([[32 + nx, 42 + ny], [headX - pivotX + 32 + nx, headY - pivotY + 42 + ny], [headX - pivotX + 32 - nx, headY - pivotY + 42 - ny], [32 - nx, 42 - ny]], M.woodDark);
    mallet.ellipse(headX - pivotX + 32, headY - pivotY + 42, 5, 4, M.woodLight);
    mallet.rect(31, 41, 4, 3, M.red);
    this.sprite(mallet, pivotX - 32, pivotY - 42);

    // 8. One sound opens into a short ring of light and falling golden dust.
    if (state.committed && since < 0.6 && !state.reduced) {
      const s = since / 0.6;
      this.ring(77 + front, 31, 5 + s * 14, 3 + s * 7, M.light, Math.round((1 - s) * 13));
    }
    for (const dot of this.dust) {
      if (active < 0.55 || Math.sin(dot.phase + t * 0.5) < 0.78) continue;
      const x = dot.x + Math.round(Math.sin(t * 0.3 + dot.phase) * 2);
      const y = 17 + ((dot.y + Math.floor(t * 1.5)) % 43);
      this.pixel(x + front, y, M.light, 1, 0.24);
    }
  }

  checksum(): string {
    let hash = 2166136261;
    for (let i = 0; i < this.scene.length; i++) hash = Math.imul(hash ^ this.scene[i]!, 16777619);
    return (hash >>> 0).toString(16);
  }
}

