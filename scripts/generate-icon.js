/**
 * Generate a simple app icon (blue square).
 * Uses pure Node.js — no external dependencies.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir);

// Build a minimal 256×256 PNG manually (solid blue #5B9BD5)
function createMinimalPNG(width, height, r, g, b) {

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);   // width
  ihdrData.writeUInt32BE(height, 4);  // height
  ihdrData.writeUInt8(8, 8);          // bit depth
  ihdrData.writeUInt8(2, 9);          // color type (RGB)
  ihdrData.writeUInt8(0, 10);         // compression
  ihdrData.writeUInt8(0, 11);         // filter
  ihdrData.writeUInt8(0, 12);         // interlace

  const ihdr = createChunk('IHDR', ihdrData);

  // Raw image data (filter byte + RGB for each row)
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const offset = y * (1 + width * 3);
    rawData.writeUInt8(0, offset); // filter: none
    for (let x = 0; x < width; x++) {
      const po = offset + 1 + x * 3;
      rawData.writeUInt8(r, po);
      rawData.writeUInt8(g, po + 1);
      rawData.writeUInt8(b, po + 2);
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    ihdr, idat, iend,
  ]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else crc >>>= 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate the PNG
const png = createMinimalPNG(256, 256, 0x5B, 0x9B, 0xD5);
const pngPath = path.join(buildDir, 'icon.png');
fs.writeFileSync(pngPath, png);
console.log(`✅ Icon generated: ${pngPath} (${png.length} bytes)`);
