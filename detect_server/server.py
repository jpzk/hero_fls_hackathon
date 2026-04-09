"""
Detection server: runs YOLOv8 on frames from a 3D Gaussian Splat viewer,
back-projects 2D detections to 3D bounding boxes, and returns trade-relevant
suggestions.

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8100
"""

import base64
import io
import logging
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("detect_server")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="3DGS Detection Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# YOLOv8 model — loaded once at startup
# ---------------------------------------------------------------------------
yolo_model = None


@app.on_event("startup")
def load_model():
    global yolo_model
    from ultralytics import YOLO

    logger.info("Loading YOLOv8n model ...")
    yolo_model = YOLO("yolov8n.pt")
    logger.info("YOLOv8n model loaded.")


# ---------------------------------------------------------------------------
# Trade-suggestion lookup
# ---------------------------------------------------------------------------
TRADE_SUGGESTIONS = {
    "toilet": {"item": "Toilet installation/replacement", "range": "\u20ac200\u2013400"},
    "sink": {"item": "Basin replacement", "range": "\u20ac150\u2013220"},
    "oven": {"item": "Oven installation", "range": "\u20ac120\u2013300"},
    "microwave": {"item": "Microwave installation", "range": "\u20ac80\u2013150"},
    "refrigerator": {"item": "Refrigerator installation", "range": "\u20ac100\u2013250"},
    "tv": {"item": "TV wall mount installation", "range": "\u20ac80\u2013200"},
    "laptop": {"item": "Workstation setup", "range": "\u20ac50\u2013100"},
    "chair": {"item": "Furniture assembly", "range": "\u20ac30\u201380"},
    "couch": {"item": "Furniture delivery/placement", "range": "\u20ac50\u2013150"},
    "bed": {"item": "Bed frame assembly", "range": "\u20ac60\u2013120"},
    "dining table": {"item": "Table assembly", "range": "\u20ac40\u2013100"},
    "potted plant": {"item": "Planter installation", "range": "\u20ac20\u201360"},
    "vase": {"item": "Decorative fixture mount", "range": "\u20ac15\u201340"},
    "clock": {"item": "Wall fixture installation", "range": "\u20ac20\u201350"},
    "book": {"item": "Shelf installation", "range": "\u20ac40\u2013120"},
    "bottle": {"item": "Storage/shelving unit", "range": "\u20ac30\u201380"},
    "cup": {"item": "Kitchen fixture", "range": "\u20ac15\u201340"},
    "knife": {"item": "Kitchen tool storage", "range": "\u20ac20\u201360"},
    "spoon": {"item": "Kitchen tool storage", "range": "\u20ac20\u201360"},
    "bowl": {"item": "Kitchen fixture", "range": "\u20ac15\u201340"},
    "mouse": {"item": "Workstation peripheral", "range": "\u20ac10\u201330"},
    "keyboard": {"item": "Workstation peripheral", "range": "\u20ac10\u201330"},
    "cell phone": {"item": "Charging station installation", "range": "\u20ac30\u201380"},
    "remote": {"item": "Smart home control setup", "range": "\u20ac50\u2013150"},
    "suitcase": {"item": "Storage solution", "range": "\u20ac40\u2013100"},
    "backpack": {"item": "Storage hook/rack installation", "range": "\u20ac20\u201350"},
}

# ---------------------------------------------------------------------------
# Color palette (10 distinct colours, cycled per class)
# ---------------------------------------------------------------------------
_PALETTE = [
    [0.90, 0.30, 0.30, 0.6],  # red
    [0.30, 0.70, 0.90, 0.6],  # blue
    [0.30, 0.90, 0.40, 0.6],  # green
    [0.95, 0.75, 0.20, 0.6],  # yellow
    [0.80, 0.40, 0.90, 0.6],  # purple
    [0.95, 0.55, 0.20, 0.6],  # orange
    [0.40, 0.90, 0.85, 0.6],  # teal
    [0.90, 0.45, 0.70, 0.6],  # pink
    [0.55, 0.55, 0.55, 0.6],  # grey
    [0.60, 0.80, 0.30, 0.6],  # lime
]

_class_color_map: dict[str, list[float]] = {}
_color_idx = 0


def _color_for_class(cls_name: str) -> list[float]:
    global _color_idx
    if cls_name not in _class_color_map:
        _class_color_map[cls_name] = _PALETTE[_color_idx % len(_PALETTE)]
        _color_idx += 1
    return _class_color_map[cls_name]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class FrameData(BaseModel):
    image: str  # base64-encoded PNG
    viewMatrix: List[float]  # 16 floats, column-major
    projMatrix: List[float]  # 16 floats, column-major


class DetectRequest(BaseModel):
    frames: List[FrameData]
    sceneCenter: List[float]  # [x, y, z]
    sceneRadius: float


class Suggestion(BaseModel):
    item: str
    range: str


class Detection3D(BaseModel):
    class_name: str  # using class_name to avoid Python reserved word
    confidence: float
    center: List[float]
    size: List[float]
    color: List[float]
    suggestion: Suggestion

    class Config:
        # Serialize `class_name` as `class` in JSON output
        populate_by_name = True

    def dict(self, **kw):
        d = super().dict(**kw)
        d["class"] = d.pop("class_name")
        return d


class DetectResponse(BaseModel):
    detections: List[dict]


# ---------------------------------------------------------------------------
# Matrix helpers (column-major WebGL -> numpy)
# ---------------------------------------------------------------------------

def _col_major_to_mat4(flat: List[float]) -> np.ndarray:
    """Convert a 16-element column-major list to a 4x4 float64 matrix."""
    return np.array(flat, dtype=np.float64).reshape((4, 4), order="F")


def _closest_point_on_ray(origin: np.ndarray, direction: np.ndarray,
                           point: np.ndarray) -> tuple[np.ndarray, float]:
    """Return the closest point on ray(origin, direction) to *point*, and the
    parameter t (distance along ray from origin)."""
    diff = point - origin
    t = float(np.dot(diff, direction))
    t = max(t, 0.0)  # clamp so we don't go behind camera
    return origin + t * direction, t


def _closest_point_between_rays(
    o1: np.ndarray, d1: np.ndarray,
    o2: np.ndarray, d2: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Return the midpoint of the closest approach between two rays, plus the
    distance between them at that point."""
    w0 = o1 - o2
    a = float(np.dot(d1, d1))
    b = float(np.dot(d1, d2))
    c = float(np.dot(d2, d2))
    d = float(np.dot(d1, w0))
    e = float(np.dot(d2, w0))

    denom = a * c - b * b
    if abs(denom) < 1e-12:
        # Rays are nearly parallel; just use midpoint of origins projected
        t = 0.0
        s = e / c if abs(c) > 1e-12 else 0.0
    else:
        s = (b * e - c * d) / denom
        t = (a * e - b * d) / denom

    s = max(s, 0.0)
    t = max(t, 0.0)

    p1 = o1 + s * d1
    p2 = o2 + t * d2
    midpoint = (p1 + p2) / 2.0
    dist = float(np.linalg.norm(p1 - p2))
    return midpoint, dist


# ---------------------------------------------------------------------------
# Back-projection helpers
# ---------------------------------------------------------------------------

def _backproject_ray(
    cx: float, cy: float,
    width: int, height: int,
    view_mat: np.ndarray,
    proj_mat: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Given a pixel (cx, cy), view and projection matrices, return
    (ray_origin, ray_direction) in world space."""
    ndc_x = (cx / width) * 2.0 - 1.0
    ndc_y = 1.0 - (cy / height) * 2.0

    vp = proj_mat @ view_mat  # view-projection
    inv_vp = np.linalg.inv(vp)

    near_h = inv_vp @ np.array([ndc_x, ndc_y, -1.0, 1.0], dtype=np.float64)
    far_h = inv_vp @ np.array([ndc_x, ndc_y, 1.0, 1.0], dtype=np.float64)

    near_pt = near_h[:3] / near_h[3]
    far_pt = far_h[:3] / far_h[3]

    direction = far_pt - near_pt
    norm = np.linalg.norm(direction)
    if norm < 1e-12:
        direction = np.array([0.0, 0.0, -1.0])
    else:
        direction = direction / norm

    return near_pt, direction


# ---------------------------------------------------------------------------
# Internal detection record (before merging / NMS)
# ---------------------------------------------------------------------------

class _Det2D:
    __slots__ = (
        "cls", "confidence", "cx", "cy", "bw", "bh",
        "ray_origin", "ray_dir", "width", "height",
        "focal_x", "focal_y",
    )

    def __init__(self, cls, confidence, cx, cy, bw, bh,
                 ray_origin, ray_dir, width, height, focal_x, focal_y):
        self.cls = cls
        self.confidence = confidence
        self.cx = cx
        self.cy = cy
        self.bw = bw
        self.bh = bh
        self.ray_origin = ray_origin
        self.ray_dir = ray_dir
        self.width = width
        self.height = height
        self.focal_x = focal_x
        self.focal_y = focal_y


# ---------------------------------------------------------------------------
# Core detection pipeline
# ---------------------------------------------------------------------------

def _decode_image(b64: str) -> Image.Image:
    """Decode a base64 PNG/JPEG string to a PIL Image (RGB)."""
    # Strip optional data-URI prefix
    if "," in b64[:80]:
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return img


def _run_yolo(img: Image.Image) -> list:
    """Run YOLOv8 on a PIL image. Returns list of result boxes."""
    results = yolo_model(img, conf=0.3, verbose=False)
    return results


def _estimate_3d_box(det: _Det2D, depth: float, scene_radius: float) -> list[float]:
    """Estimate world-space 3D box size from a 2D detection at a given depth."""
    fx = max(abs(det.focal_x), 1e-6)
    fy = max(abs(det.focal_y), 1e-6)
    w = det.bw * depth / fx
    h = det.bh * depth / fy
    d = min(w, h) * 0.5
    # Clamp each dimension to at most 40% of scene radius
    max_dim = scene_radius * 0.4
    w = min(w, max_dim)
    h = min(h, max_dim)
    d = min(d, max_dim)
    return [float(w), float(h), float(d)]


def _ray_sphere_intersect(
    origin: np.ndarray, direction: np.ndarray,
    center: np.ndarray, radius: float,
) -> float | None:
    """Find parameter t where ray enters a sphere. Returns None if no hit."""
    oc = origin - center
    a = float(np.dot(direction, direction))
    b = 2.0 * float(np.dot(oc, direction))
    c = float(np.dot(oc, oc)) - radius * radius
    disc = b * b - 4 * a * c
    if disc < 0:
        return None
    sqrt_disc = np.sqrt(disc)
    t1 = (-b - sqrt_disc) / (2 * a)
    t2 = (-b + sqrt_disc) / (2 * a)
    # Return the first positive intersection (entering the sphere)
    if t1 > 0:
        return float(t1)
    if t2 > 0:
        return float(t2)
    return None


def _process_frames(
    frames: List[FrameData],
    scene_center: np.ndarray,
    scene_radius: float,
) -> list[_Det2D]:
    """Decode frames, run YOLO, and produce a list of 2D detections with
    associated rays."""
    all_dets: list[_Det2D] = []

    for frame in frames:
        try:
            img = _decode_image(frame.image)
        except Exception:
            logger.exception("Failed to decode frame image")
            continue

        width, height = img.size
        view_mat = _col_major_to_mat4(frame.viewMatrix)
        proj_mat = _col_major_to_mat4(frame.projMatrix)

        # Derive focal lengths from projection matrix
        # proj_mat is column-major -> element (0,0) is at [0,0], (1,1) at [1,1]
        focal_x = proj_mat[0, 0] * width / 2.0
        focal_y = proj_mat[1, 1] * height / 2.0

        results = _run_yolo(img)
        if not results or len(results) == 0:
            continue

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            continue

        for box in boxes:
            xyxy = box.xyxy[0].cpu().numpy()  # [x1, y1, x2, y2]
            conf = float(box.conf[0].cpu().numpy())
            cls_id = int(box.cls[0].cpu().numpy())
            cls_name = yolo_model.names[cls_id]

            x1, y1, x2, y2 = xyxy
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            bw = x2 - x1
            bh = y2 - y1

            ray_origin, ray_dir = _backproject_ray(
                cx, cy, width, height, view_mat, proj_mat
            )

            all_dets.append(_Det2D(
                cls=cls_name,
                confidence=conf,
                cx=cx, cy=cy,
                bw=bw, bh=bh,
                ray_origin=ray_origin,
                ray_dir=ray_dir,
                width=width,
                height=height,
                focal_x=focal_x,
                focal_y=focal_y,
            ))

    return all_dets


def _merge_and_localise(
    dets: list[_Det2D],
    scene_center: np.ndarray,
    scene_radius: float,
) -> list[dict]:
    """Multi-view merge, single-view fallback, NMS, and final output."""

    # Group by class
    by_class: dict[str, list[_Det2D]] = {}
    for d in dets:
        by_class.setdefault(d.cls, []).append(d)

    merged: list[dict] = []  # list of final dicts

    for cls_name, cls_dets in by_class.items():
        # Attempt pairwise multi-view matching within the same class
        used = [False] * len(cls_dets)
        groups: list[list[int]] = []  # indices into cls_dets

        for i in range(len(cls_dets)):
            if used[i]:
                continue
            group = [i]
            used[i] = True
            for j in range(i + 1, len(cls_dets)):
                if used[j]:
                    continue
                # Check if rays are from different views (different origins)
                origin_dist = np.linalg.norm(
                    cls_dets[i].ray_origin - cls_dets[j].ray_origin
                )
                if origin_dist < 1e-6:
                    # Same view — don't merge here
                    continue
                midpoint, dist = _closest_point_between_rays(
                    cls_dets[i].ray_origin, cls_dets[i].ray_dir,
                    cls_dets[j].ray_origin, cls_dets[j].ray_dir,
                )
                if dist < scene_radius * 0.3:
                    group.append(j)
                    used[j] = True
            groups.append(group)

        for group in groups:
            group_dets = [cls_dets[idx] for idx in group]

            if len(group_dets) >= 2:
                # Multi-view: average closest-approach points pairwise
                points = []
                for i in range(len(group_dets)):
                    for j in range(i + 1, len(group_dets)):
                        mid, _ = _closest_point_between_rays(
                            group_dets[i].ray_origin, group_dets[i].ray_dir,
                            group_dets[j].ray_origin, group_dets[j].ray_dir,
                        )
                        points.append(mid)
                center_3d = np.mean(points, axis=0)
            else:
                # Single-view: intersect ray with a sphere around scene center
                # This places objects inside the scene volume
                det = group_dets[0]
                t_sphere = _ray_sphere_intersect(
                    det.ray_origin, det.ray_dir,
                    scene_center, scene_radius * 0.8,
                )
                if t_sphere is not None and t_sphere > 0.1:
                    # Place midway between entry and scene center depth
                    closest_pt, t_center = _closest_point_on_ray(
                        det.ray_origin, det.ray_dir, scene_center
                    )
                    t = (t_sphere + t_center) / 2.0
                else:
                    # Fallback: project toward scene center
                    _, t = _closest_point_on_ray(
                        det.ray_origin, det.ray_dir, scene_center
                    )
                t = max(t, 0.1)
                center_3d = det.ray_origin + t * det.ray_dir

            # Best confidence and representative detection
            best_det = max(group_dets, key=lambda d: d.confidence)
            confidence = best_det.confidence

            # Estimate depth for sizing
            depth = float(np.linalg.norm(center_3d - best_det.ray_origin))
            depth = max(depth, 0.1)

            size = _estimate_3d_box(best_det, depth, scene_radius)

            suggestion = TRADE_SUGGESTIONS.get(
                cls_name,
                {"item": f"{cls_name} \u2014 noted on site", "range": "TBD"},
            )

            merged.append({
                "class": cls_name,
                "confidence": round(confidence, 3),
                "center": [round(float(c), 4) for c in center_3d],
                "size": [round(float(s), 4) for s in size],
                "color": _color_for_class(cls_name),
                "suggestion": suggestion,
            })

    # 3D NMS: within same class, if centres are inside each other's box,
    # keep the higher-confidence one.
    final: list[dict] = []
    merged.sort(key=lambda d: -d["confidence"])

    suppressed = [False] * len(merged)
    for i in range(len(merged)):
        if suppressed[i]:
            continue
        for j in range(i + 1, len(merged)):
            if suppressed[j]:
                continue
            if merged[i]["class"] != merged[j]["class"]:
                continue
            ci = np.array(merged[i]["center"])
            cj = np.array(merged[j]["center"])
            si = np.array(merged[i]["size"])
            sj = np.array(merged[j]["size"])

            # Check if cj is inside box i OR ci is inside box j
            diff = np.abs(ci - cj)
            inside_i = np.all(diff < si / 2.0)
            inside_j = np.all(diff < sj / 2.0)
            if inside_i or inside_j:
                # Suppress the lower-confidence one (j, since sorted desc)
                suppressed[j] = True

    for i, det in enumerate(merged):
        if not suppressed[i]:
            final.append(det)

    return final


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------

@app.post("/api/detect")
async def detect(req: DetectRequest) -> dict:
    """Run detection pipeline on submitted frames."""
    try:
        if not req.frames:
            return {"detections": []}

        scene_center = np.array(req.sceneCenter, dtype=np.float64)
        scene_radius = float(req.sceneRadius)
        if scene_radius <= 0:
            scene_radius = 1.0

        # Step 1: process frames -> 2D detections with rays
        dets_2d = _process_frames(req.frames, scene_center, scene_radius)

        if not dets_2d:
            return {"detections": []}

        # Step 2: merge across views, localise in 3D, NMS, build output
        detections = _merge_and_localise(dets_2d, scene_center, scene_radius)

        logger.info("Returning %d detections", len(detections))
        return {"detections": detections}

    except Exception:
        logger.exception("Detection pipeline failed")
        raise HTTPException(status_code=500, detail="Detection pipeline error")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": yolo_model is not None}
