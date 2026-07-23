/**
 * Erzeugt die App-Icons als PNG.
 *
 * Bewusst ohne Bildbibliothek: die Vorlage ist ein paar Polygone, und eine
 * zusaetzliche native Abhaengigkeit (sharp, canvas) waere fuer ein Icon nicht
 * zu rechtfertigen. Gezeichnet wird mit vierfachem Supersampling, encodiert
 * wird ein RGBA-PNG von Hand — zlib und crc32 liefert Node selbst.
 *
 * Aufruf: npm run icons
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [0x12, 0x14, 0x1a];
const ACCENT = [0x6b, 0xab, 0x4a];
const LIGHT = [0xee, 0xee, 0xd2];

const SS = 4; // Supersampling-Faktor

// ─── Zeichenfläche ───────────────────────────────────────────────────────────
function createCanvas(size) {
  const pixels = new Float64Array(size * size * 4);
  return { size, pixels };
}

function blend(canvas, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  const p = canvas.pixels;
  p[i] = p[i] * (1 - alpha) + color[0] * alpha;
  p[i + 1] = p[i + 1] * (1 - alpha) + color[1] * alpha;
  p[i + 2] = p[i + 2] * (1 - alpha) + color[2] * alpha;
  p[i + 3] = Math.min(255, p[i + 3] * (1 - alpha) + 255 * alpha);
}

function fillRect(canvas, x0, y0, x1, y1, color) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
      blend(canvas, x, y, color, 1);
    }
  }
}

/** Abgerundetes Rechteck — die iOS-Maske schneidet die Ecken ohnehin. */
function fillRoundedRect(canvas, x0, y0, x1, y1, radius, color) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
      const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
      if (dx * dx + dy * dy <= radius * radius) blend(canvas, x, y, color, 1);
    }
  }
}

function fillCircle(canvas, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) blend(canvas, x, y, color, 1);
    }
  }
}

/** Polygonfüllung nach der Even-Odd-Regel, zeilenweise. */
function fillPolygon(canvas, points, color) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
    const scanY = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if (y1 === y2) continue;
      if (scanY < Math.min(y1, y2) || scanY >= Math.max(y1, y2)) continue;
      crossings.push(x1 + ((scanY - y1) / (y2 - y1)) * (x2 - x1));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      for (let x = Math.floor(crossings[i]); x < Math.ceil(crossings[i + 1]); x += 1) {
        blend(canvas, x, y, color, 1);
      }
    }
  }
}

// ─── Motiv: König auf Schachbrettsockel ─────────────────────────────────────
function drawIcon(canvas, { rounded }) {
  const s = canvas.size;
  const u = s / 100; // Einheiten in Prozent der Kantenlänge

  if (rounded) {
    fillRoundedRect(canvas, 0, 0, s, s, 22 * u, BG);
  } else {
    fillRect(canvas, 0, 0, s, s, BG);
  }

  // Schachbrettstreifen als Sockel
  const boardTop = 74 * u;
  const cell = 12.5 * u;
  for (let col = 0; col < 8; col += 1) {
    const x = 0 * u + col * cell;
    fillRect(canvas, x, boardTop, x + cell, boardTop + cell, col % 2 === 0 ? LIGHT : ACCENT);
  }

  // Kreuz auf der Krone
  fillRect(canvas, 46.5 * u, 10 * u, 53.5 * u, 26 * u, ACCENT);
  fillRect(canvas, 40 * u, 16 * u, 60 * u, 22 * u, ACCENT);

  // Krone: Trapez mit zwei seitlichen Spitzen
  fillPolygon(
    canvas,
    [
      [30 * u, 46 * u],
      [34 * u, 30 * u],
      [42 * u, 40 * u],
      [50 * u, 26 * u],
      [58 * u, 40 * u],
      [66 * u, 30 * u],
      [70 * u, 46 * u],
    ],
    ACCENT
  );

  // Kopfkugeln der Krone
  fillCircle(canvas, 34 * u, 29 * u, 4 * u, ACCENT);
  fillCircle(canvas, 66 * u, 29 * u, 4 * u, ACCENT);

  // Körper
  fillPolygon(
    canvas,
    [
      [32 * u, 47 * u],
      [68 * u, 47 * u],
      [62 * u, 66 * u],
      [38 * u, 66 * u],
    ],
    ACCENT
  );

  // Sockelplatte
  fillRoundedRect(canvas, 30 * u, 66 * u, 70 * u, 73 * u, 2 * u, ACCENT);
}

// ─── PNG-Encoder ─────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bittiefe
  header[9] = 6; // Farbtyp RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Jede Zeile bekommt ein Filter-Byte (0 = keine Filterung).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Zeichnet vergrössert und mittelt herunter — ergibt weiche Kanten. */
function render(size, options) {
  const canvas = createCanvas(size * SS);
  drawIcon(canvas, options);

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * canvas.size + (x * SS + sx)) * 4;
          r += canvas.pixels[i];
          g += canvas.pixels[i + 1];
          b += canvas.pixels[i + 2];
          a += canvas.pixels[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

const targets = [
  // iOS erwartet ein deckendes 180er-PNG und rundet selbst ab.
  { file: "src/app/apple-icon.png", size: 180, rounded: false },
  { file: "src/app/icon.png", size: 512, rounded: true },
  { file: "public/icon-192.png", size: 192, rounded: true },
  { file: "public/icon-512.png", size: 512, rounded: true },
];

for (const target of targets) {
  const file = path.join(process.cwd(), target.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(target.size, { rounded: target.rounded }));
  console.log(`geschrieben: ${target.file} (${target.size}x${target.size})`);
}
