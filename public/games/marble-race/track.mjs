// 원본 미니맵의 길을 따라가는 곡선. s=코스 거리, u=길의 좌우 위치(월드 단위).
export const COURSE_LENGTH = 18000;
export const TRACK_HALF_WIDTH = 112;
const MAPS = {
  1: { name: '코스타 델 솔 · 해안 순환로', imageKey: 'track3', width: 914, height: 733,
    points: [[707,177],[640,195],[584,241],[548,291],[520,331],[519,365],[492,403],[487,453],[462,511],[419,568],[355,607],[284,636],[215,643],[159,621],[128,585],[120,549],[147,506],[201,466],[231,420],[239,365],[241,305],[255,260],[247,219],[229,175],[226,115],[251,92],[315,81],[368,93],[415,82],[470,85],[515,103],[557,91],[578,86]] },
  2: { name: '림사 로민사 · 협곡 순환로', imageKey: 'track2', width: 637, height: 695,
    points: [[332,90],[322,143],[322,198],[346,256],[362,309],[326,332],[289,352],[257,392],[235,449],[212,512],[190,574],[195,606],[251,617],[310,624],[351,604],[364,555],[364,509],[356,479],[358,448],[377,421],[372,381],[370,348],[393,332],[438,327],[473,328]] },
  3: { name: '골드 소서 · 천공의 외길', imageKey: 'track1', width: 429, height: 733,
    points: [[131,687],[123,647],[116,619],[108,587],[112,558],[129,533],[136,492],[132,455],[133,422],[157,401],[167,377],[163,342],[176,316],[181,297],[160,276],[152,250],[146,232],[160,207],[174,184],[177,161],[184,146],[203,143],[210,127],[207,100],[206,74],[203,48],[214,30],[244,27],[272,27]] }
};
const lerp = (a,b,t) => a+(b-a)*t;
function spline(a,b,c,d,t) {
  return [0,1].map(i=>0.5*((2*b[i])+(-a[i]+c[i])*t+(2*a[i]-5*b[i]+4*c[i]-d[i])*t*t+(-a[i]+3*b[i]-3*c[i]+d[i])*t*t*t));
}
export function createTrack(id=1) {
  const map = MAPS[id] || MAPS[1], samples=[];
  for(let i=0;i<map.points.length-1;i++) for(let j=0;j<12;j++) {
    const p=spline(map.points[Math.max(0,i-1)],map.points[i],map.points[i+1],map.points[Math.min(map.points.length-1,i+2)],j/12);
    samples.push({x:p[0],y:p[1],s:0});
  }
  samples.push({x:map.points.at(-1)[0],y:map.points.at(-1)[1],s:0});
  let length=0;
  for(let i=1;i<samples.length;i++) {length+=Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y);samples[i].s=length;}
  const scale=COURSE_LENGTH/length;
  for(const p of samples) {p.x*=scale;p.y*=scale;p.s*=scale;}
  function frame(s,u=0) {
    const distance=Math.max(0,Math.min(COURSE_LENGTH,s));
    let lo=0,hi=samples.length-1;
    while(lo+1<hi) {const m=(lo+hi)>>1;if(samples[m].s<=distance)lo=m;else hi=m;}
    const a=samples[lo],b=samples[hi],len=b.s-a.s;
    const nx=(b.x-a.x)/len,ny=(b.y-a.y)/len,t=(distance-a.s)/len;
    const extension=s-distance;
    return {x:lerp(a.x,b.x,t)+nx*extension-ny*u,y:lerp(a.y,b.y,t)+ny*extension+nx*u,nx,ny,px:-ny,py:nx,angle:Math.atan2(ny,nx)};
  }
  return {...map,id,scale,samples,length:COURSE_LENGTH,halfWidth:TRACK_HALF_WIDTH,frame};
}

// 좁은 출구, 엇갈린 핀, 회전봉. 참고 앱의 맵 데이터는 복제하지 않고 직접 배치한다.
export function createObstacles(track) {
  const obstacles=[];
  const capsule=(s1,u1,s2,u2,r=9,kind='rail')=>obstacles.push({type:'capsule',s1,u1,s2,u2,r,kind});
  const pin=(s,u,r)=>obstacles.push({type:'pin',s,u,r,kind:'pin'});
  // 핀숲: 빈 통로로 흘러 들어간 구슬을 좌우로 흩뜨린다.
  for(let row=0;row<3;row++) for(let col=0;col<3;col++) pin(track.length*.12+row*86,(col-1)*58+(row%2?8:-8),11);
  // 깔때기는 충돌 벽 두 개와 짧은 목으로 구성한다. 출구는 구슬 약 두 개 폭.
  const funnel=at=>{
    const s=track.length*at;
    capsule(s-175,-112,s+80,-41,8,'funnel');capsule(s-175,112,s+80,41,8,'funnel');
    capsule(s+80,-41,s+140,-41,8,'funnel');capsule(s+80,41,s+140,41,8,'funnel');
  };
  funnel(.245);
  // 좌우가 번갈아 막힌 경사 판: 맞은 구슬이 빈 쪽으로 굴러 이동한다.
  const s=track.length*.49;
  capsule(s,-112,s+95,24,9,'baffle');capsule(s+190,112,s+285,-24,9,'baffle');
  // 회전봉이 길을 열고 닫으며 뭉친 구슬의 순서를 바꾼다.
  for(const [at,omega] of [[.59,1.5],[.81,-1.8]]) obstacles.push({type:'rotor',s:track.length*at,u:0,r:9,half:88,omega,phase:at*7,kind:'rotor'});
  return obstacles;
}
export function capsuleAt(o,time) {
  if(o.type!=='rotor')return o;
  const a=o.phase+o.omega*time,ds=Math.sin(a)*o.half,du=Math.cos(a)*o.half;
  return {s1:o.s-ds,u1:o.u-du,s2:o.s+ds,u2:o.u+du,r:o.r};
}
