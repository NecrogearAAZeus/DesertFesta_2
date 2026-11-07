import {createTrack,createObstacles,capsuleAt} from './track.mjs';

export const PHYSICS = Object.freeze({hz:120,duration:60,radius:13,maxForwardSpeed:380,gravity:2050,drag:1.3});
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function seededRandom(seed) {
  let h=2166136261;
  for(const c of String(seed))h=Math.imul(h^c.charCodeAt(0),16777619);
  return ()=>{let t=h+=0x6d2b79f5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export function fanHit(x,y,angle,radius=440,halfAngle=.24) {
  if(x*x+y*y>radius*radius)return false;
  const a=Math.atan2(y,x)-angle;
  const period=Math.PI/2;
  const diff=((a+period/2)%period+period)%period-period/2;
  return Math.abs(diff)<=halfAngle;
}
export class RaceSimulation {
  constructor({seed='desert-festa-preview',trackId=1,hazardMultiplier=1,players=[]}={}) {
    this.seed=String(seed);this.rng=seededRandom(seed);this.track=createTrack(trackId);
    this.multiplier=clamp(Number(hazardMultiplier)||1,1,3);this.tick=0;this.time=0;this.finished=false;
    this.obstacles=createObstacles(this.track);this.events=[];this.fx=[];this.eventId=0;
    this.mushroomHits=0;this.stickers=[];
    this.stats={obstacleContacts:0,marbleContacts:0,recoveries:0,wallHits:0};
    this.boss=null;this.triggered={zodiark:false,abyss:false};this.sniper=null;this.buster=null;
    this.nextSniper=7.5/this.multiplier;this.nextBuster=11/this.multiplier;
    this.finishOrder=[];
    const names=players.length?players:Array.from({length:28},(_,i)=>`빛의영웅_${i+1}`);
    const positions=names.map((_,i)=>i);
    for(let i=positions.length-1;i>0;i--){const j=Math.floor(this.rng()*(i+1));[positions[i],positions[j]]=[positions[j],positions[i]];}
    this.marbles=names.map((name,i)=>{
      const pos=positions[i],s=-20-Math.floor(pos/6)*31,u=((pos%6)-2.5)*30;
      return {id:i+1,name:String(name),color:`hsl(${i*360/names.length},80%,65%)`,s,u,vs:0,vu:0,progress:0,rank:i+1,
        stun:0,lowGravity:0,air:0,hitCooldown:0,pendingStun:false,finished:false,finishTime:null,finishOrder:0,
        bestS:s,stuck:0,sparkCooldown:0,trail:[],...this.track.frame(s,u)};
    });
    this.ranked=[...this.marbles];this.traps=[];
    for(const type of ['banana','mushroom'])for(let i=0;i<(type==='banana'?10:8)*this.multiplier;i++) {
      this.traps.push({type,s:this.track.length*(.055+this.rng()*.88),u:(this.rng()-.5)*166,active:true});
    }
  }
  emit(type,s,u,{life=1,sound=null,...data}={}) {
    const e={id:++this.eventId,type,s,u,at:this.time,life,sound,...data};
    this.events.push(e);this.fx.push(e);
    if(this.events.length>1200)this.events.shift();
    if(this.fx.length>220)this.fx.shift();
    return e;
  }
  step() {
    if(this.finished)return;
    const dt=1/PHYSICS.hz;
    this.time=this.tick/PHYSICS.hz;
    // 뒤집는 동안 구슬을 공중에 붙잡는다. 경기 시간은 계속 흐르고 착지 때 좌표를 한 번만 교환한다.
    if(this.boss?.flip&&!this.boss.flip.landed){this.bossStep();this.endTick();return;}
    for(const m of this.marbles) {
      m.prevS=m.s;m.prevU=m.u;
      m.lowGravity=Math.max(0,m.lowGravity-dt);m.air=Math.max(0,m.air-dt);
      m.hitCooldown=Math.max(0,m.hitCooldown-dt);m.sparkCooldown=Math.max(0,m.sparkCooldown-dt);
      if(m.finished)continue;
      if(m.stun>0){m.stun=Math.max(0,m.stun-dt);m.vs=0;m.vu=0;continue;}
      m.vs+=(PHYSICS.gravity*(m.lowGravity>0?.2:1)-PHYSICS.drag*m.vs)*dt;
      m.vu*=Math.exp(-2*dt);
      if(this.boss?.phase==='active'&&this.boss.type==='zodiark'&&this.inArena(m))m.vu+=700*dt;
      m.vs=clamp(m.vs,-380,PHYSICS.maxForwardSpeed);m.vu=clamp(m.vu,-720,720);
      m.s+=m.vs*dt;m.u+=m.vu*dt;
    }
    // 120Hz + 세 번의 접촉 해결. 모든 클라이언트에서 같은 순서로 실행한다.
    for(let iter=0;iter<3;iter++) {
      for(const m of this.marbles) {
        if(m.finished||m.stun>0)continue;
        for(const o of this.obstacles) {
          const center=o.s??(o.s1+o.s2)/2;
          if(Math.abs(m.s-center)>350)continue;
          if(o.type==='pin')this.contact(m,o.s,o.u,o.r,0,0);
          else {
            const c=capsuleAt(o,this.time),ds=c.s2-c.s1,du=c.u2-c.u1;
            const t=clamp(((m.s-c.s1)*ds+(m.u-c.u1)*du)/(ds*ds+du*du),0,1);
            const s=c.s1+ds*t,u=c.u1+du*t;
            this.contact(m,s,u,c.r,o.type==='rotor'?o.omega*(u-o.u):0,o.type==='rotor'?-o.omega*(s-o.s):0);
          }
        }
        this.wall(m);
      }
      for(let i=0;i<this.marbles.length;i++)for(let j=i+1;j<this.marbles.length;j++) {
        const a=this.marbles[i],b=this.marbles[j];
        if(a.finished||b.finished)continue;
        const ds=b.s-a.s,du=b.u-a.u,d=Math.hypot(ds,du),diameter=PHYSICS.radius*2;
        if(d>=diameter)continue;
        const ns=d>1e-6?ds/d:0,nu=d>1e-6?du/d:1;
        const ia=a.stun>0?0:1,ib=b.stun>0?0:1,sum=ia+ib;
        if(!sum)continue;
        const dep=(diameter-d)/sum;
        a.s-=ns*dep*ia;a.u-=nu*dep*ia;b.s+=ns*dep*ib;b.u+=nu*dep*ib;
        const v=(b.vs-a.vs)*ns+(b.vu-a.vu)*nu;
        if(v<0){const impulse=-1.25*v/sum;a.vs-=impulse*ns*ia;a.vu-=impulse*nu*ia;b.vs+=impulse*ns*ib;b.vu+=impulse*nu*ib;}
        if(iter===0)this.stats.marbleContacts++;
      }
    }
    for(const m of this.marbles) {
      if(m.finished)continue;
      // 일반 이동의 전진 상한. 반전도 현재 선두 위치 안에서 교환하므로 선두의 거리 상한은 유지된다.
      m.s=clamp(m.s,-400,m.prevS+PHYSICS.maxForwardSpeed*dt);
      m.u=clamp(m.u,-this.track.halfWidth+PHYSICS.radius,this.track.halfWidth-PHYSICS.radius);
      m.s=Math.round(m.s*1e6)/1e6;m.u=Math.round(m.u*1e6)/1e6;
      m.vs=Math.round(clamp(m.vs,-380,PHYSICS.maxForwardSpeed)*1e6)/1e6;
      m.vu=Math.round(clamp(m.vu,-720,720)*1e6)/1e6;
      if(m.s>m.bestS+8){m.bestS=m.s;m.stuck=0;}else if(m.stun<=0)m.stuck+=dt;
      if(m.stuck>1.5){m.vu=(Math.abs(m.u)>65?-Math.sign(m.u):(this.rng()>.5?1:-1))*320;m.vs=0;m.stuck=0;this.stats.recoveries++;this.emit('rescue',m.s,m.u,{life:.45});}
      m.progress=clamp(m.s/this.track.length,0,1);
      Object.assign(m,this.track.frame(m.s,m.u));
      if(this.tick%6===0){m.trail.push({s:m.s,u:m.u});if(m.trail.length>14)m.trail.shift();}
      if(m.s>=this.track.length){m.finished=true;m.progress=1;m.finishTime=(this.tick+1)/PHYSICS.hz;m.finishOrder=this.finishOrder.length+1;this.finishOrder.push(m.id);this.emit('finish',m.s,m.u,{life:1.5});}
    }
    this.rank();this.trapStep();this.timedStep();this.bossStep();
    this.endTick();
  }
  endTick(){
    this.tick++;this.time=this.tick/PHYSICS.hz;
    this.fx=this.fx.filter(e=>this.time-e.at<e.life);
    this.stickers=this.stickers.filter(e=>this.time-e.at<e.life);
    if(this.tick>=PHYSICS.hz*PHYSICS.duration){this.finished=true;this.rank();}
  }
  contact(m,s,u,r,vs,vu) {
    const ds=m.s-s,du=m.u-u,d=Math.hypot(ds,du),required=r+PHYSICS.radius;
    if(d>=required)return;
    const ns=d>1e-6?ds/d:-1,nu=d>1e-6?du/d:0;
    m.s+=ns*(required-d);m.u+=nu*(required-d);
    const v=(m.vs-vs)*ns+(m.vu-vu)*nu;
    if(v<0){m.vs-=1.25*v*ns;m.vu-=1.25*v*nu;}
    this.stats.obstacleContacts++;
    if(m.sparkCooldown<=0&&Math.abs(v)>100){this.emit('spark',m.s,m.u,{life:.22,color:'#ffd58a'});m.sparkCooldown=.18;}
  }
  wall(m) {
    const edge=this.track.halfWidth-PHYSICS.radius;
    if(Math.abs(m.u)<=edge)return;
    const impact=Math.abs(m.vu);m.u=Math.sign(m.u)*edge;m.vu*=-.5;
    if(impact>120&&m.sparkCooldown<=0){this.emit('spark',m.s,m.u,{life:.45,color:m.pendingStun?'#ff702b':'#ceafff'});m.sparkCooldown=.2;this.stats.wallHits++;}
    if(m.pendingStun){m.stun=2.5;m.pendingStun=false;m.vs=0;m.vu=0;this.emit('stun',m.s,m.u,{life:.7,color:'#ff873d'});}
  }
  rank() {
    this.ranked=[...this.marbles].sort((a,b)=>a.finished&&b.finished?a.finishOrder-b.finishOrder:a.finished?-1:b.finished?1:b.s-a.s||a.id-b.id);
    this.ranked.forEach((m,i)=>m.rank=i+1);
  }
  trapStep() {
    for(const trap of this.traps) {
      if(!trap.active)continue;
      const m=this.marbles.find(m=>!m.finished&&Math.hypot(m.s-trap.s,m.u-trap.u)<28);
      if(!m)continue;
      trap.active=false;
      if(trap.type==='banana'){
        m.vs=-340;m.vu+=(this.rng()-.5)*260;m.air=.8;
        this.emit('banana',m.s,m.u,{life:.8,sound:'bananaSlip'});
      }else{
        for(const n of this.marbles)if(!n.finished&&Math.hypot(n.s-trap.s,n.u-trap.u)<145)n.lowGravity=4.5;
        this.emit('poison',trap.s,trap.u,{life:2.5,radius:145,sound:'mushroomPuff'});
        this.stickers.push({id:++this.mushroomHits,victimId:m.id,at:this.time,life:2.6,imageKey:this.mushroomHits%2?'teemoThumb1':'teemoThumb2'});
      }
    }
  }
  timedStep() {
    const active=this.ranked.filter(m=>!m.finished);
    if(!active.length)return;
    if(!this.sniper&&this.time>=this.nextSniper){const target=active[Math.floor(this.rng()*active.length)];this.sniper={id:target.id,at:this.time,fire:this.time+1.3};this.nextSniper+=7.5/this.multiplier;this.emit('aim',target.s,target.u,{life:.15,sound:'sniperAim'});}
    if(this.sniper&&this.time>=this.sniper.fire){const m=this.marbles[this.sniper.id-1];if(!m.finished){m.stun=2.8;m.vs=0;m.vu=0;this.emit('shot',m.s,m.u,{life:.65,sound:'sniperShot'});}this.sniper=null;}
    if(!this.buster&&this.time>=this.nextBuster){this.buster={id:active[0].id,at:this.time,fire:this.time+1.6};this.nextBuster+=11/this.multiplier;this.emit('lock',active[0].s,active[0].u,{life:.2,sound:'blueShellLock'});}
    if(this.buster&&this.time>=this.buster.fire){
      const target=this.marbles[this.buster.id-1];
      this.emit('buster',target.s,target.u,{life:1.1,radius:165,sound:'explosion'});
      for(const m of active){const ds=m.s-target.s,du=m.u-target.u,d=Math.hypot(ds,du);if(d>165)continue;const a=d>1?Math.atan2(du,ds):this.rng()*Math.PI*2,force=650*(1-d/220);m.vs=Math.cos(a)*force-220;m.vu=Math.sin(a)*force;m.air=.7;}
      this.buster=null;
    }
  }
  inArena(m) {return !m.finished&&m.rank<=20&&this.boss&&Math.abs(m.s-this.boss.s)<1100;}
  beginFlip(b){
    const active=this.marbles.filter(m=>!m.finished);
    if(!active.length)return;
    const minS=Math.min(...active.map(m=>m.s)),maxS=Math.max(...active.map(m=>m.s));
    b.s=(minS+maxS)/2;
    const entries=active.map(m=>({id:m.id,fromS:m.s,fromU:m.u,toS:minS+maxS-m.s,toU:-m.u,vs:m.vs,vu:m.vu}));
    const points=entries.flatMap(e=>[this.track.frame(e.fromS,e.fromU),this.track.frame(e.toS,e.toU)]);
    const x=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2;
    const y=(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2;
    b.flip={prepare:.45,duration:1,landed:false,minS,maxS,x,y,radius:Math.max(...points.map(p=>Math.hypot(p.x-x,p.y-y))),entries};
  }
  landFlip(b){
    const flip=b.flip;
    if(!flip||flip.landed)return;
    for(const e of flip.entries){
      const m=this.marbles[e.id-1];
      m.s=e.toS;m.u=e.toU;m.prevS=m.s;m.prevU=m.u;
      m.vs=-Math.abs(e.vs)*.3;m.vu=-e.vu;m.air=.8;
      m.bestS=m.s;m.stuck=0;m.trail=[];m.progress=clamp(m.s/this.track.length,0,1);
      Object.assign(m,this.track.frame(m.s,m.u));
      this.emit('flipLand',m.s,m.u,{life:.65,color:'#dab0ff'});
    }
    flip.landed=true;this.rank();
    // 반전 착지 뒤 기존 조디아크의 측면 폭발·벽 충돌 효과도 이어 간다.
    for(const m of this.marbles)if(this.inArena(m)){m.vu=700;m.vs-=170;m.air=.8;}
    this.emit('flipImpact',b.s,0,{life:1.1,radius:460,sound:'explosion'});
  }
  bossStep() {
    const leader=this.ranked.find(m=>!m.finished)||this.ranked[0];
    if(!this.boss){
      const type=!this.triggered.zodiark&&leader.progress>=.58?'zodiark':!this.triggered.abyss&&leader.progress>=.7?'abyss':null;
      if(type){this.triggered[type]=true;this.boss={type,phase:'casting',at:this.time,cast:type==='zodiark'?2.5:2.2,duration:type==='zodiark'?5:6,s:leader.s+450,u:0,angle:0};this.emit('cast',this.boss.s,0,{life:2.5,sound:type==='zodiark'?'zodiarkVoice':'castWarning',boss:type});}
    }
    const b=this.boss;if(!b)return;
    if(b.type==='zodiark'&&b.phase==='casting'){
      const distances=this.marbles.filter(m=>!m.finished).map(m=>m.s);
      if(distances.length)b.s=(Math.min(...distances)+Math.max(...distances))/2;
    }
    const elapsed=this.time-b.at;
    if(b.phase==='casting'&&elapsed>=b.cast){
      b.phase='active';b.activeAt=this.time;
      if(b.type==='zodiark')this.beginFlip(b);
      this.emit(b.type==='zodiark'?'rift':'abyss',b.s,0,{life:1.6,radius:440,sound:b.type==='zodiark'?'explosion':'abyssAoe'});
    }
    if(b.flip&&!b.flip.landed&&this.time-b.activeAt>=b.flip.prepare+b.flip.duration)this.landFlip(b);
    const center=this.track.frame(b.s,0);
    b.angle=center.angle+Math.max(0,elapsed-b.cast)*1.85;
    if(b.phase==='active'&&b.type==='abyss')for(const m of this.marbles){
      if(!this.inArena(m)||m.stun>0||m.hitCooldown>0)continue;
      if(fanHit(m.x-center.x,m.y-center.y,b.angle)){
        m.vu=700;m.vs=-160;m.pendingStun=true;m.hitCooldown=1.3;m.air=.55;
        this.emit('slash',m.s,m.u,{life:.6,color:'#ff913d'});
      }
    }
    if(elapsed>=b.cast+b.duration)this.boss=null;
  }
  advanceTo(tick) {while(this.tick<Math.min(tick,PHYSICS.hz*PHYSICS.duration))this.step();}
  get result(){return {winner:this.ranked[0],loser:this.ranked.at(-1)};}
}
