'use strict';

// One source grid cell per voxel. No spatial interpolation or stride sampling.
// The DDA visits each intersected cell exactly once, compositing front-to-back.
const VOXEL_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const VOXEL_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler3D volume;
uniform sampler2D palette;
uniform ivec3 dimensions;
uniform int paletteSize;
uniform vec3 boundsMin, boundsMax, viewRight, viewUp, viewFront;
uniform float screenScale, colorMin, colorMax;
uniform vec2 viewportSize;
out vec4 pixel;
vec3 voxelColor(float value) {
  float t = clamp((value-colorMin)/(colorMax-colorMin),0.0,1.0)*float(paletteSize-1);
  int i = min(int(floor(t)),paletteSize-2);
  return mix(texelFetch(palette,ivec2(i,0),0).rgb,texelFetch(palette,ivec2(i+1,0),0).rgb,t-float(i));
}
void main() {
  vec3 size = boundsMax-boundsMin;
  vec3 center = (boundsMin+boundsMax)*0.5;
  vec2 logicalPixel = gl_FragCoord.xy / viewportSize * vec2(720.0,650.0);
  vec3 origin = center + viewRight*(logicalPixel.x-360.0)/screenScale
    + viewUp*(logicalPixel.y-340.0)/screenScale + viewFront*(length(size)+1.0);
  vec3 direction = -viewFront;
  vec3 inv = vec3(1.0)/mix(direction,vec3(1e-20),lessThan(abs(direction),vec3(1e-20)));
  vec3 a = (boundsMin-origin)*inv, b = (boundsMax-origin)*inv;
  vec3 nearT = min(a,b), farT = max(a,b);
  float entry = max(max(nearT.x,nearT.y),nearT.z);
  float leave = min(min(farT.x,farT.y),farT.z);
  if (entry >= leave || leave < 0.0) { pixel=vec4(0.0); return; }
  vec3 cellSize = size/vec3(dimensions);
  vec3 point = origin+direction*max(entry,0.0);
  vec3 grid = (point-boundsMin)/cellSize;
  // On a boundary a negative ray enters the cell just below that boundary.
  ivec3 cell = clamp(ivec3(floor(grid+sign(direction)*1e-4)),ivec3(0),dimensions-1);
  ivec3 stepCell = ivec3(sign(direction));
  vec3 nextEdge = boundsMin+(vec3(cell)+step(vec3(0.0),direction))*cellSize;
  vec3 nextT = (nextEdge-origin)*inv;
  vec3 deltaT = abs(cellSize*inv);
  float magnitude = max(abs(colorMin),abs(colorMax));
  vec4 accumulated = vec4(0.0);
  int limit = dimensions.x+dimensions.y+dimensions.z+3;
  for (int visit=0;visit<limit;visit++) {
    float value = texelFetch(volume,cell,0).r;
    float alpha = clamp(abs(value)/magnitude,0.0,1.0);
    float weight = (1.0-accumulated.a)*alpha;
    accumulated.rgb += voxelColor(value)*weight;
    accumulated.a += weight;
    if (accumulated.a >= 0.9999) break;
    float t = min(min(nextT.x,nextT.y),nextT.z);
    if (t >= leave) break;
    // Advance all tied axes; corner/edge touches do not add spurious voxels.
    bvec3 hit = lessThanEqual(nextT,vec3(t+max(1e-6,abs(t)*1e-6)));
    cell += ivec3(hit)*stepCell;
    nextT += vec3(hit)*deltaT;
    if (any(lessThan(cell,ivec3(0))) || any(greaterThanEqual(cell,dimensions))) break;
  }
  pixel = accumulated; // Premultiplied alpha, matching the WebGL canvas.
}`;
function voxelOpacity(value, lo, hi) {
  return Math.min(1, Math.abs(value) / Math.max(Math.abs(lo), Math.abs(hi)));
}
class VoxelRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720;
    this.canvas.height = 650;
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true
    });
    if (!gl) return new CanvasVoxelRenderer();
    this.backend = 'WebGL2';
    this.gl = gl;
    this.maxSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('体素着色器编译失败：' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VOXEL_VERTEX),
      fragment = compile(gl.FRAGMENT_SHADER, VOXEL_FRAGMENT);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw Error('体素着色器链接失败');
    this.texture = gl.createTexture();
    this.palette = gl.createTexture();
    this.data = null;
    this.paletteKey = null;
    this.canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = true;
    });
    this.locations = Object.fromEntries(['volume', 'palette', 'dimensions', 'paletteSize', 'boundsMin', 'boundsMax', 'viewRight', 'viewUp', 'viewFront', 'screenScale', 'viewportSize', 'colorMin', 'colorMax'].map(n => [n, gl.getUniformLocation(this.program, n)]));
  }
  checkDimensions(dimensions) {
    if (dimensions.some(n => n > this.maxSize)) throw Error(`体素单轴最多 ${this.maxSize} 格；请缩小显示范围`);
  }
  render(data, dimensions, bounds, basis, scale, colors, lo, hi, resolution = 1) {
    const width = Math.round(720 * resolution), height = Math.round(650 * resolution);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    const gl = this.gl,
      u = this.locations;
    if (this.lost || gl.isContextLost()) throw Error('体素图形上下文已丢失；请刷新网页后重新导入文件');
    this.checkDimensions(dimensions);
    gl.useProgram(this.program);
    gl.viewport(0, 0, width, height);
    gl.uniform2f(u.viewportSize, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    if (this.data !== data) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, ...dimensions, 0, gl.RED, gl.FLOAT, data);
      if (gl.getError() !== gl.NO_ERROR) throw Error('体素数据无法载入图形内存；请缩小显示范围');
      this.data = data;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    const key = JSON.stringify(colors);
    if (this.paletteKey !== key) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, colors.length, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(colors.flat()));
      this.paletteKey = key;
    }
    gl.uniform1i(u.volume, 0);
    gl.uniform1i(u.palette, 1);
    gl.uniform3iv(u.dimensions, dimensions);
    gl.uniform1i(u.paletteSize, colors.length);
    gl.uniform3fv(u.boundsMin, bounds[0]);
    gl.uniform3fv(u.boundsMax, bounds[1]);
    gl.uniform3fv(u.viewRight, basis[0]);
    gl.uniform3fv(u.viewUp, basis[1]);
    gl.uniform3fv(u.viewFront, basis[2]);
    gl.uniform1f(u.screenScale, scale);
    gl.uniform1f(u.colorMin, lo);
    gl.uniform1f(u.colorMax, hi);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}

// Same cell traversal in Canvas2D for browsers without WebGL2. This changes
// the rendering backend only: all selected cells and screen pixels are retained.
class CanvasVoxelRenderer {
  constructor() {
    this.backend = 'Canvas2D';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720;
    this.canvas.height = 650;
    this.context = this.canvas.getContext('2d');
  }
  checkDimensions(dimensions) {
    if (dimensions.some(n => !Number.isSafeInteger(n) || n < 1)) throw Error('无效体素尺寸');
  }
  render(data, dimensions, bounds, basis, scale, colors, lo, hi, resolution = 1) {
    const width = Math.round(720 * resolution), height = Math.round(650 * resolution);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    this.checkDimensions(dimensions);
    const key = JSON.stringify([colors, lo, hi]);
    if (this.data !== data || this.colorKey !== key) {
      this.rgba = new Float32Array(data.length * 4);
      for (let n = 0; n < data.length; n++) {
        const t = Math.max(0, Math.min(1, (data[n] - lo) / (hi - lo))) * (colors.length - 1);
        const i = Math.min(Math.floor(t), colors.length - 2),
          f = t - i;
        for (let c = 0; c < 3; c++) this.rgba[4 * n + c] = colors[i][c] + (colors[i + 1][c] - colors[i][c]) * f;
        this.rgba[4 * n + 3] = voxelOpacity(data[n], lo, hi);
      }
      this.data = data;
      this.colorKey = key;
    }
    const out = this.context.createImageData(width, height),
      pixels = out.data;
    const size = bounds[1].map((v, a) => v - bounds[0][a]),
      center = bounds[0].map((v, a) => v + size[a] / 2);
    const direction = basis[2].map(v => -v),
      distance = Math.hypot(...size) + 1;
    const cellSize = size.map((v, a) => v / dimensions[a]),
      step = direction.map(Math.sign);
    const inv = direction.map(v => Math.abs(v) < 1e-20 ? 1e20 : 1 / v),
      delta = cellSize.map((v, a) => Math.abs(v * inv[a]));
    const origin = [0, 0, 0],
      cell = [0, 0, 0],
      next = [0, 0, 0],
      limit = dimensions.reduce((a, b) => a + b, 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let entry = -Infinity,
        leave = Infinity;
      for (let a = 0; a < 3; a++) {
        origin[a] = center[a] + basis[0][a] * ((x + .5) * 720 / width - 360) / scale + basis[1][a] * (310 - (y + .5) * 650 / height) / scale + basis[2][a] * distance;
        const t0 = (bounds[0][a] - origin[a]) * inv[a],
          t1 = (bounds[1][a] - origin[a]) * inv[a];
        entry = Math.max(entry, Math.min(t0, t1));
        leave = Math.min(leave, Math.max(t0, t1));
      }
      if (entry >= leave || leave < 0) continue;
      for (let a = 0; a < 3; a++) {
        const grid = (origin[a] + direction[a] * Math.max(entry, 0) - bounds[0][a]) / cellSize[a];
        cell[a] = Math.max(0, Math.min(dimensions[a] - 1, Math.floor(grid + step[a] * 1e-4)));
        next[a] = (bounds[0][a] + (cell[a] + (direction[a] >= 0 ? 1 : 0)) * cellSize[a] - origin[a]) * inv[a];
      }
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0;
      for (let visit = 0; visit < limit; visit++) {
        const n = 4 * ((cell[2] * dimensions[1] + cell[1]) * dimensions[0] + cell[0]);
        const w = (1 - alpha) * this.rgba[n + 3];
        red += this.rgba[n] * w;
        green += this.rgba[n + 1] * w;
        blue += this.rgba[n + 2] * w;
        alpha += w;
        if (alpha >= .9999) break;
        const t = Math.min(...next);
        if (t >= leave) break;
        let outside = false;
        for (let a = 0; a < 3; a++) if (next[a] <= t + Math.max(1e-6, Math.abs(t) * 1e-6)) {
          cell[a] += step[a];
          next[a] += delta[a];
          if (cell[a] < 0 || cell[a] >= dimensions[a]) outside = true;
        }
        if (outside) break;
      }
      if (alpha > 0) {
        const n = 4 * (y * width + x);
        pixels[n] = red / alpha;
        pixels[n + 1] = green / alpha;
        pixels[n + 2] = blue / alpha;
        pixels[n + 3] = alpha * 255;
      }
    }
    this.context.putImageData(out, 0, 0);
    return this.canvas;
  }
}
