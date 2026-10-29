import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function htmlFiles(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(file));
    else if (entry.name.endsWith(".html")) files.push(file);
  }
  return files;
}

// Astro emits module scripts without Vite's HTML entrypoint transformation.
// Expose their static imports in the head, avoiding a discovery RTT per level.
// Dynamic imports remain on demand, except on pages with a photo viewer
// ([data-gallery]): there the lazily loaded viewer is preloaded too, so a photo
// tapped as soon as the page appears still opens without extra round trips.
export function modulePreloads(base = "/") {
  const graph = new Map();
  const viewers = new Set();
  return {
    name: "gallery-module-preloads",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => updateConfig({
        vite: { plugins: [{
          name: "gallery-module-graph",
          apply: "build",
          generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
              if (chunk.type === "chunk" && chunk.fileName.endsWith(".js")) {
                graph.set(chunk.fileName, chunk.imports);
                // Identify entry modules by source, independent of hashed output names.
                // Other dynamic imports (holiday art, click motions, the egg gallery)
                // must keep their on-demand loading even on photograph pages.
                const source = chunk.facadeModuleId?.replaceAll("\\", "/") ?? "";
                if (source.endsWith("/src/lib/lightbox.ts") || source.endsWith("/photoswipe/dist/photoswipe.esm.js")) {
                  viewers.add(chunk.fileName);
                }
              }
            }
          },
        }] },
      }),
      "astro:build:done": async ({ dir }) => {
        for (const file of await htmlFiles(fileURLToPath(dir))) {
          const html = await fs.readFile(file, "utf8");
          const entries = [...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+)"[^>]*>/g)]
            .map((match) => match[1].startsWith(base.slice(1)) ? match[1].slice(base.length - 1) : match[1]).filter((entry) => graph.has(entry));
          const seen = new Set(entries);
          const dependencies = [];
          const visit = (entry) => {
            for (const dependency of graph.get(entry) ?? []) {
              if (seen.has(dependency) || !graph.has(dependency)) continue;
              seen.add(dependency);
              dependencies.push(dependency);
              visit(dependency);
            }
          };
          entries.forEach(visit);
          if (/<[a-z][^>]*\sdata-gallery[\s>=]/.test(html)) {
            for (const entry of viewers) {
              if (seen.has(entry) || !graph.has(entry)) continue;
              seen.add(entry);
              dependencies.push(entry);
              visit(entry);
            }
          }
          if (!dependencies.length) continue;
          const links = dependencies.map((dependency) => `<link rel="modulepreload" href="${base}${dependency}">`).join("");
          await fs.writeFile(file, html.replace("</title>", `</title>${links}`));
        }
      },
    },
  };
}
