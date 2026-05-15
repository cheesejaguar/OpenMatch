// Server-side EXIF / metadata stripping for the photo formats we accept.
//
// Why server-side at all: the iOS client re-encodes through UIImage's
// jpegData, which doesn't carry GPS over by default. The server is the
// privacy boundary that gets enforced and tested, so we strip again
// here as defence-in-depth.
//
// Why dependency-free: avoiding the `sharp` native module (~120MB
// platform-specific wheels) keeps the Vercel Function image small.
//
// Coverage today:
//   - JPEG  — APP1 (EXIF) segments removed.
//   - PNG   — eXIf, tEXt, iTXt, zTXt ancillary chunks removed.
//   - WebP  — EXIF and XMP chunks within the RIFF container removed.
//   - HEIC / HEIF — rejected at the media.ts layer; we do not have a
//     box-parser. iOS clients re-encode to JPEG before upload.
//
// Privacy principle reference: docs/privacy/principles.md §3.

export interface StripExifResult {
  /** Stripped bytes (or original if no metadata segment was found). */
  bytes: Buffer;
  /** True if at least one metadata segment was removed. */
  removed: boolean;
  /** Number of bytes removed. */
  bytesRemoved: number;
  /** Which format was processed. */
  format: "jpeg" | "png" | "webp" | "other";
}

const JPEG_SOI = 0xff;
const JPEG_SOI2 = 0xd8;
const SEGMENT_MARKER = 0xff;
const STANDALONE_MARKERS = new Set([
  0xd0,
  0xd1,
  0xd2,
  0xd3,
  0xd4,
  0xd5,
  0xd6,
  0xd7, // RSTn
  0xd8,
  0xd9, // SOI, EOI
]);
const APP_EXIF = 0xe1;

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === JPEG_SOI && buf[1] === JPEG_SOI2;
}

function isPng(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  // 89 50 4E 47 0D 0A 1A 0A
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isWebp(buf: Buffer): boolean {
  // RIFF....WEBP
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

// -------- JPEG --------

export function stripJpegExif(input: Buffer): StripExifResult {
  if (!isJpeg(input)) {
    return { bytes: input, removed: false, bytesRemoved: 0, format: "other" };
  }

  const chunks: Buffer[] = [];
  chunks.push(input.subarray(0, 2)); // SOI
  let i = 2;
  let removed = false;
  let bytesRemoved = 0;

  while (i < input.length) {
    if (input.readUInt8(i) !== SEGMENT_MARKER) {
      chunks.push(input.subarray(i));
      break;
    }
    let markerIdx = i + 1;
    while (markerIdx < input.length && input.readUInt8(markerIdx) === 0xff) markerIdx++;
    if (markerIdx >= input.length) break;
    const marker = input.readUInt8(markerIdx);

    if (STANDALONE_MARKERS.has(marker)) {
      chunks.push(Buffer.from([SEGMENT_MARKER, marker]));
      i = markerIdx + 1;
      continue;
    }

    if (markerIdx + 3 > input.length) {
      chunks.push(input.subarray(i));
      break;
    }
    const segLen = input.readUInt16BE(markerIdx + 1);
    const segStart = i;
    const segEnd = markerIdx + 1 + segLen;

    if (marker === APP_EXIF) {
      removed = true;
      bytesRemoved += segEnd - segStart;
    } else {
      chunks.push(input.subarray(segStart, Math.min(segEnd, input.length)));
    }

    if (marker === 0xda) {
      // SOS — entropy data follows. Copy to EOI verbatim.
      chunks.push(input.subarray(segEnd));
      break;
    }
    i = segEnd;
  }

  return { bytes: Buffer.concat(chunks), removed, bytesRemoved, format: "jpeg" };
}

// -------- PNG --------

// PNG chunks: [length:4][type:4][data:length][crc:4]. We drop any chunk
// whose 4-byte ASCII type is in the deny set. Chunks that may contain
// EXIF or arbitrary text-encoded GPS:
//   - eXIf: standard EXIF container (PNG spec 2017).
//   - tEXt, iTXt, zTXt: text key/value; values like "GPS Latitude=…"
//     have been observed in real-world exports.
const PNG_FORBIDDEN_CHUNKS = new Set(["eXIf", "tEXt", "iTXt", "zTXt"]);
const PNG_SIGNATURE_LEN = 8;

export function stripPngExif(input: Buffer): StripExifResult {
  if (!isPng(input)) {
    return { bytes: input, removed: false, bytesRemoved: 0, format: "other" };
  }
  const chunks: Buffer[] = [input.subarray(0, PNG_SIGNATURE_LEN)];
  let i = PNG_SIGNATURE_LEN;
  let removed = false;
  let bytesRemoved = 0;

  while (i + 8 <= input.length) {
    const len = input.readUInt32BE(i);
    const type = input.toString("ascii", i + 4, i + 8);
    const totalLen = 4 + 4 + len + 4; // length + type + data + crc
    if (i + totalLen > input.length) {
      // Truncated; copy the rest verbatim and stop.
      chunks.push(input.subarray(i));
      break;
    }
    if (PNG_FORBIDDEN_CHUNKS.has(type)) {
      removed = true;
      bytesRemoved += totalLen;
    } else {
      chunks.push(input.subarray(i, i + totalLen));
      if (type === "IEND") break;
    }
    i += totalLen;
  }
  return { bytes: Buffer.concat(chunks), removed, bytesRemoved, format: "png" };
}

// -------- WebP --------

// WebP container layout:
//   "RIFF" + size:LE32 + "WEBP" + chunks
// Each inner chunk: 4-byte ASCII fourcc + LE32 size + payload (padded to
// 2-byte alignment).
// EXIF lives in a chunk fourcc "EXIF". XMP lives in "XMP " (note the
// trailing space). Both are dropped here.
const WEBP_FORBIDDEN_CHUNKS = new Set(["EXIF", "XMP "]);

export function stripWebpExif(input: Buffer): StripExifResult {
  if (!isWebp(input)) {
    return { bytes: input, removed: false, bytesRemoved: 0, format: "other" };
  }
  const preserved: Buffer[] = [];
  let i = 12; // skip RIFF[4] size[4] WEBP[4]
  let removed = false;
  let bytesRemoved = 0;

  while (i + 8 <= input.length) {
    const fourcc = input.toString("ascii", i, i + 4);
    const size = input.readUInt32LE(i + 4);
    const padded = size + (size & 1); // pad to 2-byte alignment
    const chunkEnd = i + 8 + padded;
    if (chunkEnd > input.length) {
      preserved.push(input.subarray(i));
      break;
    }
    if (WEBP_FORBIDDEN_CHUNKS.has(fourcc)) {
      removed = true;
      bytesRemoved += 8 + padded;
    } else {
      preserved.push(input.subarray(i, chunkEnd));
    }
    i = chunkEnd;
  }

  // Rebuild the file: header + concatenated kept chunks, with the RIFF
  // size field re-computed so readers don't trip on stale lengths.
  const body = Buffer.concat(preserved);
  const out = Buffer.alloc(12 + body.length);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(4 + body.length, 4); // "WEBP" + chunks
  out.write("WEBP", 8, "ascii");
  body.copy(out, 12);
  return { bytes: out, removed, bytesRemoved, format: "webp" };
}

// -------- Dispatcher --------

export function stripExif(input: Buffer, contentType: string): StripExifResult {
  switch (contentType) {
    case "image/jpeg":
      return stripJpegExif(input);
    case "image/png":
      return stripPngExif(input);
    case "image/webp":
      return stripWebpExif(input);
    default:
      return { bytes: input, removed: false, bytesRemoved: 0, format: "other" };
  }
}
