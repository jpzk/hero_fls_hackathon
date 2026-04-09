# Spatial Object Detection for 3D Job Site Documentation

## Problem
Trades professionals need to document job sites for remote review by office teams. Currently this requires photos, manual notes, and back-and-forth calls. A 3D scan with automatic object detection lets the office see what's on site without visiting.

## Solution
Video -> 3D Gaussian Splat -> AI detects objects -> labeled 3D bounding boxes in the viewer. The office team can orbit the scene, click detected items, and see estimated dimensions + trade-relevant suggestions.

## Architecture

```
Viewer (browser)                         Server (GPU)
──────────────────                       ────────────
1. User clicks "Detect Objects"
2. Captures 6 synthetic viewpoints  ──>  3. YOLOv8 runs on each frame
   (renders canvas at different           4. Cross-view NMS + matching
   camera angles, sends as base64         5. Back-project to 3D boxes
   + camera matrices)
6. Receives 3D boxes + labels    <──     Returns JSON: [{class,
7. Adds as overlay boxes                  confidence, center, size,
8. Click box -> detail panel              suggestion}]
```

## Detection Pipeline (Server)

1. Decode 6 base64 PNG frames
2. Run YOLOv8n (nano) on each frame
3. For each detection: back-project 2D center to 3D ray using camera matrices
4. Match same-class detections across views by ray proximity
5. Triangulate 3D position from multiple rays (least-squares)
6. Estimate 3D box size from 2D box dimensions + camera distance
7. Look up trade suggestion from static mapping
8. Return JSON array of detections

### Simplified fallback
Single best view + depth assumption at scene center. Still produces 3D boxes, less accurate.

## API

```
POST /api/detect
{
  frames: [{ image: base64, viewMatrix: [16], projMatrix: [16] }, ...],
  sceneCenter: [x, y, z],
  sceneRadius: float
}

Response:
{
  detections: [{
    class: "sink",
    confidence: 0.94,
    center: [x, y, z],
    size: [w, h, d],
    suggestion: { item: "Basin replacement", range: "150-220" }
  }]
}
```

## Viewer Changes

1. **Detect button** in floating toolbar (between heatmap and drawer buttons)
2. **Detection overlays** as colored 3D boxes with floating labels
3. **Detail panel** (right side) on box click: class, confidence, dimensions, trade suggestion

## Trade Suggestion Lookup

Static JSON mapping from YOLO class to trade item + price range. Extensible, not AI-dependent.

## Build Order

1. Python detection endpoint (YOLO + single-view projection) ~2h
2. Viewer detect button + viewpoint capture ~1h
3. Render results as 3D overlay boxes ~1h
4. Detail panel ~1h
5. Multi-view triangulation (stretch) ~2h
6. Polish ~1h
