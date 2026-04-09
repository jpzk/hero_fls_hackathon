/**
 * 3D overlay renderer for drawing wireframe shapes on top of splats.
 *
 * Supports: rectangles (3D quads), boxes (wireframe cuboids),
 * lines, and circles/rings in world space.
 */

const OVERLAY_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;

uniform mat4 u_viewProj;

out vec4 v_color;

void main() {
    v_color = a_color;
    gl_Position = u_viewProj * vec4(a_position, 1.0);
}
`;

const OVERLAY_FRAG = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
    fragColor = v_color;
}
`;

export interface OverlayRect {
  type: "rect";
  /** Center position in world space */
  center: [number, number, number];
  /** Width and height in the chosen plane */
  size: [number, number];
  /** RGBA color, each 0-1 */
  color: [number, number, number, number];
  /** Rotation around Y axis in radians (default 0) */
  rotationY?: number;
  /** Fill the rectangle with triangles (default false = wireframe) */
  filled?: boolean;
  /** Plane the rect lies on: "xy" (default) or "xz" (ground plane) */
  plane?: "xy" | "xz";
}

export interface OverlayBox {
  type: "box";
  /** Center position in world space */
  center: [number, number, number];
  /** Half-extents [x, y, z] */
  halfExtents: [number, number, number];
  /** RGBA color, each 0-1 */
  color: [number, number, number, number];
  /** Rotation around Y axis in radians (default 0) */
  rotationY?: number;
}

export interface OverlayLine {
  type: "line";
  from: [number, number, number];
  to: [number, number, number];
  color: [number, number, number, number];
}

export interface OverlayCircle {
  type: "circle";
  center: [number, number, number];
  radius: number;
  color: [number, number, number, number];
  /** Number of segments (default 32) */
  segments?: number;
  /** Axis the circle is perpendicular to: "x" | "y" | "z" (default "y") */
  axis?: "x" | "y" | "z";
}

export interface OverlayPoint {
  type: "point";
  position: [number, number, number];
  color: [number, number, number, number];
  /** Size of cross indicator in world units (default 0.1) */
  size?: number;
}

export type Overlay = OverlayRect | OverlayBox | OverlayLine | OverlayCircle | OverlayPoint;

export class OverlayRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private colBuf: WebGLBuffer;

  overlays: Overlay[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = this.createProgram();

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.colBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  render(viewMatrix: Float32Array, projMatrix: Float32Array) {
    if (this.overlays.length === 0) return;

    const gl = this.gl;
    const { lineVerts, lineColors, triVerts, triColors } = this.buildGeometry();

    const viewProj = mat4Multiply(projMatrix, viewMatrix);

    gl.useProgram(this.program);
    const vpLoc = gl.getUniformLocation(this.program, "u_viewProj");
    gl.uniformMatrix4fv(vpLoc, false, viewProj);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    gl.bindVertexArray(this.vao);

    // Draw filled triangles first
    if (triVerts.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triVerts), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triColors), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, triVerts.length / 3);
    }

    // Draw lines on top
    if (lineVerts.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVerts), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineColors), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, lineVerts.length / 3);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  private buildGeometry() {
    const lineVerts: number[] = [];
    const lineColors: number[] = [];
    const triVerts: number[] = [];
    const triColors: number[] = [];

    for (const o of this.overlays) {
      switch (o.type) {
        case "rect":
          this.buildRect(o, lineVerts, lineColors, triVerts, triColors);
          break;
        case "box":
          this.buildBox(o, lineVerts, lineColors);
          break;
        case "line":
          this.pushLine(lineVerts, lineColors, o.from, o.to, o.color);
          break;
        case "circle":
          this.buildCircle(o, lineVerts, lineColors);
          break;
        case "point":
          this.buildPoint(o, lineVerts, lineColors);
          break;
      }
    }

    return { lineVerts, lineColors, triVerts, triColors };
  }

  private pushLine(
    verts: number[], colors: number[],
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number, number],
  ) {
    verts.push(...a, ...b);
    colors.push(...c, ...c);
  }

  private pushTri(
    verts: number[], colors: number[],
    a: [number, number, number], b: [number, number, number], c_pt: [number, number, number],
    c: [number, number, number, number],
  ) {
    verts.push(...a, ...b, ...c_pt);
    colors.push(...c, ...c, ...c);
  }

  private rotateY(p: [number, number, number], angle: number, center: [number, number, number]): [number, number, number] {
    const dx = p[0] - center[0];
    const dz = p[2] - center[2];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [
      center[0] + dx * cos + dz * sin,
      p[1],
      center[2] - dx * sin + dz * cos,
    ];
  }

  private buildRect(
    r: OverlayRect,
    lineVerts: number[], lineColors: number[],
    triVerts: number[], triColors: number[],
  ) {
    const [cx, cy, cz] = r.center;
    const hw = r.size[0] / 2;
    const hh = r.size[1] / 2;
    const rot = r.rotationY ?? 0;
    const plane = r.plane ?? "xy";

    let corners: [number, number, number][];
    if (plane === "xz") {
      corners = [
        [cx - hw, cy, cz - hh],
        [cx + hw, cy, cz - hh],
        [cx + hw, cy, cz + hh],
        [cx - hw, cy, cz + hh],
      ];
    } else {
      corners = [
        [cx - hw, cy - hh, cz],
        [cx + hw, cy - hh, cz],
        [cx + hw, cy + hh, cz],
        [cx - hw, cy + hh, cz],
      ];
    }

    if (rot !== 0) {
      corners = corners.map(p => this.rotateY(p, rot, r.center));
    }

    // Wireframe edges
    for (let i = 0; i < 4; i++) {
      this.pushLine(lineVerts, lineColors, corners[i], corners[(i + 1) % 4], r.color);
    }

    // Fill
    if (r.filled) {
      const fc: [number, number, number, number] = [r.color[0], r.color[1], r.color[2], r.color[3] * 0.25];
      this.pushTri(triVerts, triColors, corners[0], corners[1], corners[2], fc);
      this.pushTri(triVerts, triColors, corners[0], corners[2], corners[3], fc);
    }
  }

  private buildBox(o: OverlayBox, verts: number[], colors: number[]) {
    const [cx, cy, cz] = o.center;
    const [hx, hy, hz] = o.halfExtents;
    const rot = o.rotationY ?? 0;

    let corners: [number, number, number][] = [
      [cx - hx, cy - hy, cz - hz],
      [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz],
      [cx - hx, cy + hy, cz - hz],
      [cx - hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy + hy, cz + hz],
      [cx - hx, cy + hy, cz + hz],
    ];

    if (rot !== 0) {
      corners = corners.map(p => this.rotateY(p, rot, o.center));
    }

    // 12 edges of a box
    const edges = [
      [0,1],[1,2],[2,3],[3,0], // front
      [4,5],[5,6],[6,7],[7,4], // back
      [0,4],[1,5],[2,6],[3,7], // connecting
    ];
    for (const [a, b] of edges) {
      this.pushLine(verts, colors, corners[a], corners[b], o.color);
    }
  }

  private buildCircle(o: OverlayCircle, verts: number[], colors: number[]) {
    const segs = o.segments ?? 32;
    const axis = o.axis ?? "y";
    const [cx, cy, cz] = o.center;

    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;

      let p1: [number, number, number], p2: [number, number, number];
      if (axis === "y") {
        p1 = [cx + Math.cos(a1) * o.radius, cy, cz + Math.sin(a1) * o.radius];
        p2 = [cx + Math.cos(a2) * o.radius, cy, cz + Math.sin(a2) * o.radius];
      } else if (axis === "x") {
        p1 = [cx, cy + Math.cos(a1) * o.radius, cz + Math.sin(a1) * o.radius];
        p2 = [cx, cy + Math.cos(a2) * o.radius, cz + Math.sin(a2) * o.radius];
      } else {
        p1 = [cx + Math.cos(a1) * o.radius, cy + Math.sin(a1) * o.radius, cz];
        p2 = [cx + Math.cos(a2) * o.radius, cy + Math.sin(a2) * o.radius, cz];
      }
      this.pushLine(verts, colors, p1, p2, o.color);
    }
  }

  private buildPoint(o: OverlayPoint, verts: number[], colors: number[]) {
    const s = (o.size ?? 0.1) / 2;
    const [x, y, z] = o.position;
    // 3-axis cross
    this.pushLine(verts, colors, [x - s, y, z], [x + s, y, z], o.color);
    this.pushLine(verts, colors, [x, y - s, z], [x, y + s, z], o.color);
    this.pushLine(verts, colors, [x, y, z - s], [x, y, z + s], o.color);
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(`Overlay shader error: ${gl.getShaderInfoLog(s)}`);
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, OVERLAY_VERT);
    const fs = compile(gl.FRAGMENT_SHADER, OVERLAY_FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Overlay program link error: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[j * 4 + i] =
        a[0 * 4 + i] * b[j * 4 + 0] +
        a[1 * 4 + i] * b[j * 4 + 1] +
        a[2 * 4 + i] * b[j * 4 + 2] +
        a[3 * 4 + i] * b[j * 4 + 3];
    }
  }
  return out;
}
