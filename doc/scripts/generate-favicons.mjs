// One-off generator for favicon.ico / favicon-32x32.png / favicon-16x16.png.
// Source mark: the bird+fish icon cropped from the top-left square of
// public/img/logo.svg (viewBox 0 0 1200 630 — the same square region used as
// the ogp.png background color, #181818).
//
// zudo-doc 4.5.0's HeadWithDefaults hardcodes these three favicon links
// (not configurable), so filenames/paths must match exactly:
//   <link rel="icon" href="/favicon.ico" sizes="any">
//   <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
//   <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
//
// Run once with: node doc/scripts/generate-favicons.mjs
// Not wired into the build — output is committed as static binaries.

import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docRoot = path.resolve(__dirname, "..");
const srcSvg = path.join(docRoot, "public/img/logo.svg");
const publicDir = path.join(docRoot, "public");

const BG = "#181818"; // sampled from public/img/ogp.png background

// logo.svg viewBox is 0 0 1200 630 — the bird+fish mark sits fully inside
// the left 630x630 square (the wordmark "ZDTL" occupies the right portion
// and is excluded here since it's unreadable at favicon sizes).
const SQUARE_RENDER_SIZE = 1260; // high-res base, downscaled per output size

async function renderSquareBase() {
  return sharp(srcSvg, { density: 300 })
    .resize(SQUARE_RENDER_SIZE * 2, SQUARE_RENDER_SIZE)
    .extract({ left: 0, top: 0, width: SQUARE_RENDER_SIZE, height: SQUARE_RENDER_SIZE })
    .flatten({ background: BG })
    .png()
    .toBuffer();
}

async function renderSquarePng(baseBuffer, size) {
  return sharp(baseBuffer).resize(size, size).png().toBuffer();
}

// ICO container: modern (Vista+) ICO allows embedding PNG data directly per
// entry, so no BMP/DIB conversion is needed. Hand-rolled here since the
// workspace has no ico-writer dependency.
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  pngBuffers.forEach(({ size, buffer }, i) => {
    const entryOffset = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 0); // width
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1); // height
    header.writeUInt8(0, entryOffset + 2); // color count
    header.writeUInt8(0, entryOffset + 3); // reserved
    header.writeUInt16LE(1, entryOffset + 4); // color planes
    header.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    header.writeUInt32LE(buffer.length, entryOffset + 8); // size in bytes
    header.writeUInt32LE(offset, entryOffset + 12); // offset
    offset += buffer.length;
  });

  return Buffer.concat([header, ...pngBuffers.map((p) => p.buffer)]);
}

async function main() {
  const base = await renderSquareBase();
  const png32 = await renderSquarePng(base, 32);
  const png16 = await renderSquarePng(base, 16);
  const png48 = await renderSquarePng(base, 48);

  await writeFile(path.join(publicDir, "favicon-32x32.png"), png32);
  await writeFile(path.join(publicDir, "favicon-16x16.png"), png16);

  const ico = buildIco([
    { size: 16, buffer: png16 },
    { size: 32, buffer: png32 },
    { size: 48, buffer: png48 },
  ]);
  await writeFile(path.join(publicDir, "favicon.ico"), ico);

  console.log("Generated favicon-32x32.png, favicon-16x16.png, favicon.ico");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
