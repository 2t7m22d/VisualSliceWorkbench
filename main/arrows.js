'use strict';

// The scientific arrays remain untouched. One compact display instance is eight
// float32 values (32 bytes), instead of a separate object/mesh for every arrow.
const MAX_ARROW_INSTANCES = 2000000;
class ArrowBatch {
  constructor(capacity, center) {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_ARROW_INSTANCES) throw Error('单个视图最多 200 万支箭头；请增加箭头间隔或缩小范围');
    this.width = 2048;
    this.data = new Float32Array(Math.max(1, Math.ceil(capacity / 1024)) * 8192);
    this.center = center;
    this.count = 0;
    this.maxLength = 0;
    this.maxPosition = 0;
  }
  add(x, y, z, px, py, pz) {
    if (px === 0 && py === 0 && pz === 0) return;
    const t = this.count++ * 8, d = this.data, c = this.center;
    d[t] = x - c[0]; d[t + 1] = y - c[1]; d[t + 2] = z - c[2];
    d[t + 3] = px; d[t + 4] = py; d[t + 5] = pz;
    this.maxLength = Math.max(this.maxLength, Math.hypot(px, py, pz));
    this.maxPosition = Math.max(this.maxPosition, Math.hypot(d[t], d[t + 1], d[t + 2]));
  }
  get height() { return Math.max(1, Math.ceil(this.count / 1024)); }
  get pixels() { return this.data.subarray(0, this.width * this.height * 4); }
}
function arrowSampleIndex(i, total, shown) {
  if (total === shown) return i;
  // One original instance per disjoint bin; deterministic jitter avoids the
  // planar aliasing produced by taking every Nth item in a 3D row-major array.
  const first = Math.floor(i * total / shown), end = Math.floor((i + 1) * total / shown);
  let h = (i + 17) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x7feb352d) >>> 0;
  h = Math.imul(h ^ h >>> 15, 0x846ca68b) >>> 0;
  h = (h ^ h >>> 16) >>> 0;
  return first + h % Math.max(1, end - first);
}
function arrowRGB(value, q) {
  const t = Math.max(0, Math.min(1, (value - q.lo) / (q.hi - q.lo))) * (q.colors.length - 1);
  const i = Math.min(Math.floor(t), q.colors.length - 2), f = t - i;
  return q.colors[i].map((v, c) => Math.round(v + f * (q.colors[i + 1][c] - v)));
}

const ARROW_COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 rightAxis, upAxis, frontAxis;
uniform float screenScale, depthExtent, arrowScale, headSize, shaftSize;
uniform vec3 colors[16];
uniform int colorCount, directionMode;
uniform float colorMin, colorMax;
vec3 mappedColor(float v) {
  float t=clamp((v-colorMin)/(colorMax-colorMin),0.,1.)*float(colorCount-1);
  int i=min(int(floor(t)),colorCount-2);
  return mix(colors[i],colors[i+1],t-float(i));
}
vec3 project(vec3 p) { return vec3(dot(p,rightAxis),dot(p,upAxis),dot(p,frontAxis)); }
vec4 clipPosition(vec3 p) {
  return vec4(p.x*screenScale/360.,(p.y*screenScale+15.)/325.,-p.z/depthExtent,1.);
}
`;
// Each head uses two triangles as a screen-space envelope. The fragment shader
// intersects the actual circular cone analytically, including its base and
// depth. Thus a million heads need 6M vertices, not 96M mesh vertices, while
// retaining a round 3D silhouette from every direction.
const ARROW_VERTEX = ARROW_COMMON + DirectionColors.glsl + `
layout(location=0) in vec3 meshPoint;
uniform highp sampler2D instances;
uniform int totalCount, shownCount, textureWidth, part, drawOffset;
out vec3 tint;
out float edge;
out vec3 rayPoint;
flat out vec3 coneAxis, coneTip;
flat out vec2 coneSize;
flat out int isShaft;
uint hash(uint n) { n=(n^(n>>16))*0x7feb352du; n=(n^(n>>15))*0x846ca68bu; return n^(n>>16); }
vec4 datum(int i) { return texelFetch(instances,ivec2(i%textureWidth,i/textureWidth),0); }
void main() {
  int i=gl_InstanceID+drawOffset;
  if(shownCount!=totalCount) {
    // Split the ratio to avoid overflowing a 32-bit integer product.
    int quotient=totalCount/shownCount, remainder=totalCount%shownCount;
    int first=i*quotient+int(floor(float(i)*float(remainder)/float(shownCount)));
    int end=(i+1)*quotient+int(floor(float(i+1)*float(remainder)/float(shownCount)));
    i=min(first+int(hash(uint(i+17))%uint(max(1,end-first))),totalCount-1);
  }
  vec4 a=datum(i*2), b=datum(i*2+1);
  vec3 origin=a.xyz, vector=vec3(a.w,b.xy);
  float magnitude=length(vector), len=magnitude*arrowScale;
  vec3 n=vector/max(magnitude,1.e-30);
  float height=len*.26*headSize, radius=len*.1*headSize;
  vec3 base=origin+n*(len*.5-height);
  tint=directionMode==1?directionColor(vector):mappedColor(vector.z);isShaft=part;edge=0.;
  coneAxis=project(n);coneTip=project(origin+n*len*.5);coneSize=vec2(height,radius);rayPoint=vec3(0);
  if(part==1) {
    vec3 tail=project(origin-n*len*.5), finish=project(base);
    vec2 delta=(finish-tail).xy;
    vec2 side=length(delta)>1.e-20?normalize(vec2(-delta.y,delta.x)):vec2(1,0);
    vec3 p=mix(tail,finish,meshPoint.x);
    vec4 clip=clipPosition(p);
    clip.xy+=side*(1.3*shaftSize*meshPoint.y)/vec2(360.,325.);
    edge=meshPoint.y;gl_Position=clip;
  } else {
    vec3 center=project(base+n*height*.5);
    float bound=length(vec2(height*.5,radius));
    rayPoint=center+vec3(meshPoint.xy*bound,bound*1.001);
    gl_Position=clipPosition(vec3(rayPoint.xy,center.z));
  }
}`;
const ARROW_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 tint;
in float edge;
in vec3 rayPoint;
flat in vec3 coneAxis, coneTip;
flat in vec2 coneSize;
flat in int isShaft;
uniform float depthExtent;
uniform int directionMode;
out vec4 pixel;
void main(){
  if(isShaft==1){
    pixel=vec4(abs(edge)>.654?vec3(.282,.329,.376):tint,1.);
    gl_FragDepth=gl_FragCoord.z;return;
  }
  float h=coneSize.x,r=coneSize.y;
  if(h<=1.e-20 || r<=1.e-20)discard;
  vec3 n=coneAxis,d=vec3(0,0,-1),o=rayPoint-coneTip;
  float c=h*h/(h*h+r*r),on=dot(o,n),dn=dot(d,n);
  float a=dn*dn-c,b=2.*(on*dn-c*dot(o,d)),cc=on*on-c*dot(o,o);
  float best=1.e30;vec3 normal=vec3(0);
  float discriminant=b*b-4.*a*cc;
  if(discriminant>=0.) {
    vec2 roots;
    if(abs(a)<1.e-7){roots=vec2(abs(b)>1.e-20?-cc/b:1.e30);}
    else {
      // Stable quadratic roots when one intersection lies close to the ray.
      float v=-.5*(b+(b>=0.?1.:-1.)*sqrt(discriminant));
      roots=abs(v)>1.e-25?vec2(v/a,cc/v):vec2(-b/(2.*a));
    }
    for(int i=0;i<2;i++) {
      float t=roots[i],axial=on+t*dn;
      if(t>=0. && t<best && axial>=-h && axial<=0.){
        best=t;normal=normalize(c*(o+t*d)-axial*n);
      }
    }
  }
  if(abs(dn)>1.e-7) {
    float t=(-h-on)/dn;
    vec3 radial=o+t*d+h*n;
    if(t>=0. && t<best && dot(radial,radial)<=r*r){best=t;normal=-n;}
  }
  if(best==1.e30)discard;
  float shade=.67+.33*max(0.,dot(normal,vec3(-.35,.45,.82)));
  pixel=vec4(tint*(directionMode==1?1.:shade),1.);
  gl_FragDepth=clamp(.5-.5*(rayPoint.z-best)/depthExtent,0.,1.);
}
`;
const FACE_VERTEX = ARROW_COMMON + `
uniform vec3 faceOrigin, faceU, faceV;
out vec2 uv;
void main(){
  vec2 corners[6]=vec2[](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
  uv=corners[gl_VertexID];
  gl_Position=clipPosition(project(faceOrigin+faceU*uv.x+faceV*uv.y));
}`;
const FACE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D faceTexture;
in vec2 uv;
out vec4 pixel;
void main(){pixel=texture(faceTexture,uv);}
`;

class ArrowGPU {
  constructor(canvas, onChange = () => {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {alpha:true,antialias:true,depth:true,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    if (!this.gl) throw Error('浏览器未提供 WebGL2');
    this.onChange = onChange;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost=true; onChange(); });
    canvas.addEventListener('webglcontextrestored', () => { try { this.init(); } catch (e) { this.error=e.message; } onChange(); });
    this.init();
  }
  compile(vertex, fragment) {
    const gl=this.gl, program=gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader=gl.createShader(type);
      gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    const names=['rightAxis','upAxis','frontAxis','screenScale','depthExtent','arrowScale','headSize','shaftSize','colors[0]','colorCount','directionMode','directionColorCount','directionColors[0]','colorMin','colorMax','instances','totalCount','shownCount','textureWidth','part','drawOffset','faceOrigin','faceU','faceV','faceTexture'];
    return {program, u:Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(program,n)]))};
  }
  init() {
    const gl=this.gl;
    this.lost=false;this.error=null;
    this.arrow=this.compile(ARROW_VERTEX,ARROW_FRAGMENT);
    this.face=this.compile(FACE_VERTEX,FACE_FRAGMENT);
    this.batches=new Map();this.textures=new Map();
    this.emptyVAO=gl.createVertexArray();
    const envelope=[];
    for(const [x,y] of [[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]])envelope.push(x,y,0,0,0,0);
    this.head=this.mesh(envelope);
    this.shaft=this.mesh([0,-1,0,0,0,0,1,-1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1,-1,0,0,0,0,1,1,0,0,0,0]);
    this.maxResolution=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    this.uploads=0;
  }
  mesh(values) {
    const gl=this.gl, vao=gl.createVertexArray(), buffer=gl.createBuffer();
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);
    for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);}
    return {vao,buffer,count:values.length/6};
  }
  setup(program,scene,q) {
    const gl=this.gl,u=program.u;
    gl.useProgram(program.program);
    gl.uniform3fv(u.rightAxis,scene.basis[0]);gl.uniform3fv(u.upAxis,scene.basis[1]);gl.uniform3fv(u.frontAxis,scene.basis[2]);
    gl.uniform1f(u.screenScale,scene.scale);gl.uniform1f(u.depthExtent,scene.depth);
    gl.uniform1f(u.arrowScale,q.scale);gl.uniform1f(u.headSize,q.headSize);gl.uniform1f(u.shaftSize,q.shaftSize);
    gl.uniform1i(u.directionMode,q.spatialColor==='direction'?1:0);
    const directionPalette=DirectionColors.presets[q.directionPreset || 'rainbow'].colors;
    gl.uniform1i(u.directionColorCount,directionPalette.length);
    if(directionPalette.length)gl.uniform3fv(u['directionColors[0]'],new Float32Array(directionPalette.flat().map(v=>v/255)));
    gl.uniform1f(u.colorMin,q.lo);gl.uniform1f(u.colorMax,q.hi);
    gl.uniform1i(u.colorCount,q.colors.length);gl.uniform3fv(u['colors[0]'],new Float32Array(q.colors.flat().map(v=>v/255)));
  }
  texture() {
    const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  render(scene,q,limit=Infinity,resolution=1,moving=false,range=null) {
    const gl=this.gl;
    if(this.lost || gl.isContextLost() || this.error) throw Error(this.error || 'GPU上下文暂不可用');
    const width=Math.round(720*resolution),height=Math.round(650*resolution);
    if(Math.max(width,height)>this.maxResolution) throw Error('当前GPU导出尺寸不足，请降低DPI');
    if(this.canvas.width!==width || this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);
    const first=!range || range.start===0;
    if(first)gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    // Explicitly release stale ranges. Rotation reuses resident textures.
    for(const [batch,t] of this.batches)if(!scene.allBatches.includes(batch)){gl.deleteTexture(t);this.batches.delete(batch);}
    for(const [face,t] of this.textures)if(!scene.allFaces.includes(face)){gl.deleteTexture(t.texture);this.textures.delete(face);}
    this.setup(this.face,scene,q);gl.bindVertexArray(this.emptyVAO);
    for(const f of first?scene.faces:[]) {
      let cached=this.textures.get(f);
      if(!cached){cached={texture:this.texture()};this.textures.set(f,cached);}
      gl.bindTexture(gl.TEXTURE_2D,cached.texture);
      if(cached.key!==f.colorKey){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,f.texture);cached.key=f.colorKey;}
      gl.uniform3fv(this.face.u.faceOrigin,f.origin.map((v,i)=>v-scene.center[i]));gl.uniform3fv(this.face.u.faceU,f.du);gl.uniform3fv(this.face.u.faceV,f.dv);
      gl.uniform1i(this.face.u.faceTexture,0);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    // Surface arrows intentionally overlay the visible heatmaps, as in the
    // original boundary view. Depth testing still resolves arrow/arrow overlap.
    if(first && scene.faces.length)gl.clear(gl.DEPTH_BUFFER_BIT);
    this.setup(this.arrow,scene,q);
    const cone=this.head,u=this.arrow.u;
    const total=scene.batches.reduce((n,b)=>n+b.count,0);
    let shown=0,calls=first?scene.faces.length:0,position=0;
    for(const batch of scene.batches) {
      if(!batch.count)continue;
      let t=this.batches.get(batch);
      if(!t) {
        t=this.texture();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,batch.width,batch.height,0,gl.RGBA,gl.FLOAT,batch.pixels);
        if(gl.getError()!==gl.NO_ERROR){gl.deleteTexture(t);throw Error('箭头数据无法载入GPU内存');}
        this.batches.set(batch,t);this.uploads++;
      } else gl.bindTexture(gl.TEXTURE_2D,t);
      const count=Math.min(batch.count,Math.max(1,Math.floor(limit*batch.count/Math.max(total,1))));
      const begin=range?Math.max(0,range.start-position):0;
      const end=range?Math.min(count,range.start+range.size-position):count;
      position+=count;
      if(end<=begin)continue;
      const drawing=end-begin;shown+=drawing;
      gl.uniform1i(u.drawOffset,begin);
      gl.uniform1i(u.instances,0);gl.uniform1i(u.textureWidth,batch.width);gl.uniform1i(u.totalCount,batch.count);gl.uniform1i(u.shownCount,count);
      gl.bindVertexArray(this.shaft.vao);gl.uniform1i(u.part,1);gl.drawArraysInstanced(gl.TRIANGLES,0,this.shaft.count,drawing);
      gl.bindVertexArray(cone.vao);gl.uniform1i(u.part,0);gl.drawArraysInstanced(gl.TRIANGLES,0,cone.count,drawing);calls+=2;
    }
    gl.bindVertexArray(null);
    this.last={shown,total,calls,resolution};
    return this.last;
  }
}

// Responsive fallback: no per-arrow mesh allocation. A projected circular
// cone is drawn by its elliptical base and two tangent silhouettes.
class ArrowCanvas {
  constructor(canvas) { this.canvas=canvas;this.ctx=canvas.getContext('2d');this.generation=0;this.frame=null; }
  cancel() { this.generation++;if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null; }
  *order(scene,limit) {
    const total=scene.batches.reduce((n,b)=>n+b.count,0);
    const sizes=scene.batches.map(b=>(b.count?Math.min(b.count,Math.max(1,Math.floor(limit*b.count/Math.max(1,total)))):0));
    const count=sizes.reduce((n,v)=>n+v,0), bins=2048, front=scene.basis[2];
    const offsets=new Uint32Array(count), owners=new Uint8Array(count), depths=new Uint16Array(count), counts=new Uint32Array(bins);
    let cursor=0;
    for(let bi=0;bi<scene.batches.length;bi++) {
      const batch=scene.batches[bi],d=batch.data,n=sizes[bi];
      for(let i=0;i<n;i++,cursor++) {
        const t=arrowSampleIndex(i,batch.count,n)*8;
        const depth=d[t]*front[0]+d[t+1]*front[1]+d[t+2]*front[2];
        const bin=Math.max(0,Math.min(bins-1,Math.floor((depth/scene.depth+1)*.5*bins)));
        offsets[cursor]=t;owners[cursor]=bi;depths[cursor]=bin;counts[bin]++;
        if((cursor&4095)===4095)yield null;
      }
    }
    let sum=0;
    for(let i=0;i<bins;i++){const n=counts[i];counts[i]=sum;sum+=n;}
    const sortedOffsets=new Uint32Array(count),sortedOwners=new Uint8Array(count);
    for(let i=0;i<count;i++) {
      const j=counts[depths[i]]++;
      sortedOffsets[j]=offsets[i];sortedOwners[j]=owners[i];
      if((i&4095)===4095)yield null;
    }
    // Linear-time depth buckets replace per-arrow objects and O(N log N) sort.
    return {offsets:sortedOffsets,owners:sortedOwners,count};
  }
  background(scene,resolution) {
    const c=this.canvas,g=this.ctx,w=Math.round(720*resolution),h=Math.round(650*resolution);
    if(c.width!==w || c.height!==h){c.width=w;c.height=h;}
    g.setTransform(resolution,0,0,resolution,0,0);g.clearRect(0,0,720,650);
    for(const f of scene.faces) {
      const p=scene.screen(f.origin),u=scene.screen(f.origin.map((v,i)=>v+f.du[i])),v=scene.screen(f.origin.map((v,i)=>v+f.dv[i]));
      g.save();g.imageSmoothingEnabled=false;g.transform((u[0]-p[0])/f.width,(u[1]-p[1])/f.width,(v[0]-p[0])/f.height,(v[1]-p[1])/f.height,p[0],p[1]);
      g.drawImage(f.texture,0,0);g.restore();
    }
  }
  arrow(batch,t,scene,q) {
    const d=batch.data,b=scene.basis,s=scene.scale,g=this.ctx;
    const px=d[t+3],py=d[t+4],pz=d[t+5],mag=Math.hypot(px,py,pz),len=mag*q.scale;
    const n=[px/mag,py/mag,pz/mag],ref=Math.abs(n[2])>.9?[0,1,0]:[0,0,1];
    let u=[n[1]*ref[2]-n[2]*ref[1],n[2]*ref[0]-n[0]*ref[2],n[0]*ref[1]-n[1]*ref[0]];
    const ul=Math.hypot(...u);u=u.map(v=>v/ul);
    const w=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
    const dot=(v,a)=>v[0]*a[0]+v[1]*a[1]+v[2]*a[2];
    const x=360+s*(d[t]*b[0][0]+d[t+1]*b[0][1]+d[t+2]*b[0][2]),y=310-s*(d[t]*b[1][0]+d[t+1]*b[1][1]+d[t+2]*b[1][2]);
    const nx=dot(n,b[0])*s,ny=-dot(n,b[1])*s,height=len*.26*q.headSize,radius=len*.1*q.headSize;
    const tipx=x+nx*len/2,tipy=y+ny*len/2,basex=tipx-nx*height,basey=tipy-ny*height;
    if(Math.max(x,tipx,basex)+radius*s<0 || Math.min(x,tipx,basex)-radius*s>720 || Math.max(y,tipy,basey)+radius*s<0 || Math.min(y,tipy,basey)-radius*s>650)return;
    const rgb=q.spatialColor==='direction'?DirectionColors.spatial(px,py,pz,q.directionPreset):arrowRGB(pz,q),color='rgb('+rgb+')';
    g.beginPath();g.moveTo(x-nx*len/2,y-ny*len/2);g.lineTo(basex,basey);
    g.strokeStyle='#485460';g.lineWidth=2.6*q.shaftSize;g.stroke();g.strokeStyle=color;g.lineWidth=1.7*q.shaftSize;g.stroke();
    const bx=dot(u,b[0])*radius*s,by=-dot(u,b[1])*radius*s,cx=dot(w,b[0])*radius*s,cy=-dot(w,b[1])*radius*s;
    // Exact tangent parameter of the projected ellipse. Near edge-on use a
    // narrow triangle instead of unstable division by the determinant.
    const det=bx*cy-by*cx,dx=tipx-basex,dy=tipy-basey;
    const tx=(dx*cy-dy*cx)/det,ty=(bx*dy-by*dx)/det,dist=Math.hypot(tx,ty);
    g.fillStyle=color;g.beginPath();
    if(Math.abs(det)<1.e-8) {
      const size=Math.hypot(bx,by)>Math.hypot(cx,cy)?[bx,by]:[cx,cy];
      g.moveTo(tipx,tipy);g.lineTo(basex+size[0],basey+size[1]);g.lineTo(basex-size[0],basey-size[1]);
    } else if(dist<=1) {
      for(let i=0;i<16;i++){const a=i*Math.PI/8;const xx=basex+bx*Math.cos(a)+cx*Math.sin(a),yy=basey+by*Math.cos(a)+cy*Math.sin(a);if(i)g.lineTo(xx,yy);else g.moveTo(xx,yy);}
    } else {
      const mid=Math.atan2(ty,tx),angle=Math.acos(1/dist);
      g.moveTo(tipx,tipy);
      for(let i=0;i<=12;i++){const a=mid+angle+(2*Math.PI-2*angle)*i/12;g.lineTo(basex+bx*Math.cos(a)+cx*Math.sin(a),basey+by*Math.cos(a)+cy*Math.sin(a));}
    }
    g.closePath();g.fill();
  }
  render(scene,q,limit=Infinity,resolution=1,progressive=false,onProgress=()=>{}) {
    this.cancel();const generation=this.generation;
    const total=scene.batches.reduce((n,b)=>n+b.count,0),iterator=this.order(scene,limit);
    const shown=scene.batches.reduce((n,b)=>n+(b.count?Math.min(b.count,Math.max(1,Math.floor(limit*b.count/Math.max(1,total)))):0),0);
    this.background(scene,resolution);
    // Give immediate feedback while the complete frame is prepared in short,
    // cancellable slices. This preview uses actual instances, never averages.
    if(progressive && q.motion!=='full') {
      const preview=this.order(scene,Math.min(800,shown));let step;
      do{step=preview.next();}while(!step.done);
      for(let i=0;i<step.value.count;i++)this.arrow(scene.batches[step.value.owners[i]],step.value.offsets[i],scene,q);
    }
    let ordered=null,cursor=0;
    const chunk=()=>{
      if(generation!==this.generation)return;
      const start=performance.now();
      while(!ordered) {
        const step=iterator.next();
        if(step.done){ordered=step.value;this.background(scene,resolution);break;}
        if(progressive && performance.now()-start>=6){onProgress(0,shown);this.frame=requestAnimationFrame(chunk);return;}
      }
      do {
        const stop=Math.min(cursor+32,ordered.count);
        for(;cursor<stop;cursor++)this.arrow(scene.batches[ordered.owners[cursor]],ordered.offsets[cursor],scene,q);
      }while(cursor<ordered.count && (!progressive || performance.now()-start<6));
      onProgress(cursor,shown);
      if(cursor<ordered.count)this.frame=requestAnimationFrame(chunk);else this.frame=null;
    };
    if(progressive){onProgress(0,shown);this.frame=requestAnimationFrame(chunk);}else chunk();
    return {shown,total};
  }
}
