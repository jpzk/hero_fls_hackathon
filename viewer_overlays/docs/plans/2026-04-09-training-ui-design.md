# Training UI Design

Video upload + training progress monitoring for the Gaussian Splat Viewer.

## Architecture

### Server (dev.ts)

**In-memory job state:**
```ts
type JobStatus = "idle" | "running" | "completed" | "failed";
type Stage = "uploading" | "frames" | "colmap" | "training" | "export";

interface TrainingJob {
  status: JobStatus;
  stage: Stage;
  iteration: number;
  totalIterations: number;
  loss: number;
  startedAt: number | null;
  logs: string[];           // last ~100 lines
  outputFile: string | null;
  config: { iterations: number; fps: number };
  error: string | null;
}
```

**New endpoints:**
- `POST /api/train` — multipart upload (video file + iterations + fps). Saves video to `3dgs/` dir, spawns `make splat` with overridden ITERATIONS/FPS. Returns 409 if job already running.
- `GET /api/status` — returns current `TrainingJob` state (for page refresh catch-up).
- `WebSocket /ws` — broadcasts job state updates to all connected clients.

**Process management:**
- Spawns `make splat VIDEO=<name> ITERATIONS=N FPS=F` as child process in `3dgs/` directory.
- Parses stdout/stderr line-by-line:
  - Stage detection via pattern matching ("Extracted N frames", "COLMAP reconstruction", tqdm output, "Done:")
  - Training iteration + loss extracted from tqdm: regex on iteration count and loss value
- Broadcasts to WebSocket subscribers on every meaningful state change (~every 10 iterations during training).
- Single job at a time — returns 409 Conflict if job in progress.

### Frontend

**Drop-zone layout (3 sections):**

1. **Upload & Config** (top)
   - Video file picker (accepts .mp4, .mov, .avi)
   - Iterations input (default 30000, step 1000)
   - FPS input (default 6, step 1)
   - "Start Training" button

2. **Training Progress** (middle, visible when job running/completed)
   - Stage indicator: 4 steps (Frames → COLMAP → Training → Export)
   - Progress bar (iteration/total during training, indeterminate otherwise)
   - Stats: iteration, loss, estimated time remaining
   - Live log: scrollable, last ~20 lines, auto-scrolls
   - On complete: "Load Result" button

3. **File Browser** (bottom, unchanged)

**Page refresh behavior:**
- On load, fetches `GET /api/status`
- If job running: shows progress section, connects WebSocket, resumes live updates
- If job completed: shows completion state with "Load Result" button

### Data flow

```
Browser                        Bun Server                     Shell (3dgs/)
───────                        ──────────                     ─────────────
POST /api/train (video+config)
  ────────────────────────►   Save video, set job=running
  ◄──── 200 {started}         Spawn: make splat VIDEO=x ITERATIONS=n FPS=f
                                                              ──► ffmpeg
Connect WS /ws                Parse stdout ◄────────────────  [frame output]
  ◄──── {stage:"frames"}      Broadcast
                                                              ──► COLMAP
  ◄──── {stage:"colmap"}      Parse stdout ◄────────────────  [colmap output]
                                                              ──► train.py
  ◄──── {iter,loss,stage}     Parse tqdm ◄──────────────────  [tqdm lines]
                               (every ~10 iters)
                                                              ──► ply_to_splat
  ◄──── {status:"completed"}  Parse exit code ◄─────────────  [exit 0]
                               Set outputFile

GET /api/status (page refresh)
  ────────────────────────►   Return current job state
  ◄──── {full job state}
```

### Makefile integration

The Makefile already accepts `ITERATIONS`, `FPS`, and `VIDEO` as overridable variables. The server passes them via make args:

```sh
make -C /root/splatting/3dgs splat VIDEO=uploaded.mp4 ITERATIONS=10000 FPS=4
```

`SPLAT_DIR` env var on the server points to `/root/splatting/3dgs/output` so newly created splats appear in the file browser automatically.
