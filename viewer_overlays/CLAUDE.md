# Viewer Overlays

Experiment: splat viewer with 3D visual indicators drawn on top of gaussian splats.

## What's different from splatting_base/viewer

- `src/overlays.ts` — Overlay renderer (separate WebGL program for lines/triangles in world space)
- `src/main.ts` — Auto-generates overlays from scene bounds, toggle panel
- `index.html` — Overlay control panel UI

## Overlay types

| Type | Description |
|------|-------------|
| `rect` | Flat rectangle in world space (wireframe + optional fill) |
| `box` | Wireframe cuboid |
| `line` | Single line segment |
| `circle` | Circle/ring around an axis |
| `point` | 3-axis cross marker |

All overlays live in `renderer.overlayRenderer.overlays` array.

## Commands

```sh
bun install
bun dev   # http://localhost:3000
```
