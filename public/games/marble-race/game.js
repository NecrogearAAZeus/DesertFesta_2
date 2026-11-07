import {GAME_CONFIG} from './config.js';
import {RaceSimulation,PHYSICS} from './simulation.mjs';
import {RaceRenderer} from './renderer.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const params=new URLSearchParams(location.search),liveMode=params.get('live')==='1';
let myName=params.get('name');
try {myName ||= localStorage.getItem('nickname');}catch{}

class SoundManager {
  constructor(){this.failed=new Set();this.active=new Set();this.lastSubtitle=new Map();}
  subtitle(key){
    const now=performance.now();if(now-(this.lastSubtitle.get(key)??-Infinity)<1800)return;
    this.lastSubtitle.set(key,now);const container=$('soundSubtitleContainer');
    while(container.children.length>=2)container.firstElementChild.remove();
    const el=document.createElement('div');el.className='sound-subtitle-toast';el.textContent=GAME_CONFIG.sounds[key]?.subtitle||key;
    container.appendChild(el);setTimeout(()=>el.remove(),2200);
  }
  play(key){
    const item=GAME_CONFIG.sounds[key];if(!item)return;
    if(this.failed.has(key)){this.subtitle(key);return;}
    if(this.active.size>=6)return;
    const a=new Audio(item.src);a.volume=item.loop ? 0.3 : 0.55;a.loop=!!item.loop;this.active.add(a);
    a.onended=()=>this.active.delete(a);
    a.play().catch(error=>{if(!this.active.has(a)||error.name==='AbortError')return;this.active.delete(a);if(error.name!=='NotAllowedError')this.failed.add(key);this.subtitle(key);});
  }
  stop(){for(const a of this.active){a.pause();a.removeAttribute('src');}this.active.clear();}
}
const images={};
for(const [key,url] of Object.entries(GAME_CONFIG.images)){const img=new Image();img.src=url;images[key]=img;}
const renderer=new RaceRenderer($('mainCanvas'),$('pipCanvas'),images),sound=new SoundManager();
window.addEventListener('resize',()=>renderer.resize());
let sim=null,startedAt=0,animation=null,lastFrame=0,lastHud=-1,lastEvent=0,resultShown=false,serverRace=false,serverSeed=null;

function startRace(options={}){
  if(animation)cancelAnimationFrame(animation);
  sound.stop();sim=new RaceSimulation(options);startedAt=options.startedAt??Date.now();
  serverRace=options.status==='running';serverSeed=serverRace?String(options.seed):null;
  resultShown=false;lastHud=-1;lastEvent=0;lastFrame=performance.now();renderer.reset();
  $('resultModal').style.display='none';$('bossCastOverlay').style.display='none';
  $('raceMetaText').textContent=`${sim.track.name} · 방해 ${sim.multiplier}x`;
  sound.play('bgm');updateHud();animation=requestAnimationFrame(loop);
}
function loop(now){
  if(!sim)return;
  const target=Math.floor(Math.max(0,Date.now()-startedAt)*PHYSICS.hz/1000);
  // 따라잡기 프레임 수를 제한해 재접속 중에도 UI가 응답한다. 물리 틱은 버리지 않는다.
  sim.advanceTo(Math.min(target,sim.tick+360));
  for(const event of sim.events)if(event.id>lastEvent){if(event.sound&&sim.time-event.at<.35)sound.play(event.sound);lastEvent=event.id;}
  renderer.render(sim,Math.min(.05,(now-lastFrame)/1000),myName||sim.marbles[0]?.name);lastFrame=now;
  if(sim.time-lastHud>=.1||sim.finished){updateHud();lastHud=sim.time;}
  if(sim.finished&&!serverRace)showResult();
  if(!resultShown)animation=requestAnimationFrame(loop);
}
function rankRow(m,mine=false){
  return `<div class="rank-row ${mine?'my-rank-row':''}"><div class="rank-num rank-${m.rank}">${m.rank}</div><div class="marble-badge" style="background:${m.color}"></div><div class="rank-info"><div class="rank-name-line"><span class="num-tag">${m.id}</span><span>${escapeHTML(m.name)}${mine?' · 나':''}</span></div><div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${m.progress*100}%"></div><div class="progress-pct-text">${m.finished?`${m.finishOrder}위 완주`:`${(m.progress*100).toFixed(1)}%`}</div></div></div></div>`;
}
function updateHud(){
  const whole=Math.ceil(Math.max(0,60-sim.time));
  $('timerValue').textContent=`${String(Math.floor(whole/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`;
  $('topRanksList').innerHTML=sim.ranked.slice(0,7).map(m=>rankRow(m)).join('');
  const mine=sim.marbles.find(m=>m.name===myName)||(!liveMode?sim.marbles[0]:null);
  $('myRankContainer').innerHTML=mine?rankRow(mine,true):'';
  const last=sim.ranked.at(-1);$('pipLastName').textContent=`${last.name} · ${(last.progress*100).toFixed(1)}%`;
  const leader=sim.ranked[0],stage=leader.progress<.12?'출발 · 자유 낙하':leader.progress<.16?'핀 숲':leader.progress<.29?'깔때기 병목':leader.progress<.46?'중반 질주':leader.progress<.56?'교차 경사판':leader.progress<.69?'조디아크 · 천지 뒤집기':leader.progress<.8?'심연의 회랑':leader.progress<.9?'마지막 회전봉':'결승 질주';
  $('courseStatus').textContent=`${stage} · ${sim.finishOrder.length}/${sim.marbles.length} 완주`;
  $('finishStatus').textContent=leader.finished?`첫 완주 ${leader.finishTime.toFixed(2)}초 · 60초까지 계속 진행`:'구슬들이 결승선을 통과해도 60초까지 계속 진행됩니다';
  const b=sim.boss,overlay=$('bossCastOverlay');overlay.style.display=b?'flex':'none';
  if(b){const casting=b.phase==='casting';overlay.dataset.boss=b.type;
    $('bossDialogueText').textContent=b.type==='zodiark'?'“세상만물 내 뜻대로!”':'“한쪽은 심연 — 돌아가는 불꽃을 보아라!”';
    $('bossSkillName').textContent=b.type==='zodiark'?(casting?'아스트랄 격변 · 꽉 잡으세요!':b.flip?.landed?'아스트랄 격변 · 앞뒤 반전 완료!':'아스트랄 격변 · 천지 뒤집기!'):('심연의 회전 화염'+(casting?' · 시전 중':' · 발동'));
    const elapsed=sim.time-b.at,remain=casting?b.cast-elapsed:b.cast+b.duration-elapsed;
    $('bossCastTime').textContent=Math.max(0,remain).toFixed(1)+'s';
    $('bossCastFill').style.width=(casting?Math.min(100,elapsed/b.cast*100):100)+'%';
  }
}
function showResult(){
  if(resultShown||!sim.finished)return;resultShown=true;serverRace=false;
  if(animation)cancelAnimationFrame(animation);sound.stop();sound.play('fanfare');
  $('bossCastOverlay').style.display='none';const {winner,loser}=sim.result;
  $('winnerName').textContent=winner.name;$('winnerDetail').textContent=winner.finished?`최초 완주 ${winner.finishTime.toFixed(2)}초`:`미완주 · 최고 진행도 ${(winner.progress*100).toFixed(2)}%`;
  $('loserName').textContent=loser.name;$('loserDetail').textContent=`60초 시점 진행도 ${(loser.progress*100).toFixed(2)}% · ${sim.marbles.length}명 중 ${loser.rank}위`;
  $('resultModal').style.display='flex';
}
function preview(){
  const count=Number($('selectPlayers').value);
  startRace({seed:$('seedInput').value.trim()||'desert-festa-preview',trackId:Number($('selectTrack').value),hazardMultiplier:Number($('selectHazard').value),players:Array.from({length:count},(_,i)=>`빛의영웅_${i+1}`)});
}
$('btnTestStart').addEventListener('click',preview);
$('btnNewSeed').addEventListener('click',()=>{$('seedInput').value='festa-'+Date.now().toString(36);preview();});
$('reduceMotion').addEventListener('change',e=>renderer.reduced=e.target.checked);
$('reduceMotion').checked=renderer.reduced;
if(liveMode){
  $('devControls').classList.add('server-connected');
  if(myName)fetch('/api/marble-race/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:myName})}).catch(()=>{});
  const stream=new EventSource('/api/marble-race/stream');
  stream.onmessage=event=>{
    const {type,payload}=JSON.parse(event.data);
    if(type==='START_MARBLE_RACE'||type==='SYNC_STATE'&&['running','finished'].includes(payload.status))startRace(payload);
    if(type==='FINISH_MARBLE_RACE'&&sim&&String(payload.seed)===serverSeed){sim.advanceTo(PHYSICS.duration*PHYSICS.hz);updateHud();renderer.render(sim,1/60,myName);showResult();}
  };
}else preview();
