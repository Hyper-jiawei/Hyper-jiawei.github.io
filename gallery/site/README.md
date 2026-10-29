# Hyper's Gallery (Astro)

Static rebuild of the gallery. Albums are read straight from `../content/` (the same
folders and `index.md` front matter the Hugo site uses), so nothing is duplicated.

```bash
npm install
npm run dev      # process images, then start the dev server
npm run build    # process images, then build the static site into dist/
npm run preview  # serve dist/ locally
npm run favicon  # rebuild tab and Apple Touch icons from the wordmark outlines
npm test         # loading, navigation cancellation and module-preload regression checks
```

`npm run images` (run automatically by dev/build) generates WebP sizes 480/960/1600/3000
into `public/img/`, plus separate 360/480/540/720/960/1600px WebP cover thumbnails
(quality 70 at 360px, 80 for the other sizes) for album listings. Listing cards choose between these six sizes with
`srcset`, including on Retina displays; photo pages and the hero keep their responsive high-quality versions.
The image pipeline extracts dominant colour, a blurred placeholder and EXIF, and writes
`src/data/gallery.json`. Results are cached in `.cache/`, so only new or changed photos
are processed again.

Front matter that is honoured: `title`, `date`, `categories`, `layout: single-big-photo`
(single-photo page), `featured` (home slideshow), `private` (built but unlisted, noindex),
`draft` (skipped), `resources[].params.cover` (cover photo), `resources[].params.hidden`.

Multi-photo albums (`gallery` and `actual`) hide caption colour swatches by default.
Enable them for one album in its `content/<album>/index.md` front matter:

```yaml
showPalette: true
```

Use `showPalette: false` to turn them off; `params.showPalette` is also supported.
This setting does not change the colour card on single-photo pages. Existing multi-photo
albums explicitly set `showPalette: false`.

Album URLs match the Hugo ones (`/<urlized folder name>/`, `/categories/<name>/`).
Site settings (bio, friend links, social links) live in `src/site.config.ts`.

Production builds trim font `unicode-range` declarations and subset the matching
WOFF2 files against `src/`, including the generated album manifest. HarfBuzz keeps
variable axes, hinting and layout features (including vertical forms). Subsets are
cached in `.cache/font-subsets/` by font content, character set and subsetter version;
new content is picked up automatically on the next build. Fonts remain separate,
cacheable files rather than base64 in the blocking stylesheet. Development keeps
the original fonts and full ranges so newly edited text works during hot reload.

The first photograph is preloaded with the same responsive candidates and sizes
as its displayed image. Neighbouring photographs warm at low priority after the
current page's eager images settle; on constrained connections or with data saving
enabled, they warm only on link hover/focus. Pending warmups are cancelled on navigation.

The home carousel requests its selected photograph first, then warms only the next
slide after that photo settles. Direct slide selection loads immediately; animation
styles and the seven-second rotation interval stay the same. Listing and hero links
prefetch HTML on hover, and their first destination photograph starts alongside
navigation's HTML request. The existing decode-before-swap wait still applies.

Production HTML includes module preloads derived from Vite's static import graph,
so the browser discovers router dependencies without serial module-fetch round trips.
Photo pages additionally preload only the viewer entry and PhotoSwipe core, with
their static dependencies; holiday artwork, click animations and the hidden gallery
keep their existing on-demand imports.
The egg page's arrival burst runs from an inline script at the start of its body,
so slow or failed module downloads cannot skip the celebration. Its particle
geometry, colours and animation durations remain unchanged.
The PhotoSwipe core loads with the page, and its CSS is included in the initial
page styles. Plain image clicks are captured by the inline page script; clicks
before module readiness are replayed once the viewer is ready.

The image pipeline also copies each source file unchanged to `public/img/<key>/original.<ext>`.
The lightbox download button saves that source with its original filename. Opening the
lightbox reuses the page image's selected resource for the zoom animation. After the
animation finishes, the current source downloads with byte progress in the top bar,
decodes, then fades in over the preview. Paging or closing cancels pending source
requests; completed sources remain cached until their slides are disposed of. Only
the top-right download, zoom and close controls are shown; touch swipes and arrow
keys still page through albums.

Albums with `layout: actual` use the ordinary multi-photo editorial layout at viewport
widths of 900px or less. Wider windows use a responsive contact sheet: cards keep their
physical size relationships and original aspect ratios, and wide screens show more prints
rather than enlarged ones. Rows are balanced by their real widths, then gently staggered
and aligned to alternating edges. Captions are remeasured after resizing and font loading.
Both layouts share the same ordered image list and lightbox slides. Without JavaScript,
phones retain the editorial layout and wider windows use a readable wrapping sheet.
