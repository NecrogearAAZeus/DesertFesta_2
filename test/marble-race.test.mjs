import test from 'node:test';
import assert from 'node:assert/strict';
import {RaceSimulation,PHYSICS,fanHit} from '../public/games/marble-race/simulation.mjs';
import {createTrack} from '../public/games/marble-race/track.mjs';

test('50초 이전 완주는 코스 길이와 속도 상한으로 불가능하다',()=>{
  for(let id=1;id<=3;id++)assert.ok(createTrack(id).length/PHYSICS.maxForwardSpeed>50);
});
test('그려지는 네 방향 부채꼴의 각도·반경과 피격 판정이 일치한다',()=>{
  assert.equal(fanHit(200,0,0),true);assert.equal(fanHit(0,200,0),true);
  assert.equal(fanHit(150,150,0),false);assert.equal(fanHit(450,0,0),false);
  assert.equal(fanHit(150,150,Math.PI/4),true);
});
test('같은 시드는 프레임 소비 묶음이 달라도 같은 궤적과 결과다',()=>{
  const options={seed:'determinism-40',trackId:2,hazardMultiplier:3,players:Array.from({length:40},(_,i)=>String(i))};
  const a=new RaceSimulation(options),b=new RaceSimulation(options);
  for(let tick=120;tick<=7200;tick+=120){a.advanceTo(tick);for(let t=b.tick;t<tick;t+=17)b.advanceTo(Math.min(t+17,tick));
    assert.deepEqual(a.marbles,b.marbles);assert.deepEqual(a.events,b.events);}
  assert.deepEqual(a.result,b.result);
});
test('3개 맵 × 3개 배수 × 3개 인원 × 3개 시드: 완주 시간, 종료, 충돌, 기믹',()=>{
  const summary=[];
  for(const trackId of [1,2,3])for(const hazardMultiplier of [1,2,3]){
    const first=[],last=[],done=[];
    for(const count of [20,28,40])for(const seed of ['desert-festa-preview','race-b','race-c']){
      const s=new RaceSimulation({trackId,hazardMultiplier,seed,players:Array.from({length:count},(_,i)=>`참가자${i}`)});
      s.advanceTo(5999);assert.equal(s.finishOrder.length,0);assert.equal(s.finished,false);
      s.advanceTo(7199);assert.equal(s.finished,false);s.step();assert.equal(s.finished,true);assert.equal(s.time,60);
      assert.ok(s.stats.obstacleContacts>0);assert.ok(s.stats.marbleContacts>0);
      assert.equal(s.triggered.zodiark,true);assert.equal(s.triggered.abyss,true);
      for(const m of s.marbles){assert.ok(Number.isFinite(m.s)&&Number.isFinite(m.u));assert.ok(m.progress>.7,'초반 장애물에 영구적으로 끼이면 안 됨');assert.ok(Math.abs(m.u)<=s.track.halfWidth-PHYSICS.radius+.001);if(m.finished)assert.ok(m.finishTime>=50&&m.finishTime<=60);}
      if(s.ranked[0].finished)first.push(s.ranked[0].finishTime);
      last.push(s.ranked.at(-1).progress);done.push(s.finishOrder.length);
    }
    summary.push({trackId,hazardMultiplier,runs:9,withFinisher:first.length,firstMin:first.length?Math.min(...first).toFixed(2):null,firstMax:first.length?Math.max(...first).toFixed(2):null,lastProgressMin:(Math.min(...last)*100).toFixed(1),finishedMin:Math.min(...done),finishedMax:Math.max(...done)});
  }
  console.log('MEASUREMENTS '+JSON.stringify(summary));
});
