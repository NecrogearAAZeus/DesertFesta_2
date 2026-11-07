import {PHYSICS,clamp} from './simulation.mjs';
import {capsuleAt} from './track.mjs';
const TAU=Math.PI*2;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
function circle(c,x,y,r,fill,stroke=null,width=1){c.beginPath();c.arc(x,y,Math.max(.01,r),0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
function line(c,points,color,width=2){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function flipPoint(track,flip,e,t,reduced){
  const from=track.frame(e.fromS,e.fromU),to=track.frame(e.toS,e.toU);
  if(reduced)return {x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};
  const a=Math.PI*t,dx=from.x-flip.x,dy=from.y-flip.y;
  return {x:flip.x+dx*Math.cos(a)-dy*Math.sin(a)+(to.x-(flip.x-dx))*t,y:flip.y+dx*Math.sin(a)+dy*Math.cos(a)+(to.y-(flip.y-dy))*t};
}
export class RaceRenderer {
  constructor(canvas,pip,images){this.canvas=canvas;this.pip=pip;this.images=images;this.camera=null;this.reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;this.resize();}
  resize(){const d=Math.min(window.devicePixelRatio||1,2);this.dpr=d;this.w=window.innerWidth;this.h=window.innerHeight;this.canvas.width=this.w*d;this.canvas.height=this.h*d;}
  reset(){this.camera=null;this.flipView=null;}
  render(sim,dt=1/60,myName=null){
    const group=sim.ranked.filter(m=>!m.finished).slice(0,3);if(!group.length)group.push(...sim.ranked.slice(0,3));
    const s=group.reduce((n,m)=>n+m.s,0)/group.length+125;
    const p=sim.track.frame(s),zoom=.86;
    const angle=Math.PI/2-p.angle;
    if(!this.camera)this.camera={x:p.x,y:p.y,rotation:angle,s,zoom};
    const blend=1-Math.exp(-dt*7),cam=this.camera;
    const boss=sim.boss,flip=boss?.flip;
    const overview=flip&&sim.time-boss.activeAt<flip.prepare+flip.duration+.18;
    // 먼저 축소하고, 1초 회전 동안 위치·각도·배율을 고정한 뒤 일반 추적으로 복귀한다.
    if(overview){
      if(this.flipView?.flip!==flip){
        const co=Math.cos(cam.rotation),si=Math.sin(cam.rotation),points=[];
        for(const e of flip.entries)for(let i=0;i<=24;i++){
          const q=flipPoint(sim.track,flip,e,i/24,this.reduced);
          points.push({x:q.x*co-q.y*si,y:q.x*si+q.y*co});
        }
        const minX=Math.min(...points.map(q=>q.x)),maxX=Math.max(...points.map(q=>q.x));
        const minY=Math.min(...points.map(q=>q.y)),maxY=Math.max(...points.map(q=>q.y));
        const x=(minX+maxX)/2,y=(minY+maxY)/2;
        this.flipView={flip,from:{...cam},to:{x:x*co+y*si,y:-x*si+y*co,s:(flip.minS+flip.maxS)/2,
          zoom:Math.min(.86,this.w*.64/(maxX-minX+180),this.h*.6/(maxY-minY+180))}};
      }
      const {from,to}=this.flipView,t=smooth((sim.time-boss.activeAt)/flip.prepare);
      cam.x=from.x+(to.x-from.x)*t;cam.y=from.y+(to.y-from.y)*t;
      cam.s=from.s+(to.s-from.s)*t;cam.zoom=from.zoom+(to.zoom-from.zoom)*t;cam.rotation=from.rotation;
    }else{
      cam.x+=(p.x-cam.x)*blend;cam.y+=(p.y-cam.y)*blend;cam.s=s;
      let difference=(angle-cam.rotation+Math.PI)%TAU;if(difference<0)difference+=TAU;difference-=Math.PI;
      cam.rotation+=difference*blend;cam.zoom+=(zoom-cam.zoom)*(1-Math.exp(-dt*10));
    }
    const drawCam={...cam,range:overview||cam.zoom<.8?Infinity:1300};
    const c=this.canvas.getContext('2d');c.setTransform(this.dpr,0,0,this.dpr,0,0);
    this.viewport(c,this.w,this.h,sim,drawCam,cam.zoom,myName,false);
    this.screenEffects(c,sim);this.minimap(c,sim);
    const last=sim.ranked.at(-1),lp=sim.track.frame(last.s,last.u);
    const pc=this.pip.getContext('2d');pc.setTransform(1,0,0,1,0,0);
    this.viewport(pc,this.pip.width,this.pip.height,sim,{...lp,s:last.s,rotation:Math.PI/2-lp.angle},.85,myName,true);
  }
  marblePose(sim,m){
    const b=sim.boss,flip=b?.flip;
    if(flip&&!flip.landed){
      const e=flip.entries.find(e=>e.id===m.id);
      if(e){
        const t=smooth((sim.time-b.activeAt-flip.prepare)/flip.duration);
        return flipPoint(sim.track,flip,e,t,this.reduced);
      }
    }
    const p=sim.track.frame(m.s,m.u);
    if(b?.type==='zodiark'&&b.phase==='casting'&&!m.finished&&!this.reduced){
      const strength=clamp((sim.time-b.at)/b.cast,0,1)*5;
      p.x+=Math.sin(sim.time*49+m.id)*strength;p.y+=Math.cos(sim.time*37+m.id)*strength;
    }
    return p;
  }
  viewport(c,w,h,sim,cam,zoom,myName,isPip){
    c.save();c.fillStyle='#141923';c.fillRect(0,0,w,h);
    let shake=0;
    if(!this.reduced&&!isPip&&sim.boss?.type!=='zodiark'){
      for(const e of sim.fx)if(['abyss','buster'].includes(e.type))shake=Math.max(shake,Math.max(0,1-(sim.time-e.at)/.65)*7);
    }
    c.translate(w*(isPip?.5:.55)+Math.sin(sim.time*83)*shake,h*.45+Math.cos(sim.time*71)*shake);
    c.scale(zoom,zoom);c.rotate(cam.rotation);c.translate(-cam.x,-cam.y);
    const track=sim.track,bg=this.images[track.imageKey];
    if(bg?.complete&&bg.naturalWidth){c.globalAlpha=.65;c.drawImage(bg,0,0,track.width*track.scale,track.height*track.scale);c.globalAlpha=1;}
    // 기존 미니맵 위에 길과 충돌 벽을 다시 깐다.
    c.lineCap='round';c.lineJoin='round';
    const points=track.samples;
    line(c,points,'#302c31',track.halfWidth*2+24);
    line(c,points,'#b79b62',track.halfWidth*2+12);
    line(c,points,'#3c3a3c',track.halfWidth*2);
    line(c,points,'#57514a',track.halfWidth*2-10);
    c.save();c.setLineDash([7,23]);line(c,points,'rgba(243,217,163,.15)',3);c.restore();
    for(let d=Math.max(0,Math.floor((cam.s-1000)/220)*220);d<Math.min(track.length,cam.s+1200);d+=220){
      const p=track.frame(d);c.save();c.translate(p.x,p.y);c.rotate(p.angle-Math.PI/2);c.fillStyle='rgba(239,212,157,.14)';
      c.beginPath();c.moveTo(-9,-4);c.lineTo(0,6);c.lineTo(9,-4);c.lineTo(9,2);c.lineTo(0,12);c.lineTo(-9,2);c.fill();c.restore();
    }
    for(const o of sim.obstacles){
      const s=o.s??(o.s1+o.s2)/2;if(Math.abs(s-cam.s)>(cam.range??1400))continue;
      if(o.type==='pin'){
        const p=track.frame(o.s,o.u);circle(c,p.x+3,p.y+5,o.r+5,'#151820');
        circle(c,p.x,p.y,o.r+3,'#7d715e','#e5c991',2);circle(c,p.x-3,p.y-3,o.r*.43,'#fff0bc');
      }else{
        const a=capsuleAt(o,sim.time),p=track.frame(a.s1,a.u1),q=track.frame(a.s2,a.u2);
        line(c,[p,q],'#171d28',a.r*2+9);line(c,[p,q],o.type==='rotor'?'#b25d48':'#c2a06b',a.r*2);
        line(c,[p,q],o.type==='rotor'?'#ffd1a1':'#fff0c0',3);
        if(o.type==='rotor'){const center=track.frame(o.s,o.u);circle(c,center.x,center.y,17,'#344052','#ffd6a1',3);circle(c,center.x,center.y,6,'#ffa45d');}
      }
    }
    this.finishLine(c,track,cam.s);
    this.bossGround(c,sim);
    for(const trap of sim.traps){if(!trap.active||Math.abs(trap.s-cam.s)>1000)continue;const p=track.frame(trap.s,trap.u);c.save();c.translate(p.x,p.y);c.rotate(-cam.rotation);circle(c,0,5,19,'rgba(0,0,0,.3)');
      const img=this.images[trap.type];if(img?.complete&&img.naturalWidth){circle(c,0,0,19,trap.type==='banana'?'#ddc886':'#c7a4cf');c.globalCompositeOperation='multiply';c.drawImage(img,-17,-17,34,34);}else {c.font='27px sans-serif';c.textAlign='center';c.fillText(trap.type==='banana'?'🍌':'🍄',0,10);}c.restore();}
    this.groundFx(c,sim);
    const labels=[];
    for(const m of sim.marbles){
      if(Math.abs(m.s-cam.s)>(cam.range??1300))continue;
      const p=this.marblePose(sim,m),mine=m.name===myName,flying=sim.boss?.flip&&!sim.boss.flip.landed;
      if(m.trail.length>1&&!flying){c.save();c.globalAlpha=m.lowGravity>0?.45:.2;line(c,m.trail.map(p=>track.frame(p.s,p.u)),m.lowGravity>0?'#c188ff':m.color,m.lowGravity>0?7:3);c.restore();}
      c.save();c.translate(p.x,p.y);c.rotate(-cam.rotation);
      const lift=m.lowGravity>0?14+Math.sin(sim.time*4+m.id)*5:m.air>0?Math.sin(clamp(m.air/.8,0,1)*Math.PI)*24:0;
      c.save();c.scale(1,.43);circle(c,2,12+lift,PHYSICS.radius+3,'rgba(0,0,0,.48)');c.restore();
      c.translate(0,-lift);
      if(m.lowGravity>0){circle(c,0,0,23,'rgba(157,86,255,.13)','#b994ff',1);for(let i=0;i<3;i++){const a=sim.time*2+i*TAU/3;circle(c,Math.cos(a)*20,Math.sin(a)*20,2.5,'#e1b8ff');}}
      const displayRadius=flying?Math.max(PHYSICS.radius,5/zoom):PHYSICS.radius;
      const g=c.createRadialGradient(-5,-6,1,0,0,displayRadius*1.3);g.addColorStop(0,'#fff8dc');g.addColorStop(.28,m.color);g.addColorStop(1,'#171b31');circle(c,0,0,displayRadius,g,mine?'#78edff':'#fff0ca',mine?3:1.5);
      c.fillStyle='#182031';c.font=`bold ${flying?Math.max(10,8/zoom):10}px sans-serif`;c.textAlign='center';c.fillText(String(m.id),0,4);
      if(m.stun>0)for(let i=0;i<3;i++){const a=sim.time*4+i*TAU/3;c.fillStyle='#ffe684';c.font='15px sans-serif';c.fillText('✦',Math.cos(a)*20,-20+Math.sin(a)*5);}
      const labelPoint={x:Math.cos(cam.rotation)*p.x-Math.sin(cam.rotation)*p.y,y:Math.sin(cam.rotation)*p.x+Math.cos(cam.rotation)*p.y};
      const visibleLabel=isPip?m.rank===sim.marbles.length:(mine||m.rank<=3)&&!labels.some(q=>Math.abs(q.x-labelPoint.x)<135&&Math.abs(q.y-labelPoint.y)<27);
      if(visibleLabel){labels.push(labelPoint);const text=isPip?`${m.rank}위`:`${m.rank}위 ${m.name}`;c.font='bold 12px "Malgun Gothic",sans-serif';c.strokeStyle='#121620';c.lineWidth=4;c.strokeText(text,0,-26);c.fillStyle=mine?'#9af2ff':'#fff6df';c.fillText(text,0,-26);}
      c.restore();
    }
    this.targeting(c,sim,cam.rotation);this.airFx(c,sim);this.bossSigil(c,sim);
    c.restore();
    this.mushroomStickers(c,w,h,sim,cam,zoom,isPip,shake);
  }
  finishLine(c,track,camS){
    if(track.length-camS>1500)return;const p=track.frame(track.length);
    c.save();c.translate(p.x,p.y);c.rotate(p.angle-Math.PI/2);
    for(let row=0;row<2;row++)for(let col=0;col<14;col++){c.fillStyle=(row+col)%2?'#1e2431':'#f8edcd';c.fillRect(-112+col*16,row*16,16,16);}
    c.fillStyle='#fff0bf';c.textAlign='center';c.font='bold 26px sans-serif';c.fillText('FINISH',0,69);c.restore();
  }
  bossGround(c,sim){
    const b=sim.boss;if(!b)return;const center=sim.track.frame(b.s),age=sim.time-b.at,charge=clamp(age/b.cast,0,1),active=b.phase==='active';
    c.save();
    if(b.type==='abyss'){
      c.translate(center.x,center.y);c.rotate(b.angle);
      for(let i=0;i<4;i++){
        const a=i*Math.PI/2;c.beginPath();c.moveTo(0,0);c.arc(0,0,440,a-.24,a+.24);c.closePath();
        c.fillStyle=active?'rgba(255,97,15,.56)':`rgba(255,154,48,${.08+charge*.18})`;c.fill();c.lineWidth=active?5:2;c.strokeStyle=active?'#fff1a3':'#ffaf4d';c.stroke();
        if(!active){c.beginPath();c.moveTo(0,0);c.arc(0,0,440*charge,a-.24,a+.24);c.closePath();c.fillStyle='rgba(255,141,39,.25)';c.fill();}
      }
      circle(c,0,0,440,null,active?'#ff994a':'rgba(255,180,90,.45)',2);
      c.restore();c.save();
      const crack=[];for(let s=b.s-650;s<b.s+950;s+=32)crack.push(sim.track.frame(s,sim.track.halfWidth+9+Math.sin(s*.1)*8));
      line(c,crack,'#100916',32);line(c,crack,'#ff672b',9);line(c,crack,'#ffd4a2',2);
    }else{
      for(let s=b.s-950;s<b.s+1050;s+=75){const p=sim.track.frame(s);c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.fillStyle=active?'rgba(120,62,236,.3)':'rgba(161,111,250,.12)';c.fillRect(-40,-sim.track.halfWidth,80,sim.track.halfWidth*2);
        c.strokeStyle=active?'#be93ff':'rgba(190,147,255,.5)';c.lineWidth=3;
        for(let u=-80;u<100;u+=55){c.beginPath();c.moveTo(-9,u-8);c.lineTo(0,u+3);c.lineTo(9,u-8);c.stroke();}c.restore();}
    }
    c.restore();
  }
  bossSigil(c,sim){
    const b=sim.boss;if(!b||b.type!=='zodiark')return;
    const p=sim.track.frame(b.s),age=sim.time-b.at,active=b.phase==='active',charge=clamp(age/b.cast,0,1);
    c.save();c.translate(p.x,p.y);c.globalAlpha=active?.48:.35+charge*.4;c.globalCompositeOperation='lighter';
    c.rotate(age*.26);const radius=270+charge*55;
    for(let j=0;j<3;j++)circle(c,0,0,radius-j*22,null,j===1?'#ad74ff':'#e2bcff',j===1?7:2);
    for(let i=0;i<16;i++){const a=i*TAU/16;c.save();c.rotate(a);line(c,[{x:radius-12,y:0},{x:radius+14,y:0}],'#dfc6ff',3);c.font='20px serif';c.fillStyle='#d9bdff';c.fillText(['✧','◇','⋈','△'][i%4],radius-50,5);c.restore();}
    for(let i=0;i<8;i++){const a=i*TAU/8,d=a+TAU*3/8;line(c,[{x:Math.cos(a)*200,y:Math.sin(a)*200},{x:Math.cos(d)*200,y:Math.sin(d)*200}],'rgba(207,166,255,.6)',2);}
    c.rotate(-age*.26);c.beginPath();c.moveTo(-100,0);c.quadraticCurveTo(0,-90,100,0);c.quadraticCurveTo(0,90,-100,0);c.fillStyle='#442375';c.fill();c.strokeStyle='#e8c3ff';c.lineWidth=5;c.stroke();
    const g=c.createRadialGradient(0,0,2,0,0,48);g.addColorStop(0,'#fff9db');g.addColorStop(.28,'#efb8ff');g.addColorStop(1,'rgba(173,87,255,0)');circle(c,0,0,48,g);c.fillStyle='#21122f';c.fillRect(-4,-29,8,58);
    c.restore();
  }
  targeting(c,sim,rotation){
    for(const [marker,type] of [[sim.sniper,'sniper'],[sim.buster,'buster']]){
      if(!marker)continue;const m=sim.marbles[marker.id-1],p=this.marblePose(sim,m),charge=clamp((sim.time-marker.at)/(marker.fire-marker.at),0,1);
      c.save();c.translate(p.x,p.y);
      if(type==='buster'){
        circle(c,0,0,165,'rgba(240,47,41,.08)','#ff6254',2);circle(c,0,0,165*charge,'rgba(255,54,35,.15)');
        c.rotate(-rotation);c.translate(0,-57-Math.sin(sim.time*7)*4);c.fillStyle='#ff564c';c.shadowColor='#ff3322';c.shadowBlur=14;
        c.beginPath();c.moveTo(0,20);c.lineTo(-20,-9);c.lineTo(-8,-6);c.lineTo(0,-30);c.lineTo(8,-6);c.lineTo(20,-9);c.closePath();c.fill();circle(c,0,-6,29,null,'#ffd0b3',2);
      }else{
        c.rotate(sim.time*.6);circle(c,0,0,35-charge*10,null,'#ff7c79',2);
        for(let i=0;i<4;i++){c.rotate(Math.PI/2);line(c,[{x:18,y:0},{x:42,y:0}],'#ffb0a3',3);}
        line(c,[{x:-300,y:-360},{x:0,y:0}],'rgba(255,85,75,.5)',1);
      }
      c.restore();
    }
  }
  groundFx(c,sim){
    for(const e of sim.fx){if(e.type!=='poison')continue;const p=sim.track.frame(e.s,e.u),t=(sim.time-e.at)/e.life;c.save();c.translate(p.x,p.y);c.globalAlpha=(1-t)*.7;
      const g=c.createRadialGradient(0,0,10,0,0,e.radius);g.addColorStop(0,'#ba70eb');g.addColorStop(.55,'rgba(143,72,206,.6)');g.addColorStop(1,'rgba(90,40,170,0)');circle(c,0,0,e.radius,g);
      for(let i=0;i<12;i++){const a=hash(e.id*50+i)*TAU,r=hash(i+e.id)*e.radius*Math.sqrt(t+.1);circle(c,Math.cos(a)*r,Math.sin(a)*r,9+12*t,null,'#ce98fa',1);}c.restore();}
  }
  airFx(c,sim){
    for(const e of sim.fx){
      if(['poison','cast','aim','lock'].includes(e.type))continue;
      const p=sim.track.frame(e.s,e.u),age=sim.time-e.at,t=clamp(age/e.life,0,1);
      const big=['rift','abyss','buster','flipImpact'].includes(e.type),color=e.color||(['rift','flipImpact'].includes(e.type)?'#c9a0ff':e.type==='banana'?'#ffe072':e.type==='shot'?'#ff8c7a':'#ffc989');
      c.save();c.translate(p.x,p.y);c.globalAlpha=1-t;c.globalCompositeOperation='lighter';
      if(big){
        const r=(e.radius||160)*(1-Math.pow(1-t,3));circle(c,0,0,r,null,color,Math.max(1,13*(1-t)));circle(c,0,0,r*.72,null,'#fff4d8',2);
        if(t<.22)circle(c,0,0,50*(1-t/.22),'#fff4e9');
      }
      if(e.type==='shot')line(c,[{x:-340,y:-440},{x:0,y:0}],'#fff4da',5*(1-t));
      const count=this.reduced?6:big?36:12;
      for(let i=0;i<count;i++){
        const a=hash(e.id*117+i)*TAU,speed=(big?90:25)+hash(e.id+i*21)*(big?350:120),r=age*speed;
        const x=Math.cos(a)*r,y=Math.sin(a)*r+age*age*50;
        c.save();c.translate(x,y);c.rotate(a+t*4);c.fillStyle=i%4===0?'#fff7e7':color;
        if(big){c.beginPath();c.moveTo(-5,-2);c.lineTo(8+hash(i)*15,0);c.lineTo(-3,4);c.closePath();c.fill();}else c.fillRect(-2,-2,4,4);c.restore();
      }
      c.restore();
    }
  }
  mushroomStickers(c,w,h,sim,cam,zoom,isPip,shake){
    const placed=[];
    for(const sticker of sim.stickers){
      const m=sim.marbles[sticker.victimId-1];if(!m)continue;
      const p=this.marblePose(sim,m),dx=p.x-cam.x,dy=p.y-cam.y;
      const anchor={x:w*(isPip?.5:.55)+(dx*Math.cos(cam.rotation)-dy*Math.sin(cam.rotation))*zoom+Math.sin(sim.time*83)*shake,
        y:h*.45+(dx*Math.sin(cam.rotation)+dy*Math.cos(cam.rotation))*zoom+Math.cos(sim.time*71)*shake};
      const onScreen=anchor.x>=0&&anchor.x<=w&&anchor.y>=25&&anchor.y<=h;
      if(isPip&&!onScreen)continue;
      const age=sim.time-sticker.at,size=isPip?40:72,cardH=size+(isPip?17:24);
      const left=isPip?size/2+5:Math.min(300,w*.3),right=isPip?w-size/2-5:w-205;
      const top=isPip?cardH/2+28:145,bottom=isPip?h-cardH/2-4:h-140;
      const candidates=(onScreen?[[size*.85,-size*.8],[-size*.85,-size*.8],[size*.85,size*.7],[-size*.85,size*.7],[0,-size*1.9]]:[[w-285-anchor.x,330+(sticker.id%3)*140-anchor.y]])
        .map(([ox,oy])=>({x:clamp(anchor.x+ox,left,right),y:clamp(anchor.y+oy-age*5,top,bottom)}));
      const pos=candidates.find(p=>!placed.some(q=>Math.abs(p.x-q.x)<size+12&&Math.abs(p.y-q.y)<cardH+10))||candidates[0];
      placed.push(pos);
      const fade=clamp((sticker.life-age)/.4,0,1),pop=this.reduced?1:smooth(age/.13)*(1+.1*Math.sin(Math.min(1,age/.4)*Math.PI));
      c.save();c.globalAlpha=fade;
      if(onScreen)line(c,[anchor,pos],'rgba(195,132,255,.7)',2);
      c.translate(pos.x,pos.y);c.scale(pop,pop);
      if(!this.reduced)c.rotate(Math.sin(age*20)*.1*Math.exp(-age*2));
      c.shadowColor='rgba(151,71,238,.7)';c.shadowBlur=isPip?8:18;
      c.beginPath();c.roundRect(-size/2-5,-cardH/2-5,size+10,cardH+10,10);c.fillStyle='#fff9ea';c.fill();c.strokeStyle='#bc81ef';c.lineWidth=3;c.stroke();c.shadowBlur=0;
      const img=this.images[sticker.imageKey];
      if(img?.complete&&img.naturalWidth){
        if(sticker.imageKey==='teemoThumb2'){
          // 원본 파일은 보존하고, 여백이 넓은 두 번째 이미지의 인물 부분을 화면에 맞춰 그린다.
          c.drawImage(img,img.naturalWidth*.30,img.naturalHeight*.18,img.naturalWidth*.41,img.naturalHeight*.55,-size/2,-cardH/2,size,size);
        }else c.drawImage(img,-size/2,-cardH/2,size,size);
      }else {c.font=`${size*.55}px sans-serif`;c.textAlign='center';c.fillText('👍',0,12);}
      c.fillStyle='#67358a';c.font=`bold ${isPip?9:12}px "Malgun Gothic",sans-serif`;c.textAlign='center';
      const name=m.name.length>12?m.name.slice(0,11)+'…':m.name;
      c.fillText(name,0,cardH/2-5,size);c.restore();
    }
  }
  screenEffects(c,sim){
    const b=sim.boss;if(!b)return;
    c.save();const g=c.createRadialGradient(this.w*.55,this.h*.48,this.h*.15,this.w*.55,this.h*.48,this.w*.7);
    const alpha=b.phase==='active'?.52:.25;g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,b.type==='zodiark'?`rgba(80,20,140,${alpha})`:`rgba(100,25,6,${alpha})`);c.fillStyle=g;c.fillRect(0,0,this.w,this.h);
    if(b.type==='zodiark'&&b.phase==='active'&&!this.reduced){c.strokeStyle='rgba(197,146,255,.26)';c.lineWidth=1;for(let i=0;i<14;i++){const a=i*TAU/14+sim.time*.04;const x=this.w*.55+Math.cos(a)*this.w*.52,y=this.h*.5+Math.sin(a)*this.h*.65;line(c,[{x,y},{x:x-Math.cos(a)*80,y:y-Math.sin(a)*80},{x:x-Math.cos(a)*120+13,y:y-Math.sin(a)*120}],'rgba(197,146,255,.26)',2);}}
    c.restore();
  }
  minimap(c,sim){
    if(this.w<1000)return;
    const w=158,h=174,x=this.w-w-20,y=160,track=sim.track;
    c.save();c.fillStyle='rgba(17,21,31,.85)';c.fillRect(x,y,w,h);c.strokeStyle='#776344';c.strokeRect(x,y,w,h);
    c.fillStyle='#d6c6a6';c.font='10px sans-serif';c.fillText('COURSE / 전체 구간',x+10,y+16);
    const scale=Math.min((w-24)/(track.width*track.scale),(h-40)/(track.height*track.scale));
    c.translate(x+(w-track.width*track.scale*scale)/2,y+27);c.scale(scale,scale);
    line(c,track.samples,'#9a8c76',3/scale);
    for(const m of sim.marbles){const p=track.frame(m.s,m.u);circle(c,p.x,p.y,(m.rank===1?3:1.7)/scale,m.rank===1?'#ffdc78':m.rank===sim.marbles.length?'#ff7b75':'#9de0e6');}
    c.restore();
  }
}
