/** Per-photo switch; positive legacy numbers retain their ordering. */
export function featuredRank(value) {
  if (value === true || value === "精选照片") return 1;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** @param {import("../src/lib/gallery").Album[]} albums */
export function selectFeaturedPhotos(albums) {
  return albums.filter((album) => !album.private).flatMap((album) => album.photos
    .filter((photo) => featuredRank(photo.featured) > 0)
    .slice().sort((a, b) => featuredRank(a.featured) - featuredRank(b.featured))
    .map((photo) => ({ album, photo })));
}
