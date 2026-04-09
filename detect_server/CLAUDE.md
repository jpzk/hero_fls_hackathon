# Detection Server

Python FastAPI server that runs YOLOv8 on rendered frames from the Gaussian Splat viewer and returns 3D bounding boxes with trade-relevant suggestions.

## Run

```bash
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8100
```

## API

### `POST /api/detect`

Accepts rendered frames with camera matrices, returns 3D detections.

**Request:**
```json
{
  "frames": [{
    "image": "<base64 PNG>",
    "viewMatrix": [16 floats, column-major],
    "projMatrix": [16 floats, column-major]
  }],
  "sceneCenter": [x, y, z],
  "sceneRadius": float
}
```

**Response:**
```json
{
  "detections": [{
    "class": "couch",
    "confidence": 0.92,
    "center": [x, y, z],
    "size": [w, h, d],
    "color": [r, g, b, a],
    "suggestion": {"item": "Furniture delivery/placement", "range": "€50–150"}
  }]
}
```

### `GET /health`

Returns `{"status": "ok", "model_loaded": true}`.

## How It Works

1. Decode base64 PNG frames from the viewer
2. Run YOLOv8n (nano, ~6MB) on each frame — confidence threshold 0.3
3. For each 2D detection, back-project the bounding box center to a 3D ray using the camera matrices
4. Place the 3D box where the ray intersects the scene sphere (not at camera distance)
5. Estimate 3D box size from 2D box dimensions scaled by depth and focal length, clamped to 40% of scene radius
6. If multiple views: match same-class detections across views by ray proximity, triangulate 3D position
7. Apply 3D NMS to remove duplicate same-class detections
8. Look up trade suggestions from a static mapping (COCO class → trade item + price range)

## Key Implementation Details

- **Column-major matrices**: WebGL sends matrices in column-major order. Use `np.reshape((4,4), order="F")` to convert.
- **Focal length**: Derived from projection matrix: `focal_x = proj[0,0] * width / 2`, `focal_y = proj[1,1] * height / 2`
- **Depth placement**: Ray-sphere intersection with `sceneRadius * 0.8`, then average with closest-to-center depth. This places objects inside the scene, not at camera distance.
- **Size clamping**: Each box dimension capped at `sceneRadius * 0.4` to prevent oversized boxes.
- **Color palette**: 10 distinct colors cycled per class, alpha 0.6.

## Dependencies

- `ultralytics` — YOLOv8
- `fastapi` + `uvicorn` — HTTP server
- `numpy` — matrix math (float64 for precision)
- `pillow` — image decoding
