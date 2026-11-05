'use strict';
const $=id=>document.getElementById(id),c2=$('planar'),c3=$('spatial'),g2=c2.getContext('2d'),g3=c3.getContext('2d');
let sourceD=null;let D=null, fields={}, A=null, cfg=null, plot=null, loadId=0, layerStart=0, layerEnd=0, box=null;
const S={az:-56*Math.PI/180,el:46*Math.PI/180,zoom:1};
function status(s,error=false){$('status').textContent=s;$('status').className=error?'error':'';}
function assert(ok,msg){if(!ok)throw Error(msg);}
async function importFile(file){const token=++loadId;try{
 assert(file && file.size<=128*1024*1024,'请选择不超过128 MiB的切片文件；较大数据请先缩小切片。');status('正在读取并核验 '+file.name+' …');$('drop').classList.add('loading');
 const buffer=await file.arrayBuffer();if(token!==loadId)return;const view=new DataView(buffer),dec=new TextDecoder('utf-8',{fatal:true});
 let d,parsed;
 if(buffer.byteLength<8 || dec.decode(new Uint8Array(buffer,0,8))!=='BFOSLC1\n'){({d,parsed}=parsePlaneText(dec.decode(buffer),file.name));}else{
 const size=view.getUint32(8,true);assert(size>0&&size<=1048576&&12+size<=buffer.byteLength,'切片头损坏');
 d=JSON.parse(dec.decode(new Uint8Array(buffer,12,size)));assert(d.schema==='bfo-vector-slice-v1','不支持的切片版本');
 assert(Array.isArray(d.shape_zyxc)&&d.shape_zyxc.length===4&&d.shape_zyxc[3]===3&&d.shape_zyxc.every(v=>Number.isSafeInteger(v)&&v>0),'网格尺寸不正确');
 const count=d.shape_zyxc.reduce((a,b)=>a*b,1);assert(Number.isSafeInteger(count)&&count<=32000000,'网格过大');
 for(const key of ['origin_nm','spacing_nm'])assert(Array.isArray(d[key])&&d[key].length===3&&d[key].every(Number.isFinite),'缺少有效坐标');assert(d.spacing_nm.every(v=>v>0),'步长必须为正');
 assert(Array.isArray(d.fields)&&d.fields.length>0&&d.fields.length<=2,'场列表不正确');let offset=0;parsed={};
 for(const f of d.fields){assert(['P','AFD'].includes(f.name)&&!parsed[f.name],'场名称错误或重复');assert(['float32','float64'].includes(f.dtype),'精度不支持');const n=f.dtype==='float32'?4:8;
 assert(f.offset===offset&&f.bytes===count*n&&12+size+offset+f.bytes<=buffer.byteLength,'场长度或偏移错误');const a=n===4?new Float32Array(count):new Float64Array(count);
 for(let i=0;i<count;i++){a[i]=n===4?view.getFloat32(12+size+offset+i*n,true):view.getFloat64(12+size+offset+i*n,true);assert(Number.isFinite(a[i]),'场中存在 NaN/Inf');}parsed[f.name]=a;offset+=f.bytes;}
 assert(12+size+offset===buffer.byteLength,'文件截断或含多余字节');}
 if(!d.text_plane){d.source_origin_nm=d.origin_nm.slice();d.source_spacing_nm=d.spacing_nm.slice();const ranges=d.index_ranges_xyz;
 d.origin_nm=[0,1,2].map(axis=>.5+(Array.isArray(ranges?.[axis])&&Number.isSafeInteger(ranges[axis][0])?ranges[axis][0]:0));d.spacing_nm=[1,1,1];}
 d.grid_coordinates=true;meshCache=null;cubeCache=null;sourceD=d;D=d;fields=parsed;$('left-view').value=d.text_plane||'XY';$('left-view').disabled=!!d.text_plane;$('mode3').value='arrows';$('mode3').disabled=!!d.text_plane;$('mode-note').textContent=d.text_plane?'单切面文件：仅可显示文件提供的切面，长方体需要体数据。':'范围控制当前切面，双圆圈控制法向范围；两图共享选区。';updateLabels();$('field').replaceChildren();
 for(const f of d.fields){const op=new Option(f.name==='P'?(d.text_plane?'极化 P（源单位）':'极化 P (C/m²)'):'AFD Φ (rad)',f.name);$('field').add(op);}
 const nz=d.shape_zyxc[0],mid=Math.floor((nz-1)/2);
 $('plane').min=0;$('plane').max=nz-1;$('plane').value=mid;$('plane').disabled=nz===1;
 layerStart=layerEnd=mid;box=null;syncLayers();
 $('controls').disabled=false;$('plane-controls').disabled=false;$('volume-controls').disabled=false;$('field-control').hidden=d.fields.length<2;$('plane').hidden=!!d.text_plane;$('layer-track').hidden=!!d.text_plane;$('all').hidden=!!d.text_plane;$('one').hidden=!!d.text_plane;fullRange();$('stride-x').value=8;$('stride-y').value=8;$('stride-z').value=1;changeField();$('file-name').textContent=file.name;$('file-name').title=file.name;$('drop').classList.add('loaded');status(`${file.name} · ${d.shape_zyxc.slice(0,3).reverse().join(' × ')} 格点 (${d.text_plane?'切面网格':'x × y × z'}) · 格点坐标（含两端） · 已加载`);
 }catch(e){if(token===loadId)status('导入失败：'+e.message+'。已加载的旧数据保持不变。',true);}finally{if(token===loadId)$('drop').classList.remove('loading');}}

function parsePlaneText(source,name){
 const plane=name.split(/[\\/]/).pop().match(/^(XY|XZ)/i)?.[1].toUpperCase();
 assert(plane,'文本文件名必须以 XY 或 XZ 开头');
 const rows=[];
 for(const [index,line] of source.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  const t=line.trim();if(!t||t.startsWith('#'))continue;
  const parts=t.split(/\s+/);assert(parts.length===5,`第${index+1}行必须有5列`);
  const row=parts.map(x=>Number(x.replace(/[dD]/g,'e')));assert(row.every(Number.isFinite),`第${index+1}行含无效数值`);rows.push(row);
 }
 assert(rows.length>0,'文本没有数据点');assert(rows.length*3<=32000000,'网格过大');
 const xs=[...new Set(rows.map(r=>r[0]))].sort((a,b)=>a-b),ys=[...new Set(rows.map(r=>r[1]))].sort((a,b)=>a-b);
 function step(values){if(values.length===1)return 1;const h=values[1]-values[0];assert(h>0&&Number.isFinite(h),'坐标间隔无效');assert(values.every((v,i)=>Math.abs(v-(values[0]+i*h))<=Math.max(1e-9,h*1e-6)),'目前支持完整等间距矩形网格；坐标间隔不一致');return h;}
 const dx=step(xs),dy=step(ys);assert(xs.length*ys.length===rows.length,'切面网格不完整或含重复点');
 const a=new Float64Array(rows.length*3),seen=new Set(),xi=new Map(xs.map((v,i)=>[v,i])),yi=new Map(ys.map((v,i)=>[v,i]));
 for(const r of rows){const t=yi.get(r[1])*xs.length+xi.get(r[0]);assert(!seen.has(t),'存在重复坐标点');seen.add(t);a.set(r.slice(2),t*3);}
 return {d:{title:name,text_plane:plane,shape_zyxc:[1,ys.length,xs.length,3],origin_nm:[xs[0]-dx/2,ys[0]-dy/2,-.5],spacing_nm:[dx,dy,1],fields:[{name:'P'}],coordinates:`${plane} 单切面；坐标及 P 单位沿用源文件；未提供的法向坐标置0，仅用于展示`},parsed:{P:a}};
}
function planeName(){return D?.text_plane||$('left-view').value||'XY';}
function normalAxis(){return planeName()==='XZ'?'y':'z';}
function verticalAxis(){return planeName()==='XZ'?'z':'y';}
function unit(){return '格点';}
function physical(v){return planeName()==='XZ'?[v[0],v[2],v[1]]:v;}
function updateLabels(){
 $('x-label').textContent=`x 范围（${unit()}，含两端）`;$('y-label').textContent=`${verticalAxis()} 范围（${unit()}，含两端）`;
 $('vertical-range').style.order=planeName()==='XZ'?2:1;$('normal-range').style.order=planeName()==='XZ'?1:2;
 $('normal-label').textContent=D?.text_plane?`${normalAxis()} 范围（文件未提供）`:`${normalAxis()} 范围（格点，三维选层）`;for(const suffix of ['min','max']){$('n'+suffix).disabled=!!D?.text_plane;$('n'+suffix).setAttribute('aria-label',normalAxis()+(suffix==='min'?'下限':'上限'));}
 $('ymin').setAttribute('aria-label',verticalAxis()+'下限');$('ymax').setAttribute('aria-label',verticalAxis()+'上限');
 $('planar-title').textContent='平面图 / '+planeName();$('planar-help').textContent=`底色为 pz / Φz，黑箭头为 ${planeName()==='XZ'?'(px, pz)':'(x, y)'} 分量；拖动框选，移动指针读数。`;
 $('scale-label').textContent=`箭头长度（${unit()} / 单位场）`;
 c2.setAttribute('aria-label',planeName()+'原始格点平面图');$('plane').setAttribute('aria-label','左图 '+planeName()+' 层');
}

function coord(axis,i){return D.origin_nm[axis]+(i+.5)*D.spacing_nm[axis];}
function fullRange(){if(!D)return;for(const [axis,n] of [[0,D.shape_zyxc[2]],[1,D.shape_zyxc[1]]]){const name=axis?'y':'x';$(name+'min').value=coord(axis,0);$(name+'max').value=coord(axis,n-1);}}
function changeField(){A=fields[$('field').value];$('scale').value=$('field').value==='P'?2.5:8;autoColor();apply();}
function autoColor(){if(!A)return;let m=0;for(let i=2;i<A.length;i+=3)m=Math.max(m,Math.abs(A[i]));m=Math.max(.1,Math.ceil(m*10)/10);$('cmin').value=(-m).toFixed(1);$('cmax').value=m.toFixed(1);}
function at(k,j,i){const t=(!D.text_plane&&planeName()==='XZ'?((j*sourceD.shape_zyxc[1]+k)*sourceD.shape_zyxc[2]+i):((k*D.shape_zyxc[1]+j)*D.shape_zyxc[2]+i))*3,v=fields[cfg.field];return [v[t],v[t+1],v[t+2]];}
function apply(){if(!D)return;try{
 const q={lo:Number($('cmin').value),hi:Number($('cmax').value),xmin:Number($('xmin').value),xmax:Number($('xmax').value),ymin:Number($('ymin').value),ymax:Number($('ymax').value),strideX:Number($('stride-x').value),strideY:Number($('stride-y').value),strideZ:Number($('stride-z').value),scale:Number($('scale').value),k:Number($('plane').value),headSize:Number($('head-size').value),shaftSize:Number($('shaft-size').value)};
 assert(['cmin','cmax','xmin','xmax','ymin','ymax','stride-x','stride-y','stride-z','scale'].every(id=>$(id).value.trim()!==''),'输入不能为空');assert(Object.values(q).every(Number.isFinite),'请输入有限数值');assert(q.lo<q.hi,'色标下限必须小于上限');assert([q.strideX,q.strideY,q.strideZ].every(v=>Number.isSafeInteger(v)&&v>=1)&&q.scale>0,'X/Y/Z 箭头间隔须为正整数、长度须为正数');
 q.palette=$('palette').value;q.colorLow=$('color-low').value;q.colorHigh=$('color-high').value;
 assert(q.palette==='custom'||Object.hasOwn(PALETTES,q.palette),'请选择有效配色');
 assert([q.colorLow,q.colorHigh].every(v=>/^#[0-9a-f]{6}$/i.test(v)),'请选择有效的双色端点');
 q.colors=q.palette==='custom'?[hexRGB(q.colorLow),hexRGB(q.colorHigh)]:PALETTES[q.palette];
 q.inputRanges={xmin:q.xmin,xmax:q.xmax,ymin:q.ymin,ymax:q.ymax};
 for(const [axis,n] of [[0,D.shape_zyxc[2]],[1,D.shape_zyxc[1]]]){
  const name=axis?'y':'x',lo=q[name+'min'],hi=q[name+'max'],o=coord(axis,0),end=coord(axis,n-1);
  assert(lo<=hi&&lo>=o-1e-8&&hi<=end+1e-8,`${axis?verticalAxis():'x'}范围须在 ${o}–${end} ${unit()} 内（含两端格点）`);
  const ids=[];for(let i=0;i<n;i++)if(coord(axis,i)>=lo-1e-10&&coord(axis,i)<=hi+1e-10)ids.push(i);
  assert(ids.length,'所选范围没有格点');q[name+'0']=ids[0];q[name+'1']=ids.at(-1)+1;
  {q[name+'min']=coord(axis,ids[0])-D.spacing_nm[axis]/2;q[name+'max']=coord(axis,ids.at(-1))+D.spacing_nm[axis]/2;}
 }

 // Local axes are x,y,z in XY view and x,z,y in XZ view.
 q.steps=planeName()==='XZ'?[q.strideX,q.strideZ,q.strideY]:[q.strideX,q.strideY,q.strideZ];
 q.layers=Array.from({length:layerEnd-layerStart+1},(_,i)=>layerStart+i);assert(q.layers.length,'请至少选择一层三维图');
 q.sampleLayers=q.layers.filter((_,i)=>i%q.steps[2]===0);
 const [nx,ny,nz]=[q.x1-q.x0,q.y1-q.y0,q.layers.length].map((n,a)=>Math.ceil(n/q.steps[a]));
 const arrows=$('mode3').value==='box'?2*(nx*ny+nx*nz+ny*nz):nx*ny*nz;
 assert(arrows<=80000,`预计${arrows}支箭头；请增大间隔或减少层数（上限80000）`);
 assert(q.headSize>=.25&&q.headSize<=2.5&&q.shaftSize>=.3&&q.shaftSize<=5,'箭头外观设置超出范围');q.field=$('field').value;q.mode=$('mode3').value||'arrows';cfg=q;draw();status(`${D.title||'切片'} · 当前场 ${$('field').value} · 显示 ${q.layers.length} 层 · 实时更新`);
 }catch(e){status(e.message+'；图像保留上次有效设置。',true);}}
// Standard Matplotlib palettes sampled at all 256 entries, embedded for offline use.
function hexRGB(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
const PALETTES={
 diverging:[[33,102,172],[247,247,247],[178,24,43]],
 rainbow: '8000ff7e03ff7c06ff7a09ff780dff7610ff7413ff7216ff7019ff6e1cff6c1fff6a22fe6826fe6629fe642cfe622ffe6032fe5e35fe5c38fd5a3bfd583efd5641fd5444fd5247fc504afc4e4dfc4c50fc4a53fb4856fb4659fb445cfb425ffa4062fa3e65fa3c68f9396bf9386df93670f83473f83176f83079f72e7bf72c7ef72981f62884f62686f52489f5218cf4208ef41e91f31c93f31996f31898f2169bf2149df111a0f110a2f00ea5ef0ca7ef09a9ee08acee06aeed04b0ed01b3ec00b5eb02b7eb04b9ea07bbea08bee90ac0e80dc2e80fc4e710c6e612c8e614cae517cbe418cde41acfe31dd1e21fd3e120d5e122d6e024d8df27dade28dbde2adddd2ddedc2fe0db30e1da32e3da34e4d937e6d838e7d73ae8d63dead53febd540ecd442edd344eed246efd148f1d04af2cf4df3ce4ef3cd50f4cc52f5cb54f6cb56f7ca58f8c95af8c85df9c75efac660fac562fbc464fbc366fcc268fcc16afdc06dfdbf6efebe70febc72febb74feba76ffb978ffb87affb77dffb67effb580ffb482ffb384ffb286ffb088ffaf8bfeae8cfead8efeac90feab92fda994fda896fca799fca69bfba59cfba49efaa2a0faa1a2f9a0a4f89fa6f89da8f79cabf69bacf59aaef498b0f397b2f396b4f295b6f193b9ef92bbee91bced8fbeec8ec0eb8dc2ea8cc4e88ac6e789c8e688cbe486cce385cee184d0e082d2de81d4dd80d6db7ed9da7ddbd87bdcd67aded579e0d377e2d176e4cf74e6cd73e8cb72ebca70ecc86feec66df0c46cf2c26bf4c069f6be68f9bb66fbb965fcb763feb562ffb360ffb05fffae5effac5cffa95bffa759ffa558ffa256ffa055ff9d53ff9b52ff9850ff964fff934dff914cff8e4aff8c49ff8947ff8646ff8444ff8143ff7e41ff7b40ff793eff763dff733bff703aff6d38ff6b37ff6835ff6533ff6232ff5f30ff5c2fff592dff562cff532aff5029ff4d27ff4a26ff4724ff4422ff4121ff3e1fff3b1eff381cff351bff3219ff2f18ff2c16ff2914ff2613ff2211ff1f10ff1c0eff190dff160bff1309ff1008ff0d06ff0905ff0603ff0302ff0000'.match(/.{6}/g).map(hex=>hexRGB('#'+hex)),
 viridis: '44015444025645045745055946075a46085c460a5d460b5e470d60470e6147106347116447136548146748166848176948186a481a6c481b6d481c6e481d6f481f70482071482173482374482475482576482677482878482979472a7a472c7a472d7b472e7c472f7d46307e46327e46337f463480453581453781453882443983443a83443b84433d84433e85423f854240864241864142874144874045884046883f47883f48893e49893e4a893e4c8a3d4d8a3d4e8a3c4f8a3c508b3b518b3b528b3a538b3a548c39558c39568c38588c38598c375a8c375b8d365c8d365d8d355e8d355f8d34608d34618d33628d33638d32648e32658e31668e31678e31688e30698e306a8e2f6b8e2f6c8e2e6d8e2e6e8e2e6f8e2d708e2d718e2c718e2c728e2c738e2b748e2b758e2a768e2a778e2a788e29798e297a8e297b8e287c8e287d8e277e8e277f8e27808e26818e26828e26828e25838e25848e25858e24868e24878e23888e23898e238a8d228b8d228c8d228d8d218e8d218f8d21908d21918c20928c20928c20938c1f948c1f958b1f968b1f978b1f988b1f998a1f9a8a1e9b8a1e9c891e9d891f9e891f9f881fa0881fa1881fa1871fa28720a38620a48621a58521a68522a78522a88423a98324aa8325ab8225ac8226ad8127ad8128ae8029af7f2ab07f2cb17e2db27d2eb37c2fb47c31b57b32b67a34b67935b77937b87838b9773aba763bbb753dbc743fbc7340bd7242be7144bf7046c06f48c16e4ac16d4cc26c4ec36b50c46a52c56954c56856c66758c7655ac8645cc8635ec96260ca6063cb5f65cb5e67cc5c69cd5b6ccd5a6ece5870cf5773d05675d05477d1537ad1517cd2507fd34e81d34d84d44b86d54989d5488bd6468ed64590d74393d74195d84098d83e9bd93c9dd93ba0da39a2da37a5db36a8db34aadc32addc30b0dd2fb2dd2db5de2bb8de29bade28bddf26c0df25c2df23c5e021c8e020cae11fcde11dd0e11cd2e21bd5e21ad8e219dae319dde318dfe318e2e418e5e419e7e419eae51aece51befe51cf1e51df4e61ef6e620f8e621fbe723fde725'.match(/.{6}/g).map(hex=>hexRGB('#'+hex)),
 inferno: '00000401000501010601010802010a02020c02020e03021004031204031405041706041907051b08051d09061f0a07220b07240c08260d08290e092b10092d110a30120a32140b34150b37160b39180c3c190c3e1b0c411c0c431e0c451f0c48210c4a230c4c240c4f260c51280b53290b552b0b572d0b592f0a5b310a5c320a5e340a5f3609613809623909633b09643d09653e0966400a67420a68440a68450a69470b6a490b6a4a0c6b4c0c6b4d0d6c4f0d6c510e6c520e6d540f6d550f6d57106e59106e5a116e5c126e5d126e5f136e61136e62146e64156e65156e67166e69166e6a176e6c186e6d186e6f196e71196e721a6e741a6e751b6e771c6d781c6d7a1d6d7c1d6d7d1e6d7f1e6c801f6c82206c84206b85216b87216b88226a8a226a8c23698d23698f24699025689225689326679526679727669827669a28659b29649d29649f2a63a02a63a22b62a32c61a52c60a62d60a82e5fa92e5eab2f5ead305dae305cb0315bb1325ab3325ab43359b63458b73557b93556ba3655bc3754bd3853bf3952c03a51c13a50c33b4fc43c4ec63d4dc73e4cc83f4bca404acb4149cc4248ce4347cf4446d04545d24644d34743d44842d54a41d74b3fd84c3ed94d3dda4e3cdb503bdd513ade5238df5337e05536e15635e25734e35933e45a31e55c30e65d2fe75e2ee8602de9612bea632aeb6429eb6628ec6726ed6925ee6a24ef6c23ef6e21f06f20f1711ff1731df2741cf3761bf37819f47918f57b17f57d15f67e14f68013f78212f78410f8850ff8870ef8890cf98b0bf98c0af98e09fa9008fa9207fa9407fb9606fb9706fb9906fb9b06fb9d07fc9f07fca108fca309fca50afca60cfca80dfcaa0ffcac11fcae12fcb014fcb216fcb418fbb61afbb81dfbba1ffbbc21fbbe23fac026fac228fac42afac62df9c72ff9c932f9cb35f8cd37f8cf3af7d13df7d340f6d543f6d746f5d949f5db4cf4dd4ff4df53f4e156f3e35af3e55df2e661f2e865f2ea69f1ec6df1ed71f1ef75f1f179f2f27df2f482f3f586f3f68af4f88ef5f992f6fa96f8fb9af9fc9dfafda1fcffa4'.match(/.{6}/g).map(hex=>hexRGB('#'+hex)),
 gray:[[0,0,0],[255,255,255]]
};
function color(v){const t=Math.max(0,Math.min(1,(v-cfg.lo)/(cfg.hi-cfg.lo)))*(cfg.colors.length-1),i=Math.min(Math.floor(t),cfg.colors.length-2),u=t-i,a=cfg.colors[i],b=cfg.colors[i+1];return a.map((x,c)=>Math.round(x+(b[c]-x)*u));}
function syncColorbar(){
 $('colorbar').style.background='linear-gradient(to right,'+cfg.colors.map((rgb,i)=>`rgb(${rgb}) ${i/(cfg.colors.length-1)*100}%`).join(',')+')';
}

function text(g,s,x,y,align='left',size=14){g.fillStyle='#273849';g.font=size+'px system-ui';g.textAlign=align;g.fillText(s,x,y);}
function line(g,points,color,width){g.beginPath();points.forEach((p,i)=>i?g.lineTo(...p.slice(0,2)):g.moveTo(...p.slice(0,2)));g.strokeStyle=color;g.lineWidth=width;g.stroke();}
function arrow2(g,x,y,dx,dy){if(Math.hypot(dx,dy)<.02)return;const tx=x+dx/2,ty=y+dy/2,bx=tx-.28*dx,by=ty-.28*dy;line(g,[[x-dx/2,y-dy/2],[tx,ty]],'#17212a',1.3);line(g,[[bx-.12*dy,by+.12*dx],[tx,ty],[bx+.12*dy,by-.12*dx]],'#17212a',1.3);}
function draw2(){if(box){paintBox();return;}const q=cfg,s=Math.min(550/(q.xmax-q.xmin),520/(q.ymax-q.ymin)),w=(q.xmax-q.xmin)*s,h=(q.ymax-q.ymin)*s,left=80+(550-w)/2,top=45+(520-h)/2;plot={s,w,h,left,top};g2.clearRect(0,0,720,650);g2.save();g2.beginPath();g2.rect(left,top,w,h);g2.clip();let clipped=0;
 for(let j=q.y0;j<q.y1;j++)for(let i=q.x0;i<q.x1;i++){const p=at(q.k,j,i);if(p[2]<q.lo||p[2]>q.hi)clipped++;g2.fillStyle='rgb('+color(p[2])+')';const x=D.origin_nm[0]+i*D.spacing_nm[0],y=D.origin_nm[1]+j*D.spacing_nm[1];g2.fillRect(left+(x-q.xmin)*s,top+h-(y+D.spacing_nm[1]-q.ymin)*s,D.spacing_nm[0]*s+.1,D.spacing_nm[1]*s+.1);}
 for(let j=q.y0;j<q.y1;j+=q.steps[1])for(let i=q.x0;i<q.x1;i+=q.steps[0]){const p=at(q.k,j,i);arrow2(g2,left+(coord(0,i)-q.xmin)*s,top+h-(coord(1,j)-q.ymin)*s,p[0]*q.scale*s,-p[planeName()==='XZ'?2:1]*q.scale*s);}g2.restore();
 line(g2,[[left,top],[left,top+h],[left+w,top+h]],'#7a8997',1);
 for(const t of [0,.5,1]){const x=coord(0,q.x0)+(coord(0,q.x1-1)-coord(0,q.x0))*t,y=coord(1,q.y0)+(coord(1,q.y1-1)-coord(1,q.y0))*t;text(g2,Number(x.toPrecision(7)).toString(),left+(x-q.xmin)*s,top+h+24,'center');text(g2,Number(y.toPrecision(7)).toString(),left-8,top+h-(y-q.ymin)*s+5,'right');}
 text(g2,`x [${unit()}]`,left+w/2,625,'center');text(g2,`${verticalAxis()} [${unit()}]`,10,30);text(g2,D.text_plane?`${planeName()} 单切面`:`层 ${q.k+1} · ${normalAxis()} = ${coord(2,q.k).toPrecision(6)} 格点`,360,22,'center');$('clipping').textContent=`左图超色标：${clipped} / ${(q.x1-q.x0)*(q.y1-q.y0)} 格点`;}
let projectionAz=null,projectionEl=null,projectionMatrix=null;
function proj(v){if(S.az!==projectionAz||S.el!==projectionEl){const ca=Math.cos(S.az),sa=Math.sin(S.az),ce=Math.cos(S.el),se=Math.sin(S.el);projectionMatrix=[[-sa,ca,0],[-se*ca,-se*sa,ce],[ce*ca,ce*sa,se]];projectionAz=S.az;projectionEl=S.el;}const m=projectionMatrix;return [m[0][0]*v[0]+m[0][1]*v[1],m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];}
let meshCache=null,meshBuilds=0;
function arrowGeometry(q){const key=JSON.stringify([planeName(),q.field,q.x0,q.x1,q.y0,q.y1,q.layers,q.steps,q.scale,q.headSize,q.lo,q.hi,q.palette,q.colorLow,q.colorHigh]);if(meshCache?.key===key)return meshCache;
 const arrows=[];let clipped=0;
 for(const k of q.sampleLayers)for(let j=q.y0;j<q.y1;j+=q.steps[1])for(let i=q.x0;i<q.x1;i+=q.steps[0]){const p=at(k,j,i),o=physical([coord(0,i),coord(1,j),coord(2,k)]),v=p.map(x=>x*q.scale);if(p[2]<q.lo||p[2]>q.hi)clipped++;if(!Math.hypot(...v))continue;arrows.push({mesh:coneArrow(o,v,16,q.headSize),origin:o,rgb:color(p[2])});}
 meshBuilds++;return meshCache={key,arrows,clipped};
}
// Circular, closed cone in physical 3D coordinates, independent of view direction.
function coneArrow(origin,vector,segments=16,headSize=1){
 const length=Math.hypot(...vector),n=vector.map(v=>v/length),reference=Math.abs(n[2])>.9?[0,1,0]:[0,0,1];
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 let u=cross(n,reference);const ul=Math.hypot(...u);u=u.map(v=>v/ul);const w=cross(n,u);
 const tip=origin.map((v,i)=>v+vector[i]/2),tail=origin.map((v,i)=>v-vector[i]/2),height=length*.26*headSize,radius=length*.1*headSize,base=tip.map((v,i)=>v-n[i]*height);
 const radial=t=>u.map((v,i)=>v*Math.cos(t)+w[i]*Math.sin(t));
 const ring=Array.from({length:segments},(_,j)=>radial(j*2*Math.PI/segments).map((v,i)=>base[i]+radius*v));
 const faces=[];
 for(let j=0;j<segments;j++){
  const r=radial((j+.5)*2*Math.PI/segments),normal=r.map((v,i)=>v*height+n[i]*radius),nl=Math.hypot(...normal);
  faces.push({points:[tip,ring[j],ring[(j+1)%segments]],normal:normal.map(v=>v/nl)});
 }
 faces.push({points:ring,normal:n.map(v=>-v)});
 return {shaft:[tail,base],tip,base,ring,faces,height,radius};
}
function renderArrows(q,arrows,screen){for(const a of arrows)a.depth=screen(a.origin)[2];
 arrows.sort((a,b)=>a.depth-b.depth);
 for(const a of arrows){
  const projected=new Map();const vertex=v=>{let p=projected.get(v);if(!p){p=screen(v);projected.set(v,p);}return p;};
  const parts=[];for(const face of a.mesh.faces){const normal=proj(face.normal);if(normal[2]<=0)continue;parts.push({points:face.points.map(vertex),normal});}
  parts.push({points:a.mesh.shaft.map(screen),shaft:true});
  for(const part of parts)part.depth=part.points.reduce((sum,p)=>sum+p[2],0)/part.points.length;
  parts.sort((a,b)=>a.depth-b.depth);
  for(const part of parts){
   if(part.shaft){line(g3,part.points,'#485460',2.6*q.shaftSize);line(g3,part.points,'rgb('+a.rgb+')',1.7*q.shaftSize);continue;}
   const normal=part.normal,light=[-.35,.45,.82],shade=.67+.33*Math.max(0,normal.reduce((sum,x,i)=>sum+x*light[i],0));
   g3.beginPath();part.points.forEach((p,i)=>i?g3.lineTo(p[0],p[1]):g3.moveTo(p[0],p[1]));g3.closePath();
   g3.fillStyle='rgb('+a.rgb.map(v=>Math.round(v*shade))+')';g3.fill();
  }
 }

}
function draw3(){const q=cfg,zmin=coord(2,Math.min(...q.layers))-D.spacing_nm[2]/2,zmax=coord(2,Math.max(...q.layers))+D.spacing_nm[2]/2,center=[(q.xmin+q.xmax)/2,(q.ymin+q.ymax)/2,(zmin+zmax)/2],s=500/Math.hypot(q.xmax-q.xmin,q.ymax-q.ymin,zmax-zmin)*S.zoom;
 const pc=physical(center);const screen=v=>{const p=proj([v[0]-pc[0],v[1]-pc[1],v[2]-pc[2]]);return [360+p[0]*s,310-p[1]*s,p[2]];};g3.clearRect(0,0,720,650);
 if(q.mode!=='box'){for(const z of [zmin,zmax])line(g3,[[q.xmin,q.ymin,z],[q.xmax,q.ymin,z],[q.xmax,q.ymax,z],[q.xmin,q.ymax,z],[q.xmin,q.ymin,z]].map(v=>screen(physical(v))),'#c3d0d9',1);
 for(const x of [q.xmin,q.xmax])for(const y of [q.ymin,q.ymax])line(g3,[[x,y,zmin],[x,y,zmax]].map(v=>screen(physical(v))),'#c3d0d9',1);}
 const {arrows,clipped}=q.mode==='box'?{arrows:[],clipped:0}:arrowGeometry(q);for(const a of arrows)a.depth=screen(a.origin)[2];
 if(q.mode==='box'){
  const shown=drawBoundaryBox(q,screen);$('info').textContent=`可见边界面：${shown.faces.join('、')}；${shown.count} 支三维箭头`;c3.dataset.boundaryFaces=shown.faces.join(',');c3.dataset.arrows=shown.count;
 }else{renderArrows(q,arrows,screen);c3.dataset.boundaryFaces='';}

 for(let i=0;i<3;i++){let v=[0,0,0];v[i]=1;const p=proj(v),end=[65+p[0]*35,575-p[1]*35];line(g3,[[65,575],end],'#345',2);text(g3,['x','y','z'][i],end[0]+5,end[1]-5);}
 text(g3,D.text_plane?`${planeName()} 单切面 · ${planeName()==='XZ'?'y':'z'}=0（展示位置）`:`${q.layers.length}层 · ${normalAxis()}=${coord(2,q.layers[0])}–${coord(2,q.layers.at(-1))} 格点`,360,25,'center');text(g3,D.text_plane?'正交投影 · 格点坐标':'正交投影 · x/y/z 按格点等比例',360,620,'center');if(q.mode!=='box')$('info').textContent=`选区 ${q.layers.length} 层，箭头采样 ${q.sampleLayers.length} 层；${arrows.length} 支非零箭头；其中 ${clipped} 支超色标；缩放 ${S.zoom.toFixed(2)} 倍。`;c3.dataset.visiblePlanes=q.layers.length;c3.dataset.sampledPlanes=q.sampleLayers.length;if(q.mode!=='box')c3.dataset.arrows=arrows.length;}

let cubeCache=null,cubeBuilds=0;
function boundaryGeometry(q){
 const key=JSON.stringify([planeName(),q.field,q.x0,q.x1,q.y0,q.y1,q.layers,q.lo,q.hi,q.steps,q.scale,q.headSize,q.palette,q.colorLow,q.colorHigh]);if(cubeCache?.key===key)return cubeCache;
 const lows=[q.x0,q.y0,q.layers[0]],highs=[q.x1,q.y1,q.layers.at(-1)+1];
 const edges=lows.map((v,a)=>coord(a,v)-D.spacing_nm[a]/2),ends=highs.map((v,a)=>coord(a,v-1)+D.spacing_nm[a]/2),faces=[];
 for(let axis=0;axis<3;axis++)for(const side of [-1,1]){
  const axes=[0,1,2].filter(a=>a!==axis),[u,v]=axes,width=highs[u]-lows[u],height=highs[v]-lows[v];
  const fixed=side<0?lows[axis]:highs[axis]-1,normal=[0,0,0];normal[axis]=side;
  const origin=edges.slice();origin[axis]=side<0?edges[axis]:ends[axis];const du=[0,0,0],dv=[0,0,0];du[u]=ends[u]-edges[u];dv[v]=ends[v]-edges[v];
  const texture=document.createElement('canvas');texture.width=width;texture.height=height;const ctx=texture.getContext('2d'),arrows=[];
  for(let b=0;b<height;b++)for(let a=0;a<width;a++){
   const ids=[0,0,0];ids[axis]=fixed;ids[u]=lows[u]+a;ids[v]=lows[v]+b;const p=at(ids[2],ids[1],ids[0]);
   ctx.fillStyle='rgb('+color(p[2])+')';ctx.fillRect(a,b,1,1);
   if(a%q.steps[u]||b%q.steps[v]||!Math.hypot(...p))continue;
   const pos=ids.map((id,k)=>coord(k,id));pos[axis]=origin[axis];const o=physical(pos);arrows.push({origin:o,mesh:coneArrow(o,p.map(x=>x*q.scale),16,q.headSize),rgb:color(p[2])});
  }
  const pn=physical(normal),pa=pn.findIndex(n=>n!==0),label=['YZ','XZ','XY'][pa]+(side<0?'−':'+');
  faces.push({normal:pn,origin:physical(origin),du:physical(du),dv:physical(dv),texture,arrows,label,axis,side,fixed,width,height});
 }
 cubeBuilds++;return cubeCache={key,faces};
}
function visibleBoundaryFaces(faces){return faces.filter(f=>proj(f.normal)[2]>1e-7);}
function drawBoundaryBox(q,screen){
 const faces=visibleBoundaryFaces(boundaryGeometry(q).faces),add=(a,b)=>a.map((v,i)=>v+b[i]);
 faces.sort((a,b)=>screen(a.origin)[2]-screen(b.origin)[2]);
 // Draw all opaque heatmap faces first, then overlay full 3D vectors on visible faces.
 for(const f of faces){const o=screen(f.origin),u=screen(add(f.origin,f.du)),v=screen(add(f.origin,f.dv));
  g3.save();g3.imageSmoothingEnabled=false;g3.setTransform((u[0]-o[0])/f.width,(u[1]-o[1])/f.width,(v[0]-o[0])/f.height,(v[1]-o[1])/f.height,o[0],o[1]);g3.drawImage(f.texture,0,0);g3.restore();
  line(g3,[o,u,screen(add(add(f.origin,f.du),f.dv)),v,o],'#637b88',1);
 }
 const arrows=faces.flatMap(f=>f.arrows);renderArrows(q,arrows,screen);return {faces:faces.map(f=>f.label),count:arrows.length};
}
function changeView(){if(!sourceD||sourceD.text_plane)return;box=null;const old=cfg,previousD=D,previousK=$('plane').value,previousStart=layerStart,previousEnd=layerEnd,swap=$('left-view').value==='XZ';
 D={...sourceD,shape_zyxc:swap?[sourceD.shape_zyxc[1],sourceD.shape_zyxc[0],sourceD.shape_zyxc[2],3]:sourceD.shape_zyxc.slice(),origin_nm:swap?[sourceD.origin_nm[0],sourceD.origin_nm[2],sourceD.origin_nm[1]]:sourceD.origin_nm.slice(),spacing_nm:[1,1,1]};
 const nz=D.shape_zyxc[0];$('plane').max=nz-1;$('plane').value=Math.floor((old.y0+old.y1-1)/2);$('plane').disabled=nz===1;
 layerStart=old.y0;layerEnd=old.y1-1;
 $('ymin').value=coord(1,old.layers[0]);$('ymax').value=coord(1,old.layers.at(-1));meshCache=null;cubeCache=null;updateLabels();syncLayers();apply();if(cfg===old){D=previousD;$('left-view').value=swap?'XY':'XZ';layerStart=previousStart;layerEnd=previousEnd;$('plane').max=D.shape_zyxc[0]-1;$('plane').value=previousK;for(const name of ['xmin','xmax','ymin','ymax'])$(name).value=old.inputRanges[name];updateLabels();syncLayers();}
}
$('left-view').onchange=changeView;
$('mode3').onchange=()=>{if(!D)return;if(D.text_plane){$('mode3').value='arrows';return;}box=null;apply();};

function draw(){if(!cfg)return;syncColorbar();$('full-below').hidden=cfg.x0===0&&cfg.x1===D.shape_zyxc[2]&&cfg.y0===0&&cfg.y1===D.shape_zyxc[1];c3.setAttribute('aria-label',cfg.mode==='box'?'六面边界热图与三维箭头':'多层三维矢量图');$('spatial-help').textContent=cfg.mode==='box'?'XY/XZ/YZ 六面热图；可见面叠加完整三维箭头。拖动旋转，滚轮缩放。':'拖动旋转，滚轮缩放。圆锥箭头头部，长度正比于矢量模长。';for(const id of ['plane','head-size','shaft-size']){const el=$(id),lo=Number(el.min),hi=Number(el.max);el.style.setProperty?.('--progress',((Number(el.value)-lo)/(hi-lo||1)*100)+'%');}$('head-label').textContent=`三维头部大小：${cfg.headSize.toFixed(2)} 倍`;$('shaft-label').textContent=`三维柄部粗细：${cfg.shaftSize.toFixed(2)} 倍`;draw2();draw3();$('quantity').textContent=cfg.field==='P'?(D.text_plane?'Pz [源单位]':'Pz [C/m²]'):'Φz [rad]';$('lo').textContent=colorLabel(cfg.lo);$('hi').textContent=colorLabel(cfg.hi);$('plane-label').textContent=D.text_plane?`左图 ${planeName()}：单切面（无需选层）`:`左图 ${planeName()}：第 ${cfg.k+1}/${D.shape_zyxc[0]} 层 · ${normalAxis()}=${Number(coord(2,cfg.k).toPrecision(8))} 格点`;$('plane').setAttribute('aria-valuetext',`第${cfg.k+1}层，${normalAxis()}=${coord(2,cfg.k)} 格点`);}
$('file').onchange=e=>importFile(e.target.files[0]);$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('over');};$('drop').ondragleave=()=>$('drop').classList.remove('over');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('over');return importFile(e.dataTransfer.files[0]);};
function colorLabel(v){return Number.isInteger(v*10)?v.toFixed(1):String(v);}
$('field').onchange=changeField;$('plane').oninput=live;
let liveFrame=null;
function live(){if(liveFrame===null)liveFrame=requestAnimationFrame(()=>{liveFrame=null;apply();});}
$('palette').value='diverging';$('color-low').value='#2166ac';$('color-high').value='#b2182b';
$('palette').onchange=()=>{$('custom-colors').hidden=$('palette').value!=='custom';live();};
$('color-low').oninput=$('color-high').oninput=live;
$('left-view').value='XY';$('mode3').value='arrows';$('head-size').value=1;$('shaft-size').value=1;
for(const id of ['cmin','cmax','xmin','xmax','ymin','ymax','stride-x','stride-y','stride-z','scale','head-size','shaft-size'])$(id).oninput=live;
$('full-below').onclick=$('full').onclick=()=>{box=null;fullRange();apply();};$('autoColor').onclick=()=>{autoColor();apply();};
$('all').onclick=()=>{if(!D)return;layerStart=0;layerEnd=D.shape_zyxc[0]-1;syncLayers();apply();};
$('one').onclick=()=>{if(!D)return;layerStart=layerEnd=Number($('plane').value);syncLayers();apply();};
function syncLayers(){const max=D.shape_zyxc[0]-1; $('nmin').value=D.text_plane?'':coord(2,layerStart);$('nmax').value=D.text_plane?'':coord(2,layerEnd);
 for(const [id,k] of [['layer-start',layerStart],['layer-end',layerEnd]]){const e=$(id);e.style.left=(max?k/max*100:50)+'%';e.style.transform=layerStart===layerEnd?(id==='layer-start'?'translateX(-85%)':'translateX(-15%)'):'translateX(-50%)';e.setAttribute('aria-valuemax',max+1);e.setAttribute('aria-valuenow',k+1);e.setAttribute('aria-valuetext',`第${k+1}层，${normalAxis()}=${coord(2,k).toPrecision(6)} 格点`);e.disabled=max===0;}
 $('layer-fill').style.left=(max?layerStart/max*100:50)+'%';$('layer-fill').style.width=(max?(layerEnd-layerStart)/max*100:0)+'%';
 $('layer-range-label').textContent=D.text_plane?`三维：${planeName()} 单切面`:`三维 ${normalAxis()}：第 ${layerStart+1}–${layerEnd+1} 层（${layerEnd-layerStart+1}层）`;
}
function setLayer(which,k){k=Math.max(0,Math.min(D.shape_zyxc[0]-1,k));if(which==='start')layerStart=Math.min(k,layerEnd);else layerEnd=Math.max(k,layerStart);syncLayers();live();}
let layerDrag=null;
function trackIndex(e){const r=$('layer-track').getBoundingClientRect();return Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*(D.shape_zyxc[0]-1));}
$('layer-track').onpointerdown=e=>{if(!D||D.shape_zyxc[0]===1)return;e.preventDefault();const k=trackIndex(e);const rr=$('layer-track').getBoundingClientRect(),same=layerStart===layerEnd;layerDrag=same?(e.clientX<rr.left+rr.width*layerStart/(D.shape_zyxc[0]-1)?'start':'end'):e.target.id==='layer-start'?'start':e.target.id==='layer-end'?'end':Math.abs(k-layerStart)<Math.abs(k-layerEnd)?'start':k<layerStart?'start':'end';$('layer-track').setPointerCapture(e.pointerId);setLayer(layerDrag,k);};
$('layer-track').onpointermove=e=>{if(layerDrag)setLayer(layerDrag,trackIndex(e));};$('layer-track').onpointerup=$('layer-track').onpointercancel=()=>layerDrag=null;
for(const [id,which] of [['layer-start','start'],['layer-end','end']])$(id).onkeydown=e=>{if(!D)return;const k=which==='start'?layerStart:layerEnd;const v={ArrowLeft:k-1,ArrowDown:k-1,ArrowRight:k+1,ArrowUp:k+1,Home:0,End:D.shape_zyxc[0]-1}[e.key];if(v!==undefined){e.preventDefault();setLayer(which,v);}};
$('reset').onclick=()=>{S.az=-56*Math.PI/180;S.el=46*Math.PI/180;S.zoom=1;if(cfg)draw3();};let drag=null,frame=null;
function schedule3(){if(!frame)frame=requestAnimationFrame(()=>{frame=null;if(cfg)draw3();});}
c3.onpointerdown=e=>{drag=[e.clientX,e.clientY];c3.setPointerCapture(e.pointerId);};c3.onpointerup=c3.onpointercancel=()=>drag=null;c3.onpointermove=e=>{if(!drag)return;S.az-=(e.clientX-drag[0])*.008;S.el=Math.max(-Math.PI/2+.001,Math.min(Math.PI/2-.001,S.el+(e.clientY-drag[1])*.006));drag=[e.clientX,e.clientY];schedule3();};c3.addEventListener('wheel',e=>{e.preventDefault();S.zoom=Math.min(5,Math.max(.25,S.zoom*Math.exp(-e.deltaY*.001)));schedule3();},{passive:false});
c2.onpointermove=e=>{if(!plot)return;const r=c2.getBoundingClientRect(),x=(e.clientX-r.left)*720/r.width,y=(e.clientY-r.top)*650/r.height,q=plot;if(x<q.left||x>=q.left+q.w||y<q.top||y>=q.top+q.h)return;const wx=cfg.xmin+(x-q.left)/q.s,wy=cfg.ymax-(y-q.top)/q.s,i=Math.floor((wx-D.origin_nm[0])/D.spacing_nm[0]),j=Math.floor((wy-D.origin_nm[1])/D.spacing_nm[1]);if(i<0||i>=D.shape_zyxc[2]||j<0||j>=D.shape_zyxc[1])return;const p=at(cfg.k,j,i);$('sample').textContent=`格点 (${i},${j},${cfg.k}) · 中心 (${physical([coord(0,i),coord(1,j),coord(2,cfg.k)]).map(v=>v.toPrecision(5)).join(', ')}) ${unit()} · ${cfg.field}=(${p.map(v=>v.toPrecision(7)).join(', ')})`;};
function exportWithColorbar(source){
 const out=document.createElement('canvas');out.width=940;out.height=650;const g=out.getContext('2d');
 g.fillStyle='#ffffff';g.fillRect(0,0,out.width,out.height);g.drawImage(source,0,0);
 const x=750,y=100,w=24,h=440;
 for(let row=0;row<h;row++){const value=cfg.hi-(cfg.hi-cfg.lo)*row/(h-1);g.fillStyle='rgb('+color(value)+')';g.fillRect(x,y+row,w,1);}
 g.strokeStyle='#8897a3';g.lineWidth=.8;g.strokeRect(x,y,w,h);
 text(g,$('quantity').textContent,x-5,y-26,'left',15);
 for(let i=0;i<=4;i++){const value=i===0?cfg.hi:i===4?cfg.lo:cfg.hi-(cfg.hi-cfg.lo)*i/4,yy=y+h*i/4;
  line(g,[[x+w,yy],[x+w+6,yy]],'#536575',1);
  const label=(i===0||i===4)?colorLabel(value):(Number(value.toPrecision(5))).toString();text(g,label,x+w+12,yy+5,'left',14);
 }
 return out;
}
for(const [id,c] of [['save2',c2],['save3',c3]])$(id).onclick=()=>{if(!cfg)return;if(box){status('请先完成框选，再保存图像。',true);return;}const a=document.createElement('a');a.download=`${cfg.field}-${id==='save2'?planeName():cfg.mode==='box'?'boundary-3D':'3D'}.png`;a.href=exportWithColorbar(c).toDataURL('image/png');a.click();};

// Keep the left view fixed during a drag; update the input boxes and right view live.
function gridBoundary(axis,value){const n=D.shape_zyxc[2-axis];return Math.max(0,Math.min(n,Math.round((value-D.origin_nm[axis])/D.spacing_nm[axis])));}
function boxPoint(e,p,q){const r=c2.getBoundingClientRect(),x=(e.clientX-r.left)*720/r.width,y=(e.clientY-r.top)*650/r.height;return {x:Math.max(p.left,Math.min(p.left+p.w,x)),y:Math.max(p.top,Math.min(p.top+p.h,y)),inside:x>=p.left&&x<=p.left+p.w&&y>=p.top&&y<=p.top+p.h};}
function boxIndices(p){return [gridBoundary(0,box.cfg.xmin+(p.x-box.plot.left)/box.plot.s),gridBoundary(1,box.cfg.ymax-(p.y-box.plot.top)/box.plot.s)];}
function paintBox(){g2.clearRect(0,0,720,650);g2.drawImage(box.image,0,0);if(!box.end)return;const a=box.start,b=box.end,p=box.plot,q=box.cfg;
 const x=i=>p.left+(D.origin_nm[0]+i*D.spacing_nm[0]-q.xmin)*p.s,y=j=>p.top+(q.ymax-D.origin_nm[1]-j*D.spacing_nm[1])*p.s;
 g2.save();g2.beginPath();g2.rect(p.left,p.top,p.w,p.h);g2.clip();g2.fillStyle='rgba(8,140,160,.15)';g2.fillRect(Math.min(x(a[0]),x(b[0])),Math.min(y(a[1]),y(b[1])),Math.abs(x(a[0])-x(b[0])),Math.abs(y(a[1])-y(b[1])));g2.setLineDash([6,4]);line(g2,[[x(a[0]),y(a[1])],[x(b[0]),y(a[1])],[x(b[0]),y(b[1])],[x(a[0]),y(b[1])],[x(a[0]),y(a[1])]],'#087c8a',2);g2.restore();}
const hoverRead=c2.onpointermove;
c2.onpointerdown=e=>{if(!cfg||e.button!==0)return;const p=boxPoint(e,plot,cfg);if(!p.inside)return;e.preventDefault();const image=document.createElement('canvas');image.width=720;image.height=650;image.getContext('2d').drawImage(c2,0,0);box={plot:{...plot},cfg:{...cfg},image,start:null,end:null,valid:false};box.start=boxIndices(p);$('sample').textContent='拖动框选：顶点吸附整数网格边界';c2.setPointerCapture(e.pointerId);};
c2.onpointermove=e=>{if(!box){hoverRead(e);return;}const p=boxPoint(e,box.plot,box.cfg);box.end=boxIndices(p);const a=box.start,b=box.end;box.valid=a[0]!==b[0]&&a[1]!==b[1];if(box.valid){for(const [axis,name] of [[0,'x'],[1,'y']]){const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);$(name+'min').value=Number((coord(axis,lo)).toPrecision(15));$(name+'max').value=Number((coord(axis,hi-1)).toPrecision(15));}apply();}else paintBox();};
c2.onpointerup=()=>{if(!box)return;box=null;draw();};
c2.onpointercancel=()=>{if(!box)return;for(const name of ['xmin','xmax','ymin','ymax'])$(name).value=box.cfg.inputRanges[name];box=null;apply();};

function applyNormalRange(){if(!D||D.text_plane)return;try{const lo=Number($('nmin').value),hi=Number($('nmax').value),n=D.shape_zyxc[0];assert($('nmin').value.trim()!==''&&$('nmax').value.trim()!==''&&Number.isFinite(lo)&&Number.isFinite(hi),'法向范围请输入有限数值');assert(lo<=hi&&lo>=coord(2,0)-1e-8&&hi<=coord(2,n-1)+1e-8,`${normalAxis()}范围须在 ${coord(2,0)}–${coord(2,n-1)} 格点内`);const ids=[];for(let i=0;i<n;i++)if(coord(2,i)>=lo-1e-10&&coord(2,i)<=hi+1e-10)ids.push(i);assert(ids.length,'所选范围没有格点');const old=cfg,a=layerStart,b=layerEnd;layerStart=ids[0];layerEnd=ids.at(-1);apply();if(cfg===old){layerStart=a;layerEnd=b;}syncLayers();}catch(e){status(e.message+'；图像保留上次有效设置。',true);}}
$('nmin').oninput=$('nmax').oninput=applyNormalRange;
