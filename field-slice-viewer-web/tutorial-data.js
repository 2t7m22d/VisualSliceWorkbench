/* Synthetic visualization fixture: two opposite XZ vortices extruded along Y.
   No interpolation, imported research data, or simulated equilibrium is implied. */
function createTutorialExampleFile() {
  const nx = 48, ny = 64, nz = 17;
  const a = new Float32Array(nx * ny * nz * 3);
  // Grid centers at z=1 and z=17 touch the bottom/top of the radius-8 circles.
  const radius = 8, amplitude = .65, coreRadius = 2;
  // x=13,33 and z=1,9,17 are sampled by the default X/Z strides 4/2.
  const centers = [[13, 9, 1], [33, 9, -1]];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const t = ((k * ny + j) * nx + i) * 3, x = i + 1, z = k + 1;
    // The facing sides both point +z; the two outer sides point -z.
    const [cx, cz, handedness] = centers[x <= 23 ? 0 : 1];
    const dx = x - cx, dz = z - cz, radiusHere = Math.hypot(dx, dz);
    if (radiusHere <= radius) {
      const core = Math.min(1, radiusHere / coreRadius);
      if (radiusHere > 0) {
        a[t] = -handedness * amplitude * dz / radiusHere * core;
        a[t + 2] = handedness * amplitude * dx / radiusHere * core;
      }
      // No axial offset: all three components are exactly zero at each center.
    } else {
      a[t + 2] = amplitude * handedness * (dx < 0 ? -1 : 1);
    }
  }
  const header = {
    schema: 'bfo-vector-slice-v1',
    title: '示例（合成教学数据）',
    shape_zyxc: [nz, ny, nx, 3],
    origin_nm: [0, 0, 0],
    spacing_nm: [1, 1, 1],
    index_ranges_xyz: [[0, nx], [0, ny], [0, nz]],
    coordinate_unit: 'grid_index',
    synthetic: true,
    description: 'Full-volume polarization: opposite XZ vortices with vertical exterior vectors aligned to their adjacent sides; identical at every Y plane. Top/bottom grid centers touch the vortex extrema; centers align with default arrow sampling and have exactly zero polarization. Synthetic visualization fixture, not a scientific simulation.',
    fields: [{
      name: 'P',
      dtype: 'float32',
      offset: 0,
      bytes: a.byteLength
    }]
  };
  const h = new TextEncoder().encode(JSON.stringify(header)),
    bytes = new Uint8Array(12 + h.length + a.byteLength),
    v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('BFOSLC1\n'));
  v.setUint32(8, h.length, true);
  bytes.set(h, 12);
  a.forEach((x, i) => v.setFloat32(12 + h.length + 4 * i, x, true));
  return new File([bytes], 'tutorial-example-aligned.bfslice');
}
