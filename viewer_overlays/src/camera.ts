/**
 * Orbit camera with mouse/touch controls.
 */

export class OrbitCamera {
  target = [0, 0, 0];
  enabled = true;
  distance = 5;
  azimuth = 0;     // radians
  elevation = 0.3; // radians
  fov = 50;        // degrees
  near = 0.1;
  far = 1000;

  private dragging = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    // Touch support
    canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.onTouchEnd);
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button === 0) this.dragging = true;
    if (e.button === 2) this.panning = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (this.dragging) {
      this.azimuth -= dx * 0.005;
      this.elevation = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01,
        this.elevation + dy * 0.005));
    }
    if (this.panning) {
      const panSpeed = this.distance * 0.002;
      const right = this.getRight();
      const up = this.getUp();
      this.target[0] -= (dx * right[0] + dy * up[0]) * panSpeed;
      this.target[1] -= (dx * right[1] + dy * up[1]) * panSpeed;
      this.target[2] -= (dx * right[2] + dy * up[2]) * panSpeed;
    }
  };

  private onMouseUp = () => {
    this.dragging = false;
    this.panning = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.distance *= 1 + e.deltaY * 0.001;
    this.distance = Math.max(0.1, Math.min(500, this.distance));
  };

  private lastTouchDist = 0;
  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.dragging = true;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      this.dragging = false;
      this.lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && this.dragging) {
      const dx = e.touches[0].clientX - this.lastX;
      const dy = e.touches[0].clientY - this.lastY;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.azimuth -= dx * 0.005;
      this.elevation = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01,
        this.elevation + dy * 0.005));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      this.distance *= this.lastTouchDist / dist;
      this.distance = Math.max(0.1, Math.min(500, this.distance));
      this.lastTouchDist = dist;
    }
  };

  private onTouchEnd = () => {
    this.dragging = false;
  };

  getPosition(): [number, number, number] {
    const x = this.target[0] + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
    const y = this.target[1] + this.distance * Math.sin(this.elevation);
    const z = this.target[2] + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);
    return [x, y, z];
  }

  private getRight(): [number, number, number] {
    return [Math.cos(this.azimuth), 0, -Math.sin(this.azimuth)];
  }

  private getUp(): [number, number, number] {
    return [
      -Math.sin(this.elevation) * Math.sin(this.azimuth),
      Math.cos(this.elevation),
      -Math.sin(this.elevation) * Math.cos(this.azimuth),
    ];
  }

  getViewMatrix(): Float32Array {
    const eye = this.getPosition();
    const [tx, ty, tz] = this.target;
    return lookAt(eye[0], eye[1], eye[2], tx, ty, tz, 0, 1, 0);
  }

  getProjectionMatrix(aspect: number): Float32Array {
    const f = 1 / Math.tan((this.fov * Math.PI / 180) / 2);
    const nf = 1 / (this.near - this.far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (this.far + this.near) * nf, -1,
      0, 0, 2 * this.far * this.near * nf, 0,
    ]);
  }

  /** Auto-frame the camera to fit the scene */
  fitToScene(center: [number, number, number], radius: number) {
    this.target = [...center];
    this.distance = radius * 0.8;
  }
}

function lookAt(
  ex: number, ey: number, ez: number,
  cx: number, cy: number, cz: number,
  ux: number, uy: number, uz: number,
): Float32Array {
  let fx = cx - ex, fy = cy - ey, fz = cz - ez;
  let fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx /= fl; fy /= fl; fz /= fl;

  let sx = fy * uz - fz * uy;
  let sy = fz * ux - fx * uz;
  let sz = fx * uy - fy * ux;
  let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
  sx /= sl; sy /= sl; sz /= sl;

  let uux = sy * fz - sz * fy;
  let uuy = sz * fx - sx * fz;
  let uuz = sx * fy - sy * fx;

  return new Float32Array([
    sx, uux, -fx, 0,
    sy, uuy, -fy, 0,
    sz, uuz, -fz, 0,
    -(sx * ex + sy * ey + sz * ez),
    -(uux * ex + uuy * ey + uuz * ez),
    -(-fx * ex + -fy * ey + -fz * ez),
    1,
  ]);
}
