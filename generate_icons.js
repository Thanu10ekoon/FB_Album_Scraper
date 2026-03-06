// Generates simple PNG icons for the extension
// Run: node generate_icons.js

const fs = require("fs");

function createMinimalPNG(size) {
  // Create a minimal valid PNG with a colored square
  // PNG structure: signature + IHDR + IDAT + IEND

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = createChunk("IHDR", ihdrData);

  // Create raw pixel data (blue-ish background with a white down-arrow)
  const rawData = Buffer.alloc(size * (size * 3 + 1)); // +1 for filter byte per row

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 3 + 1);
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 3;

      // Background: #4fc3f7 (light blue)
      let r = 79, g = 195, b = 247;

      // Draw a simple down-arrow in white
      const cx = size / 2;
      const cy = size / 2;
      const s = size / 8;

      // Vertical bar of arrow
      if (Math.abs(x - cx) < s && y > cy - s * 3 && y < cy + s) {
        r = 255; g = 255; b = 255;
      }
      // Arrow head (triangle)
      const arrowY = cy + s;
      if (y >= arrowY && y < arrowY + s * 2.5) {
        const spread = (y - arrowY) * 0.8;
        if (Math.abs(x - cx) < s * 2.5 - spread) {
          r = 255; g = 255; b = 255;
        }
      }

      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  // Compress with zlib
  const zlib = require("zlib");
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk("IDAT", compressed);

  // IEND chunk
  const iend = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createMinimalPNG(size);
  fs.writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Created icons/icon${size}.png (${png.length} bytes)`);
}

console.log("Done! Icons generated.");
