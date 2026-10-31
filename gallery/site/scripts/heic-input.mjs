import fs from "node:fs/promises";
import sharp from "sharp";
import decode from "heic-decode";

export const IMAGE_RE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
export const isHeic = (file) => /\.hei[cf]$/i.test(file);

// libheif decodes the primary still and applies the container's orientation.
// Keep this build-only: visitors never need a HEIC decoder or an extra download.
export async function imageInput(file) {
  if (!isHeic(file)) return file;
  const { width, height, data } = await decode({ buffer: await fs.readFile(file) });
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
