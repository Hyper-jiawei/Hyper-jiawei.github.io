import assert from "node:assert/strict";
import { test } from "node:test";
import { featuredRank, selectFeaturedPhotos } from "./featured.mjs";

test("photo selection accepts a switch, the Chinese label and legacy ranks", () => {
  for (const value of [true, "精选照片", 1]) assert.equal(featuredRank(value), 1);
  assert.equal(featuredRank(8), 8);
  for (const value of [false, undefined, null, "false", "", 0, -1, NaN, Infinity]) assert.equal(featuredRank(value), 0);
});

test("all marked photos across albums rotate, including more than five, while private/unmarked photos stay out", () => {
  const photos = Array.from({ length: 11 }, (_, i) => ({ file: `${i}.jpg`, featured: true }));
  const latest = { title: "new", photos: [...photos, { file: "not-featured.jpg", featured: false }] };
  const older = { title: "old", photos: [{ file: "rank2.jpg", featured: 2 }, { file: "rank1.jpg", featured: 1 }] };
  const privateAlbum = { private: true, photos: [{ featured: true }] };
  const selected = selectFeaturedPhotos([latest, older, privateAlbum]);
  assert.equal(selected.length, 13);
  assert.deepEqual(selected.slice(0, 11).map(({ photo }) => photo.file), photos.map((p) => p.file));
  assert.deepEqual(selected.slice(11).map(({ photo }) => photo.file), ["rank1.jpg", "rank2.jpg"]);
  assert.equal(selectFeaturedPhotos([{ photos: [{ featured: true }] }]).length, 1);
  assert.equal(selectFeaturedPhotos([{ photos: [{ featured: false }] }]).length, 0);
});
