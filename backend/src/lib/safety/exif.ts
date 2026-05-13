// Minimal EXIF stripper for JPEG. Removes the APP1/EXIF segment
// (marker 0xFFE1) which is where GPS coordinates live. Returns the
// input unchanged for non-JPEG bytes (PNG/WebP/HEIC EXIF GPS is rare
// in mobile camera output and the iOS client re-encodes photos before
// upload — but the privacy invariant is enforced again here as
// defence-in-depth).
//
// Why we don't just use `sharp`: it's a ~120MB native dep with
// platform-specific wheels that complicate the Vercel Function image.
// JPEG segment scanning is small, dependency-free, and good enough.
//
// Privacy principle reference: docs/privacy/principles.md §3.

const JPEG_SOI = 0xff;
const JPEG_SOI2 = 0xd8;
const SEGMENT_MARKER = 0xff;
// Segments that have no payload after the marker.
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

export interface StripExifResult {
  /** Stripped bytes (or original if not JPEG). */
  bytes: Buffer;
  /** True if at least one EXIF/APP1 segment was removed. */
  removed: boolean;
  /** Number of bytes removed. */
  bytesRemoved: number;
}

export function stripJpegExif(input: Buffer): StripExifResult {
  if (!isJpeg(input)) {
    return { bytes: input, removed: false, bytesRemoved: 0 };
  }

  const chunks: Buffer[] = [];
  // Write the SOI.
  chunks.push(input.subarray(0, 2));
  let i = 2;
  let removed = false;
  let bytesRemoved = 0;

  while (i < input.length) {
    if (input.readUInt8(i) !== SEGMENT_MARKER) {
      // We've fallen out of the segment header region — entropy data
      // follows. Copy the rest verbatim.
      chunks.push(input.subarray(i));
      break;
    }
    // Skip 0xFF fill bytes.
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
      // Truncated header; copy remaining bytes and bail.
      chunks.push(input.subarray(i));
      break;
    }
    const segLen = input.readUInt16BE(markerIdx + 1);
    const segStart = i;
    const segEnd = markerIdx + 1 + segLen; // segLen includes the length bytes

    if (marker === APP_EXIF) {
      removed = true;
      bytesRemoved += segEnd - segStart;
    } else {
      chunks.push(input.subarray(segStart, Math.min(segEnd, input.length)));
    }

    // SOS (Start of Scan, 0xFFDA) marks the beginning of compressed
    // entropy data; after it we copy everything up to EOI verbatim.
    if (marker === 0xda) {
      chunks.push(input.subarray(segEnd));
      break;
    }
    i = segEnd;
  }

  return { bytes: Buffer.concat(chunks), removed, bytesRemoved };
}
