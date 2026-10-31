import data from "../data/gallery.json";
import { albumPath, categoryPath, defaultLang, formatDate as formatDateIn, type Lang } from "../i18n";

export interface Variant {
  url: string;
  w: number;
  h: number;
}

export interface Exif {
  camera: string | null;
  lens: string | null;
  focal: string | null;
  aperture: string | null;
  shutter: string | null;
  iso: string | null;
  date: string | null;
  description: string | null;
}

export interface Photo {
  file: string;
  title: string;
  description: string | null;
  featured: number;
  key: string;
  width: number;
  height: number;
  color: string;
  lqip: string;
  srcset: Variant[];
  original: Variant;
  thumbnail?: Variant;
  thumbnails?: Variant[];
  exif: Exif | null;
  tone?: { hue: number; chroma: number; share: number; lightness: number; cast?: [number, number] };
  /** Four main colours, most widespread first (hex). */
  palette?: { v: number; colors: string[] };
  /** "Actual size" albums: the width and height the photo prints at, in CSS pixels. */
  actual?: { w: number; h: number } | null;
}

export interface Album {
  dir: string;
  parentSlug?: string;
  slug: string;
  title: string;
  description: string | null;
  date: string | null;
  categories: string[];
  layout: "single" | "gallery" | "actual";
  /** Show colour swatches in multi-photo captions; opt-in per album. */
  showPalette: boolean;
  featured: boolean;
  private: boolean;
  cover: string;
  photos: Photo[];
}

/** Every album, newest first (private ones included; they get pages but are never listed). */
export const allAlbums = (data.albums as Album[]).slice();

/** Albums shown in listings, feeds and navigation. */
export const albums = allAlbums.filter((a) => !a.private);

/** Individual photo pages reuse the original single-photo museum layout. */
export const photoSlug = (p: Photo) => encodeURIComponent(p.title);
export const photoUrl = (a: Album, p: Photo, lang: Lang = defaultLang) => albumPath(lang, a.slug) + photoSlug(p) + "/";
export const photoAlbums: Album[] = allAlbums.flatMap((a) => a.photos.map((p) => ({
  ...a, parentSlug: a.slug, slug: a.slug + "/" + p.title,
  title: p.title, description: p.description, date: p.exif?.date ?? a.date,
  layout: "single" as const, cover: p.file, photos: [p],
})));
export const featuredPhotos = albums.flatMap((album) => album.photos.filter((p) => p.featured > 0)
  .sort((a, b) => a.featured - b.featured).map((photo) => ({ album, photo }))).slice(0, 5);

export const coverOf = (album: Album): Photo =>
  album.photos.find((p) => p.file === album.cover) ?? album.photos[0];

export const aspect = (p: Photo) => p.width / p.height;

export const srcsetOf = (p: Photo) => p.srcset.map((v) => `${v.url} ${v.w}w`).join(", ");

export const stageSizes = (p: Photo) => `(max-width: 900px) 100vw, min(70vw, calc((100svh - 200px) * ${aspect(p).toFixed(4)}))`;

/** A safe server-side estimate; the sheet refines each image to its measured width. */
export const printedPhotoSizes = (p: Photo) => {
  const width = p.actual?.w ?? (aspect(p) >= 1 ? 557 : 376);
  return `(max-width: 600px) calc(100vw - 36px), (max-width: 900px) 85vw, ${Math.ceil(width * 1.5)}px`;
};

/** Match the first displayed photograph, which may differ from an album's cover. */
export const firstPhotoSizes = (a: Album) =>
  a.layout === "single"
    ? stageSizes(a.photos[0])
    : a.layout === "actual"
      ? printedPhotoSizes(a.photos[0])
      : `(max-width: 900px) 100vw, ${aspect(a.photos[0]) >= 1 ? 72 : 40}vw`;

export const preloadFor = (a?: Album) => a ? {
  "data-preload-srcset": srcsetOf(a.photos[0]),
  "data-preload-sizes": firstPhotoSizes(a),
} : {};

/** Smallest variant at least `minWidth` wide (or the largest available). */
export const pick = (p: Photo, minWidth: number): Variant =>
  p.srcset.find((v) => v.w >= minWidth) ?? p.srcset[p.srcset.length - 1];

export const largest = (p: Photo): Variant => p.srcset[p.srcset.length - 1];

export const albumUrl = (a: Album, lang: Lang = defaultLang) => albumPath(lang, a.slug);

export const categoryUrl = (c: string, lang: Lang = defaultLang) => categoryPath(lang, c);

export const year = (a: Album) => a.date?.slice(0, 4) ?? "—";

/** Dates in the visitor's language (see i18n). */
export const formatDate = (d: string | null, lang: Lang = defaultLang, style: "long" | "short" = "long") =>
  formatDateIn(d, lang, style);

export function categories() {
  const map = new Map<string, Album[]>();
  for (const a of albums) for (const c of a.categories) map.set(c, [...(map.get(c) ?? []), a]);
  return [...map.entries()]
    .map(([name, list]) => ({ name, albums: list, photos: list.reduce((n, a) => n + a.photos.length, 0) }))
    .sort((a, b) => b.albums.length - a.albums.length);
}

export function neighbours(album: Album) {
  const list = album.parentSlug ? photoAlbums.filter((a) => a.parentSlug === album.parentSlug) : albums;
  const i = list.findIndex((a) => a.slug === album.slug);
  if (i < 0) return { newer: undefined, older: undefined };
  return { newer: list[i - 1], older: list[i + 1] };
}

export const photoCount = albums.reduce((n, a) => n + a.photos.length, 0);

export function exifLine(e: Exif | null) {
  if (!e) return "";
  return [e.focal, e.aperture, e.shutter, e.iso].filter(Boolean).join("  ·  ");
}

/** Catalogue number, counting up from the oldest public album ("No. 001"). */
export function numberOf(album: Album) {
  const i = albums.findIndex((a) => a.slug === (album.parentSlug ?? album.slug));
  return i < 0 ? "" : String(albums.length - i).padStart(3, "0");
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
