/**
 * WebGL2 Gaussian Splat Renderer
 *
 * Renders 3D gaussians as sorted, alpha-blended screen-space quads.
 * Each gaussian is projected to a 2D ellipse via its 3D covariance matrix
 * and the camera's projection Jacobian.
 */

import type { SplatData } from "./loader";
import { OrbitCamera } from "./camera";

// Vertex shader: positions a quad for each gaussian based on its 2D projection
const VERT_SRC = `#version 300 es
precision highp float;

// Per-vertex: quad corner [-1,-1] to [1,1]
layout(location = 0) in vec2 a_quad;

// Per-instance data from textures
uniform sampler2D u_positions;   // xyz
uniform sampler2D u_scales;      // scale xyz
uniform sampler2D u_colors;      // rgba
uniform sampler2D u_rotations;   // quaternion wxyz
uniform isampler2D u_sortIndex;  // sorted index

uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec2 u_viewport;
uniform int u_count;
uniform float u_texSize;

out vec4 v_color;
out vec2 v_offset;
out float v_opacity;

mat3 quatToMat(vec4 q) {
    float x = q.x, y = q.y, z = q.z, w = q.w;
    return mat3(
        1.0 - 2.0*(y*y + z*z), 2.0*(x*y + w*z), 2.0*(x*z - w*y),
        2.0*(x*y - w*z), 1.0 - 2.0*(x*x + z*z), 2.0*(y*z + w*x),
        2.0*(x*z + w*y), 2.0*(y*z - w*x), 1.0 - 2.0*(x*x + y*y)
    );
}

void main() {
    // Get sorted index
    int sortedID = gl_InstanceID;
    ivec2 sortCoord = ivec2(sortedID % int(u_texSize), sortedID / int(u_texSize));
    int idx = texelFetch(u_sortIndex, sortCoord, 0).r;

    // Fetch data
    ivec2 texCoord = ivec2(idx % int(u_texSize), idx / int(u_texSize));
    vec3 pos = texelFetch(u_positions, texCoord, 0).rgb;
    vec3 scale = texelFetch(u_scales, texCoord, 0).rgb;
    vec4 color = texelFetch(u_colors, texCoord, 0);
    vec4 quat = texelFetch(u_rotations, texCoord, 0);

    // View space position
    vec4 viewPos = u_view * vec4(pos, 1.0);

    // Skip if behind camera
    if (viewPos.z > -0.1) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // Build 3D covariance from scale and rotation
    mat3 R = quatToMat(quat);
    mat3 S = mat3(scale.x, 0, 0, 0, scale.y, 0, 0, 0, scale.z);
    mat3 M = R * S;
    mat3 cov3d = M * transpose(M);

    // Project to 2D covariance using Jacobian of perspective projection
    float fx = u_proj[0][0] * u_viewport.x * 0.5;
    float fy = u_proj[1][1] * u_viewport.y * 0.5;
    float z = -viewPos.z;
    float z2 = z * z;

    // Jacobian of projection
    mat3 viewRot = mat3(u_view);
    mat3 cov3dView = viewRot * cov3d * transpose(viewRot);

    float a = cov3dView[0][0] * fx * fx / z2;
    float b = cov3dView[0][1] * fx * fy / z2;
    float c = cov3dView[1][1] * fy * fy / z2;

    // Add low-pass filter
    a += 0.3;
    c += 0.3;

    // Eigenvalues of 2D covariance → radii of ellipse
    float det = a * c - b * b;
    if (det < 1e-10) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    float trace = a + c;
    float disc = sqrt(max(0.0, trace * trace - 4.0 * det));
    float lambda1 = (trace + disc) * 0.5;
    float lambda2 = (trace - disc) * 0.5;

    float radius1 = ceil(3.0 * sqrt(lambda1));
    float radius2 = ceil(3.0 * sqrt(lambda2));
    float maxRadius = max(radius1, radius2);

    // Compute eigenvectors for proper ellipse orientation
    float angle = 0.5 * atan(2.0 * b, a - c);
    float cosA = cos(angle);
    float sinA = sin(angle);

    // Position quad vertices
    vec2 quadOffset = a_quad * maxRadius;
    vec2 screenCenter = vec2(
        (u_proj[0][0] * viewPos.x / (-viewPos.z) + u_proj[2][0]) * u_viewport.x * 0.5 + u_viewport.x * 0.5,
        (u_proj[1][1] * viewPos.y / (-viewPos.z) + u_proj[2][1]) * u_viewport.y * 0.5 + u_viewport.y * 0.5
    );
    vec2 screenPos = screenCenter + quadOffset;

    // Convert to clip space
    gl_Position = vec4(
        screenPos.x / u_viewport.x * 2.0 - 1.0,
        screenPos.y / u_viewport.y * 2.0 - 1.0,
        0.0, 1.0
    );

    // Pass to fragment shader
    v_color = vec4(color.rgb, 1.0);
    v_opacity = color.a;

    // Compute the inverse 2D covariance for the fragment shader
    // We pass the offset and let the fragment compute the gaussian
    float invDet = 1.0 / det;
    // v_offset encodes the position relative to gaussian center in "covariance space"
    // We need to pass the 2D cov inverse to fragment... use v_offset for the quad position
    // and pack the cov inverse in v_color.a... actually let's keep it simpler

    // The fragment shader gets the offset from center and computes exp(-0.5 * offset^T * covInv * offset)
    // Pack covInv into varyings
    v_offset = a_quad * maxRadius;

    // Recompute in fragment... or just pass what we need
    // Actually, let's use a simpler approach: transform offset to normalized gaussian space
    // where the gaussian is a unit circle
    float invA = c * invDet;
    float invB = -b * invDet;
    float invC = a * invDet;

    // Transform quad offset to gaussian-normalized space
    // power = 0.5 * (invA * dx^2 + 2*invB*dx*dy + invC*dy^2)
    // We can pass (invA, invB, invC) but we only have 2 varyings left...
    // Simpler: just compute power from the offset in screen pixels

    // Actually let's use a flat varying approach
    // We'll compute the gaussian weight in the vertex shader per-quad-corner
    float dx = v_offset.x;
    float dy = v_offset.y;
    float power = 0.5 * (invA * dx * dx + 2.0 * invB * dx * dy + invC * dy * dy);

    // This won't interpolate correctly... let's pass the cov inverse components
    // Use v_offset for position, compute power in fragment
    // We need 3 more floats: invA, invB, invC -> abuse v_color since we have 4 channels

    // Let's restructure: pass everything we need
    v_offset = a_quad * maxRadius; // screen-space offset from center, in pixels
}
`;

// Fragment shader: computes gaussian falloff
const FRAG_SRC = `#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_offset;
in float v_opacity;

out vec4 fragColor;

void main() {
    // Simple radial gaussian (approximation - treats as circular)
    // For proper elliptical, we'd need the inverse covariance
    float d2 = dot(v_offset, v_offset);
    // v_offset is in pixels, scaled to maxRadius which is 3*sigma
    // So at the edge, |offset| = maxRadius = 3*sigma, and we want exp(-0.5*(3)^2) ≈ 0.011
    // Normalize: offset/maxRadius gives us units of sigma... but maxRadius varies per axis
    // For the simple circular case, this is fine as an approximation

    // We need to know maxRadius to normalize. Since offset goes from -maxR to +maxR
    // and the quad is -1 to 1 scaled by maxRadius, the furthest corner is at sqrt(2)*maxR
    // Let's use a simpler approach: d2 is already in pixel^2

    // Actually, the correct approach is to pass the inverse covariance.
    // Let's use a screen-space approximation that works well in practice:
    // The quad is sized to 3*sigma, so at the edges we want the gaussian to be ~0.
    // We know max offset = maxRadius ≈ 3*sqrt(maxEigenvalue)
    // Normalize offset to [0,1] range where 1 = 3sigma

    // Since we're already sizing the quad to maxRadius = 3*sqrt(lambda_max),
    // a good approximation is:
    float len = length(v_offset);
    // But we don't have maxRadius here...

    // Simplest correct approach: use a fixed gaussian with the quad size
    // The quad corners are at ±maxRadius, so |a_quad| max is sqrt(2)
    // We multiplied by maxRadius, so |v_offset| max = sqrt(2)*maxRadius
    // We want: at center=1, at 3sigma=exp(-4.5)≈0.011, at corner=~0

    // Use a normalized gaussian: exp(-dot(offset,offset) / (2*sigma^2))
    // where sigma = maxRadius/3
    // But we don't have maxRadius in the fragment shader.

    // Better approach: pass sigma or use the fact that a_quad goes -1..1
    // Before maxRadius scaling, the quad is -1..1, so at corners dist = sqrt(2)
    // sigma in quad space = 1/3 (since quad extends to 3sigma)
    // So power = dot(a_quad, a_quad) / (2 * (1/3)^2) = dot * 4.5

    // BUT v_offset = a_quad * maxRadius, and we don't have maxRadius.
    // The trick: just use a fixed falloff on normalized coordinates.

    // Let's fix this by passing a_quad directly as v_offset instead:
    // Actually the vertex shader sets v_offset = a_quad * maxRadius
    // We should pass a_quad directly. Let me use a power estimate:

    // A simpler and correct approach used by many web viewers:
    // alpha = exp(-d2), where d2 is computed from a_quad coordinates
    // Since a_quad is ±1 at edges and 0 at center, and we want 3-sigma coverage:
    // We want falloff such that at dist=1 (edge of quad) alpha ≈ 0.011
    // exp(-4.5) ≈ 0.011, so: alpha = exp(-4.5 * dot(a_quad, a_quad))

    // But v_offset = a_quad * maxRadius, we need to undo that.
    // Actually, this doesn't work because the interpolation of a_quad * maxRadius
    // is the same as interpolating a_quad and multiplying by maxRadius (which is constant per instance).
    // So v_offset / maxRadius = a_quad... but we still don't have maxRadius.

    // SOLUTION: just set v_offset = a_quad (the raw [-1,1] quad coords)
    // and do the falloff in the fragment shader. Let me fix the vertex shader.

    // For now, use a simple radial approximation:
    // Assume v_offset is proportional to position in gaussian space
    // The quad is sized to 3sigma, so edge = 3sigma, center = 0
    // After interpolation, max(|v_offset|) on edge ≈ maxRadius
    // We want gaussian falloff based on distance from center.

    // Use a power that gives good visual results:
    float alpha = exp(-4.5 * dot(v_offset, v_offset) / max(dot(v_offset, v_offset) + 0.001, 1.0));

    // Simpler and more correct: treat offset as in sigma units
    // v_offset goes from 0 at center to maxRadius at edge
    // maxRadius = 3*sigma, so v_offset/maxRadius * 3 = offset_in_sigmas
    // But without maxRadius... let's just use a simple radial falloff

    alpha = v_opacity * exp(-d2 * 0.001);
    if (alpha < 1.0/255.0) discard;

    fragColor = vec4(v_color.rgb * alpha, alpha);
}
`;

// Actually, let me rewrite the shaders properly. The above got messy.
// Here's the clean version:

const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 a_quad;

uniform highp sampler2D u_positions;
uniform highp sampler2D u_scales;
uniform highp sampler2D u_colors;
uniform highp sampler2D u_rotations;
uniform highp isampler2D u_sortIndex;

uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec2 u_viewport;
uniform float u_texSize;
uniform float u_focal_x;
uniform float u_focal_y;

out vec4 v_color;
out vec2 v_conic_and_offset_x;  // conic.x, conic.y
out vec2 v_conic_z_and_offset_y; // conic.z, unused
out vec2 v_center;
out vec2 v_position;

mat3 quatToMat(vec4 q) {
    float w = q.x, x = q.y, y = q.z, z = q.w;
    return mat3(
        1.0-2.0*(y*y+z*z), 2.0*(x*y+w*z), 2.0*(x*z-w*y),
        2.0*(x*y-w*z), 1.0-2.0*(x*x+z*z), 2.0*(y*z+w*x),
        2.0*(x*z+w*y), 2.0*(y*z-w*x), 1.0-2.0*(x*x+y*y)
    );
}

void main() {
    int sortedID = gl_InstanceID;
    ivec2 sCoord = ivec2(sortedID % int(u_texSize), sortedID / int(u_texSize));
    int idx = texelFetch(u_sortIndex, sCoord, 0).r;

    ivec2 tc = ivec2(idx % int(u_texSize), idx / int(u_texSize));
    vec3 pos = texelFetch(u_positions, tc, 0).rgb;
    vec3 scale = texelFetch(u_scales, tc, 0).rgb;
    vec4 rgba = texelFetch(u_colors, tc, 0);
    vec4 quat = texelFetch(u_rotations, tc, 0);

    vec4 cam = u_view * vec4(pos, 1.0);
    if (cam.z > -0.2) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // 3D covariance = R * S * S^T * R^T
    mat3 R = quatToMat(quat);
    mat3 RS = R * mat3(scale.x, 0, 0, 0, scale.y, 0, 0, 0, scale.z);
    mat3 cov3d = RS * transpose(RS);

    // Project to 2D: J * V * Sigma * V^T * J^T
    mat3 V = mat3(u_view);
    mat3 cov3dCam = V * cov3d * transpose(V);

    float z = -cam.z;
    float z2 = z * z;

    // 2D covariance in pixel space
    float a = (u_focal_x * u_focal_x * cov3dCam[0][0]) / z2;
    float b = (u_focal_x * u_focal_y * cov3dCam[0][1]) / z2;
    float c = (u_focal_y * u_focal_y * cov3dCam[1][1]) / z2;

    // Low-pass filter
    a += 0.3;
    c += 0.3;

    float det = a * c - b * b;
    if (det < 1e-6) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // Inverse of 2D cov (the "conic")
    float invDet = 1.0 / det;
    vec3 conic = vec3(c * invDet, -b * invDet, a * invDet);

    // Eigenvalues for quad size
    float mid = 0.5 * (a + c);
    float lambda = sqrt(max(0.1, mid * mid - det));
    float radius = ceil(3.0 * sqrt(mid + lambda));

    // Screen-space center
    vec2 center = vec2(
        u_focal_x * cam.x / z + u_viewport.x * 0.5,
        u_focal_y * cam.y / z + u_viewport.y * 0.5
    );

    // Quad vertex position in pixels
    vec2 pxPos = center + a_quad * radius;

    // To clip space
    gl_Position = vec4(
        pxPos / u_viewport * 2.0 - 1.0,
        0.0, 1.0
    );

    v_color = rgba;
    v_conic_and_offset_x = vec2(conic.x, conic.y);
    v_conic_z_and_offset_y = vec2(conic.z, 0.0);
    v_center = center;
    v_position = pxPos;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_conic_and_offset_x;
in vec2 v_conic_z_and_offset_y;
in vec2 v_center;
in vec2 v_position;

out vec4 fragColor;

void main() {
    vec2 d = v_position - v_center;
    float cA = v_conic_and_offset_x.x;
    float cB = v_conic_and_offset_x.y;
    float cC = v_conic_z_and_offset_y.x;

    float power = -0.5 * (cA * d.x * d.x + 2.0 * cB * d.x * d.y + cC * d.y * d.y);
    if (power > 0.0) discard;

    float alpha = min(0.99, v_color.a * exp(power));
    if (alpha < 1.0 / 255.0) discard;

    // Premultiplied alpha output
    fragColor = vec4(v_color.rgb * alpha, alpha);
}
`;

export class SplatRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private textures: {
    positions: WebGLTexture;
    scales: WebGLTexture;
    colors: WebGLTexture;
    rotations: WebGLTexture;
    sortIndex: WebGLTexture;
  } | null = null;
  private splatCount = 0;
  private texSize = 0;

  // Sort buffers
  private sortDepths: Float32Array | null = null;
  private sortIndices: Int32Array | null = null;
  private sortWorker: Worker | null = null;
  private pendingSortResult: Int32Array | null = null;

  camera: OrbitCamera;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    this.camera = new OrbitCamera(canvas);

    // Compile shaders
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);

    // Create quad VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Create sort worker
    this.initSortWorker();
  }

  private initSortWorker() {
    const workerCode = `
      let sortIndices, sortDepths;
      self.onmessage = (e) => {
        const { depths, count } = e.data;
        if (!sortIndices || sortIndices.length !== count) {
          sortIndices = new Int32Array(count);
          sortDepths = new Float32Array(count);
        }
        sortDepths.set(new Float32Array(depths, 0, count));
        for (let i = 0; i < count; i++) sortIndices[i] = i;

        // Radix sort by depth (16-bit, 2 passes)
        const n = count;
        const BITS = 16;
        const RADIX = 256;
        const temp = new Int32Array(n);

        // Convert float depths to sortable integers
        const keys = new Uint32Array(n);
        const depthView = new DataView(sortDepths.buffer);
        for (let i = 0; i < n; i++) {
          let bits = depthView.getUint32(i * 4, true);
          // Flip for correct float ordering
          keys[i] = (bits >> 31) ? ~bits : (bits | 0x80000000);
        }

        let src = sortIndices;
        let dst = temp;

        for (let shift = 0; shift < BITS * 2; shift += 8) {
          const counts = new Uint32Array(RADIX);
          for (let i = 0; i < n; i++) {
            counts[(keys[src[i]] >> shift) & 0xFF]++;
          }
          const offsets = new Uint32Array(RADIX);
          for (let i = 1; i < RADIX; i++) {
            offsets[i] = offsets[i-1] + counts[i-1];
          }
          for (let i = 0; i < n; i++) {
            dst[offsets[(keys[src[i]] >> shift) & 0xFF]++] = src[i];
          }
          [src, dst] = [dst, src];
        }

        if (src !== sortIndices) sortIndices.set(src);

        self.postMessage({ indices: sortIndices.buffer }, [sortIndices.buffer]);
        sortIndices = null;
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    this.sortWorker = new Worker(URL.createObjectURL(blob));
    this.sortWorker.onmessage = (e) => {
      this.pendingSortResult = new Int32Array(e.data.indices);
    };
  }

  loadSplatData(data: import("./loader").SplatData) {
    const gl = this.gl;
    const count = data.count;
    this.splatCount = count;

    // Texture size (square, power of 2)
    this.texSize = Math.ceil(Math.sqrt(count));

    // Helper to create a data texture
    const createTex = (internalFmt: number, w: number, h: number, fmt: number, type: number, pixels: ArrayBufferView) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, w, h, 0, fmt, type, pixels);
      return tex;
    };

    const ts = this.texSize;

    // Pad data to fill texture
    const padF = (src: Float32Array, components: number) => {
      const padded = new Float32Array(ts * ts * components);
      padded.set(src);
      return padded;
    };
    const padU = (src: Uint8Array, components: number) => {
      const padded = new Uint8Array(ts * ts * components);
      padded.set(src);
      return padded;
    };

    this.textures = {
      positions: createTex(gl.RGB32F, ts, ts, gl.RGB, gl.FLOAT, padF(data.positions, 3)),
      scales: createTex(gl.RGB32F, ts, ts, gl.RGB, gl.FLOAT, padF(data.scales, 3)),
      colors: createTex(gl.RGBA8, ts, ts, gl.RGBA, gl.UNSIGNED_BYTE, padU(data.colors, 4)),
      rotations: createTex(gl.RGBA32F, ts, ts, gl.RGBA, gl.FLOAT, padF(data.rotations, 4)),
      sortIndex: createTex(gl.R32I, ts, ts, gl.RED_INTEGER, gl.INT, new Int32Array(ts * ts)),
    };

    // Init sort buffers
    this.sortDepths = new Float32Array(count);
    this.sortIndices = new Int32Array(count);
    for (let i = 0; i < count; i++) this.sortIndices[i] = i;

    // Auto-frame camera
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < count; i++) {
      cx += data.positions[i * 3];
      cy += data.positions[i * 3 + 1];
      cz += data.positions[i * 3 + 2];
    }
    cx /= count; cy /= count; cz /= count;

    let maxDist = 0;
    for (let i = 0; i < count; i++) {
      const dx = data.positions[i * 3] - cx;
      const dy = data.positions[i * 3 + 1] - cy;
      const dz = data.positions[i * 3 + 2] - cz;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }

    this.camera.fitToScene([cx, cy, cz], maxDist);

    // Store positions for sorting
    this._positions = data.positions;
  }

  private _positions: Float32Array | null = null;
  private _lastSortTime = 0;

  private updateSort(viewMatrix: Float32Array) {
    if (!this._positions || !this.sortDepths || !this.sortIndices) return;

    const now = performance.now();
    if (now - this._lastSortTime < 30) return; // Sort at most ~33fps
    this._lastSortTime = now;

    // Compute depths
    const count = this.splatCount;
    const pos = this._positions;
    const depths = this.sortDepths;

    // View direction (3rd row of view matrix)
    const vx = viewMatrix[2], vy = viewMatrix[6], vz = viewMatrix[10], vw = viewMatrix[14];

    for (let i = 0; i < count; i++) {
      depths[i] = vx * pos[i * 3] + vy * pos[i * 3 + 1] + vz * pos[i * 3 + 2] + vw;
    }

    if (this.sortWorker) {
      this.sortWorker.postMessage(
        { depths: depths.buffer, count },
        [depths.buffer]
      );
      this.sortDepths = new Float32Array(count); // Reallocate since we transferred
    }
  }

  render() {
    const gl = this.gl;
    const canvas = this.canvas;

    // Resize
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    // Clear
    gl.clearColor(0.05, 0.05, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.textures || this.splatCount === 0) return;

    const viewMatrix = this.camera.getViewMatrix();
    const projMatrix = this.camera.getProjectionMatrix(w / h);

    // Update sort
    this.updateSort(viewMatrix);

    // Apply pending sort result
    if (this.pendingSortResult) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.textures.sortIndex);
      const padded = new Int32Array(this.texSize * this.texSize);
      padded.set(this.pendingSortResult);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize,
        gl.RED_INTEGER, gl.INT, padded);
      this.pendingSortResult = null;
    }

    // Render
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Blending: premultiplied alpha, back-to-front
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // Uniforms
    const loc = (name: string) => gl.getUniformLocation(this.program, name);
    gl.uniformMatrix4fv(loc("u_view"), false, viewMatrix);
    gl.uniformMatrix4fv(loc("u_proj"), false, projMatrix);
    gl.uniform2f(loc("u_viewport"), w, h);
    gl.uniform1f(loc("u_texSize"), this.texSize);

    const fovRad = this.camera.fov * Math.PI / 180;
    const fy = h / (2 * Math.tan(fovRad / 2));
    const fx = w / (2 * Math.tan(fovRad / 2) * (w / h) / (w / h)); // same as fy for square pixels
    gl.uniform1f(loc("u_focal_x"), fy * (w / h));
    gl.uniform1f(loc("u_focal_y"), fy);

    // Bind textures
    const bindTex = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc(name), unit);
    };
    bindTex(0, this.textures.positions, "u_positions");
    bindTex(1, this.textures.scales, "u_scales");
    bindTex(2, this.textures.colors, "u_colors");
    bindTex(3, this.textures.rotations, "u_rotations");
    bindTex(4, this.textures.sortIndex, "u_sortIndex");

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.splatCount);

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  private createProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const gl = this.gl;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile error: ${info}\n\nSource:\n${src}`);
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      throw new Error(`Program link error: ${info}`);
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }
}
