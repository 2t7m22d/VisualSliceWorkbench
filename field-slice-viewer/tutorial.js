/* The guided tour uses an isolated synthetic-data iframe; the user's workspace is untouched. */
(()=>{
 const trigger=document.getElementById('start-tutorial');
 if(new URLSearchParams(location.search).has('tutorial-demo')){trigger.hidden=true;return;}
 const style=document.createElement('style');style.textContent=`
.tour{position:fixed;inset:0;z-index:10000;background:#eef3f6}.tour iframe{border:0;width:100%;height:100%;pointer-events:none}.tour-focus{position:absolute;border:3px solid #14afbb;border-radius:9px;box-shadow:0 0 0 9999px #102b3b70;pointer-events:none;transition:all .22s}.tour-card{position:absolute;width:330px;max-width:calc(100vw - 24px);padding:18px;background:white;border:1px solid #b7d5df;border-radius:14px;box-shadow:0 12px 40px #142c4340;color:#183342;font:14px/1.6 system-ui}.tour-card h2{font-size:18px;margin:6px 0}.tour-card p{margin:8px 0}.tour-badge{font-size:11px;color:#147c8a}.tour-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.tour-actions button{font:12px system-ui;padding:7px 10px;cursor:pointer}.tour-actions .primary{background:#147c8a;color:white}.tour-close{position:fixed;top:10px;right:12px;z-index:3;background:white}.tour svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.tour-feedback{color:#147c8a;min-height:22px;font-size:12px}@media(prefers-reduced-motion:reduce){.tour-focus{transition:none}}
`;document.head.append(style);
 function demoFile(){const nx=32,ny=32,nz=9,n=nx*ny*nz*3,a=new Float32Array(n);for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){let t=((k*ny+j)*nx+i)*3;a[t]=.28*Math.sin(j/5+k*.4);a[t+1]=.28*Math.cos(i/5-k*.4);a[t+2]=.65*Math.sin(i/6+k*.5)*Math.cos(j/7);}
 const h=new TextEncoder().encode(JSON.stringify({schema:'bfo-vector-slice-v1',title:'教学示例（合成数据，非科学结果）',shape_zyxc:[nz,ny,nx,3],origin_nm:[0,0,0],spacing_nm:[1,1,1],fields:[{name:'P',dtype:'float32',offset:0,bytes:a.byteLength}]}));const b=new Uint8Array(12+h.length+a.byteLength);b.set(new TextEncoder().encode('BFOSLC1\n'));new DataView(b.buffer).setUint32(8,h.length,true);b.set(h,12);const v=new DataView(b.buffer);a.forEach((x,i)=>v.setFloat32(12+h.length+i*4,x,true));return new File([b],'教学示例-合成数据.bfslice');}
 trigger.onclick=()=>{
 const tutorialHTML='<!doctype html>'+document.documentElement.outerHTML.replace('<script src="tutorial.js"></script>','').replace('</head>','<style>#start-tutorial{display:none}</style></head>');
 const overlay=document.createElement('div');overlay.className='tour';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','交互使用教程');
 overlay.innerHTML=`<iframe title="教程示例工作台" ></iframe><div class="tour-focus"></div><svg><defs><marker id="tour-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#14afbb"/></marker></defs><path class="tour-line" fill="none" stroke="#14afbb" stroke-width="3" marker-end="url(#tour-arrow)"/></svg><button class="tour-close">退出教程 ×</button><section class="tour-card"><div class="tour-badge">独立教学示例 · 合成数据 · 不修改你的文件与设置</div><h2></h2><p class="tour-text"></p><div class="tour-feedback" aria-live="polite"></div><div class="tour-actions"><button class="tour-prev">上一步</button><button class="tour-demo">演示效果</button><button class="tour-next primary">下一步</button></div></section>`;
 document.body.append(overlay);const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';const frame=overlay.querySelector('iframe'),card=overlay.querySelector('.tour-card'),focus=overlay.querySelector('.tour-focus');let index=0,active=false,shown=false,timer,target;
 const close=()=>{clearTimeout(timer);window.removeEventListener('resize',position);document.removeEventListener('keydown',keys);document.body.style.overflow=previousOverflow;overlay.remove();trigger.focus();};
 const keys=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const bs=[overlay.querySelector('.tour-close'),...card.querySelectorAll('button:not(:disabled)')].filter(b=>!b.hidden);let i=bs.indexOf(document.activeElement);e.preventDefault();bs[(i+(e.shiftKey?-1:1)+bs.length)%bs.length].focus();}};
 overlay.querySelector('.tour-close').onclick=close;document.addEventListener('keydown',keys);
 const d=()=>frame.contentDocument,w=()=>frame.contentWindow;
 function set(id,value,event='input'){const e=d().getElementById(id);e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}));}
 function details(n){const es=d().querySelectorAll('details');es.forEach((e,i)=>e.open=i===n);}
 const steps=[
 ['#drop','导入与文件名','把 .bfslice 或 XY/XZ 五列文本拖入文件框，或点击选择文件。加载后这里显示文件名。教程使用合成体数据，关闭后你的工作区保持原样。',null],
 ['.plots','两张图与操作方式','左图展示切面，右图展示三维矢量。下滚进入双图视图后，两图独占一屏；左图可框选，右图可拖动旋转、滚轮缩放。',null],
 ['#plane-controls','左图选层','左图下方的单滑块改变当前切面层。点击演示，观察层号和左图颜色、箭头一起变化；右图选层保持独立。',()=>set('plane',shown?4:7)],
 ['#volume-controls','右图连续层范围','双圆圈限定三维起止层。“全部层”显示整个厚度，“仅左图层”只显示左图当前层。单切面文本没有可拖动的选层控件。',()=>d().getElementById(shown?'one':'all').click()],
 ['#controls details:nth-child(1)','范围与恢复','x、y、z 三轴同时显示；切面内两轴控制裁剪，法向轴与右图选层同步。也可在左图拖出矩形。框选吸附最近格点并同步输入框。演示缩小范围；恢复完整范围按钮会出现。',()=>{if(shown)d().getElementById('full').click();else{set('xmin',9);set('xmax',24);set('ymin',9);set('ymax',24);}}],
 ['#controls details:nth-child(2)','颜色范围','色标上下限决定颜色映射。缩窄色标后对比会增强，超界格点使用端点色并计数；原数据不会改变。“自动对称色标”恢复覆盖全部数值的范围。',()=>{if(shown)d().getElementById('autoColor').click();else{set('cmin',-.2);set('cmax',.2);}}],
 ['#controls details:nth-child(3)','箭头疏密与大小','间隔越小箭头越密；长度、圆锥头部和柄部粗细可分别调整。点击演示对比两种外观，只改变显示，不修改数据。',()=>{set('stride',shown?4:2);set('head-size',shown?1:1.7);set('shaft-size',shown?1:2);} ],
 ['#left-view','切换 XY / XZ','体数据可以切换平面方向，范围和选层轴随之变化。XY/XZ 文本只包含一个切面，因此方向固定。',()=>set('left-view',shown?'XY':'XZ','change')],
 ['#mode3','边界长方体模式','体内箭头可切换为六面边界热图长方体，可见面叠加三维箭头。可旋转观察不同边界；此模式需要体数据。',()=>{d().getElementById('all').click();set('mode3',shown?'arrows':'box','change');}],
 ['.spatial-footer','保存图片与结束','保存平面 / 三维 PNG 会输出当前视图，并附竖向色条。重置视角恢复默认观察角度。教程不会自动下载图片；点击完成返回原工作区。',null]
 ];
 function position(){if(!active||!target)return;const r=target.getBoundingClientRect(),vw=innerWidth,vh=innerHeight;const x=Math.max(4,r.left-4),y=Math.max(4,r.top-4),rw=Math.min(vw-8,r.right+4)-x,rh=Math.min(vh-8,r.bottom+4)-y;Object.assign(focus.style,{left:x+'px',top:y+'px',width:Math.max(1,rw)+'px',height:Math.max(1,rh)+'px'});
 const cw=card.offsetWidth,ch=card.offsetHeight;let cx,cy,sx,sy,tx,ty;
 if(vw-x-rw>cw+24||x>cw+24){const right=vw-x-rw>cw+24;cx=right?x+rw+18:x-cw-18;cy=Math.max(52,Math.min(vh-ch-12,y+rh/2-ch/2));sx=right?cx:cx+cw;sy=cy+ch/2;tx=right?x+rw:x;ty=Math.max(y+8,Math.min(y+rh-8,sy));}
 else{cy=y>ch+28?y-ch-18:y+rh+ch+28<vh?y+rh+18:Math.max(48,vh-ch-18);cx=Math.min(vw-cw-12,Math.max(12,x+rw/2-cw/2));if(rw>vw*.7){cx=vw-cw-18;cy=48;}sx=cx+cw/2;sy=cy<y?cy+ch:cy;tx=Math.max(x+8,Math.min(x+rw-8,sx));ty=cy<y?y:y+rh;}
 Object.assign(card.style,{left:cx+'px',top:Math.max(12,cy)+'px'});overlay.querySelector('.tour-line').setAttribute('d',`M${sx},${sy} L${tx},${ty}`);}

 async function show(){shown=false;details(index>=4&&index<=6?index-4:-1);const step=steps[index];card.querySelector('h2').textContent=`${index+1} / ${steps.length} · ${step[1]}`;card.querySelector('.tour-text').textContent=step[2];card.querySelector('.tour-feedback').textContent='';card.querySelector('.tour-demo').hidden=!step[3];card.querySelector('.tour-prev').disabled=index===0;card.querySelector('.tour-next').textContent=index===steps.length-1?'完成教程':'下一步';target=d().querySelector(step[0]);(index===1||index===2||index===3||index>=7?d().getElementById('plots'):target).scrollIntoView({block:index===0||index>=4&&index<=6?'center':'start',behavior:'instant'});position();clearTimeout(timer);timer=setTimeout(position,120);}
 card.querySelector('.tour-prev').onclick=()=>{if(index>0){index--;show();}};card.querySelector('.tour-next').onclick=()=>{if(index===steps.length-1)close();else{index++;show();}};
 card.querySelector('.tour-demo').onclick=()=>{steps[index][3]();shown=!shown;if(index>=4&&index<=6){target=d().getElementById(index===6?'spatial':'planar');d().getElementById('plots').scrollIntoView({block:'start',behavior:'instant'});}card.querySelector('.tour-feedback').textContent=shown?'已调整示例：观察图像和读数变化。再次点击可对比。':'已切回对比设置。';clearTimeout(timer);timer=setTimeout(position,100);};
 frame.onload=async()=>{await w().importFile(demoFile());set('stride',4);active=true;show();card.querySelector('.tour-next').focus();};window.addEventListener('resize',position);frame.srcdoc=tutorialHTML;
 };
})();
