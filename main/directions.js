'use strict';

// Fixed source-coordinate direction colors. Magnitude and the camera never
// enter the color mapping. Colored polar caps converge continuously at ±z.
const DirectionColors = (() => {
  const tau = 2 * Math.PI;
  // Closed, custom cyclic palettes: the last control point interpolates back
  // to the first. The original planar rainbow remains unchanged.
  const presets = {
    rainbow: { label: '经典彩虹（原版）', colors: [] },
    soft: { label: '柔和彩虹', colors: [[227,139,156],[237,184,125],[202,212,133],[130,203,169],[127,196,216],[143,157,216],[186,143,207],[220,140,185]] },
    aurora: { label: '青紫橙环', colors: [[22,177,178],[60,127,205],[115,76,188],[193,67,155],[233,110,77],[244,187,77],[176,201,80],[54,178,125]] },
    ember: { label: '蓝红金环', colors: [[41,102,186],[102,76,168],[177,62,123],[221,77,70],[237,142,55],[236,196,96],[98,182,173],[49,144,192]] }
  };
  function equator(h, preset) {
    const colors = presets[preset].colors;
    if (!colors.length) return hueUnit(h);
    const t = ((h % 1 + 1) % 1) * colors.length, i = Math.floor(t), f = t - i;
    return colors[i].map((v, k) => (v + (colors[(i + 1) % colors.length][k] - v) * f) / 255);
  }
  function hueUnit(h) {
    h = (h % 1 + 1) % 1;
    return [0, 4, 2].map(offset => Math.max(0, Math.min(1, Math.abs((h * 6 + offset) % 6 - 3) - 1)));
  }
  function planar(x, vertical, preset = 'rainbow') {
    if (x === 0 && vertical === 0) return [128, 128, 128];
    const h = Math.atan2(vertical, x) / tau;
    return equator(h, preset).map(v => Math.round(v * 255));
  }
  function spatial(x, y, z, preset = 'rainbow') {
    const magnitude = Math.hypot(x, y, z);
    if (!magnitude) return [128, 128, 128];
    const nz = Math.max(-1, Math.min(1, z / magnitude));
    const h = Math.atan2(y, x) / tau, weight = Math.abs(nz);
    const pole = nz >= 0 ? [245, 149, 38] : [92, 61, 203];
    return equator(h, preset).map((v, k) => Math.round(255 * v * (1 - weight) + pole[k] * weight));
  }
  const glsl = `
uniform int directionColorCount;
uniform vec3 directionColors[8];
vec3 directionColor(vec3 v) {
  float magnitude=length(v);
  if(magnitude==0.)return vec3(.5);
  float z=clamp(v.z/magnitude,-1.,1.);
  float h=dot(v.xy,v.xy)>0.?atan(v.y,v.x)/6.283185307179586:0.;
  vec3 hue=clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);
  if(directionColorCount>0){
    float t=fract(h+1.)*float(directionColorCount);
    int i=min(int(floor(t)),directionColorCount-1);
    hue=mix(directionColors[i],directionColors[(i+1)%directionColorCount],t-float(i));
  }
  vec3 pole=z>=0.?vec3(245.,149.,38.)/255.:vec3(92.,61.,203.)/255.;
  return mix(hue,pole,abs(z));
}`;
  function label(g, value, x, y, size = 11) {
    g.font = size + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#273849'; g.fillText(value, x, y);
  }
  // Both legends use a 130 × 96 logical layout, also reused at export DPI.
  function wheel(g, vertical = 'y', preset = 'rainbow') {
    const x = 65, y = 46, r = 29;
    g.save();
    for (let i = 0; i < 360; i++) {
      const a = i * tau / 360, b = (i + 1.5) * tau / 360;
      g.beginPath(); g.arc(x, y, r, -b, -a); g.arc(x, y, r * .58, -a, -b, true); g.closePath();
      g.fillStyle = 'rgb(' + planar(Math.cos(a), Math.sin(a), preset) + ')'; g.fill();
    }
    label(g, '+x', x + r + 14, y); label(g, '−x', x - r - 14, y);
    label(g, '+' + vertical, x, y - r - 9); label(g, '−' + vertical, x, y + r + 9);
    label(g, '方向', x, y, 10);
    g.restore();
  }
  let sphereCache = null;
  function sphere(g, basis, resolution = 2, preset = 'rainbow') {
    // Rebuild only when the camera or output resolution changes. One small
    // legend texture, independent of the number of arrows or source cells.
    const pixels = Math.max(58, Math.ceil(58 * resolution));
    const key = JSON.stringify([basis, pixels, preset]);
    if (sphereCache?.key !== key) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = pixels;
      const ctx = canvas.getContext('2d'), data = ctx.createImageData(pixels, pixels);
      for (let j = 0; j < pixels; j++) for (let i = 0; i < pixels; i++) {
        const x = (i + .5) / pixels * 2 - 1, y = 1 - (j + .5) / pixels * 2;
        const radius = x * x + y * y;
        if (radius > 1) continue;
        const z = Math.sqrt(1 - radius);
        const rgb = spatial(...[0, 1, 2].map(k => x * basis[0][k] + y * basis[1][k] + z * basis[2][k]), preset);
        data.data.set([...rgb, 255], (j * pixels + i) * 4);
      }
      ctx.putImageData(data, 0, 0); sphereCache = { key, canvas };
    }
    g.save();
    g.drawImage(sphereCache.canvas, 36, 17, 58, 58);
    g.strokeStyle = '#6a7b8a'; g.lineWidth = .6; g.beginPath(); g.arc(65, 46, 29, 0, tau); g.stroke();
    // Front-facing signed axes label the hemisphere currently facing the user.
    for (let k = 0; k < 3; k++) {
      const sign = basis[2][k] >= 0 ? 1 : -1;
      const x = basis[0][k] * sign, y = basis[1][k] * sign, len = Math.hypot(x, y);
      if (len < .08) { label(g, (sign > 0 ? '+' : '−') + 'xyz'[k], 65, 46); continue; }
      const end = [65 + x / len * 39, 46 - y / len * 39];
      g.beginPath(); g.moveTo(65 + x * 29, 46 - y * 29); g.lineTo(...end); g.stroke();
      label(g, (sign > 0 ? '+' : '−') + 'xyz'[k], end[0], end[1]);
    }
    g.restore();
  }
  function preview(canvas, draw) {
    const ratio = Math.min(2, window.devicePixelRatio || 1), width = 130 * ratio, height = 96 * ratio;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const g = canvas.getContext('2d'); g.setTransform(ratio, 0, 0, ratio, 0, 0); g.clearRect(0, 0, 130, 96);
    draw(g, ratio);
  }
  return { presets, planar, spatial, glsl, wheel, sphere, preview };
})();
