// Generates the PWA icon set as real PNGs, with no image dependency.
//
// Each icon is a rounded-square badge in the brand colour with a white "B".
// Written by hand as an uncompressed-but-valid PNG (zlib "stored" blocks), so
// the build has one fewer third-party package to trust.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const BRAND = [91, 91, 214]; // #5b5bd6
const OUT = "public/icons";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** The letter B, drawn on a 7x9 grid and scaled up. */
const GLYPH = [
  "111110 ",
  "1000110",
  "1000110",
  "1000110",
  "111110 ",
  "1000110",
  "1000011",
  "1000110",
  "111110 ",
].map((r) => r.padEnd(7, " "));

function renderPng(size, { maskable }) {
  // A maskable icon must keep its content inside a safe circle, so the badge
  // fills the canvas and the glyph is drawn smaller.
  const pad = maskable ? 0 : Math.round(size * 0.06);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const glyphScale = maskable ? 0.42 : 0.52;

  const gw = Math.round(size * glyphScale);
  const gh = Math.round((gw / 7) * 9);
  const gx = Math.round((size - gw) / 2);
  const gy = Math.round((size - gh) / 2);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      const inX = x >= pad && x < size - pad;
      const inY = y >= pad && y < size - pad;
      let inBadge = inX && inY;

      if (inBadge && radius > 0) {
        // knock out the four corners to round the square
        const lx = x - pad, ly = y - pad;
        const w = size - pad * 2;
        const cx = lx < radius ? radius : lx >= w - radius ? w - radius - 1 : lx;
        const cy = ly < radius ? radius : ly >= w - radius ? w - radius - 1 : ly;
        if ((lx - cx) ** 2 + (ly - cy) ** 2 > radius ** 2) inBadge = false;
      }

      if (inBadge) {
        [r, g, b] = BRAND;
        a = 255;
        const col = Math.floor(((x - gx) / gw) * 7);
        const row = Math.floor(((y - gy) / gh) * 9);
        if (x >= gx && x < gx + gw && y >= gy && y < gy + gh && GLYPH[row]?.[col] === "1") {
          r = g = b = 255;
        }
      }

      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });

const targets = [
  { size: 192, maskable: false, file: "icon-192.png" },
  { size: 512, maskable: false, file: "icon-512.png" },
  { size: 192, maskable: true, file: "maskable-192.png" },
  { size: 512, maskable: true, file: "maskable-512.png" },
  { size: 180, maskable: false, file: "apple-touch-icon.png" },
];

for (const t of targets) {
  const png = renderPng(t.size, { maskable: t.maskable });
  writeFileSync(`${OUT}/${t.file}`, png);
  console.log(
    `${t.file.padEnd(24)} ${String(png.length).padStart(7)} bytes  sha256=${createHash("sha256").update(png).digest("hex").slice(0, 12)}`,
  );
}
