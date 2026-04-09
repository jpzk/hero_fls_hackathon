/**
 * Bun dev server - bundles and serves the viewer.
 *
 * Environment variables:
 *   PORT      - server port (default: 3001)
 *   SPLAT_DIR - root directory to scan for .splat/.ply files
 *               (default: parent dir, i.e. repo root)
 */

import { watch } from "fs";
import { readdir, stat, realpath } from "fs/promises";
import { join, relative, resolve } from "path";

const PORT = parseInt(process.env.PORT || "3001", 10);
const SPLAT_DIR = resolve(process.env.SPLAT_DIR || join(import.meta.dir, "../.."));

let bundledJs = "";

async function bundle() {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/main.ts"],
    target: "browser",
    format: "esm",
  });
  if (result.success) {
    bundledJs = await result.outputs[0].text();
    console.log(`Bundled ${result.outputs[0].size} bytes`);
  } else {
    console.error("Bundle failed:", result.logs);
  }
}

await bundle();

/** Recursively find all .splat and .ply files under a directory */
async function findSplatFiles(dir: string, base: string): Promise<{ name: string; path: string; size: number }[]> {
  const results: { name: string; path: string; size: number }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
        results.push(...await findSplatFiles(full, base));
      } else if (entry.name.endsWith(".splat") || entry.name.endsWith(".ply")) {
        const info = await stat(full);
        results.push({
          name: entry.name,
          path: relative(base, full),
          size: info.size,
        });
      }
    }
  } catch {
    // Permission denied or missing dir — skip
  }
  return results;
}

// Watch for changes
const watcher = watch(import.meta.dir, { recursive: true }, async (event, filename) => {
  if (filename?.endsWith(".ts")) {
    console.log(`Change detected: ${filename}, rebundling...`);
    await bundle();
  }
});

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // --- API: list splat files ---
    if (path === "/api/splats") {
      const files = await findSplatFiles(SPLAT_DIR, SPLAT_DIR);
      return Response.json(files, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // --- Serve splat files from SPLAT_DIR ---
    if (path.startsWith("/splats/")) {
      const relative = path.slice("/splats/".length);
      const requested = resolve(SPLAT_DIR, relative);
      // Security: ensure resolved path is within SPLAT_DIR
      const realRequested = await realpath(requested).catch(() => null);
      const realBase = await realpath(SPLAT_DIR).catch(() => SPLAT_DIR);
      if (!realRequested || !realRequested.startsWith(realBase)) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(realRequested);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    if (path === "/" || path === "/index.html") {
      // Serve index.html with script tag pointing to bundle
      const html = await Bun.file(import.meta.dir + "/../index.html").text();
      const modified = html.replace(
        '<script type="module" src="./src/main.ts"></script>',
        '<script type="module" src="/bundle.js"></script>'
      );
      return new Response(modified, {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (path === "/bundle.js") {
      return new Response(bundledJs, {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    // Serve static files from viewer root
    const filePath = import.meta.dir + "/.." + path;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`\nGaussian Splat Viewer: http://localhost:${server.port}`);
console.log(`Scanning for splats in: ${SPLAT_DIR}`);
console.log("Watching for changes...\n");
