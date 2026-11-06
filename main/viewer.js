'use strict';

const $ = id => document.getElementById(id),
  c2 = $('planar'),
  c3 = $('spatial');
let render3DEnabled = true;
let followLeftLayer = false;
let planarScaleBar = null;
let renderScale = 1,
  g2 = c2.getContext('2d'),
  g3 = c3.getContext('2d');
let sourceD = null;
let D = null,
  fields = {},
  A = null,
  cfg = null,
  plot = null,
  loadId = 0,
  layerStart = 0,
  layerEnd = 0,
  box = null;
const S = {
  az: -56 * Math.PI / 180,
  el: 46 * Math.PI / 180,
  zoom: 1
};
function status(s, error = false) {
  $('status').textContent = s;
  $('status').hidden = !s;
  $('status').className = error ? 'error' : '';
}
function assert(ok, msg) {
  if (!ok) throw Error(msg);
}
// File decoding and dataset initialization.
async function importFile(file) {
  const token = ++loadId;
  try {
    assert(file && file.size <= 128 * 1024 * 1024, '请选择不超过128 MiB的切片文件；较大数据请先缩小切片。');
    status('正在读取并核验 ' + file.name + ' …');
    $('drop').classList.add('loading');
    const buffer = await file.arrayBuffer();
    if (token !== loadId) return;
    const view = new DataView(buffer),
      dec = new TextDecoder('utf-8', {
        fatal: true
      });
    let d, parsed;
    if (buffer.byteLength < 8 || dec.decode(new Uint8Array(buffer, 0, 8)) !== 'BFOSLC1\n') {
      ({
        d,
        parsed
      } = parsePlaneText(dec.decode(buffer), file.name));
    } else {
      const size = view.getUint32(8, true);
      assert(size > 0 && size <= 1048576 && 12 + size <= buffer.byteLength, '切片头损坏');
      d = JSON.parse(dec.decode(new Uint8Array(buffer, 12, size)));
      assert(d.schema === 'bfo-vector-slice-v1', '不支持的切片版本');
      assert(Array.isArray(d.shape_zyxc) && d.shape_zyxc.length === 4 && d.shape_zyxc[3] === 3 && d.shape_zyxc.every(v => Number.isSafeInteger(v) && v > 0), '网格尺寸不正确');
      const count = d.shape_zyxc.reduce((a, b) => a * b, 1);
      assert(Number.isSafeInteger(count) && count <= 32000000, '网格过大');
      for (const key of ['origin_nm', 'spacing_nm']) assert(Array.isArray(d[key]) && d[key].length === 3 && d[key].every(Number.isFinite), '缺少有效坐标');
      assert(d.spacing_nm.every(v => v > 0), '步长必须为正');
      assert(Array.isArray(d.fields) && d.fields.length > 0 && d.fields.length <= 2, '场列表不正确');
      let offset = 0;
      parsed = {};
      for (const f of d.fields) {
        assert(['P', 'AFD'].includes(f.name) && !parsed[f.name], '场名称错误或重复');
        assert(['float32', 'float64'].includes(f.dtype), '精度不支持');
        const n = f.dtype === 'float32' ? 4 : 8;
        assert(f.offset === offset && f.bytes === count * n && 12 + size + offset + f.bytes <= buffer.byteLength, '场长度或偏移错误');
        const a = n === 4 ? new Float32Array(count) : new Float64Array(count);
        for (let i = 0; i < count; i++) {
          a[i] = n === 4 ? view.getFloat32(12 + size + offset + i * n, true) : view.getFloat64(12 + size + offset + i * n, true);
          assert(Number.isFinite(a[i]), '场中存在 NaN/Inf');
        }
        parsed[f.name] = a;
        offset += f.bytes;
      }
      assert(12 + size + offset === buffer.byteLength, '文件截断或含多余字节');
    }
    if (!d.text_plane) {
      const ranges = d.index_ranges_xyz;
      d.origin_nm = [0, 1, 2].map(axis => .5 + (Array.isArray(ranges?.[axis]) && Number.isSafeInteger(ranges[axis][0]) ? ranges[axis][0] : 0));
      d.spacing_nm = [1, 1, 1];
    }
    cancelPendingInteractions();
    stopSpatial();
    workspaceHistory.reset();
    followLeftLayer = false;
    clearSample();
    planarScaleBar = null;
    meshCache = null;
    cubeCache = null;
    sourceD = d;
    D = d;
    fields = parsed;
    $('left-view').value = d.text_plane || 'XY';
    $('left-view').disabled = !!d.text_plane;
    $('mode3').value = 'arrows';
    $('mode3').disabled = false;
    $('box-mode-option').disabled = !!d.text_plane;
    $('voxel-component').value = '2';
    voxelCache = null;
    updateLabels();
    $('field').replaceChildren();
    for (const f of d.fields) {
      const op = new Option(f.name === 'P' ? d.text_plane ? '极化 P（源单位）' : '极化 P (C/m²)' : 'AFD Φ (rad)', f.name);
      $('field').add(op);
    }
    const nz = d.shape_zyxc[0],
      mid = Math.floor((nz - 1) / 2);
    $('plane').min = 0;
    $('plane').max = nz - 1;
    $('plane').value = mid;
    $('plane').disabled = nz === 1;
    layerStart = layerEnd = mid;
    box = null;
    syncLayers();
    $('controls').disabled = false;
    $('plane-controls').disabled = false;
    $('volume-controls').disabled = false;
    $('field-control').hidden = d.fields.length < 2;
    $('plane').hidden = !!d.text_plane;
    $('layer-track').hidden = !!d.text_plane;
    $('all').hidden = !!d.text_plane;
    $('one').hidden = !!d.text_plane;
    fullRange();
    $('stride-x').value = 4;
    $('stride-y').value = 4;
    $('stride-z').value = 2;
    changeField();
    $('file-name').textContent = file.name;
    $('file-name').title = file.name;
    $('drop').classList.add('loaded');
    resetWorkspaceHistory();
    status('');
  } catch (e) {
    if (token === loadId) status('导入失败：' + e.message + '。已加载的旧数据保持不变。', true);
  } finally {
    if (token === loadId) $('drop').classList.remove('loading');
  }
}
// XY/XZ text import.
function parsePlaneText(source, name) {
  const plane = name.split(/[\\/]/).pop().match(/^(XY|XZ)/i)?.[1].toUpperCase();
  assert(plane, '文本文件名必须以 XY 或 XZ 开头');
  const rows = [];
  for (const [index, line] of source.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(/\s+/);
    assert(parts.length === 5, `第${index + 1}行必须有5列`);
    const row = parts.map(x => Number(x.replace(/[dD]/g, 'e')));
    assert(row.every(Number.isFinite), `第${index + 1}行含无效数值`);
    rows.push(row);
  }
  assert(rows.length > 0, '文本没有数据点');
  assert(rows.length * 3 <= 32000000, '网格过大');
  const xs = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b),
    ys = [...new Set(rows.map(r => r[1]))].sort((a, b) => a - b);
  function step(values) {
    if (values.length === 1) return 1;
    const h = values[1] - values[0];
    assert(h > 0 && Number.isFinite(h), '坐标间隔无效');
    assert(values.every((v, i) => Math.abs(v - (values[0] + i * h)) <= Math.max(1e-9, h * 1e-6)), '目前支持完整等间距矩形网格；坐标间隔不一致');
    return h;
  }
  const dx = step(xs),
    dy = step(ys);
  assert(xs.length * ys.length === rows.length, '切面网格不完整或含重复点');
  const a = new Float64Array(rows.length * 3),
    seen = new Set(),
    xi = new Map(xs.map((v, i) => [v, i])),
    yi = new Map(ys.map((v, i) => [v, i]));
  for (const r of rows) {
    const t = yi.get(r[1]) * xs.length + xi.get(r[0]);
    assert(!seen.has(t), '存在重复坐标点');
    seen.add(t);
    a.set(r.slice(2), t * 3);
  }
  return {
    d: {
      title: name,
      text_plane: plane,
      shape_zyxc: [1, ys.length, xs.length, 3],
      origin_nm: [xs[0] - dx / 2, ys[0] - dy / 2, -.5],
      spacing_nm: [dx, dy, 1],
      fields: [{
        name: 'P'
      }],
      coordinates: `${plane} 单切面；坐标及 P 单位沿用源文件；未提供的法向坐标置0，仅用于展示`
    },
    parsed: {
      P: a
    }
  };
}
// View axes and coordinate labels.
function planeName() {
  return D?.text_plane || $('left-view').value || 'XY';
}
function normalAxis() {
  return planeName() === 'XZ' ? 'y' : 'z';
}
function verticalAxis() {
  return planeName() === 'XZ' ? 'z' : 'y';
}
const COORDINATE_UNIT = '格点';
// Map view-local axes (x,z,y for XZ) back to source axes; no length conversion.
function sourceAxes(v) {
  return planeName() === 'XZ' ? [v[0], v[2], v[1]] : v;
}
function updateLabels() {
  $('x-label').textContent = `x 范围（${COORDINATE_UNIT}，含两端）`;
  $('y-label').textContent = `${verticalAxis()} 范围（${COORDINATE_UNIT}，含两端）`;
  $('vertical-range').style.order = planeName() === 'XZ' ? 2 : 1;
  $('normal-range').style.order = planeName() === 'XZ' ? 1 : 2;
  $('normal-label').textContent = D?.text_plane ? `${normalAxis()} 范围（文件未提供）` : `${normalAxis()} 范围（格点，三维选层）`;
  for (const suffix of ['min', 'max']) {
    $('n' + suffix).disabled = !!D?.text_plane;
    $('n' + suffix).setAttribute('aria-label', normalAxis() + (suffix === 'min' ? '下限' : '上限'));
  }
  $('ymin').setAttribute('aria-label', verticalAxis() + '下限');
  $('ymax').setAttribute('aria-label', verticalAxis() + '上限');
  $('planar-title').textContent = '平面图 / ' + planeName();
  $('scale-label').textContent = `箭头长度（${COORDINATE_UNIT} / 单位场）`;
  c2.setAttribute('aria-label', planeName() + '原始格点平面图');
  $('plane').setAttribute('aria-label', '左图 ' + planeName() + ' 层');
}

// origin_nm/spacing_nm are legacy schema names; D holds grid display coordinates.
function coord(axis, i) {
  return D.origin_nm[axis] + (i + .5) * D.spacing_nm[axis];
}
function fullRange() {
  if (!D) return;
  for (const [axis, n] of [[0, D.shape_zyxc[2]], [1, D.shape_zyxc[1]]]) {
    const name = axis ? 'y' : 'x';
    $(name + 'min').value = coord(axis, 0);
    $(name + 'max').value = coord(axis, n - 1);
  }
}
function changeField() {
  syncField();
  $('scale').value = $('field').value === 'P' ? 2.5 : 8;
  autoColor();
  apply();
}
function syncField() {
  A = fields[$('field').value];
  for (let c = 0; c < 3; c++) {
    const option = $('voxel-component').options?.[c];
    if (option) option.textContent = ($('field').value === 'P' ? 'p' : 'Φ') + ['x', 'y', 'z'][c];
  }
}
function autoColor() {
  if (!A) return;
  let m = 0;
  const component = $('mode3').value === 'voxels' ? Number($('voxel-component').value) : 2;
  for (let i = component; i < A.length; i += 3) m = Math.max(m, Math.abs(A[i]));
  m = Math.max(.1, Math.ceil(m * 10) / 10);
  $('cmin').value = (-m).toFixed(1);
  $('cmax').value = m.toFixed(1);
}
function at(k, j, i, field = cfg.field) {
  const t = (!D.text_plane && planeName() === 'XZ' ? (j * sourceD.shape_zyxc[1] + k) * sourceD.shape_zyxc[2] + i : (k * D.shape_zyxc[1] + j) * D.shape_zyxc[2] + i) * 3,
    v = fields[field];
  return [v[t], v[t + 1], v[t + 2]];
}
// Validate a complete settings snapshot before rendering.
function apply() {
  if (!D) return;
  try {
    const q = {
      lo: Number($('cmin').value),
      hi: Number($('cmax').value),
      xmin: Number($('xmin').value),
      xmax: Number($('xmax').value),
      ymin: Number($('ymin').value),
      ymax: Number($('ymax').value),
      strideX: Number($('stride-x').value),
      strideY: Number($('stride-y').value),
      strideZ: Number($('stride-z').value),
      scale: Number($('scale').value),
      k: Number($('plane').value),
      headSize: Number($('head-size').value),
      shaftSize: Number($('shaft-size').value)
    };
    assert(['cmin', 'cmax', 'xmin', 'xmax', 'ymin', 'ymax', 'stride-x', 'stride-y', 'stride-z', 'scale'].every(id => $(id).value.trim() !== ''), '输入不能为空');
    assert(Object.values(q).every(Number.isFinite), '请输入有限数值');
    assert(q.lo < q.hi, '色标下限必须小于上限');
    assert([q.strideX, q.strideY, q.strideZ].every(v => Number.isSafeInteger(v) && v >= 1) && q.scale > 0, 'X/Y/Z 箭头间隔须为正整数、长度须为正数');
    q.planarColor = $('planar-color').value;
    q.spatialColor = $('spatial-color').value;
    q.directionPreset = $('direction-preset').value;
    assert(Object.hasOwn(DirectionColors.presets, q.directionPreset), '请选择有效的方向配色');
    q.heatmap = $('toggle-heatmap').value !== 'off';
    assert(['black', 'direction'].includes(q.planarColor) && ['component', 'direction'].includes(q.spatialColor), '请选择有效的箭头颜色模式');
    q.renderer = $('renderer').value;
    q.motion = $('motion-quality').value;
    assert(['auto', 'gpu', 'cpu'].includes(q.renderer), '请选择有效的渲染方式');
    assert(['adaptive', 'full'].includes(q.motion), '请选择有效的交互质量');
    q.palette = $('palette').value;
    q.colorLow = $('color-low').value;
    q.colorHigh = $('color-high').value;
    assert(q.palette === 'custom' || Object.hasOwn(PALETTES, q.palette), '请选择有效配色');
    assert([q.colorLow, q.colorHigh].every(v => /^#[0-9a-f]{6}$/i.test(v)), '请选择有效的双色端点');
    q.colors = q.palette === 'custom' ? [hexRGB(q.colorLow), hexRGB(q.colorHigh)] : PALETTES[q.palette];
    q.inputRanges = {
      xmin: q.xmin,
      xmax: q.xmax,
      ymin: q.ymin,
      ymax: q.ymax
    };
    for (const [axis, n] of [[0, D.shape_zyxc[2]], [1, D.shape_zyxc[1]]]) {
      const name = axis ? 'y' : 'x',
        lo = q[name + 'min'],
        hi = q[name + 'max'],
        o = coord(axis, 0),
        end = coord(axis, n - 1);
      assert(lo <= hi && lo >= o - 1e-8 && hi <= end + 1e-8, `${axis ? verticalAxis() : 'x'}范围须在 ${o}–${end} ${COORDINATE_UNIT} 内（含两端格点）`);
      const ids = [];
      for (let i = 0; i < n; i++) if (coord(axis, i) >= lo - 1e-10 && coord(axis, i) <= hi + 1e-10) ids.push(i);
      assert(ids.length, '所选范围没有格点');
      q[name + '0'] = ids[0];
      q[name + '1'] = ids.at(-1) + 1;
      {
        q[name + 'min'] = coord(axis, ids[0]) - D.spacing_nm[axis] / 2;
        q[name + 'max'] = coord(axis, ids.at(-1)) + D.spacing_nm[axis] / 2;
      }
    }

    // Local axes are x,y,z in XY view and x,z,y in XZ view.
    q.steps = planeName() === 'XZ' ? [q.strideX, q.strideZ, q.strideY] : [q.strideX, q.strideY, q.strideZ];
    const first = followLeftLayer ? q.k : layerStart,
      last = followLeftLayer ? q.k : layerEnd;
    q.layers = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    assert(q.layers.length, '请至少选择一层三维图');
    q.sampleLayers = q.layers.filter((_, i) => i % q.steps[2] === 0);
    const [nx, ny, nz] = [q.x1 - q.x0, q.y1 - q.y0, q.layers.length].map((n, a) => Math.ceil(n / q.steps[a]));
    const arrows = $('mode3').value === 'box' ? 2 * (nx * ny + nx * nz + ny * nz) : nx * ny * nz;
    assert(!render3DEnabled || $('mode3').value === 'voxels' || arrows <= MAX_ARROW_INSTANCES, `预计${arrows}支箭头；请增大间隔或减少层数（上限200万）`);
    assert(q.headSize >= .25 && q.headSize <= 2.5 && q.shaftSize >= .3 && q.shaftSize <= 5, '箭头外观设置超出范围');
    q.field = $('field').value;
    q.mode = $('mode3').value || 'arrows';
    q.component = Number($('voxel-component').value);
    $('renderer').disabled = $('motion-quality').disabled = q.mode === 'voxels';
    assert(['arrows', 'box', 'voxels'].includes(q.mode), '请选择有效三维模式');
    assert([0, 1, 2].includes(q.component), '请选择有效体素分量');
    if (render3DEnabled && q.mode === 'voxels') prepareVoxels(q);
    clearSample();
    cfg = q;
    layerStart = first;
    layerEnd = last;
    syncLayers();
    draw();
    status('');
    rememberWorkspace();
    return true;
  } catch (e) {
    status(e.message + '；图像保留上次有效设置。', true);
    return false;
  }
}
// Shared colors and canvas primitives.
function color(v) {
  const t = Math.max(0, Math.min(1, (v - cfg.lo) / (cfg.hi - cfg.lo))) * (cfg.colors.length - 1),
    i = Math.min(Math.floor(t), cfg.colors.length - 2),
    u = t - i,
    a = cfg.colors[i],
    b = cfg.colors[i + 1];
  return a.map((x, c) => Math.round(x + (b[c] - x) * u));
}
function syncColorbar() {
  $('colorbar').style.background = 'linear-gradient(to right,' + cfg.colors.map((rgb, i) => `rgb(${rgb}) ${i / (cfg.colors.length - 1) * 100}%`).join(',') + ')';
}
function text(g, s, x, y, align = 'left', size = 14) {
  g.fillStyle = '#273849';
  g.font = size + 'px system-ui';
  g.textAlign = align;
  g.fillText(s, x, y);
}
function line(g, points, color, width) {
  g.beginPath();
  points.forEach((p, i) => i ? g.lineTo(...p.slice(0, 2)) : g.moveTo(...p.slice(0, 2)));
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}
function arrow2(g, x, y, dx, dy, tint = '#17212a') {
  if (Math.hypot(dx, dy) < .02) return;
  const tx = x + dx / 2,
    ty = y + dy / 2,
    bx = tx - .28 * dx,
    by = ty - .28 * dy;
  line(g, [[x - dx / 2, y - dy / 2], [tx, ty]], tint, 1.3);
  line(g, [[bx - .12 * dy, by + .12 * dx], [tx, ty], [bx + .12 * dy, by - .12 * dx]], tint, 1.3);
}
function planarLayout(q = cfg) {
  const s = Math.min(550 / (q.xmax - q.xmin), 520 / (q.ymax - q.ymin)),
    w = (q.xmax - q.xmin) * s,
    h = (q.ymax - q.ymin) * s,
    left = 80 + (550 - w) / 2,
    top = 45 + (520 - h) / 2;
  return { s, w, h, left, top };
}
function scaleBarGeometry(value = planarScaleBar, layout = planarLayout()) {
  assert(value && [value.nmPerGrid, value.lengthNm].every(v => Number.isFinite(v) && v > 0), '两个数值都必须是大于 0 的有限数。');
  const width = value.lengthNm / value.nmPerGrid * layout.s, margin = 12, height = 8;
  assert(Number.isFinite(width) && width >= 1, '比例尺太短，请增大长度或缩小显示范围。');
  assert(width <= layout.w - 2 * margin, '比例尺超过当前图片宽度，请减小长度或扩大显示范围。');
  assert(layout.h >= 46, '当前图片高度不足以放置比例尺，请调整显示范围。');
  const label = `${value.lengthNm} nm`;
  g2.save(); g2.font = '13px system-ui'; const labelWidth = g2.measureText(label).width; g2.restore();
  assert(labelWidth <= layout.w - 8, '当前图片宽度不足以显示比例尺文字，请调整显示范围。');
  return { x: layout.left + layout.w - margin - width, y: layout.top + layout.h - margin - height, width, height, label };
}
function drawScaleBar(g, layout) {
  const bar = scaleBarGeometry(planarScaleBar, layout);
  g.save();
  g.fillStyle = '#ffffff'; g.strokeStyle = '#000000'; g.lineWidth = 1.3;
  g.fillRect(bar.x, bar.y, bar.width, bar.height); g.strokeRect(bar.x, bar.y, bar.width, bar.height);
  g.font = '13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  const labelWidth = g.measureText(bar.label).width;
  const x = Math.max(layout.left + labelWidth / 2 + 4, Math.min(layout.left + layout.w - labelWidth / 2 - 4, bar.x + bar.width / 2));
  g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = '#ffffff';
  g.strokeText(bar.label, x, bar.y - 5); g.fillStyle = '#000000'; g.fillText(bar.label, x, bar.y - 5);
  g.restore();
}
function syncScaleBar() {
  $('scale-bar-toggle').disabled = !cfg || exporting;
  $('scale-bar-toggle').setAttribute('aria-pressed', String(!!planarScaleBar));
  $('export-mode2').options[0].textContent = planarScaleBar ? '图片与比例尺' : '完整图片';
  let problem = '';
  if (cfg && planarScaleBar) try { scaleBarGeometry(); } catch (e) { problem = e.message; }
  $('scale-notice').hidden = !problem;
  $('scale-notice').textContent = problem;
  return !problem;
}
// Preview and export share the exact same heatmap/arrow drawing path.
function draw2({ annotations = true, scaleBar = true, exportMode = false } = {}) {
  if (box && !exportMode) { paintBox(); return; }
  const q = cfg, layout = planarLayout(q), { s, w, h, left, top } = layout;
  plot = layout;
  g2.clearRect(0, 0, 720, 650);
  g2.save();
  g2.beginPath();
  g2.rect(left, top, w, h);
  g2.clip();
  let clipped = 0;
  if (q.heatmap) for (let j = q.y0; j < q.y1; j++) for (let i = q.x0; i < q.x1; i++) {
    const p = at(q.k, j, i);
    if (p[2] < q.lo || p[2] > q.hi) clipped++;
    g2.fillStyle = 'rgb(' + color(p[2]) + ')';
    const x = D.origin_nm[0] + i * D.spacing_nm[0],
      y = D.origin_nm[1] + j * D.spacing_nm[1];
    g2.fillRect(left + (x - q.xmin) * s, top + h - (y + D.spacing_nm[1] - q.ymin) * s, D.spacing_nm[0] * s + .1, D.spacing_nm[1] * s + .1);
  }
  for (let j = q.y0; j < q.y1; j += q.steps[1]) for (let i = q.x0; i < q.x1; i += q.steps[0]) {
    const p = at(q.k, j, i);
    arrow2(g2, left + (coord(0, i) - q.xmin) * s, top + h - (coord(1, j) - q.ymin) * s, p[0] * q.scale * s, -p[planeName() === 'XZ' ? 2 : 1] * q.scale * s, q.planarColor === 'direction' ? 'rgb(' + DirectionColors.planar(p[0], p[planeName() === 'XZ' ? 2 : 1], q.directionPreset) + ')' : '#17212a');
  }
  g2.restore();
  if (annotations) {
    line(g2, [[left, top], [left, top + h], [left + w, top + h]], '#7a8997', 1);
    for (const t of [0, .5, 1]) {
      const x = coord(0, q.x0) + (coord(0, q.x1 - 1) - coord(0, q.x0)) * t,
        y = coord(1, q.y0) + (coord(1, q.y1 - 1) - coord(1, q.y0)) * t;
      text(g2, Number(x.toPrecision(7)).toString(), left + (x - q.xmin) * s, top + h + 24, 'center');
      text(g2, Number(y.toPrecision(7)).toString(), left - 8, top + h - (y - q.ymin) * s + 5, 'right');
    }
    text(g2, `x [${COORDINATE_UNIT}]`, left + w / 2, 625, 'center');
    text(g2, `${verticalAxis()} [${COORDINATE_UNIT}]`, 10, 30);
    text(g2, D.text_plane ? `${planeName()} 单切面` : `层 ${q.k + 1} · ${normalAxis()} = ${coord(2, q.k).toPrecision(6)} 格点`, 360, 22, 'center');
  }
  if (scaleBar && planarScaleBar) {
    if (exportMode) drawScaleBar(g2, layout);
    else if (syncScaleBar()) drawScaleBar(g2, layout);
  }
  $('clipping').textContent = q.heatmap ? `左图超色标：${clipped} / ${(q.x1 - q.x0) * (q.y1 - q.y0)} 格点` : '';
  c2.dataset.heatmap = String(q.heatmap);
  c2.dataset.arrowColor = q.planarColor;
}
let projectionAz = null,
  projectionEl = null,
  projectionMatrix = null;
// Cached 3D projection and cone geometry.
function proj(v) {
  if (S.az !== projectionAz || S.el !== projectionEl) {
    const ca = Math.cos(S.az),
      sa = Math.sin(S.az),
      ce = Math.cos(S.el),
      se = Math.sin(S.el);
    projectionMatrix = [[-sa, ca, 0], [-se * ca, -se * sa, ce], [ce * ca, ce * sa, se]];
    projectionAz = S.az;
    projectionEl = S.el;
  }
  const m = projectionMatrix;
  return [m[0][0] * v[0] + m[0][1] * v[1], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}
let meshCache = null;
function draw3({ exportMode = false, annotations = true } = {}) {
  if (!render3DEnabled) return;
  const q = cfg,
    zmin = coord(2, Math.min(...q.layers)) - D.spacing_nm[2] / 2,
    zmax = coord(2, Math.max(...q.layers)) + D.spacing_nm[2] / 2,
    center = [(q.xmin + q.xmax) / 2, (q.ymin + q.ymax) / 2, (zmin + zmax) / 2],
    s = 500 / Math.hypot(q.xmax - q.xmin, q.ymax - q.ymin, zmax - zmin) * S.zoom;
  const pc = sourceAxes(center);
  const screen = v => {
    const p = proj([v[0] - pc[0], v[1] - pc[1], v[2] - pc[2]]);
    return [360 + p[0] * s, 310 - p[1] * s, p[2]];
  };
  g3.clearRect(0, 0, 720, 650);
  c3.dataset.voxels = '0';
  c3.dataset.voxelComponent = '';
  if (q.mode !== 'box') {
    for (const z of [zmin, zmax]) line(g3, [[q.xmin, q.ymin, z], [q.xmax, q.ymin, z], [q.xmax, q.ymax, z], [q.xmin, q.ymax, z], [q.xmin, q.ymin, z]].map(v => screen(sourceAxes(v))), '#c3d0d9', 1);
    for (const x of [q.xmin, q.xmax]) for (const y of [q.ymin, q.ymax]) line(g3, [[x, y, zmin], [x, y, zmax]].map(v => screen(sourceAxes(v))), '#c3d0d9', 1);
  }
  if (q.mode === 'voxels') {
    stopSpatial();
    $('render-status').textContent = '体素';
    drawVoxels(q, zmin, zmax, s, exportMode);
  } else {
    renderSpatial(makeArrowScene(q, pc, s, screen), q, exportMode);
  }
  if (annotations) {
    for (let i = 0; i < 3; i++) {
      let v = [0, 0, 0];
      v[i] = 1;
      const p = proj(v),
        end = [65 + p[0] * 35, 575 - p[1] * 35];
      line(g3, [[65, 575], end], '#345', 2);
      text(g3, ['x', 'y', 'z'][i], end[0] + 5, end[1] - 5);
    }
    text(g3, D.text_plane ? `${planeName()} 单切面 · ${planeName() === 'XZ' ? 'y' : 'z'}=0（展示位置）` : `${q.layers.length}层 · ${normalAxis()}=${coord(2, q.layers[0])}–${coord(2, q.layers.at(-1))} 格点`, 360, 25, 'center');
    text(g3, D.text_plane ? '正交投影 · 格点坐标' : '正交投影 · x/y/z 按格点等比例', 360, 620, 'center');
  }
  if (!exportMode && q.spatialColor === 'direction' && q.mode !== 'voxels') {
    DirectionColors.preview($('direction-sphere'), (g, resolution) => DirectionColors.sphere(g, projectionMatrix, resolution, q.directionPreset));
  }
  c3.dataset.arrowColor = q.mode === 'voxels' ? 'component' : q.spatialColor;
  c3.dataset.zoom = String(S.zoom);
  c3.dataset.visiblePlanes = q.layers.length;
  c3.dataset.sampledPlanes = q.mode === 'voxels' ? q.layers.length : q.sampleLayers.length;
}
let cubeCache = null;
// View switching and control synchronization.
function orientedDataset(view) {
  if (sourceD.text_plane) return sourceD;
  const swap = view === 'XZ';
  return {
    ...sourceD,
    shape_zyxc: swap ? [sourceD.shape_zyxc[1], sourceD.shape_zyxc[0], sourceD.shape_zyxc[2], 3] : sourceD.shape_zyxc.slice(),
    origin_nm: swap ? [sourceD.origin_nm[0], sourceD.origin_nm[2], sourceD.origin_nm[1]] : sourceD.origin_nm.slice(),
    spacing_nm: [1, 1, 1]
  };
}
function changeView() {
  if (!sourceD || sourceD.text_plane) return;
  box = null;
  const old = cfg,
    previousD = D,
    previousK = $('plane').value,
    previousStart = layerStart,
    previousEnd = layerEnd,
    swap = $('left-view').value === 'XZ';
  D = orientedDataset($('left-view').value);
  const nz = D.shape_zyxc[0];
  $('plane').max = nz - 1;
  $('plane').value = Math.floor((old.y0 + old.y1 - 1) / 2);
  $('plane').disabled = nz === 1;
  layerStart = old.y0;
  layerEnd = old.y1 - 1;
  $('ymin').value = coord(1, old.layers[0]);
  $('ymax').value = coord(1, old.layers.at(-1));
  meshCache = null;
  cubeCache = null;
  updateLabels();
  syncLayers();
  apply();
  if (cfg === old) {
    D = previousD;
    $('left-view').value = swap ? 'XY' : 'XZ';
    layerStart = previousStart;
    layerEnd = previousEnd;
    $('plane').max = D.shape_zyxc[0] - 1;
    $('plane').value = previousK;
    for (const name of ['xmin', 'xmax', 'ymin', 'ymax']) $(name).value = old.inputRanges[name];
    updateLabels();
    syncLayers();
  }
}
function draw() {
  if (!cfg) return;
  syncColorbar();
  syncDirectionControls();
  syncScaleBar();
  updateExportSize();
  $('full-below').hidden = cfg.x0 === 0 && cfg.x1 === D.shape_zyxc[2] && cfg.y0 === 0 && cfg.y1 === D.shape_zyxc[1];
  c3.setAttribute('aria-label', cfg.mode === 'voxels' ? '格点体素图' : cfg.mode === 'box' ? '六面边界热图与三维箭头' : '多层三维矢量图');
  $('voxel-control').hidden = cfg.mode !== 'voxels';
  for (const id of ['plane', 'head-size', 'shaft-size']) {
    const el = $(id),
      lo = Number(el.min),
      hi = Number(el.max);
    el.style.setProperty?.('--progress', (Number(el.value) - lo) / (hi - lo || 1) * 100 + '%');
  }
  $('head-label').textContent = `三维头部大小：${cfg.headSize.toFixed(2)} 倍`;
  $('shaft-label').textContent = `三维柄部粗细：${cfg.shaftSize.toFixed(2)} 倍`;
  draw2();
  draw3();
  $('quantity').textContent = cfg.mode === 'voxels' ? `左图 ${componentLabel(2)} / 体素 ${componentLabel(cfg.component)}` : componentLabel(2);
  $('lo').textContent = colorLabel(cfg.lo);
  $('hi').textContent = colorLabel(cfg.hi);
  $('plane-label').textContent = D.text_plane ? `左图 ${planeName()}：单切面（无需选层）` : `左图 ${planeName()}：第 ${cfg.k + 1}/${D.shape_zyxc[0]} 层 · ${normalAxis()}=${Number(coord(2, cfg.k).toPrecision(8))} 格点`;
  $('plane').setAttribute('aria-valuetext', `第${cfg.k + 1}层，${normalAxis()}=${coord(2, cfg.k)} 格点`);
}
function colorLabel(v) {
  return Number.isInteger(v * 10) ? v.toFixed(1) : String(v);
}
let liveFrame = null;
function live() {
  markSpatialInteraction();
  if (liveFrame === null) liveFrame = requestAnimationFrame(() => {
    liveFrame = null;
    apply();
  });
}
function flushLive() {
  if (liveFrame === null) return;
  cancelAnimationFrame(liveFrame);
  liveFrame = null;
  apply();
}
function cancelPendingInteractions() {
  if (typeof stopSpatial === 'function') stopSpatial();
  if (liveFrame !== null) cancelAnimationFrame(liveFrame);
  if (frame !== null) cancelAnimationFrame(frame);
  liveFrame = frame = null;
  planarWheelPending = null;
  const pan = planarPan;
  planarPan = box = layerDrag = drag = null;
  c2.style.cursor = '';
  if (pan && c2.hasPointerCapture?.(pan.pointerId)) c2.releasePointerCapture(pan.pointerId);
}
function syncLayers() {
  const max = D.shape_zyxc[0] - 1;
  $('one').setAttribute('aria-pressed', String(followLeftLayer));
  $('one').title = followLeftLayer ? '已跟随左图选层；再次点击取消' : '让三维图持续跟随左图所在层';
  $('nmin').disabled = $('nmax').disabled = !!D.text_plane || followLeftLayer;
  $('layer-track').classList.toggle('following', followLeftLayer);
  $('nmin').value = D.text_plane ? '' : coord(2, layerStart);
  $('nmax').value = D.text_plane ? '' : coord(2, layerEnd);
  for (const [id, k] of [['layer-start', layerStart], ['layer-end', layerEnd]]) {
    const e = $(id);
    e.style.left = (max ? k / max * 100 : 50) + '%';
    e.style.transform = layerStart === layerEnd ? id === 'layer-start' ? 'translateX(-85%)' : 'translateX(-15%)' : 'translateX(-50%)';
    e.setAttribute('aria-valuemax', max + 1);
    e.setAttribute('aria-valuenow', k + 1);
    e.setAttribute('aria-valuetext', `第${k + 1}层，${normalAxis()}=${coord(2, k).toPrecision(6)} 格点`);
    e.disabled = max === 0 || followLeftLayer;
  }
  $('layer-fill').style.left = (max ? layerStart / max * 100 : 50) + '%';
  $('layer-fill').style.width = (max ? (layerEnd - layerStart) / max * 100 : 0) + '%';
  $('layer-range-label').textContent = D.text_plane ? `三维：${planeName()} 单切面` : `三维 ${normalAxis()}：第 ${layerStart + 1}–${layerEnd + 1} 层（${layerEnd - layerStart + 1}层）`;
}
function setLayer(which, k) {
  if (followLeftLayer) return;
  k = Math.max(0, Math.min(D.shape_zyxc[0] - 1, k));
  if (which === 'start') layerStart = Math.min(k, layerEnd);else layerEnd = Math.max(k, layerStart);
  syncLayers();
  live();
}
let layerDrag = null;
function trackIndex(e) {
  const r = $('layer-track').getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (D.shape_zyxc[0] - 1));
}
let drag = null,
  frame = null;
function schedule3() {
  if (!render3DEnabled) return;
  if (!frame) frame = requestAnimationFrame(() => {
    frame = null;
    if (cfg) draw3();
  });
}
function hoverRead(e) {
  if (!plot) return;
  const r = c2.getBoundingClientRect(),
    x = (e.clientX - r.left) * 720 / r.width,
    y = (e.clientY - r.top) * 650 / r.height,
    q = plot;
  if (x < q.left || x >= q.left + q.w || y < q.top || y >= q.top + q.h) return;
  const wx = cfg.xmin + (x - q.left) / q.s,
    wy = cfg.ymax - (y - q.top) / q.s,
    i = Math.floor((wx - D.origin_nm[0]) / D.spacing_nm[0]),
    j = Math.floor((wy - D.origin_nm[1]) / D.spacing_nm[1]);
  if (i < 0 || i >= D.shape_zyxc[2] || j < 0 || j >= D.shape_zyxc[1]) return;
  showSample(i, j, cfg.k);
}
function clearSample() {
  $('sample').replaceChildren();
  $('sample').removeAttribute('title');
}
function showSample(i, j, k) {
  const coordinates = sourceAxes([coord(0, i), coord(1, j), coord(2, k)]);
  const axes = D.text_plane ? (planeName() === 'XZ' ? [0, 2] : [0, 1]) : [0, 1, 2];
  const values = at(k, j, i), prefix = cfg.field === 'AFD' ? 'Φ' : 'p';
  const lines = [
    ['格点', ...axes.map(a => `${'xyz'[a]}=${Math.round(coordinates[a])}`)],
    [cfg.field === 'AFD' ? 'Φ' : 'P', ...values.map((v, a) => `${prefix}${'xyz'[a]}=${(v === 0 ? 0 : v).toPrecision(4)}`)]
  ];
  const title = lines.map(parts => parts.join(' · ')).join('\n');
  if ($('sample').title === title) return;
  $('sample').replaceChildren(...lines.map(parts => {
    const row = document.createElement('div'); row.className = 'sample-row';
    row.replaceChildren(...parts.map(value => { const span = document.createElement('span'); span.textContent = value; return span; }));
    return row;
  }));
  $('sample').title = title;
}
function exportLayout(source, mode = 'standard') {
  assert(['standard', 'clean'].includes(mode), '请选择有效的 PNG 输出方式。');
  const dataOnly = mode === 'clean' || (source === c2 && !!planarScaleBar);
  if (source === c2 && dataOnly && cfg) {
    const p = planarLayout();
    return { left: p.left, top: p.top, width: p.w, height: p.h, dataOnly };
  }
  return { left: 0, top: 0, width: dataOnly ? 720 : 940, height: 650, dataOnly };
}
// Standard exports retain legends; clean exports draw no annotation layer.
function exportWithColorbar(source, dpi = 96, mode = 'standard') {
  assert(source !== c3 || render3DEnabled, '请先开启3D渲染，再保存三维 PNG。');
  assert(Number.isInteger(dpi) && dpi >= 72 && dpi <= 600, 'DPI 请输入 72–600 之间的整数。');
  const layout = exportLayout(source, mode), scaleBar = source === c2 && !!planarScaleBar && mode !== 'clean';
  if (scaleBar) scaleBarGeometry();
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(layout.width * dpi / 96));
  out.height = Math.max(1, Math.round(layout.height * dpi / 96));
  const g = out.getContext('2d');
  g.scale(out.width / layout.width, out.height / layout.height);
  // Redraw source vectors, labels and heatmaps at the export resolution.
  // Do not resize the preview or upscale its already-rasterized pixels.
  const previous = { g2, g3, renderScale, plot };
  g.save();
  g.translate(-layout.left, -layout.top);
  g.beginPath(); g.rect(0, 0, 720, 650); g.clip();
  try {
    renderScale = dpi / 96;
    if (source === c2) { g2 = g; draw2({ annotations: !layout.dataOnly, scaleBar, exportMode: true }); }
    else { g3 = g; draw3({ exportMode: true, annotations: !layout.dataOnly }); }
  } finally {
    ({ g2, g3, renderScale, plot } = previous);
    g.restore();
    if (source === c3) requestAnimationFrame(() => { if (cfg && render3DEnabled) draw3(); });
  }
  g.save();
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, layout.width, layout.height);
  g.restore();
  if (layout.dataOnly) return out;
  const directional = source === c2 ? cfg.planarColor === 'direction' : cfg.spatialColor === 'direction' && cfg.mode !== 'voxels';
  const scalar = source === c2 ? cfg.heatmap : !directional || cfg.mode === 'box';
  if (directional) {
    text(g, source === c2 ? `${planeName()} 平面方向` : '空间方向', 824, 44, 'center', 15);
    text(g, DirectionColors.presets[cfg.directionPreset].label, 824, 68, 'center', 12);
    g.save(); g.translate(727, 75); g.scale(1.5, 1.5);
    if (source === c2) DirectionColors.wheel(g, verticalAxis(), cfg.directionPreset);
    else DirectionColors.sphere(g, projectionMatrix, dpi / 96 * 1.5, cfg.directionPreset);
    g.restore();
    if (source === c3) {
      text(g, '+z 橙金色 · −z 蓝紫色', 824, 238, 'center', 12);
      text(g, '颜色与矢量长度无关', 824, 259, 'center', 12);
    }
  }
  if (!scalar) return out;
  const x = 750,
    y = directional ? 325 : 100,
    w = 24,
    h = directional ? 250 : 440;
  for (let row = 0; row < h; row++) {
    const value = cfg.hi - (cfg.hi - cfg.lo) * row / (h - 1);
    g.fillStyle = 'rgb(' + color(value) + ')';
    g.fillRect(x, y + row, w, 1);
  }
  g.strokeStyle = '#8897a3';
  g.lineWidth = .8;
  g.strokeRect(x, y, w, h);
  text(g, componentLabel(source === c3 && cfg.mode === 'voxels' ? cfg.component : 2), x - 5, y - 26, 'left', 15);
  for (let i = 0; i <= 4; i++) {
    const value = i === 0 ? cfg.hi : i === 4 ? cfg.lo : cfg.hi - (cfg.hi - cfg.lo) * i / 4,
      yy = y + h * i / 4;
    line(g, [[x + w, yy], [x + w + 6, yy]], '#536575', 1);
    const label = i === 0 || i === 4 ? colorLabel(value) : Number(value.toPrecision(5)).toString();
    text(g, label, x + w + 12, yy + 5, 'left', 14);
  }
  return out;
}
// Keep the left view fixed during a drag; update the input boxes and right view live.
// Grid-snapped box selection.
function gridBoundary(axis, value) {
  const n = D.shape_zyxc[2 - axis];
  return Math.max(0, Math.min(n, Math.round((value - D.origin_nm[axis]) / D.spacing_nm[axis])));
}
function boxPoint(e, p) {
  const r = c2.getBoundingClientRect(),
    x = (e.clientX - r.left) * 720 / r.width,
    y = (e.clientY - r.top) * 650 / r.height;
  return {
    x: Math.max(p.left, Math.min(p.left + p.w, x)),
    y: Math.max(p.top, Math.min(p.top + p.h, y)),
    inside: x >= p.left && x <= p.left + p.w && y >= p.top && y <= p.top + p.h
  };
}
// Wheel zoom changes the shared grid selection, rather than scaling a bitmap.
// Batch wheel events into one redraw per animation frame (also for trackpads).
let planarWheelPending = null, planarWheelFrame = false;
function zoomPlanarWithWheel(e) {
  if (!cfg || !plot || box || planarPan || !Number.isFinite(e.deltaY) || !e.deltaY) return;
  const point = boxPoint(e, plot);
  if (!point.inside) {
    planarWheelPending = null;
    return; // Let the page scroll normally outside the heatmap.
  }
  e.preventDefault();
  const delta = Math.max(-120, Math.min(120, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1)));
  if (!planarWheelPending || planarWheelPending.settings !== cfg || Math.sign(planarWheelPending.delta) !== Math.sign(delta)) {
    planarWheelPending = { settings: cfg, dataset: loadId, delta: 0 };
  }
  Object.assign(planarWheelPending, {
    delta: planarWheelPending.delta + delta,
    anchor: [(point.x - plot.left) / plot.w, 1 - (point.y - plot.top) / plot.h]
  });
  if (planarWheelFrame) return;
  planarWheelFrame = true;
  requestAnimationFrame(() => {
    planarWheelFrame = false;
    flushPlanarWheel();
  });
}
function flushPlanarWheel() {
  const pending = planarWheelPending;
  if (!pending) return;
  if (pending.settings !== cfg || pending.dataset !== loadId || box || planarPan) {
    planarWheelPending = null;
    return;
  }
  if (Math.abs(pending.delta) < 8) return; // Accumulate small trackpad movements.
  planarWheelPending = null;
  const factor = Math.exp(Math.max(-240, Math.min(240, pending.delta)) * .0025);
  const ranges = ['x', 'y'].map((axis, i) => {
    const first = cfg[axis + '0'], count = cfg[axis + '1'] - first, total = D.shape_zyxc[2 - i];
    let nextCount = Math.round(count * factor);
    if (nextCount === count) nextCount += pending.delta < 0 ? -1 : 1;
    nextCount = Math.max(1, Math.min(total, nextCount));
    const start = Math.max(0, Math.min(total - nextCount, Math.round(first + pending.anchor[i] * (count - nextCount))));
    return [start, start + nextCount];
  });
  if (ranges.every(([start, end], i) => start === cfg[['x0', 'y0'][i]] && end === cfg[['x1', 'y1'][i]])) return;
  ranges.forEach(([start, end], i) => {
    const axis = i ? 'y' : 'x';
    $(axis + 'min').value = coord(i, start);
    $(axis + 'max').value = coord(i, end - 1);
  });
  apply(); // Both views, range inputs and the restore button share this path.
}
// Right-button hand panning: move the data with the pointer, keeping the
// selected grid-cell counts and normal-axis layers unchanged.
let planarPan = null;
function startPlanarPan(e) {
  if (!cfg || !plot || box || planarPan || !boxPoint(e, plot).inside) return;
  e.preventDefault();
  planarWheelPending = null;
  const rect = c2.getBoundingClientRect();
  planarPan = {
    pointerId: e.pointerId, dataset: loadId, settings: cfg,
    original: cfg.inputRanges, start: [cfg.x0, cfg.y0],
    count: [cfg.x1 - cfg.x0, cfg.y1 - cfg.y0],
    pointer: [e.clientX, e.clientY], position: [e.clientX, e.clientY],
    pixelsPerCell: [plot.s * D.spacing_nm[0] * rect.width / 720,
      plot.s * D.spacing_nm[1] * rect.height / 650],
    frame: false
  };
  c2.style.cursor = 'grabbing';
  c2.setPointerCapture(e.pointerId);
}
function updatePlanarPan(pan) {
  if (planarPan !== pan) return;
  if (pan.dataset !== loadId || pan.settings !== cfg || box) {
    finishPlanarPan();
    return;
  }
  const shifts = [-(pan.position[0] - pan.pointer[0]), pan.position[1] - pan.pointer[1]];
  const starts = shifts.map((shift, i) => Math.max(0, Math.min(D.shape_zyxc[2 - i] - pan.count[i],
    pan.start[i] + Math.round(shift / pan.pixelsPerCell[i]))));
  if (starts[0] === cfg.x0 && starts[1] === cfg.y0) return;
  starts.forEach((start, i) => {
    const axis = i ? 'y' : 'x';
    $(axis + 'min').value = coord(i, start);
    $(axis + 'max').value = coord(i, start + pan.count[i] - 1);
  });
  apply();
  pan.settings = cfg;
}
function movePlanarPan(e) {
  const pan = planarPan;
  if (!pan || e.pointerId !== pan.pointerId) return;
  e.preventDefault();
  pan.position = [e.clientX, e.clientY];
  if (pan.frame) return;
  pan.frame = true;
  requestAnimationFrame(() => {
    pan.frame = false;
    updatePlanarPan(pan);
  });
}
function finishPlanarPan(restore = false) {
  const pan = planarPan;
  if (!pan) return;
  planarPan = null;
  c2.style.cursor = '';
  if (c2.hasPointerCapture?.(pan.pointerId)) c2.releasePointerCapture(pan.pointerId);
  if (restore && pan.dataset === loadId && pan.settings === cfg) {
    for (const name of ['xmin', 'xmax', 'ymin', 'ymax']) $(name).value = pan.original[name];
    apply();
  }
}
function boxIndices(p) {
  return [gridBoundary(0, box.cfg.xmin + (p.x - box.plot.left) / box.plot.s), gridBoundary(1, box.cfg.ymax - (p.y - box.plot.top) / box.plot.s)];
}
function paintBox() {
  g2.clearRect(0, 0, 720, 650);
  g2.drawImage(box.image, 0, 0);
  if (!box.end) return;
  const a = box.start,
    b = box.end,
    p = box.plot,
    q = box.cfg;
  const x = i => p.left + (D.origin_nm[0] + i * D.spacing_nm[0] - q.xmin) * p.s,
    y = j => p.top + (q.ymax - D.origin_nm[1] - j * D.spacing_nm[1]) * p.s;
  g2.save();
  g2.beginPath();
  g2.rect(p.left, p.top, p.w, p.h);
  g2.clip();
  g2.fillStyle = 'rgba(8,140,160,.15)';
  g2.fillRect(Math.min(x(a[0]), x(b[0])), Math.min(y(a[1]), y(b[1])), Math.abs(x(a[0]) - x(b[0])), Math.abs(y(a[1]) - y(b[1])));
  g2.setLineDash([6, 4]);
  line(g2, [[x(a[0]), y(a[1])], [x(b[0]), y(a[1])], [x(b[0]), y(b[1])], [x(a[0]), y(b[1])], [x(a[0]), y(a[1])]], '#087c8a', 2);
  g2.restore();
}
function applyNormalRange() {
  if (!D || D.text_plane || followLeftLayer) return;
  try {
    const lo = Number($('nmin').value),
      hi = Number($('nmax').value),
      n = D.shape_zyxc[0];
    assert($('nmin').value.trim() !== '' && $('nmax').value.trim() !== '' && Number.isFinite(lo) && Number.isFinite(hi), '法向范围请输入有限数值');
    assert(lo <= hi && lo >= coord(2, 0) - 1e-8 && hi <= coord(2, n - 1) + 1e-8, `${normalAxis()}范围须在 ${coord(2, 0)}–${coord(2, n - 1)} 格点内`);
    const ids = [];
    for (let i = 0; i < n; i++) if (coord(2, i) >= lo - 1e-10 && coord(2, i) <= hi + 1e-10) ids.push(i);
    assert(ids.length, '所选范围没有格点');
    const old = cfg,
      a = layerStart,
      b = layerEnd;
    layerStart = ids[0];
    layerEnd = ids.at(-1);
    apply();
    if (cfg === old) {
      layerStart = a;
      layerEnd = b;
    }
    syncLayers();
  } catch (e) {
    status(e.message + '；图像保留上次有效设置。', true);
  }
}

// Cached scalar texture: include every grid point, regardless of arrow sampling.
let voxelRenderer = null,
  voxelCache = null;
function componentLabel(component) {
  const axis = ['x', 'y', 'z'][component];
  return cfg.field === 'P' ? `P${axis} [${D.text_plane ? '源单位' : 'C/m²'}]` : `Φ${axis} [rad]`;
}
function prepareVoxels(q) {
  if (!voxelRenderer) voxelRenderer = new VoxelRenderer();
  const dimensions = [q.x1 - q.x0, q.y1 - q.y0, q.layers.length];
  voxelRenderer.checkDimensions(dimensions);
  const magnitude = Math.max(Math.abs(q.lo), Math.abs(q.hi));
  const key = JSON.stringify([loadId, planeName(), q.field, q.component, q.x0, q.x1, q.y0, q.y1, q.layers[0], q.layers.at(-1), q.lo, q.hi, magnitude]);
  if (voxelCache?.key === key) return voxelCache;
  const data = new Float32Array(dimensions.reduce((a, b) => a * b, 1));
  let t = 0,
    zeros = 0,
    clipped = 0;
  for (const k of q.layers) for (let j = q.y0; j < q.y1; j++) for (let i = q.x0; i < q.x1; i++) {
    const value = at(k, j, i, q.field)[q.component];
    if (value === 0) zeros++;
    if (value < q.lo || value > q.hi) clipped++;
    // Normalize for display only, retaining tiny/large source units and signed colors.
    data[t++] = Math.max(-1e30, Math.min(1e30, value / magnitude));
  }
  return voxelCache = {
    key,
    data,
    dimensions,
    magnitude,
    zeros,
    clipped
  };
}
function drawVoxels(q, zmin, zmax, scale, exportMode = false) {
  c3.dataset.arrows = 0;
  c3.dataset.boundaryFaces = '';
  try {
    const volume = prepareVoxels(q);
    proj([0, 0, 0]); // Refresh the shared camera basis before its use below.
    const canvas = voxelRenderer.render(volume.data, volume.dimensions, [[q.xmin, q.ymin, zmin], [q.xmax, q.ymax, zmax]], projectionMatrix.map(sourceAxes), scale, q.colors, q.lo / volume.magnitude, q.hi / volume.magnitude, renderScale);
    g3.drawImage(canvas, 0, 0, 720, 650);
    c3.dataset.voxels = volume.data.length;
    c3.dataset.voxelComponent = q.component;
    $('info').textContent = `${volume.data.length.toLocaleString()} 个体素 · ${componentLabel(q.component)} · ${volume.zeros.toLocaleString()} 个零值全透明 · ${volume.clipped.toLocaleString()} 个超色标 · 不抽样${voxelRenderer.backend === 'Canvas2D' ? ' · 兼容绘制' : ''}`;
  } catch (error) {
    if (exportMode || renderScale !== 1) throw error;
    c3.dataset.voxels = 0;
    $('info').textContent = error.message;
    text(g3, '体素绘制不可用，请缩小范围或切换模式', 360, 310, 'center');
  }
}

// Per-panel direction modes share one color convention with both renderers.
function syncDirectionControls() {
  const wheel = cfg.planarColor === 'direction', sphere = cfg.spatialColor === 'direction' && cfg.mode !== 'voxels';
  $('planar-color').disabled = $('toggle-heatmap').disabled = false;
  $('spatial-color').disabled = cfg.mode === 'voxels';
  $('toggle-heatmap').setAttribute('aria-pressed', String(!cfg.heatmap));
  $('direction-wheel').hidden = !wheel;
  $('direction-sphere').hidden = !sphere;
  $('plots').classList.toggle('direction-legends', wheel || sphere);
  if (wheel) {
    $('direction-wheel').setAttribute('aria-label', `${planeName()}平面方向色环：${DirectionColors.presets[cfg.directionPreset].label}，标注±x与±${verticalAxis()}方向`);
    DirectionColors.preview($('direction-wheel'), g => DirectionColors.wheel(g, verticalAxis(), cfg.directionPreset));
  }
}
// UI bindings and defaults. Keep all event registration in one place.
$('planar-color').onchange = $('spatial-color').onchange = $('direction-preset').onchange = () => { box = null; apply(); };
$('toggle-heatmap').onclick = () => {
  if (!cfg || exporting) return;
  box = null;
  $('toggle-heatmap').value = cfg.heatmap ? 'off' : 'on';
  if (!apply()) $('toggle-heatmap').value = cfg.heatmap ? 'on' : 'off';
};
$('left-view').onchange = changeView;
$('mode3').onchange = () => {
  if (!D) return;
  if (D.text_plane && $('mode3').value === 'box') {
    $('mode3').value = cfg?.mode || 'arrows';
    return;
  }
  box = null;
  apply();
  $('mode3').value = cfg?.mode || 'arrows';
};
$('file').onchange = e => importFile(e.target.files[0]);
$('drop').ondragover = e => {
  e.preventDefault();
  $('drop').classList.add('over');
};
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = e => {
  e.preventDefault();
  $('drop').classList.remove('over');
  return importFile(e.dataTransfer.files[0]);
};
$('field').onchange = changeField;
$('plane').oninput = live;
$('palette').value = 'diverging';
$('color-low').value = '#2166ac';
$('color-high').value = '#b2182b';
$('palette').onchange = () => {
  $('custom-colors').hidden = $('palette').value !== 'custom';
  live();
};
$('color-low').oninput = $('color-high').oninput = live;
$('left-view').value = 'XY';
$('mode3').value = 'arrows';
$('voxel-component').value = '2';
$('voxel-component').onchange = () => {
  autoColor();
  apply();
};
$('head-size').value = 1;
$('shaft-size').value = 1;
for (const id of ['cmin', 'cmax', 'xmin', 'xmax', 'ymin', 'ymax', 'stride-x', 'stride-y', 'stride-z', 'scale', 'head-size', 'shaft-size']) $(id).oninput = live;
$('full-below').onclick = $('full').onclick = () => {
  box = null;
  fullRange();
  apply();
};
$('autoColor').onclick = () => {
  autoColor();
  apply();
};
$('all').onclick = () => {
  if (!D) return;
  followLeftLayer = false;
  layerStart = 0;
  layerEnd = D.shape_zyxc[0] - 1;
  syncLayers();
  apply();
};
$('one').onclick = () => {
  if (!D || D.text_plane) return;
  followLeftLayer = !followLeftLayer;
  if (!apply()) {
    followLeftLayer = !followLeftLayer;
    syncLayers();
  }
};
$('layer-track').onpointerdown = e => {
  if (!D || D.shape_zyxc[0] === 1 || followLeftLayer || e.button !== 0) return;
  e.preventDefault();
  const k = trackIndex(e);
  const rr = $('layer-track').getBoundingClientRect(),
    same = layerStart === layerEnd;
  layerDrag = same ? e.clientX < rr.left + rr.width * layerStart / (D.shape_zyxc[0] - 1) ? 'start' : 'end' : e.target.id === 'layer-start' ? 'start' : e.target.id === 'layer-end' ? 'end' : Math.abs(k - layerStart) < Math.abs(k - layerEnd) ? 'start' : k < layerStart ? 'start' : 'end';
  $('layer-track').setPointerCapture(e.pointerId);
  setLayer(layerDrag, k);
};
$('layer-track').onpointermove = e => {
  if (layerDrag) setLayer(layerDrag, trackIndex(e));
};
$('layer-track').onpointerup = $('layer-track').onpointercancel = $('layer-track').onlostpointercapture = () => layerDrag = null;
for (const [id, which] of [['layer-start', 'start'], ['layer-end', 'end']]) $(id).onkeydown = e => {
  if (!D) return;
  const k = which === 'start' ? layerStart : layerEnd;
  const v = {
    ArrowLeft: k - 1,
    ArrowDown: k - 1,
    ArrowRight: k + 1,
    ArrowUp: k + 1,
    Home: 0,
    End: D.shape_zyxc[0] - 1
  }[e.key];
  if (v !== undefined) {
    e.preventDefault();
    setLayer(which, v);
  }
};
$('reset').onclick = () => {
  S.az = -56 * Math.PI / 180;
  S.el = 46 * Math.PI / 180;
  S.zoom = 1;
  if (cfg) draw3();
  rememberWorkspace({ camera: { ...S } });
};
c3.onpointerdown = e => {
  if (!cfg || !render3DEnabled || e.button !== 0) return;
  drag = [e.clientX, e.clientY];
  c3.setPointerCapture(e.pointerId);
};
c3.onpointerup = c3.onpointercancel = () => { drag = null; markSpatialInteraction(); };
c3.onpointermove = e => {
  if (!render3DEnabled || !drag) return;
  S.az -= (e.clientX - drag[0]) * .008;
  S.el = Math.max(-Math.PI / 2 + .001, Math.min(Math.PI / 2 - .001, S.el + (e.clientY - drag[1]) * .006));
  drag = [e.clientX, e.clientY];
  markSpatialInteraction();
  rememberWorkspace({ camera: { ...S } });
  schedule3();
};
c2.addEventListener('wheel', zoomPlanarWithWheel, { passive: false });
c3.addEventListener('wheel', e => {
  if (!render3DEnabled) return;
  e.preventDefault();
  S.zoom = Math.min(100, Math.max(.25, S.zoom * Math.exp(-e.deltaY * .001)));
  markSpatialInteraction();
  rememberWorkspace({ camera: { ...S } });
  schedule3();
}, {
  passive: false
});
// PNG pHYs stores pixels per metre; browsers otherwise write a fixed 96 DPI.
function pngWithDPI(bytes, dpi) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(bytes.length >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a, 'PNG 编码失败。');
  const chunk = new Uint8Array(21), data = new DataView(chunk.buffer);
  data.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // pHYs
  const ppm = Math.round(dpi / .0254);
  data.setUint32(8, ppm); data.setUint32(12, ppm); chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  data.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const parts = [bytes.subarray(0, 8)];
  for (let pos = 8; pos < bytes.length;) {
    assert(pos + 12 <= bytes.length, 'PNG 数据不完整。');
    const length = view.getUint32(pos), end = pos + length + 12;
    assert(end <= bytes.length, 'PNG 数据不完整。');
    const type = view.getUint32(pos + 4);
    if (type !== 0x70485973) parts.push(bytes.subarray(pos, end));
    if (type === 0x49484452) parts.push(chunk);
    pos = end;
  }
  return new Blob(parts, { type: 'image/png' });
}
function exportDPI() {
  const dpi = Number($('export-dpi').value);
  assert(Number.isInteger(dpi) && dpi >= 72 && dpi <= 600, 'DPI 请输入 72–600 之间的整数。');
  return dpi;
}
function updateExportSize() {
  try {
    const dpi = exportDPI();
    const dimensions = [c2, c3].map((c, i) => {
      const l = exportLayout(c, $('export-mode' + (i + 2)).value);
      return `${Math.max(1, Math.round(l.width * dpi / 96))} × ${Math.max(1, Math.round(l.height * dpi / 96))}`;
    });
    $('export-size').textContent = dimensions[0] === dimensions[1] ? `${dimensions[0]} px · 两图共用` : `平面 ${dimensions[0]} · 三维 ${dimensions[1]} px`;
  } catch {
    $('export-size').textContent = '请输入 72–600 的整数';
  }
}
$('export-dpi').oninput = () => {
  updateExportSize();
  const dpi = Number($('export-dpi').value);
  if (Number.isInteger(dpi) && dpi >= 72 && dpi <= 600) rememberWorkspace({ values: { 'export-dpi': String(dpi) } });
};
updateExportSize();
let exporting = false;
for (const id of ['export-mode2', 'export-mode3']) $(id).onchange = () => {
  updateExportSize();
  rememberWorkspace({ values: { [id]: $(id).value } });
};
$('scale-bar-toggle').onclick = () => {
  if (!cfg || exporting) return;
  if (planarScaleBar) {
    planarScaleBar = null;
    syncScaleBar(); draw2(); updateExportSize(); rememberWorkspace({ scaleBar: null });
    return;
  }
  if (box) { status('请先完成框选，再设置比例尺。', true); return; }
  $('scale-nm-grid').value = '';
  $('scale-length-nm').value = '';
  $('scale-error').hidden = true;
  $('scale-dialog').showModal();
  $('scale-nm-grid').focus();
};
$('scale-cancel').onclick = () => $('scale-dialog').close();
$('scale-form').onsubmit = e => {
  e.preventDefault();
  try {
    const value = { nmPerGrid: Number($('scale-nm-grid').value), lengthNm: Number($('scale-length-nm').value) };
    scaleBarGeometry(value);
    planarScaleBar = value;
    $('scale-dialog').close();
    syncScaleBar(); draw2(); updateExportSize(); rememberWorkspace({ scaleBar: { ...value } });
  } catch (error) {
    $('scale-error').textContent = error.message;
    $('scale-error').hidden = false;
  }
};
for (const [id, c] of [['save2', c2], ['save3', c3]]) $(id).onclick = async () => {
  if (!cfg || exporting || (c === c3 && !render3DEnabled)) return;
  if (box) {
    status('请先完成框选，再保存图像。', true);
    return;
  }
  try {
    const dpi = exportDPI(), mode = $('export-mode' + (c === c2 ? 2 : 3)).value;
    exporting = true;
    $('save2').disabled = $('save3').disabled = $('toggle3d').disabled = true;
    $('export-mode2').disabled = $('export-mode3').disabled = $('scale-bar-toggle').disabled = true;
    status(`正在生成 ${dpi} DPI PNG…`);
    // Let the busy indicator paint before the synchronous high-resolution draw.
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const suffix = mode === 'clean' ? '-clean' : c === c2 && planarScaleBar ? '-scalebar' : '';
    const name = `${cfg.field}-${id === 'save2' ? planeName() : cfg.mode === 'voxels' ? `voxels-${['x', 'y', 'z'][cfg.component]}-3D` : cfg.mode === 'box' ? 'boundary-3D' : '3D'}${suffix}-${dpi}dpi.png`;
    const canvas = exportWithColorbar(c, dpi, mode);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('PNG 编码失败，请降低 DPI 后重试。')), 'image/png'));
    const encoded = pngWithDPI(new Uint8Array(await blob.arrayBuffer()), dpi);
    const url = URL.createObjectURL(encoded), a = document.createElement('a');
    a.download = name; a.href = url; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const content = mode === 'clean' ? '无文字、无图例、无比例尺' : c === c2 && planarScaleBar ? '仅图片与比例尺' : '含当前模式对应图例';
    status(`已导出 ${dpi} DPI PNG · ${canvas.width} × ${canvas.height} px（${content}）`);
  } catch (error) {
    status('导出失败：' + error.message, true);
  } finally {
    exporting = false;
    $('save2').disabled = $('toggle3d').disabled = false;
    $('save3').disabled = !render3DEnabled;
    $('export-mode2').disabled = $('export-mode3').disabled = false;
    syncScaleBar();
  }
};
// Disable the entire 3D path, including geometry/volume preparation and export.
// Dataset and controls stay live so re-enabling uses the latest shared region.
function sync3DRendering() {
  $('toggle3d').setAttribute('aria-pressed', String(!render3DEnabled));
  $('spatial-paused').hidden = render3DEnabled;
  c3.hidden = !render3DEnabled;
  c3.dataset.rendering = String(render3DEnabled);
  $('reset').disabled = $('save3').disabled = !render3DEnabled;
  if (!render3DEnabled) {
    stopSpatial();
    $('info').textContent = '3D渲染已关闭；左图与范围设置仍可操作。';
    for (const key of ['visiblePlanes', 'sampledPlanes', 'arrows', 'voxels']) c3.dataset[key] = '0';
    c3.dataset.boundaryFaces = c3.dataset.voxelComponent = '';
  }
}
$('toggle3d').onclick = () => {
  if (exporting) return;
  drag = null;
  if (render3DEnabled) {
    render3DEnabled = false;
  } else {
    render3DEnabled = true;
    // Revalidate current settings before allocating or rendering 3D data.
    if (D && !apply()) render3DEnabled = false;
  }
  sync3DRendering();
  rememberWorkspace({ rendering: render3DEnabled });
};
sync3DRendering();
c2.oncontextmenu = e => { if (cfg) e.preventDefault(); };
c2.onlostpointercapture = () => finishPlanarPan();
c2.onpointerdown = e => {
  if (e.button === 2) { startPlanarPan(e); return; }
  if (!cfg || planarPan || e.button !== 0) return;
  const p = boxPoint(e, plot);
  if (!p.inside) return;
  e.preventDefault();
  const image = document.createElement('canvas');
  image.width = 720;
  image.height = 650;
  image.getContext('2d').drawImage(c2, 0, 0);
  box = {
    plot: {
      ...plot
    },
    cfg: {
      ...cfg
    },
    image,
    start: null,
    end: null,
    valid: false
  };
  box.start = boxIndices(p);
  clearSample();
  c2.setPointerCapture(e.pointerId);
};
c2.onpointermove = e => {
  if (planarPan) { movePlanarPan(e); return; }
  if (!box) {
    hoverRead(e);
    return;
  }
  const p = boxPoint(e, box.plot);
  box.end = boxIndices(p);
  const a = box.start,
    b = box.end;
  box.valid = a[0] !== b[0] && a[1] !== b[1];
  if (box.valid) {
    for (const [axis, name] of [[0, 'x'], [1, 'y']]) {
      const lo = Math.min(a[axis], b[axis]),
        hi = Math.max(a[axis], b[axis]);
      $(name + 'min').value = Number(coord(axis, lo).toPrecision(15));
      $(name + 'max').value = Number(coord(axis, hi - 1).toPrecision(15));
    }
    apply();
  } else paintBox();
};
c2.onpointerup = e => {
  if (planarPan) {
    if (e.pointerId !== planarPan.pointerId || e.button !== 2) return;
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) planarPan.position = [e.clientX, e.clientY];
    updatePlanarPan(planarPan);
    finishPlanarPan();
    return;
  }
  if (!box) return;
  box = null;
  draw();
};
c2.onpointercancel = () => {
  if (planarPan) { finishPlanarPan(true); return; }
  if (!box) return;
  for (const name of ['xmin', 'xmax', 'ymin', 'ymax']) $(name).value = box.cfg.inputRanges[name];
  box = null;
  apply();
};
$('nmin').oninput = $('nmax').oninput = applyNormalRange;
