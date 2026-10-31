import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { IMAGE_RE, imageInput } from "./heic-input.mjs";

const run = promisify(execFile);
const site = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("./fixtures/phone.heic", import.meta.url);

test("HEIC/HEIF in either case decode to browser-readable pixels without changing originals", async () => {
  const before = await fs.readFile(fixture);
  for (const name of ["phone.heic", "phone.HEIC", "phone.heif", "phone.HEIF"]) assert.ok(IMAGE_RE.test(name));
  const decoded = await imageInput(fileURLToPath(fixture));
  const meta = await sharp(decoded).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 64);
  assert.equal(meta.height, 40);
  assert.deepEqual(await fs.readFile(fixture), before);
});

test("a complete HEIC album preserves EXIF/download bytes and generates zoom/preview/palette assets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hyper-heic-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "scripts");
  const content = path.join(root, "content", "phone-album");
  await fs.mkdir(scripts, { recursive: true });
  await fs.mkdir(content, { recursive: true });
  await fs.symlink(path.join(site, "node_modules"), path.join(root, "node_modules"), "dir");
  for (const name of ["build-images.mjs", "heic-input.mjs", "featured.mjs"]) await fs.copyFile(path.join(site, "scripts", name), path.join(scripts, name));
  await fs.copyFile(fixture, path.join(content, "手机照片.HEIC"));
  await fs.writeFile(path.join(content, "index.md"), '---\ntitle: "手机测试"\ndate: 2026-10-30\nfeatured: true\nresources:\n  - src: 手机照片.HEIC\n    params:\n      cover: true\n      featured: 1\n---\n');
  const build = () => run(process.execPath, [path.join(scripts, "build-images.mjs")], { env: { ...process.env, GALLERY_CONTENT: path.join(root, "content") }, timeout: 60000 });
  await build();
  const manifest = path.join(root, "src/data/gallery.json");
  const [photo] = JSON.parse(await fs.readFile(manifest, "utf8")).albums[0].photos;
  assert.equal(photo.title, "手机照片");
  assert.equal(photo.featured, 1);
  assert.equal(photo.exif.camera, "HEIC test camera");
  assert.equal(photo.exif.date, "2026-10-30");
  assert.equal(photo.palette.colors.length, 4);
  const asset = (url) => path.join(root, "public", url);
  assert.deepEqual(await fs.readFile(asset(photo.original.url)), await fs.readFile(fixture));
  const zoom = await sharp(asset(photo.displayOriginal.url)).metadata();
  assert.equal(zoom.format, "jpeg");
  assert.equal(zoom.width, 64);
  assert.equal(zoom.height, 40);
  assert.ok(photo.srcset.length && photo.thumbnails.length);
  for (const variant of [...photo.srcset, ...photo.thumbnails]) assert.equal((await sharp(asset(variant.url)).metadata()).format, "webp");
  // Cached builds preserve links, and rebuild a missing full-resolution JPEG.
  await build();
  const cached = JSON.parse(await fs.readFile(manifest, "utf8")).albums[0].photos[0];
  assert.deepEqual(cached.displayOriginal, photo.displayOriginal);
  await fs.rm(asset(photo.displayOriginal.url));
  await build();
  assert.equal((await sharp(asset(photo.displayOriginal.url)).metadata()).format, "jpeg");
  // Invalid HEIC must stop deployment rather than silently disappear from an album.
  await fs.writeFile(path.join(content, "坏照片.heic"), "not a HEIC");
  await assert.rejects(build(), /could not be processed/);
});
