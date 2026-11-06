'use strict';

// Only small view settings are retained, never field arrays or rendered images.
// Each pointer gesture, edit or wheel burst is one undoable operation.
class ViewHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.reset();
  }
  reset(state = null) {
    this.past = [];
    this.present = state === null ? null : JSON.stringify(state);
    this.group = null;
    this.saved = false;
  }
  begin(key) {
    if (this.group === key) return;
    this.end();
    this.group = key;
  }
  end() {
    if (this.saved && this.past.at(-1) === this.present) this.past.pop();
    this.group = null;
    this.saved = false;
  }
  record(state) {
    const next = JSON.stringify(state);
    if (next === this.present) return;
    if (this.present !== null && (!this.group || !this.saved)) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
      this.saved = !!this.group;
    }
    this.present = next;
  }
  undo() {
    this.end();
    if (!this.past.length) return null;
    this.present = this.past.pop();
    return JSON.parse(this.present);
  }
}

const workspaceHistory = new ViewHistory();
const historyControls = [
  'field', 'left-view', 'mode3', 'voxel-component', 'plane', 'renderer', 'motion-quality',
  'xmin', 'xmax', 'ymin', 'ymax', 'nmin', 'nmax',
  'planar-color', 'spatial-color', 'direction-preset', 'toggle-heatmap',
  'cmin', 'cmax', 'palette', 'color-low', 'color-high',
  'stride-x', 'stride-y', 'stride-z', 'scale', 'head-size', 'shaft-size', 'export-dpi',
  'export-mode2', 'export-mode3'
];
let restoringWorkspace = false, historyWheelTimer = null, historyPointer = null;

function captureWorkspace() {
  return {
    values: Object.fromEntries(historyControls.map(id => [id, $(id).value])),
    layers: [layerStart, layerEnd],
    follow: followLeftLayer,
    rendering: render3DEnabled,
    scaleBar: planarScaleBar && { ...planarScaleBar },
    camera: { ...S }
  };
}
function rememberWorkspace(changes = null) {
  if (!cfg || restoringWorkspace || exporting) return;
  // Camera/DPI/rendering changes must not save an unfinished range or color edit.
  const previous = workspaceHistory.present && JSON.parse(workspaceHistory.present);
  const state = changes && previous ? {
    ...previous, ...changes, values: { ...previous.values, ...changes.values }
  } : captureWorkspace();
  const dpi = Number(state.values['export-dpi']);
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > 600) state.values['export-dpi'] = previous?.values['export-dpi'] || '300';
  workspaceHistory.record(state);
}
function resetWorkspaceHistory() {
  clearTimeout(historyWheelTimer);
  historyPointer = null;
  workspaceHistory.reset(cfg ? captureWorkspace() : null);
}
function restoreWorkspace(state) {
  restoringWorkspace = true;
  try {
    cancelPendingInteractions();
    // Update the orientation and range limits before restoring slider values.
    D = orientedDataset(state.values['left-view']);
    $('plane').max = D.shape_zyxc[0] - 1;
    $('plane').disabled = D.shape_zyxc[0] === 1;
    for (const [id, value] of Object.entries(state.values)) $(id).value = value;
    [layerStart, layerEnd] = state.layers;
    followLeftLayer = state.follow;
    render3DEnabled = state.rendering;
    planarScaleBar = state.scaleBar ? { ...state.scaleBar } : null;
    Object.assign(S, state.camera);
    syncField();
    updateLabels();
    syncLayers();
    sync3DRendering();
    $('custom-colors').hidden = $('palette').value !== 'custom';
    updateExportSize();
    meshCache = cubeCache = voxelCache = null;
    return apply();
  } finally {
    restoringWorkspace = false;
  }
}
function undoWorkspace() {
  if (!cfg || exporting) return false;
  flushPlanarWheel();
  flushLive();
  planarWheelPending = null;
  clearTimeout(historyWheelTimer);
  historyPointer = null;
  workspaceHistory.end();
  // Invalid/incomplete text never becomes a valid history entry. Restore that
  // draft to the last accepted settings before undoing earlier operations.
  const draft = JSON.stringify(captureWorkspace()) !== workspaceHistory.present;
  const state = draft && workspaceHistory.present ? JSON.parse(workspaceHistory.present) : workspaceHistory.undo();
  if (!state) {
    status('当前文件没有可撤回的操作。');
    return false;
  }
  const restored = restoreWorkspace(state);
  if (restored) status(draft ? '已恢复上次有效设置。' : '已撤回上一步操作。');
  return restored;
}
function isUndoShortcut(e) {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
    (e.key?.toLowerCase() === 'z' || e.code === 'KeyZ');
}
function finishHistoryOperation() {
  flushPlanarWheel();
  flushLive();
  workspaceHistory.end();
}

// Capture phase groups input before the existing rendering handlers run.
document.addEventListener('pointerdown', e => {
  if (!cfg || exporting) return;
  finishHistoryOperation();
  clearTimeout(historyWheelTimer);
  const target = e.target;
  const range = target.matches?.('input[type=range]');
  if (range || target.closest?.('#layer-track') || target === c2 || target === c3) {
    historyPointer = e.pointerId;
    workspaceHistory.begin(`pointer:${e.pointerId}`);
  }
}, true);
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, e => {
  if (historyPointer !== e.pointerId) return;
  historyPointer = null;
  queueMicrotask(finishHistoryOperation);
}, true);
document.addEventListener('input', e => {
  if (!cfg || !historyControls.includes(e.target.id) || historyPointer !== null) return;
  workspaceHistory.begin(`edit:${e.target.id}`);
}, true);
for (const name of ['change', 'blur']) document.addEventListener(name, e => {
  if (historyControls.includes(e.target.id) && historyPointer === null) queueMicrotask(finishHistoryOperation);
}, true);
document.addEventListener('wheel', e => {
  if (!cfg || exporting || (e.target !== c2 && e.target !== c3)) return;
  workspaceHistory.begin(`wheel:${e.target.id}`);
  clearTimeout(historyWheelTimer);
  historyWheelTimer = setTimeout(finishHistoryOperation, 350);
}, { capture: true, passive: true });
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing || !isUndoShortcut(e) || !cfg || document.querySelector('main').inert || $('scale-dialog').open) return;
  e.preventDefault();
  undoWorkspace();
});
