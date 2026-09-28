import { syntheticQuote } from './core/quote.mjs';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const cash = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const compact = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`;

/** Perspective projection of the canonical synthetic size/depth/impact surface. */
export function createDepthChart(canvas, { onSelect }) {
  const ctx = canvas.getContext('2d');
  const readout = document.getElementById('chartReadout');
  const table = document.getElementById('chartData');
  const root = canvas.closest('.chart-3d');
  let result, selectedSize, selectedDepth, points = [], cells = [], projected = [];
  let yaw = -.65, pitch = .48, zoom = 1, hover = null, frame = 0;
  let width = 500, height = 370, maxLog = 1, start = null, moved = false;
  const pointers = new Map();
  let pinchDistance = null;
  const sizeControl = document.getElementById('notional');
  const depthControl = document.getElementById('depth');
  const minSize = Number(sizeControl.min), maxSize = Number(sizeControl.max);
  const minDepth = Number(depthControl.min), maxDepth = Number(depthControl.max);
  const normalize = (value, min, max) => (Math.log(value / min) / Math.log(max / min)) * 2 - 1;
  const amount = (i, count, min, max) => min * Math.pow(max / min, i / count);
  const impact = (size, depth) => syntheticQuote({ notionalUsd: size, depthUsd: depth }).impactPct;
  maxLog = Math.log1p(impact(maxSize, minDepth));
  const point = (size, depth) => ({size, depth, impact: impact(size, depth), x: normalize(size, minSize, maxSize), z: normalize(depth, minDepth, maxDepth)});
  const y = value => -.68 + Math.log1p(value) / maxLog * 1.8;
  const project = (x, py, z) => {
    const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
    const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
    const ry = py * Math.cos(pitch) - rz * Math.sin(pitch);
    const depth = py * Math.sin(pitch) + rz * Math.cos(pitch);
    const factor = 4.8 / (4.8 + depth);
    const scale = Math.min(width / 4.2, height / 3.6) * zoom;
    return { x: width / 2 + rx * scale * factor, y: height * .56 - ry * scale * factor, depth };
  };
  const toScreen = p => project(p.x, y(p.impact), p.z);
  for (let zi = 0; zi <= 20; zi++) {
    for (let xi = 0; xi <= 26; xi++) points.push(point(amount(xi,26,minSize,maxSize), amount(zi,20,minDepth,maxDepth)));
  }
  for (let zi = 0; zi < 20; zi++) for (let xi = 0; xi < 26; xi++) {
    const i = zi * 27 + xi; cells.push([i, i + 1, i + 28, i + 27]);
  }
  function polygon(vertices, fill, stroke) {
    ctx.beginPath(); vertices.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath();
    if (fill) {ctx.fillStyle=fill;ctx.fill();} if (stroke) {ctx.strokeStyle=stroke;ctx.lineWidth=.6;ctx.stroke();}
  }
  function line(a,b,color,dash=[]) {
    ctx.beginPath();ctx.setLineDash(dash);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();ctx.setLineDash([]);
  }
  function label(text,p,color='#aebdca',align='center') {
    ctx.font='10px ui-monospace, monospace';ctx.textAlign=align;ctx.fillStyle='#101923';ctx.strokeStyle='#101923';ctx.lineWidth=4;ctx.strokeText(text,p.x,p.y);ctx.fillStyle=color;ctx.fillText(text,p.x,p.y);
  }
  function describe(p, prefix) {
    readout.textContent = `${prefix}: ${cash(p.size)} position · ${cash(p.depth)} depth · ${p.impact.toFixed(2)}% impact${p.impact > result.limits.breakerImpactPct ? ' · above impact breaker' : ' · within impact threshold'}`;
  }
  function draw() {
    frame=0; if (!ctx || !result || !width) return;
    ctx.clearRect(0,0,width,height);
    const bottom=-.68;
    polygon([project(-1,bottom,-1),project(1,bottom,-1),project(1,bottom,1),project(-1,bottom,1)],'#101f29','#345064');
    for(let i=0;i<=4;i++){const v=-1+i/2;line(project(v,bottom,-1),project(v,bottom,1),'#284050');line(project(-1,bottom,v),project(1,bottom,v),'#284050');}
    projected=points.map(toScreen);
    const ordered=cells.map(ids=>({ids,depth:ids.reduce((v,i)=>v+projected[i].depth,0)/4})).sort((a,b)=>b.depth-a.depth);
    for(const {ids} of ordered){const avg=ids.reduce((v,i)=>v+points[i].impact,0)/4;const high=avg>result.limits.breakerImpactPct;polygon(ids.map(i=>projected[i]),high?'rgba(159,117,218,.48)':'rgba(33,196,207,.55)',high?'rgba(183,154,236,.24)':'rgba(88,231,230,.3)');}
    const cy=y(result.limits.breakerImpactPct);
    const plane=[project(-1,cy,-1),project(1,cy,-1),project(1,cy,1),project(-1,cy,1)];
    polygon(plane,'rgba(245,184,76,.05)',null);
    for(let i=0;i<4;i++)line(plane[i],plane[(i+1)%4],'#f3bf5c',[4,4]);
    label(`${result.limits.breakerImpactPct}% impact breaker`,{x:12,y:22},'#f3bf5c','left');
    // Highlight the current depth slice, using the same synthetic adapter as the API.
    ctx.beginPath();for(let i=0;i<=60;i++){const p=toScreen(point(amount(i,60,minSize,maxSize),selectedDepth));i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}ctx.strokeStyle='#56eff0';ctx.lineWidth=2.2;ctx.stroke();
    const selected=point(selectedSize,selectedDepth), sp=toScreen(selected);
    line(project(selected.x,bottom,selected.z),sp,'#ffd483',[3,4]);
    ctx.beginPath();ctx.arc(sp.x,sp.y,6,0,Math.PI*2);ctx.fillStyle='#f3bf5c';ctx.fill();ctx.strokeStyle='#101923';ctx.lineWidth=2;ctx.stroke();
    label('YOUR POSITION',{x:sp.x,y:sp.y-13},'#ffe1a4');
    for(const [size,depth,text] of [[minSize,maxDepth,'$'+compact(minSize)],[maxSize,maxDepth,'$'+compact(maxSize)],[minSize,minDepth,'$'+compact(minDepth)]]){const p=project(normalize(size,minSize,maxSize),bottom,normalize(depth,minDepth,maxDepth));label(text,{x:p.x,y:p.y+16});}
    label('POSITION SIZE / LOG',{x:width-12,y:height-25},'#86e4e5','right');
    const deepEnd=project(-1,bottom,1);label('$'+compact(maxDepth)+' depth',{x:deepEnd.x,y:deepEnd.y+29},'#c8b2ff');
    label('DEPTH / LOG',{x:12,y:height-25},'#c8b2ff','left');
    label('Axes: logarithmic · impact uses log(1 + %)',{x:width/2,y:height-8},'#98aab9');
    const vertical=project(-1,1.12,-1);line(project(-1,bottom,-1),vertical,'#8299aa');label('IMPACT %',{x:vertical.x,y:vertical.y-10},'#bbcad5');
    if(hover!==null){const hp=projected[hover];ctx.beginPath();ctx.arc(hp.x,hp.y,5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();}
    canvas.setAttribute('aria-label',`Interactive 3D synthetic liquidity surface. Position ${cash(selectedSize)}, depth ${cash(selectedDepth)}, impact ${selected.impact.toFixed(2)} percent. Drag or use arrow keys to rotate.`);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
  function resize(){const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);schedule();}
  function nearest(event){const r=canvas.getBoundingClientRect();let best=null,dist=24;projected.forEach((p,i)=>{const d=Math.hypot(p.x-event.clientX+r.left,p.y-event.clientY+r.top);if(d<dist){dist=d;best=i;}});return best;}
  function reset(){yaw=-.65;pitch=.48;zoom=1;hover=null;schedule();}
  canvas.addEventListener('pointerdown',e=>{if(!ctx)return;canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});start={x:e.clientX,y:e.clientY,yaw,pitch};moved=false;});
  canvas.addEventListener('pointermove',e=>{
    if(pointers.has(e.pointerId)){
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===2){const [a,b]=[...pointers.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance)zoom=clamp(zoom*d/pinchDistance,.65,1.8);pinchDistance=d;moved=true;}
      else if(start){const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>4)moved=true;yaw=start.yaw+dx*.009;pitch=clamp(start.pitch+dy*.006,-.15,1.15);}
      hover=null;schedule();return;
    }
    hover=nearest(e);if(hover!==null)describe(points[hover],'Inspect');else if(result)describe(point(selectedSize,selectedDepth),'Selected');schedule();
  });
  canvas.addEventListener('pointerup',e=>{
    const select=!moved&&pointers.size===1;const index=select?nearest(e):null;
    pointers.delete(e.pointerId);pinchDistance=null;start=null;
    if(index!==null){const p=points[index];onSelect(clamp(Math.round(p.size/Number(sizeControl.step))*Number(sizeControl.step),minSize,maxSize),clamp(Math.round(p.depth/Number(depthControl.step))*Number(depthControl.step),minDepth,maxDepth));}
  });
  canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);start=null;pinchDistance=null;moved=true;});
  canvas.addEventListener('pointerleave',()=>{hover=null;if(result)describe(point(selectedSize,selectedDepth),'Selected');schedule();});
  canvas.addEventListener('wheel',e=>{if(document.activeElement!==canvas)return;e.preventDefault();zoom=clamp(zoom*Math.exp(-e.deltaY*.001),.65,1.8);schedule();},{passive:false});
  canvas.addEventListener('keydown',e=>{let used=true;switch(e.key){case'ArrowLeft':yaw-=.12;break;case'ArrowRight':yaw+=.12;break;case'ArrowUp':pitch=clamp(pitch-.1,-.15,1.15);break;case'ArrowDown':pitch=clamp(pitch+.1,-.15,1.15);break;case'+':case'=':zoom=clamp(zoom+.1,.65,1.8);break;case'-':zoom=clamp(zoom-.1,.65,1.8);break;case'Home':reset();break;default:used=false;}if(used){e.preventDefault();e.stopPropagation();schedule();}});
  root.querySelector('[data-chart-reset]').addEventListener('click',reset);
  root.querySelector('[data-chart-zoom-in]').addEventListener('click',()=>{zoom=clamp(zoom+.15,.65,1.8);schedule();});
  root.querySelector('[data-chart-zoom-out]').addEventListener('click',()=>{zoom=clamp(zoom-.15,.65,1.8);schedule();});
  new ResizeObserver(resize).observe(canvas);
  if(!ctx){canvas.hidden=true;readout.textContent='3D canvas is unavailable. Exact values are available in the table below.';root.querySelector('details').open=true;}
  return {update(next,size,depth){result=next;selectedSize=size;selectedDepth=depth;hover=null;if(ctx)describe(point(size,depth),'Selected');table.replaceChildren(...next.depthCurve.map(p=>{const tr=document.createElement('tr');for(const text of [cash(p.notionalUsd),cash(depth),p.impactPct.toFixed(2)+'%',p.impactPct>next.limits.breakerImpactPct?'Above impact threshold':'Within impact threshold']){const td=document.createElement('td');td.textContent=text;tr.append(td);}return tr;}));resize();}};
}
