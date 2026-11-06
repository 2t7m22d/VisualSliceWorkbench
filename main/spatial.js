'use strict';

// GPU and compatible rendering share the same immutable display batches.
// Camera, palette and arrow-size edits never rebuild or re-upload instances.
let arrowGPU = null, arrowGPUFailure = '', arrowCPU = null;
let spatialTimer = null, spatialMovingUntil = 0, spatialGeneration = 0;
let gpuMotionBudget = 50000, cpuMotionBudget = 1500, previousSpatialFrame = 0, gpuRefineFrame = null, gpuRefineBudget = 32768;
const gpuCanvas = $('spatial-gpu'), cpuCanvas = $('spatial-cpu');

function markSpatialInteraction() {
  spatialMovingUntil = performance.now() + 180;
  clearTimeout(spatialTimer);
  spatialTimer = setTimeout(() => { if (cfg && render3DEnabled && !exporting) draw3(); }, 190);
}
function stopSpatial() {
  spatialGeneration++;
  if(gpuRefineFrame!==null)cancelAnimationFrame(gpuRefineFrame);gpuRefineFrame=null;
  clearTimeout(spatialTimer);
  arrowCPU?.cancel();
  gpuCanvas.hidden = cpuCanvas.hidden = true;
}
function spatialKey(q) {
  return JSON.stringify([loadId,planeName(),q.field,q.x0,q.x1,q.y0,q.y1,q.layers[0],q.layers.at(-1),q.steps]);
}
function rawVectorOffset(i,j,k) {
  return (!D.text_plane && planeName()==='XZ' ? (j*sourceD.shape_zyxc[1]+k)*sourceD.shape_zyxc[2]+i : (k*D.shape_zyxc[1]+j)*D.shape_zyxc[2]+i)*3;
}
function arrowGeometry(q,center) {
  const key=spatialKey(q);
  if(meshCache?.key===key)return meshCache;
  const capacity=q.sampleLayers.length*Math.ceil((q.x1-q.x0)/q.steps[0])*Math.ceil((q.y1-q.y0)/q.steps[1]);
  const batch=new ArrowBatch(capacity,center),field=fields[q.field],swap=planeName()==='XZ',textPlane=!!D.text_plane;
  for(const k of q.sampleLayers)for(let j=q.y0;j<q.y1;j+=q.steps[1])for(let i=q.x0;i<q.x1;i+=q.steps[0]) {
    const t=rawVectorOffset(i,j,k),x=coord(0,i),y=coord(1,j),z=coord(2,k);
    batch.add(x,swap?(textPlane?0:z):y,swap?y:(textPlane?0:z),field[t],field[t+1],field[t+2]);
  }
  return meshCache={key,batch};
}
function boundaryGeometry(q,center) {
  const key=spatialKey(q);
  if(cubeCache?.key===key)return cubeCache;
  const lows=[q.x0,q.y0,q.layers[0]],highs=[q.x1,q.y1,q.layers.at(-1)+1];
  const edges=lows.map((v,a)=>coord(a,v)-.5),ends=highs.map((v,a)=>coord(a,v-1)+.5),faces=[],field=fields[q.field];
  for(let axis=0;axis<3;axis++)for(const side of [-1,1]) {
    const [u,v]=[0,1,2].filter(a=>a!==axis),width=highs[u]-lows[u],height=highs[v]-lows[v];
    const fixed=side<0?lows[axis]:highs[axis]-1,normal=[0,0,0];normal[axis]=side;
    const origin=edges.slice();origin[axis]=side<0?edges[axis]:ends[axis];
    const du=[0,0,0],dv=[0,0,0];du[u]=ends[u]-edges[u];dv[v]=ends[v]-edges[v];
    const batch=new ArrowBatch(Math.ceil(width/q.steps[u])*Math.ceil(height/q.steps[v]),center);
    const scalar=new Float64Array(width*height),ids=[0,0,0];ids[axis]=fixed;
    for(let b=0;b<height;b++)for(let a=0;a<width;a++) {
      ids[u]=lows[u]+a;ids[v]=lows[v]+b;
      const t=rawVectorOffset(ids[0],ids[1],ids[2]);scalar[b*width+a]=field[t+2];
      if(a%q.steps[u] || b%q.steps[v])continue;
      const pos=ids.map((id,k)=>coord(k,id));pos[axis]=origin[axis];
      const p=sourceAxes(pos);batch.add(...p,field[t],field[t+1],field[t+2]);
    }
    const pn=sourceAxes(normal),label=['YZ','XZ','XY'][pn.findIndex(n=>n!==0)]+(side<0?'−':'+');
    const texture=document.createElement('canvas');texture.width=width;texture.height=height;
    faces.push({normal:pn,origin:sourceAxes(origin),du:sourceAxes(du),dv:sourceAxes(dv),texture,scalar,batch,label,width,height,axis,side,fixed});
  }
  return cubeCache={key,faces};
}
function visibleBoundaryFaces(faces) { return faces.filter(f=>proj(f.normal)[2]>1.e-7); }
function updateFaceColors(faces,q) {
  const key=JSON.stringify([q.lo,q.hi,q.colors]);
  for(const face of faces) {
    if(face.colorKey===key)continue;
    const ctx=face.texture.getContext('2d'),image=ctx.createImageData(face.width,face.height);
    for(let i=0;i<face.scalar.length;i++) {
      const rgb=arrowRGB(face.scalar[i],q),t=i*4;
      image.data[t]=rgb[0];image.data[t+1]=rgb[1];image.data[t+2]=rgb[2];image.data[t+3]=255;
    }
    ctx.putImageData(image,0,0);face.colorKey=key;
  }
}
function makeArrowScene(q,center,scale,screen) {
  const allFaces=q.mode==='box'?boundaryGeometry(q,center).faces:[],faces=visibleBoundaryFaces(allFaces);
  faces.sort((a,b)=>screen(a.origin)[2]-screen(b.origin)[2]);
  updateFaceColors(faces,q);
  const allBatches=allFaces.length?allFaces.map(f=>f.batch):[arrowGeometry(q,center).batch];
  const batches=faces.length?faces.map(f=>f.batch):allBatches;
  const depth=Math.max(1,...allBatches.map(b=>b.maxPosition+b.maxLength*q.scale*2+1));
  return {center,scale,screen,depth,basis:projectionMatrix,batches,allBatches,faces,allFaces};
}
function getArrowGPU() {
  if(!arrowGPU && !arrowGPUFailure) {
    try { arrowGPU=new ArrowGPU(gpuCanvas,()=>{ if(cfg && render3DEnabled)schedule3(); }); }
    catch(error){ arrowGPUFailure=error.message; }
  }
  if(arrowGPUFailure || arrowGPU?.lost || arrowGPU?.error)throw Error(arrowGPUFailure || arrowGPU.error || 'GPU上下文暂不可用');
  return arrowGPU;
}
function setSpatialInfo(backend,scene,total,shown,progress=false,note='') {
  const faceText=scene.faces.length?' · '+scene.faces.map(f=>f.label).join('、'):'';
  $('info').textContent=backend+' · '+(progress?'正在细化 ':shown<total?'交互预览 ':'显示 ')+shown.toLocaleString()+' / '+total.toLocaleString()+' 支箭头'+faceText+(note?' · '+note:'');
  $('info').title=$('info').textContent;
  $('render-status').textContent=backend;
  c3.dataset.backend=backend;c3.dataset.arrows=String(total);c3.dataset.renderedArrows=String(shown);
  c3.dataset.refining=String(progress);c3.dataset.boundaryFaces=scene.faces.map(f=>f.label).join(',');
}
function renderSpatial(scene,q,exportMode=false) {
  if(gpuRefineFrame!==null)cancelAnimationFrame(gpuRefineFrame);gpuRefineFrame=null;
  const start=performance.now(),moving=!exportMode && q.motion==='adaptive' && (drag!==null || start<spatialMovingUntil);
  const total=scene.batches.reduce((n,b)=>n+b.count,0),generation=++spatialGeneration;
  let gpu=null,note='';
  if(q.renderer!=='cpu')try{gpu=getArrowGPU();}catch(e){note='GPU不可用，已使用兼容绘制';}
  if(gpu) {
    arrowCPU?.cancel();cpuCanvas.hidden=true;
    try {
      if(!moving && !exportMode && total>80000) {
        let cursor=0,previous=performance.now();
        gpuCanvas.hidden=false;
        const refine=()=>{
          if(generation!==spatialGeneration || !render3DEnabled)return;
          const now=performance.now(),gap=now-previous;previous=now;
          if(cursor && gap>38)gpuRefineBudget=Math.max(4096,Math.floor(gpuRefineBudget*.75));
          else if(cursor && gap<23)gpuRefineBudget=Math.min(131072,Math.ceil(gpuRefineBudget*1.1));
          try {
            const r=gpu.render(scene,q,Infinity,1,false,{start:cursor,size:gpuRefineBudget});cursor+=r.shown;
            setSpatialInfo('GPU · WebGL2',scene,total,cursor,cursor<total);
            c3.dataset.gpuUploads=String(gpu.uploads);
            if(cursor<total)gpuRefineFrame=requestAnimationFrame(refine);else gpuRefineFrame=null;
          } catch(error) {
            arrowGPUFailure=error.message;gpuRefineFrame=null;renderSpatial(scene,q);
          }
        };
        refine();return;
      }
      const result=gpu.render(scene,q,moving?gpuMotionBudget:Infinity,exportMode?renderScale:1,moving);
      if(exportMode){g3.drawImage(gpuCanvas,0,0,720,650);return;}
      gpuCanvas.hidden=false;
      setSpatialInfo('GPU · WebGL2',scene,total,result.shown,false,moving && result.shown<total?'交互预览；停止后恢复完整密度':'');
      const elapsed=performance.now()-start,interval=start-previousSpatialFrame;
      if(moving && previousSpatialFrame && interval<120) {
        if(interval>34 || elapsed>12)gpuMotionBudget=Math.max(2000,Math.floor(gpuMotionBudget*.7));
        else if(interval<22 && elapsed<8)gpuMotionBudget=Math.min(100000,Math.ceil(gpuMotionBudget*1.06));
      }
      previousSpatialFrame=start;
      c3.dataset.frameMs=elapsed.toFixed(2);c3.dataset.gpuUploads=String(gpu.uploads);
      return;
    } catch(error) {
      if(exportMode)throw error;
      note='GPU绘制失败，已使用兼容绘制';arrowGPUFailure=error.message;
    }
  }
  gpuCanvas.hidden=true;
  if(!arrowCPU)arrowCPU=new ArrowCanvas(cpuCanvas);
  if(exportMode) {
    arrowCPU.render(scene,q,Infinity,renderScale,false);
    g3.drawImage(cpuCanvas,0,0,720,650);return;
  }
  cpuCanvas.hidden=false;
  const preview=moving?cpuMotionBudget:Infinity;
  const result=arrowCPU.render(scene,q,preview,1,!moving && total>3000,(done,n)=>{
    if(generation===spatialGeneration && render3DEnabled)setSpatialInfo('兼容 · Canvas',scene,total,done,done<n,note || (moving && n<total?'交互预览；停止后恢复完整密度':''));
  });
  if(moving)setSpatialInfo('兼容 · Canvas',scene,total,result.shown,false,note || (result.shown<total?'交互预览；停止后恢复完整密度':''));
  c3.dataset.frameMs=(performance.now()-start).toFixed(2);
}
$('renderer').value='auto';$('motion-quality').value='adaptive';
$('renderer').onchange=()=>{
  if(arrowGPUFailure && $('renderer').value!=='cpu')arrowGPUFailure='';
  stopSpatial();apply();
};
$('motion-quality').onchange=()=>{stopSpatial();apply();};
