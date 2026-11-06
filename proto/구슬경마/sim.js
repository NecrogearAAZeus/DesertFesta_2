// 구슬경마 프로토타입 — 서버에서 1회 계산 → 30fps 위치 녹화 → race-data.js
//   node sim.js [--seed 7]        1판 계산, race-data.js 저장
//   node sim.js --batch 300       300판 통계 (저장 안 함)
//   node sim.js --batch 300 --equal  물리 속성 전부 동일
const fs = require('fs');
const zlib = require('zlib');
const Matter = require('matter-js');
const { Engine, Bodies, Body, Composite } = Matter;

// ---------- 튜닝값 ----------
const W = 500;                 // 맵 폭 (월드 px)
const WALL = 30;               // 외벽 두께
const STEP = 1000 / 120;       // 물리 고정 timestep(ms). 120Hz = 관통 대응
const REC_FPS = 30;
const MAX_SEC = 90;
const GRAVITY = 0.001;       // matter 기본값
const MAX_SPEED = 9;           // px/step 아님, matter velocity 단위(px/16.67ms). 관통 방지 상한
const STUCK_SEC = 3, STUCK_DIST = 12;

const MARBLES = [ // 빼빼로 6종: 크기·탄성·마찰·밀도가 조금씩 다름 (미정 E)
  { name: '초코',   color: '#6b3e26', r: 11, restitution: 0.35, friction: 0.05, density: 0.0012 },
  { name: '아몬드', color: '#c8a165', r: 12, restitution: 0.30, friction: 0.06, density: 0.0014 },
  { name: '누드',   color: '#e8c48a', r: 10, restitution: 0.45, friction: 0.04, density: 0.0010 },
  { name: '크런키', color: '#d33b3b', r: 11, restitution: 0.40, friction: 0.07, density: 0.0011 },
  { name: '화이트', color: '#f2efe6', r: 10.5, restitution: 0.40, friction: 0.05, density: 0.0010 },
  { name: '딸기',   color: '#f28cb1', r: 11.5, restitution: 0.38, friction: 0.05, density: 0.0012 },
];

// ---------- 맵 블록 (위→아래로 쌓는다). 각 블록은 y0를 받아 { items, h } ----------
// item: { t:'c', x,y,r } 원 / { t:'r', x,y,w,h,a } 기울어진 막대 / { t:'s', x,y,w,h,f } 가감속 센서
const start = () => (y) => ({ items: [], h: 120 });

const pins = ({ rows, gap = 62 }) => (y) => {
  const items = [];
  for (let i = 0; i < rows; i++) {
    const off = i % 2 ? gap / 2 : 0;
    for (let x = gap / 2 + off; x < W - 10; x += gap) items.push({ t: 'c', x, y: y + 40 + i * 55, r: 6 });
  }
  return { items, h: 40 + rows * 55 };
};

// 경사로: 벽에서 시작해 반대편 구멍 쪽으로 내려감. 이 블록이 경주 시간의 대부분을 만든다
const zigzag = ({ turns, deg = 20, hole = 70 }) => (y) => {
  const items = [], len = W - hole, a = (deg * Math.PI) / 180, step = len * Math.sin(a) + 55; // 위 막대 끝과 아래 막대 사이 55px (구슬 지름×2 이상)
  for (let i = 0; i < turns; i++) {
    const left = i % 2 === 0; // 왼쪽 벽에 붙어 오른쪽으로 내려감
    const cx = left ? len / 2 : W - len / 2;
    items.push({ t: 'r', x: cx, y: y + 70 + i * step, w: len + 20, h: 14, a: left ? a : -a });
  }
  return { items, h: 70 + turns * step };
};

// 깔때기: 양쪽 사선 벽, 가운데 gap
const funnel = ({ gap }) => (y) => {
  const half = (W - gap) / 2, drop = 140, len = Math.hypot(half, drop) + 10, a = Math.atan2(drop, half);
  return {
    items: [
      { t: 'r', x: half / 2, y: y + 40 + drop / 2, w: len, h: 14, a },
      { t: 'r', x: W - half / 2, y: y + 40 + drop / 2, w: len, h: 14, a: -a },
    ],
    h: drop + 100,
  };
};

// 가감속 패널: 경사로 1개 + 그 위를 덮는 센서. 센서 안에서 매 스텝 속도 × f^(dt/1000) = 1초당 f배
// (f를 "프레임마다 그대로" 곱하면 1.3^30/초로 폭주. 0.25초당 f배로 했더니 감속 구간에서 구슬이 멈춤)
const zone = (f) => (y) => ({
  items: [
    { t: 'r', x: (W - 70) / 2, y: y + 100, w: W - 50, h: 14, a: (15 * Math.PI) / 180 },
    { t: 's', x: W / 2, y: y + 100, w: W, h: 160, f },
  ],
  h: 200,
});
const boost = ({ factor }) => zone(factor);
const slow = ({ factor }) => zone(factor);
const finish = () => (y) => ({ items: [], h: 120, finish: true });

const MAP = [
  start(),
  pins({ rows: 6 }),
  zigzag({ turns: 4 }),
  funnel({ gap: 60 }),
  boost({ factor: 1.3 }),
  zigzag({ turns: 4 }),
  funnel({ gap: 50 }),
  slow({ factor: 0.7 }),
  pins({ rows: 8 }),
  zigzag({ turns: 4 }),
  boost({ factor: 1.3 }),
  pins({ rows: 6 }),
  slow({ factor: 0.7 }),
  zigzag({ turns: 4 }),
  funnel({ gap: 50 }),
  pins({ rows: 5 }),
  finish(),
];

function buildMap() {
  const items = [];
  let y = 0, finishY = 0;
  for (const block of MAP) {
    const b = block(y);
    items.push(...b.items);
    if (b.finish) finishY = y + 40;
    y += b.h;
  }
  return { items, H: Math.round(y), finishY: Math.round(finishY) };
}

// ---------- 시드 난수 ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 1판 ----------
function race(seed, map, record = true) {
  const rand = rng(seed);
  const engine = Engine.create();
  engine.gravity.scale = GRAVITY;
  const st = { isStatic: true, friction: 0.05, restitution: 0.2 };
  const statics = [
    Bodies.rectangle(-WALL / 2, map.H / 2, WALL, map.H * 2, st),
    Bodies.rectangle(W + WALL / 2, map.H / 2, WALL, map.H * 2, st),
  ];
  const sensors = [];
  for (const it of map.items) {
    if (it.t === 'c') statics.push(Bodies.circle(it.x, it.y, it.r, { ...st, restitution: 0.5 }));
    else if (it.t === 'r') statics.push(Bodies.rectangle(it.x, it.y, it.w, it.h, { ...st, angle: it.a }));
    else sensors.push(it); // 센서는 물리 바디 대신 사각형 판정으로 처리 (회전 없음 → 이게 더 단순)
  }
  Composite.add(engine.world, statics);

  // 출발 순서 섞기 (자리 유불리 제거)
  const order = MARBLES.map((_, i) => i).sort(() => rand() - 0.5);
  const balls = MARBLES.map((m, i) => {
    const slot = order.indexOf(i);
    const b = Bodies.circle(60 + slot * 75 + (rand() - 0.5) * 10, 30 + rand() * 20, m.r, {
      restitution: m.restitution, friction: m.friction, frictionAir: 0.003, density: m.density,
    });
    b.plugin = { id: i, done: false, hist: [], nudges: 0 };
    return b;
  });
  Composite.add(engine.world, balls);

  const stepsPerRec = Math.round(1000 / REC_FPS / STEP); // 120/30 = 4
  const stuckSteps = Math.round((STUCK_SEC * 1000) / STEP);
  const frames = [], finishes = [];
  let steps = 0, nudges = 0, escaped = 0;
  const nudgeAt = [];

  while (steps * STEP < MAX_SEC * 1000 && finishes.length < balls.length) {
    // 가감속 센서
    for (const b of balls) {
      if (b.plugin.done) continue;
      for (const s of sensors) {
        if (Math.abs(b.position.x - s.x) < s.w / 2 && Math.abs(b.position.y - s.y) < s.h / 2) {
          const k = Math.pow(s.f, STEP / 1000);
          Body.setVelocity(b, { x: b.velocity.x * k, y: b.velocity.y * k });
        }
      }
      // 속도 상한 (관통 방지)
      const sp = Math.hypot(b.velocity.x, b.velocity.y);
      if (sp > MAX_SPEED) Body.setVelocity(b, { x: (b.velocity.x / sp) * MAX_SPEED, y: (b.velocity.y / sp) * MAX_SPEED });
    }
    Engine.update(engine, STEP);
    steps++;

    for (const b of balls) {
      const p = b.plugin;
      if (p.done) continue;
      if (b.position.x < -5 || b.position.x > W + 5) { escaped++; Body.setPosition(b, { x: W / 2, y: b.position.y }); }
      if (b.position.y > map.finishY) {
        p.done = true;
        finishes.push({ id: p.id, t: +((steps * STEP) / 1000).toFixed(2) });
        Body.setStatic(b, true);
        Body.setPosition(b, { x: b.position.x, y: map.finishY + 40 });
        b.collisionFilter.mask = 0; // 결승 뒤 다른 구슬과 안 부딪히게
        continue;
      }
      // 끼임: 3초 동안 12px 미만 이동 → 살짝 밀기
      if (steps % 30 === 0) {
        p.hist.push({ x: b.position.x, y: b.position.y, s: steps });
        while (p.hist.length && steps - p.hist[0].s > stuckSteps) p.hist.shift();
        const h0 = p.hist[0];
        if (steps - h0.s >= stuckSteps - 30 && Math.hypot(b.position.x - h0.x, b.position.y - h0.y) < STUCK_DIST) {
          Body.setVelocity(b, { x: (rand() - 0.5) * 6, y: -2 - rand() * 2 });
          p.nudges++; nudges++; p.hist = []; nudgeAt.push([Math.round(b.position.x), Math.round(b.position.y)]);
        }
      }
    }
    if (record && steps % stepsPerRec === 0) {
      const f = [];
      for (const b of balls) f.push(Math.round(b.position.x), Math.round(b.position.y));
      frames.push(f);
    }
  }
  // 미도착: 진행 거리(y)로 순위
  const rest = balls.filter((b) => !b.plugin.done).sort((a, b) => b.position.y - a.position.y);
  const ranking = [...finishes.map((f) => f.id), ...rest.map((b) => b.plugin.id)];
  return { finishes, ranking, frames, nudges, nudgeAt, escaped, simSec: (steps * STEP) / 1000, unfinished: rest.length };
}

function toFile(map, r, seed, fps = REC_FPS) {
  const every = REC_FPS / fps;
  const RACE = {
    seed, W, H: map.H, finishY: map.finishY, fps,
    map: map.items.map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]))),
    marbles: MARBLES.map((m) => ({ name: m.name, color: m.color, r: m.r })),
    finishes: r.finishes, ranking: r.ranking,
    frames: r.frames.filter((_, i) => i % every === 0),
  };
  return 'window.RACE = ' + JSON.stringify(RACE) + ';\n';
}

// ---------- 실행 ----------
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
// --equal: 물리 속성 6개 전부 동일 (맵·출발 자리 자체가 공정한지 확인용)
if (args.includes("--equal")) for (const m of MARBLES) Object.assign(m, { r: 11, density: 0.0012, friction: 0.05, restitution: 0.38 });
const map = buildMap();
const batch = opt('--batch', 0);

if (!batch) {
  const seed = opt('--seed', 1);
  const t0 = performance.now();
  const r = race(seed, map);
  const ms = performance.now() - t0;
  const out = toFile(map, r, seed);
  fs.writeFileSync(__dirname + '/race-data.js', out);
  console.log(`seed ${seed}  맵 높이 ${map.H}px (폭 ${W})  계산 ${ms.toFixed(0)}ms  끼임밀기 ${r.nudges}  관통복귀 ${r.escaped}  미도착 ${r.unfinished}`);
  console.log('밀기 위치:', JSON.stringify(r.nudgeAt));
  console.log('순위:', r.ranking.map((id) => MARBLES[id].name).join(' > '));
  console.log('도착:', r.finishes.map((f) => `${MARBLES[f.id].name} ${f.t}s`).join(', '));
  console.log(`race-data.js ${(out.length / 1024).toFixed(1)}KB (gzip ${(zlib.gzipSync(out).length / 1024).toFixed(1)}KB)`);
} else {
  const wins = MARBLES.map(() => 0), first = [], last = [], ms = [], sizes = [], gz = [], sizes15 = [];
  let nudges = 0, nudgeRaces = 0, escaped = 0, unfinished = 0, timeouts = 0;
  for (let s = 1; s <= batch; s++) {
    const t0 = performance.now();
    const r = race(s, map);
    ms.push(performance.now() - t0);
    wins[r.ranking[0]]++;
    if (r.finishes.length) first.push(r.finishes[0].t);
    if (r.unfinished) timeouts++; else last.push(r.finishes[r.finishes.length - 1].t);
    nudges += r.nudges; if (r.nudges) nudgeRaces++;
    escaped += r.escaped; unfinished += r.unfinished;
    if (s <= 30) { // 크기 측정은 30판만 (직렬화 비용)
      const f = toFile(map, r, s);
      sizes.push(f.length); gz.push(zlib.gzipSync(f).length); sizes15.push(toFile(map, r, s, 15).length);
    }
  }
  const st = (a) => a.length ? `평균 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} / 최소 ${Math.min(...a).toFixed(1)} / 최대 ${Math.max(...a).toFixed(1)}` : '-';
  const in55_75 = first.filter((t) => t >= 55 && t <= 75).length;
  console.log(`batch ${batch}판  맵 높이 ${map.H}px (폭 ${W}, 약 ${(map.H / 800).toFixed(1)}화면)`);
  console.log('우승 횟수:', MARBLES.map((m, i) => `${m.name} ${wins[i]}`).join(', '));
  console.log(`1등 도착(s): ${st(first)}   55~75초 안: ${in55_75}/${first.length}`);
  console.log(`꼴등 도착(s, 전원 완주 판만): ${st(last)}`);
  console.log(`90초 강제종료 판: ${timeouts}  미도착 구슬 합계: ${unfinished}`);
  console.log(`끼임 밀기: 총 ${nudges}회, 발생 판 ${nudgeRaces}/${batch}   관통 복귀: ${escaped}`);
  console.log(`1판 계산(ms): ${st(ms)}`);
  console.log(`녹화 크기(KB, 30판): 30fps ${st(sizes.map((x) => x / 1024))}  gzip ${st(gz.map((x) => x / 1024))}  15fps ${st(sizes15.map((x) => x / 1024))}`);
}
