// Tests file/drop parser and settings with a minimal DOM, not browser automation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),frames=[];
function flush(){while(frames.length)frames.shift()();}
class El {
 constructor(){this.value='';this.style={};this.children=[];this.dataset={};this.classList={add(){},remove(){}};this.checked=false;this.textContent='';}
 set value(v){this._value=String(v);}
 get value(){return this._value;}
 replaceChildren(){this.children=[];this.value='';}
 add(o){this.children.push(o);if(this.children.length===1||o.selected)this.value=o.value;}
 append(...nodes){this.children.push(...nodes);}
 getBoundingClientRect(){return {left:0,top:0,width:720,height:650};}
 setAttribute(){} addEventListener(){} setPointerCapture(){}
 getContext(){return new Proxy({}, {get:()=>()=>{}});}
 querySelectorAll(sel){const all=this.children.flatMap(l=>l.children||[]).filter(x=>x.type==='checkbox');return sel.includes(':checked')?all.filter(x=>x.checked):all;}
}
const $=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
const context=vm.createContext({console,TextDecoder,DataView,Uint8Array,Float32Array,Float64Array,Array,Math,Number,JSON,Error,Option:class {constructor(text,value,def,selected){Object.assign(this,{text,value,selected});}},requestAnimationFrame:cb=>{frames.push(cb);return frames.length;},document:{getElementById:$,createElement:()=>new El(),createTextNode:text=>({text})}});
vm.runInContext(fs.readFileSync(__dirname+'/viewer.js','utf8'),context);
const file=path=>{const b=fs.readFileSync(path);return {name:path,size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
(async()=>{
 const f=file(__dirname+'/examples/actual-P-AFD.bfslice');
 await $('drop').ondrop({preventDefault(){},dataTransfer:{files:[f]}});
 assert.match($('status').textContent,/已加载/);assert.equal($('stride-x').value,'8');assert.equal($('stride-y').value,'8');assert.equal($('stride-z').value,'1');assert.equal(Number($('spatial').dataset.visiblePlanes),1);
 $('field').value='AFD';$('field').onchange();assert.equal($('quantity').textContent,'Φz [rad]');
 $('all').onclick();assert.equal(Number($('spatial').dataset.visiblePlanes),16);
 $('cmin').value='1';$('cmax').value='-1';$('cmin').oninput();flush();assert.match($('status').textContent,/下限必须小于上限/);
 const old=vm.runInContext('D',context);await vm.runInContext('importFile',context)({name:'bad',size:15,arrayBuffer:async()=>new ArrayBuffer(15)});assert.equal(vm.runInContext('D',context),old);assert.match($('status').textContent,/导入失败/);
 await vm.runInContext('importFile',context)(file(__dirname+'/validation-fixtures/coordinate-test.bfslice'));
 assert.equal(vm.runInContext('fields.AFD instanceof Float64Array',context),true);
 assert.equal(vm.runInContext('fields.AFD[0]',context),(3*(1*6*7+1*7+1)+.123456789)/1000);
 assert.equal(vm.runInContext('gridBoundary(0,1.6)',context),1);
 assert.equal(vm.runInContext('gridBoundary(0,.5)',context),0);
 assert.equal(vm.runInContext('gridBoundary(0,100)',context),4);
 vm.runInContext('layerStart=0;layerEnd=2;syncLayers();setLayer("start",9)',context);flush();
 assert.equal(vm.runInContext('layerStart',context),2);
 assert.equal(Number($('spatial').dataset.visiblePlanes),1);
 $('xmin').value='2';$('xmax').value='3';$('cmin').value='-5';$('cmax').value='5';$('xmin').oninput();flush();
 assert.equal(vm.runInContext('cfg.xmin',context),1.5);
 assert.equal(vm.runInContext('cfg.xmax',context),3.5);
 $('full').onclick();
 const q=vm.runInContext('({...cfg})',context),p=vm.runInContext('({...plot})',context);
 const screen=(i,j)=>({button:0,pointerId:1,preventDefault(){},clientX:p.left+(0.5+i-q.xmin)*p.s,clientY:p.top+(q.ymax-(0.5+j))*p.s});
 $('planar').onpointerdown(screen(3.1,2.1));$('planar').onpointermove(screen(.1,.1));$('planar').onpointerup();
 assert.ok(Math.abs(Number($('xmin').value)-1)<1e-12);assert.ok(Math.abs(Number($('xmax').value)-3)<1e-12);
 assert.ok(Math.abs(Number($('ymax').value)-2)<1e-12);
 assert.equal(vm.runInContext('cfg.x1-cfg.x0',context),3);
 assert.equal(vm.runInContext('cfg.y1-cfg.y0',context),2);
 const before=vm.runInContext('cfg.xmin',context);
 const p2=vm.runInContext('({...plot})',context);
 $('planar').onpointerdown({button:0,pointerId:1,preventDefault(){},clientX:p2.left+5,clientY:p2.top+5});$('planar').onpointercancel();
 assert.equal(vm.runInContext('cfg.xmin',context),before);
 // Single-plane input stays usable, with a fixed one-layer interval.
 vm.runInContext('D.shape_zyxc[0]=1;layerStart=layerEnd=0;syncLayers()',context);
 assert.equal($('layer-start').disabled,true);assert.equal($('layer-end').disabled,true);
 await vm.runInContext('importFile',context)(file(__dirname+'/examples/actual-BFO7-P.bfslice'));
 assert.equal($('cmin').value,'-0.7');assert.equal($('cmax').value,'0.7');
 assert.equal($('lo').textContent,'-0.7');assert.equal($('hi').textContent,'0.7');
 assert.ok(vm.runInContext('Array.from(A).every((v,i)=>i%3!==2||Math.abs(v)<=cfg.hi)',context));
 $('plane').value='6';$('plane').oninput();flush();assert.equal(vm.runInContext('cfg.k',context),6);
 assert.match($('plane-label').textContent,/第 7\/7 层/);
 for(const [v,expected] of [[0,.1],[.23,.3],[.680646,.7],[.70000001,.8],[-.91,1]]){
  vm.runInContext(`A=new Float64Array([0,0,${v}]);autoColor()`,context);
  assert.equal(Number($('cmax').value),expected);assert.ok(Number($('cmax').value)>=Math.abs(v));
  assert.match($('cmax').value,/^\d+\.\d$/);
 }
 for(const [plane,ny] of [['XY',200],['XZ',100]]){
  await vm.runInContext('importFile',context)(file(__dirname+'/examples/'+plane+'.00000019.dat'));
  assert.match($('status').textContent,/已加载/);
  assert.equal(vm.runInContext('D.shape_zyxc[1]',context),ny);assert.equal($('xmin').value,'1');assert.equal($('xmax').value,'200');assert.equal(Number($('ymax').value),ny);
  assert.equal($('plane').hidden,true);assert.equal($('plane').disabled,true);
  assert.equal($('layer-track').hidden,true);assert.equal($('layer-start').disabled,true);
  assert.match($('planar-title').textContent,new RegExp(plane));
  const rows=fs.readFileSync(__dirname+'/examples/'+plane+'.00000019.dat','utf8').trim().split(/\n/).map(l=>l.trim().split(/\s+/).map(Number));
  for(const r of rows){context.row=r;assert.deepEqual(Array.from(vm.runInContext('at(0,row[1]-1,row[0]-1)',context)),r.slice(2));}
  assert.ok(vm.runInContext('Array.from(A).every((v,i)=>i%3!==2||Math.abs(v)<=cfg.hi)',context));
 }
 assert.deepEqual(Array.from(vm.runInContext('physical([2,3,0])',context)),[2,0,3]);
 $('xmin').value='1';$('xmax').value='10';$('ymin').value='1';$('ymax').value='1';$('xmax').oninput();flush();
 assert.equal(vm.runInContext('cfg.x1-cfg.x0',context),10);assert.equal(vm.runInContext('cfg.y1-cfg.y0',context),1);assert.equal(vm.runInContext('cfg.xmax',context),10.5);
 $('full').onclick();
 const tp=vm.runInContext('({...plot})',context),tq=vm.runInContext('({...cfg})',context);
 const ev=(i,j)=>({button:0,pointerId:1,preventDefault(){},clientX:tp.left+i*tp.s,clientY:tp.top+tp.h-j*tp.s});
 $('planar').onpointerdown(ev(0,0));$('planar').onpointermove(ev(10,5));$('planar').onpointerup();
 assert.equal($('xmin').value,'1');assert.equal($('xmax').value,'10');assert.equal($('ymax').value,'5');
 $('planar').onpointerdown({button:0,pointerId:1,preventDefault(){},clientX:vm.runInContext('plot.left+2',context),clientY:vm.runInContext('plot.top+2',context)});$('planar').onpointercancel();assert.equal($('xmax').value,'10');
 assert.equal($('file-name').textContent,__dirname+'/examples/XZ.00000019.dat');assert.equal($('left-view').disabled,true);assert.equal($('mode3').disabled,true);
 console.log('PASS: text center ranges inclusive, single-row selection, box sync/cancel, full range');
 const parse=vm.runInContext('parsePlaneText',context);
 assert.throws(()=>parse('1 1 0 0 0\n1 1 1 1 1','XY.dat'),/重复/);
 assert.throws(()=>parse('1 1 0 0 0\n2 2 0 0 0','XZ.dat'),/不完整/);
 assert.throws(()=>parse('1 1 NaN 0 0','XY.dat'),/无效/);
 const shuffled=parse('2 2 1D-1 2 3\n1 1 4 5 6\n2 1 7 8 9\n1 2 10 11 12','XZ.dat');
 assert.deepEqual(Array.from(shuffled.parsed.P),[4,5,6,7,8,9,10,11,12,.1,2,3]);
 await vm.runInContext('importFile',context)(file(__dirname+'/examples/actual-BFO7-P.bfslice'));
 assert.equal($('plane').hidden,false);assert.equal($('layer-track').hidden,false);assert.equal($('plane').disabled,false);
 const cone=vm.runInContext('coneArrow',context);
 for(const vector of [[1,0,0],[0,1,0],[0,0,1],[0,0,-2],[1,2,3]]){
  const m=cone([4,5,6],vector),length=Math.hypot(...vector),n=vector.map(v=>v/length);
  assert.equal(m.faces.length,17);assert.equal(m.ring.length,16);
  for(const p of m.ring){const r=p.map((v,i)=>v-m.base[i]);assert.ok(Math.abs(Math.hypot(...r)-length*.1)<1e-12);assert.ok(Math.abs(r.reduce((sum,v,i)=>sum+v*n[i],0))<1e-12);}
  assert.ok(Math.abs(Math.hypot(...m.tip.map((v,i)=>v-m.shaft[0][i]))-length)<1e-12);
  assert.ok(m.faces.every(f=>f.points.flat().every(Number.isFinite)));
 }
 $('head-size').value='2';$('head-size').oninput();flush();assert.equal(vm.runInContext('cfg.headSize',context),2);assert.match($('head-label').textContent,/2.00/);
 $('shaft-size').value='3';$('shaft-size').oninput();flush();assert.equal(vm.runInContext('cfg.shaftSize',context),3);
 const small=cone([0,0,0],[1,2,3],16,.25),big=cone([0,0,0],[1,2,3],16,2.5);
 assert.deepEqual(Array.from(small.tip),Array.from(big.tip));assert.deepEqual(Array.from(small.shaft[0]),Array.from(big.shaft[0]));assert.ok(Math.abs(big.radius/small.radius-10)<1e-12);assert.ok(big.height<Math.hypot(1,2,3));
 const builds=vm.runInContext('meshBuilds',context);vm.runInContext('S.az+=.1;draw3();S.el+=.1;draw3()',context);assert.equal(vm.runInContext('meshBuilds',context),builds);assert.equal(vm.runInContext('D.spacing_nm.join() ',context),'1,1,1');assert.equal($('xmin').value,'1');assert.equal($('xmax').value,'200');console.log('PASS: grid coordinates and rotation geometry cache reuse');
 // View transformation preserves the same source volume and vector components.
 await vm.runInContext('importFile',context)(file(__dirname+'/validation-fixtures/coordinate-test.bfslice'));
 $('all').onclick();$('xmin').value='2';$('xmax').value='4';$('ymin').value='2';$('ymax').value='3';$('ymax').oninput();flush();
 const originalVec=Array.from(vm.runInContext('at(2,1,2)',context));
 $('left-view').value='XZ';$('left-view').onchange();
 assert.deepEqual(Array.from(vm.runInContext('at(1,2,2)',context)),originalVec);
 assert.equal($('ymin').value,'1');assert.equal($('ymax').value,'3');assert.equal(vm.runInContext('layerStart',context),1);assert.equal(vm.runInContext('layerEnd',context),2);
 assert.equal(vm.runInContext('normalAxis()',context),'y');
 $('left-view').value='XY';$('left-view').onchange();assert.equal($('ymin').value,'2');assert.equal($('ymax').value,'3');assert.equal(vm.runInContext('layerStart',context),0);assert.equal(vm.runInContext('layerEnd',context),2);
 // Capture raw face pixels to verify all six face corners against the data accessor.
 vm.runInContext(`testCanvases=[];originalCreate=document.createElement;document.createElement=tag=>{if(tag!=='canvas')return originalCreate(tag);const ctx={fillStyle:'',pixels:[],fillRect(x,y,w,h){this.pixels.push({x,y,color:this.fillStyle});}};const c={getContext:()=>ctx};testCanvases.push(c);return c;};cubeCache=null`,context);
 $('mode3').value='box';$('mode3').onchange();
 assert.equal(vm.runInContext('cubeCache.faces.length',context),6);
 assert.equal(vm.runInContext('visibleBoundaryFaces(cubeCache.faces).length',context),3);
 assert.ok(vm.runInContext(`cubeCache.faces.every(f=>{const [u,v]=[0,1,2].filter(a=>a!==f.axis),lows=[cfg.x0,cfg.y0,cfg.layers[0]];const ctx=f.texture.getContext('2d');return ctx.pixels.length===f.width*f.height&&ctx.pixels.every(pixel=>{const ids=lows.slice();ids[f.axis]=f.fixed;ids[u]+=pixel.x;ids[v]+=pixel.y;return pixel.color==='rgb('+color(at(ids[2],ids[1],ids[0])[2])+')';});})`,context));
 const built=vm.runInContext('cubeBuilds',context);const visible=vm.runInContext('visibleBoundaryFaces(cubeCache.faces).map(f=>f.label).join()',context);vm.runInContext('S.az+=Math.PI;S.el=-S.el;draw3()',context);
 assert.equal(vm.runInContext('cubeBuilds',context),built);assert.notEqual(vm.runInContext('visibleBoundaryFaces(cubeCache.faces).map(f=>f.label).join()',context),visible);
 assert.equal($('spatial').dataset.boundaryFaces.split(',').length,3);
 vm.runInContext('document.createElement=originalCreate',context);
 $('left-view').value='XZ';$('left-view').onchange();assert.equal(vm.runInContext('cfg.mode',context),'box');assert.equal(vm.runInContext('cubeCache.faces.length',context),6);
 $('mode3').value='arrows';$('mode3').onchange();assert.equal(vm.runInContext('cfg.mode',context),'arrows');
 // Palette changes must reach cached 3D colors, boundary textures and exported bars.
 const priorRange=vm.runInContext('JSON.stringify([cfg.lo,cfg.hi,cfg.x0,cfg.x1,cfg.layers])',context);
 for(const palette of ['rainbow','viridis','inferno','gray','custom','diverging']){
  const before=vm.runInContext('meshBuilds',context);
  $('palette').value=palette;$('palette').onchange();flush();
  assert.equal(vm.runInContext('cfg.palette',context),palette);
  assert.equal($('custom-colors').hidden,palette!=='custom');
  assert.ok(vm.runInContext('meshBuilds',context)>before);
  assert.equal(vm.runInContext('JSON.stringify([cfg.lo,cfg.hi,cfg.x0,cfg.x1,cfg.layers])',context),priorRange);
  assert.match($('colorbar').style.background,/linear-gradient/);
  assert.ok(vm.runInContext('meshCache.arrows.every(a=>a.rgb.every(v=>Number.isInteger(v)&&v>=0&&v<=255))',context));
 }
 $('palette').value='viridis';$('palette').onchange();flush();
 assert.equal(vm.runInContext('color(cfg.lo).join()',context),'68,1,84');
 assert.equal(vm.runInContext('color(cfg.hi).join()',context),'253,231,37');
 $('palette').value='custom';$('palette').onchange();$('color-low').value='#000000';$('color-high').value='#00ff80';$('color-high').oninput();flush();
 assert.equal(vm.runInContext('color(cfg.lo-100).join()',context),'0,0,0');
 assert.equal(vm.runInContext('color(cfg.hi+100).join()',context),'0,255,128');
 assert.equal(vm.runInContext('color((cfg.lo+cfg.hi)/2).join()',context),'0,128,64');
 $('mode3').value='box';$('mode3').onchange();
 const oldCube=vm.runInContext('cubeBuilds',context);
 $('color-low').value='#ff0000';$('color-low').oninput();flush();
 assert.ok(vm.runInContext('cubeBuilds',context)>oldCube);
 vm.runInContext(`exportPixels=[];document.createElement=tag=>{if(tag!=='canvas')return originalCreate(tag);const ctx=new Proxy({fillStyle:'',fillRect(x,y,w,h){if(x===750)exportPixels.push([y,this.fillStyle]);}},{get:(o,k)=>k in o?o[k]:()=>{}});return {getContext:()=>ctx};};exportWithColorbar(c2);exportWithColorbar(c3);document.createElement=originalCreate`,context);
 assert.equal(vm.runInContext('exportPixels.length',context),880);
 for(const offset of [0,440]){
  assert.equal(vm.runInContext(`exportPixels[${offset}][1]`,context),'rgb(0,255,128)');
  assert.equal(vm.runInContext(`exportPixels[${offset+439}][1]`,context),'rgb(255,0,0)');
 }
 console.log('PASS: six live palettes, custom endpoints/midpoint/clipping, unchanged ranges, 3D cache invalidation, both exported colorbars');
 // Anisotropic XYZ sampling, including nonzero crop origins and XY/XZ swaps.
 const hd={schema:'bfo-vector-slice-v1',shape_zyxc:[5,6,7,3],origin_nm:[0,0,0],spacing_nm:[1,1,1],index_ranges_xyz:[[20,27],[30,36],[40,45]],fields:[{name:'P',dtype:'float64',offset:0,bytes:5*6*7*3*8}]};
 const hb=Buffer.from(JSON.stringify(hd)),raw=Buffer.alloc(12+hb.length+hd.fields[0].bytes);raw.write('BFOSLC1\n');raw.writeUInt32LE(hb.length,8);hb.copy(raw,12);for(let i=12+hb.length;i<raw.length;i+=8)raw.writeDoubleLE(.1,i);
 await vm.runInContext('importFile',context)({name:'anisotropic.bfslice',size:raw.length,arrayBuffer:async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)});
 $('all').onclick();$('xmin').value=22;$('ymin').value=32;$('xmin').oninput();flush();
 vm.runInContext('setLayer("start",1)',context);flush();
 for(const [axis,value] of [['x',2],['y',2],['z',3]]){$('stride-'+axis).value=value;$('stride-'+axis).oninput();}flush();
 const expected=[];for(const z of [42,45])for(const y of [32,34,36])for(const x of [22,24,26])expected.push([x,y,z].join());
 const origins=()=>Array.from(vm.runInContext('arrowGeometry(cfg).arrows.map(a=>a.origin.join()).sort()',context));
 assert.deepEqual(origins(),expected.sort());assert.equal(Number($('spatial').dataset.arrows),18);
 assert.equal(vm.runInContext('cfg.layers.length',context),4);assert.equal(vm.runInContext('cfg.sampleLayers.length',context),2);
 vm.runInContext('savedArrow2=arrow2;planarCount=0;arrow2=()=>{planarCount++};draw2();arrow2=savedArrow2',context);assert.equal(vm.runInContext('planarCount',context),9);
 $('left-view').value='XZ';$('left-view').onchange();assert.deepEqual(origins(),expected.sort());
 vm.runInContext('planarCount=0;arrow2=()=>{planarCount++};draw2();arrow2=savedArrow2',context);assert.equal(vm.runInContext('planarCount',context),6);
 for(const plane of ['XZ','XY']){
  if($('left-view').value!==plane){$('left-view').value=plane;$('left-view').onchange();}
  $('mode3').value='box';$('mode3').onchange();
  const counts=JSON.parse(vm.runInContext('JSON.stringify(cubeCache.faces.map(f=>[f.label,f.arrows.length,f.width*f.height]))',context));
  for(const [label,n,pixels] of counts){assert.equal(n,label.startsWith('XY')?9:6);assert.equal(pixels,label.startsWith('XY')?30:label.startsWith('XZ')?24:20);}
 }
 const valid=vm.runInContext('cfg',context);
 for(const bad of ['0','-1','1.5','']){$('stride-z').value=bad;$('stride-z').oninput();flush();assert.equal(vm.runInContext('cfg',context),valid);}
 $('stride-z').value=100;$('stride-z').oninput();flush();$('mode3').value='arrows';$('mode3').onchange();assert.equal(Number($('spatial').dataset.arrows),9);
 assert.equal(vm.runInContext('cfg.layers.length',context),4);
 // Single-plane text uses source axes too (XZ vertical spacing is Z, not Y).
 for(const plane of ['XY','XZ']){
  const src=Array.from({length:5},(_,j)=>Array.from({length:7},(_,i)=>`${i+1} ${j+1} .1 .1 .1`).join('\n')).join('\n'),buf=Buffer.from(src);
  await vm.runInContext('importFile',context)({name:plane+'.dat',size:buf.length,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)});
  for(const [axis,value] of [['x',2],['y',2],['z',3]]){$('stride-'+axis).value=value;$('stride-'+axis).oninput();}flush();
  assert.equal(Number($('spatial').dataset.arrows),plane==='XY'?12:8);
 }
 console.log('PASS: independent XYZ strides, original-axis mapping across XY/XZ, cropped sampling origins, six face counts/full textures, single-plane text, invalid strides, large stride without shrinking selection');
 console.log('PASS: XY/XZ source vector mapping, round-trip region preservation, six exact boundary textures, visible-face changes and cache reuse, both modes');
 console.log('PASS: head/shaft live sliders and cone extremes preserve total length');
 console.log('PASS: cone circle radius, perpendicular base, 3D axis orientations, closed cap, preserved total length');
 console.log('PASS: XY/XZ all 60000 points, axis mapping, disabled/hidden single-plane controls, invalid grids, D exponent, reload multilayer;');
 console.log('PASS: live settings, grid snap with nonzero origin, slider inclusive range/clamping; drop handler, actual P/AFD, default stride, multilayer, invalid range/file retention, float64 exact decode');
})().catch(e=>{console.error(e);process.exitCode=1;});
