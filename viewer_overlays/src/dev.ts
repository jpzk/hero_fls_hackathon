/**
 * Bun dev server - bundles and serves the viewer with training pipeline.
 *
 * Environment variables:
 *   PORT      - server port (default: 3001)
 *   SPLAT_DIR - root directory to scan for .splat/.ply files
 *   PIPELINE_DIR - path to the 3dgs/ directory with Makefile
 */

import { watch } from "fs";
import { readdir, stat, realpath, mkdir } from "fs/promises";
import { join, relative, resolve, basename } from "path";
import { spawn, type Subprocess } from "bun";

const PORT = parseInt(process.env.PORT || "3001", 10);
const SPLAT_DIR = resolve(process.env.SPLAT_DIR || "/root/splatting/3dgs/output");
const PIPELINE_DIR = resolve(process.env.PIPELINE_DIR || "/root/splatting/3dgs");
const API_PROXY = process.env.API_PROXY || ""; // e.g. "http://103.196.86.242:3002"

// --- Bundle ---

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

// --- Training Job State ---

interface TrainingJob {
  status: "idle" | "running" | "completed" | "failed";
  stage: "uploading" | "frames" | "colmap" | "training" | "export";
  iteration: number;
  totalIterations: number;
  loss: number;
  startedAt: number | null;
  logs: string[];
  outputFile: string | null;
  config: { iterations: number; fps: number };
  error: string | null;
}

let currentJob: TrainingJob = {
  status: "idle",
  stage: "uploading",
  iteration: 0,
  totalIterations: 30000,
  loss: 0,
  startedAt: null,
  logs: [],
  outputFile: null,
  config: { iterations: 30000, fps: 6 },
  error: null,
};

let trainingProcess: Subprocess | null = null;

// --- WebSocket subscribers ---

const wsClients = new Set<any>();

function broadcast(data: TrainingJob) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch {}
  }
}

function addLog(line: string) {
  currentJob.logs.push(line);
  if (currentJob.logs.length > 100) currentJob.logs.shift();
}

// --- Parse training output ---

function parseTrainingOutput(line: string) {
  // Stage detection
  if (line.includes("Extracted") && line.includes("frames")) {
    currentJob.stage = "colmap";
    broadcast(currentJob);
    return;
  }
  if (line.includes("COLMAP reconstruction complete") || line.includes("convert.py") && currentJob.stage === "frames") {
    currentJob.stage = "colmap";
    broadcast(currentJob);
    return;
  }
  if (line.includes("Training progress")) {
    currentJob.stage = "training";
    broadcast(currentJob);
    return;
  }
  if (line.includes("Done:") && line.includes(".splat")) {
    currentJob.stage = "export";
    // Extract output filename
    const match = line.match(/Done:\s*(\S+\.splat)/);
    if (match) {
      currentJob.outputFile = match[1];
    }
    broadcast(currentJob);
    return;
  }

  // Training iteration + loss from tqdm postfix
  // tqdm format: " 45%|███ | 13500/30000 " or postfix {"Loss": "0.0032000"}
  const iterMatch = line.match(/(\d+)\/(\d+)/);
  const lossMatch = line.match(/Loss['":\s]+(\d+\.\d+)/);
  if (iterMatch && currentJob.stage === "training") {
    currentJob.iteration = parseInt(iterMatch[1]);
    currentJob.totalIterations = parseInt(iterMatch[2]);
  }
  if (lossMatch) {
    currentJob.loss = parseFloat(lossMatch[1]);
  }
  if (iterMatch || lossMatch) {
    broadcast(currentJob);
  }

  // Saving checkpoint
  if (line.includes("[ITER")) {
    addLog(line.trim());
    broadcast(currentJob);
  }
}

// --- Start training pipeline ---

async function startTraining(videoPath: string, iterations: number, fps: number) {
  currentJob = {
    status: "running",
    stage: "frames",
    iteration: 0,
    totalIterations: iterations,
    loss: 0,
    startedAt: Date.now(),
    logs: [],
    outputFile: null,
    config: { iterations, fps },
    error: null,
  };
  addLog(`Starting pipeline: ${basename(videoPath)}, ${iterations} iterations, ${fps} fps`);
  broadcast(currentJob);

  const videoName = basename(videoPath);
  const sceneName = videoName.replace(/\.[^.]+$/, "");

  try {
    trainingProcess = spawn({
      cmd: [
        "make", "splat",
        `VIDEO=${videoName}`,
        `SCENE=data/${sceneName}`,
        `MODEL=output/${sceneName}`,
        `ITERATIONS=${iterations}`,
        `FPS=${fps}`,
      ],
      cwd: PIPELINE_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    // Read stdout
    const readStream = async (stream: ReadableStream<Uint8Array>, label: string) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on newlines and carriage returns (tqdm uses \r)
        const parts = buffer.split(/[\r\n]+/);
        buffer = parts.pop() || "";
        for (const part of parts) {
          if (part.trim()) {
            addLog(part.trim());
            parseTrainingOutput(part);
          }
        }
      }
      // Flush remaining
      if (buffer.trim()) {
        addLog(buffer.trim());
        parseTrainingOutput(buffer);
      }
    };

    // Read both streams concurrently
    const stdoutPromise = readStream(trainingProcess.stdout as ReadableStream, "stdout");
    const stderrPromise = readStream(trainingProcess.stderr as ReadableStream, "stderr");

    await Promise.all([stdoutPromise, stderrPromise]);
    const exitCode = await trainingProcess.exited;

    if (exitCode === 0) {
      currentJob.status = "completed";
      currentJob.stage = "export";
      addLog("Pipeline completed successfully!");
    } else {
      currentJob.status = "failed";
      currentJob.error = `Process exited with code ${exitCode}`;
      addLog(`Pipeline failed with exit code ${exitCode}`);
    }
  } catch (e: any) {
    currentJob.status = "failed";
    currentJob.error = e.message;
    addLog(`Pipeline error: ${e.message}`);
  }

  trainingProcess = null;
  broadcast(currentJob);
}

// --- Proxy helpers ---

async function proxyRequest(req: Request, path: string): Promise<Response> {
  const target = API_PROXY + path;
  const headers = new Headers(req.headers);
  headers.delete("host");
  const proxyReq = new Request(target, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "follow",
  });
  const resp = await fetch(proxyReq);
  const respHeaders = new Headers(resp.headers);
  respHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}

// WebSocket proxy: connect client ↔ remote WS
const wsProxyMap = new Map<any, WebSocket>();

function proxyWebSocket(clientWs: any) {
  const wsUrl = API_PROXY.replace(/^http/, "ws") + "/ws";
  const remote = new WebSocket(wsUrl);
  wsProxyMap.set(clientWs, remote);
  remote.onmessage = (e) => {
    try { clientWs.send(e.data); } catch {}
  };
  remote.onclose = () => {
    try { clientWs.close(); } catch {}
    wsProxyMap.delete(clientWs);
  };
  remote.onerror = () => {
    try { clientWs.close(); } catch {}
    wsProxyMap.delete(clientWs);
  };
}

// --- File scanner ---

async function findSplatFiles(dir: string, base: string): Promise<{ name: string; path: string; size: number }[]> {
  const results: { name: string; path: string; size: number }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
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
  } catch {}
  return results;
}

// --- File watcher ---

const watcher = watch(import.meta.dir, { recursive: true }, async (event, filename) => {
  if (filename?.endsWith(".ts")) {
    console.log(`Change detected: ${filename}, rebundling...`);
    await bundle();
  }
});

// --- Server ---

const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- Proxy mode: forward API/WS/splats to remote server ---
    if (API_PROXY) {
      if (path === "/ws") {
        if (server.upgrade(req)) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      if (path.startsWith("/api/") || path.startsWith("/splats/")) {
        return proxyRequest(req, path);
      }
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
    }

    // --- Local mode: handle API/WS directly ---

    // --- WebSocket upgrade ---
    if (path === "/ws" && !API_PROXY) {
      if (server.upgrade(req)) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // --- API: list splat files ---
    if (path === "/api/splats" && !API_PROXY) {
      const files = await findSplatFiles(SPLAT_DIR, SPLAT_DIR);
      return Response.json(files, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // --- API: training status ---
    if (path === "/api/status" && !API_PROXY) {
      return Response.json(currentJob, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // --- API: start training ---
    if (path === "/api/train" && req.method === "POST" && !API_PROXY) {
      if (currentJob.status === "running") {
        return Response.json({ error: "A training job is already running" }, {
          status: 409,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      try {
        const formData = await req.formData();
        const videoFile = formData.get("video") as File | null;
        const iterations = parseInt(formData.get("iterations") as string) || 30000;
        const fps = parseInt(formData.get("fps") as string) || 6;

        if (!videoFile) {
          return Response.json({ error: "No video file provided" }, {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        }

        // Save video to pipeline directory
        const videoPath = join(PIPELINE_DIR, videoFile.name);
        await Bun.write(videoPath, videoFile);

        // Start training asynchronously
        startTraining(videoPath, iterations, fps);

        return Response.json({ started: true, config: { iterations, fps } }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // --- CORS preflight ---
    if (req.method === "OPTIONS" && !API_PROXY) {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // --- Serve splat files from SPLAT_DIR ---
    if (path.startsWith("/splats/") && !API_PROXY) {
      const rel = path.slice("/splats/".length);
      const requested = resolve(SPLAT_DIR, rel);
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

    // Static files from viewer root
    const filePath = import.meta.dir + "/.." + path;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      if (API_PROXY) {
        proxyWebSocket(ws);
      } else {
        wsClients.add(ws);
        ws.send(JSON.stringify(currentJob));
      }
    },
    close(ws) {
      if (API_PROXY) {
        const remote = wsProxyMap.get(ws);
        if (remote) { remote.close(); wsProxyMap.delete(ws); }
      } else {
        wsClients.delete(ws);
      }
    },
    message(ws, msg) {},
  },
});

console.log(`\nGaussian Splat Viewer: http://localhost:${server.port}`);
if (API_PROXY) {
  console.log(`PROXY MODE: API requests → ${API_PROXY}`);
} else {
  console.log(`Scanning for splats in: ${SPLAT_DIR}`);
  console.log(`Pipeline directory: ${PIPELINE_DIR}`);
}
console.log("Watching for changes...\n");
