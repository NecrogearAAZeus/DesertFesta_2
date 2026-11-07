// server.js
require('dotenv').config(); // 동일 위치의 .env 파일 로드
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// public 폴더 정적 호스팅 (public/games/marble-race/index.html 등 접근 가능)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 실시간 구슬 경마 상태 & 참가자 & SSE(Server-Sent Events) 클라이언트 관리
// ============================================================================
const sseClients = new Set();     // 실시간 중계를 보고 있는 브라우저 목록
const participants = new Set();   // 현재 참가 신청한 유저 닉네임 목록 (20~40명)
let raceEndTimer = null;

function isRaceAdmin(req) {
  return Boolean(process.env.ADMIN_PASSWORD) && req.get('x-admin-password') === ADMIN_PASSWORD;
}

function requireRaceAdmin(req, res, next) {
  if (!isRaceAdmin(req)) return res.status(403).json({ ok: false, message: '관리자 인증이 필요합니다.' });
  next();
}

let currentRaceState = {
  status: 'waiting',              // 'waiting' | 'running' | 'finished'
  seed: null,
  trackId: 1,
  hazardMultiplier: 1,
  players: [],
  startedAt: null
};

// 연결된 모든 유저 브라우저에 이벤트 실시간 전송
function broadcast(eventType, payload) {
  const data = JSON.stringify({ type: eventType, payload });
  for (const clientRes of sseClients) {
    clientRes.write(`data: ${data}\n\n`);
  }
}

// ============================================================================
// 1. 클라이언트 실시간 스트림 연결 엔드포인트 (SSE)
// ============================================================================
app.get('/api/marble-race/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // 최초 접속 시 현재 참가자 명단 및 레이스 상태 전달
  res.write(`data: ${JSON.stringify({
    type: 'SYNC_STATE',
    payload: {
      ...currentRaceState,
      WaitingPlayers: Array.from(participants)
    }
  })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ============================================================================
// 2. 유저 참가 등록 API (유저가 본인 닉네임으로 참가할 때 호출)
// ============================================================================
app.post('/api/marble-race/join', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 30);
  if (currentRaceState.status === 'running') {
    return res.status(409).json({ ok: false, message: '경기 중에는 참가할 수 없습니다.' });
  }
  if (!name) {
    return res.status(400).json({ ok: false, message: '닉네임을 입력해 주세요.' });
  }

  if (participants.size >= 40 && !participants.has(name)) {
    return res.status(400).json({ ok: false, message: '참가자는 최대 40명까지 가능합니다.' });
  }
  participants.add(name);
  const playerList = Array.from(participants);

  broadcast('PLAYERS_UPDATED', { players: playerList });
  res.json({ ok: true, players: playerList });
});

// 현재 대기 중인 참가자 목록 조회
app.get('/api/marble-race/players', (req, res) => {
  res.json({
    ok: true,
    players: Array.from(participants),
    currentRaceState
  });
});

// ============================================================================
// 3. 관리자(admin.html) 전용: 트랙 & 방해공작 배수 결정 후 레이스 시작 API
// ============================================================================
app.post('/api/marble-race/start', (req, res) => {
  const { trackId = 1, hazardMultiplier = 1, players, adminKey } = req.body;

  // 관리자의 별도 헤더 인증을 필수로 요구한다.
  if (!isRaceAdmin(req) || (adminKey && adminKey !== ADMIN_PASSWORD)) {
    return res.status(403).json({ ok: false, message: '관리자 인증이 필요합니다.' });
  }
  if (currentRaceState.status === 'running') {
    return res.status(409).json({ ok: false, message: '이미 경기가 진행 중입니다.' });
  }

  // 관리자 페이지에서 직접 넘긴 명단이 있으면 사용, 없으면 참가 신청한 유저 목록 사용
  let finalPlayers = Array.isArray(players) && players.length > 0 ? players : Array.from(participants);
  finalPlayers = [...new Set(finalPlayers.map((name) => String(name).trim()).filter(Boolean))];
  if (finalPlayers.length === 0 || finalPlayers.length > 40) {
    return res.status(400).json({ ok: false, message: '참가자는 1~40명이어야 합니다.' });
  }

  const selectedTrack = Number(trackId);
  const selectedMultiplier = Number(hazardMultiplier);
  if (![1, 2, 3].includes(selectedTrack) || ![1, 2, 3].includes(selectedMultiplier)) {
    return res.status(400).json({ ok: false, message: '트랙과 방해 배수를 확인해 주세요.' });
  }

  // 지연 수신 클라이언트도 같은 시뮬레이션 프레임에서 출발하도록 시작 시각을 조금 뒤로 둔다.
  const startedAt = Date.now() + 1500;
  const seed = `festa-${crypto.randomBytes(12).toString('hex')}`;

  currentRaceState = {
    status: 'running',
    seed,
    trackId: selectedTrack,
    hazardMultiplier: selectedMultiplier,
    players: finalPlayers,
    startedAt
  };

  if (raceEndTimer) clearTimeout(raceEndTimer);
  raceEndTimer = setTimeout(() => {
    if (currentRaceState.status !== 'running' || currentRaceState.startedAt !== startedAt) return;
    currentRaceState = { ...currentRaceState, status: 'finished', finishedAt: startedAt + 60000 };
    broadcast('FINISH_MARBLE_RACE', currentRaceState);
  }, Math.max(0, startedAt + 60000 - Date.now()));

  // 전체 접속자에게 즉시 레이스 시작 신호 브로드캐스트!
  broadcast('START_MARBLE_RACE', currentRaceState);

  res.json({ ok: true, race: currentRaceState });
});

// 관리자용 경마 상태 조회
app.get('/api/marble-race/admin-state', requireRaceAdmin, (req, res) => {
  res.json({ ok: true, race: currentRaceState, players: Array.from(participants) });
});

// 관리자용 참가자 초기화 API
app.post('/api/marble-race/reset', requireRaceAdmin, (req, res) => {
  if (raceEndTimer) clearTimeout(raceEndTimer);
  raceEndTimer = null;
  participants.clear();
  currentRaceState = { status: 'waiting', seed: null, trackId: 1, hazardMultiplier: 1, players: [], startedAt: null };
  broadcast('PLAYERS_UPDATED', { players: [] });
  res.json({ ok: true });
});

// ============================================================================
// 서버 실행
// ============================================================================
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 DesertFesta 서버가 실행되었습니다! (Port: ${PORT})`);
  console.log(`👉 구슬 경마 화면: http://localhost:${PORT}/games/marble-race/index.html`);
  console.log(`👉 메인 화면:      http://localhost:${PORT}/index.html`);
  console.log(`👉 관리자 화면:    http://localhost:${PORT}/admin.html`);
  console.log(`====================================================`);
});