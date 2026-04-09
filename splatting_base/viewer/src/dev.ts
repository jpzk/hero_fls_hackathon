/**
 * Bun dev server - bundles and serves the viewer.
 */

import { watch } from "fs";

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

// Watch for changes
const watcher = watch(import.meta.dir, { recursive: true }, async (event, filename) => {
  if (filename?.endsWith(".ts")) {
    console.log(`Change detected: ${filename}, rebundling...`);
    await bundle();
  }
});

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

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
console.log("Watching for changes...\n");
