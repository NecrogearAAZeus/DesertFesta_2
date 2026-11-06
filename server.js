// 공통 서버: 가입/로그인, 세션, 채팅, 폴링, 운영자 API. (docs/스펙.md §6)
// 이 파일은 한 사람만 고친다. 게임 로직은 games/*.js 에.
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('.env에 ADMIN_PASSWORD가 필요합니다');
const PORT = Number(process.env.PORT ?? 3000);

const games = {
  test: require('./games/test'),
};

// ---- DB ----
fs.mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/app.db');
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  ffxiv_id        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  pepero          INTEGER NOT NULL CHECK (pepero BETWEEN 1 AND 5),
  consent_at      TEXT NOT NULL,
  participated_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 64));
}

// ---- 메모리 상태 (재시작 시 사라짐. 누적 점수가 없으므로 허용) ----
// ponytail: 채팅·게임 상태 메모리 보관, 재시작 보존이 필요해지면 DB 테이블로
const chat = [];             // { id, ffxivId, text, at }
let chatSeq = 0;
const lastChatAt = new Map(); // userId → ms
const CHAT_KEEP = 200;
const CHAT_COOLDOWN_MS = 3000;
const CHAT_MAX_LEN = 300;

const current = { name: null, phase: 'idle' }; // phase: idle | playing | result

// ---- HTTP ----
const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
}

function auth(req, res, next) {
  const token = /(?:^|;\s*)sid=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1];
  const user = token && db.prepare(
    'SELECT u.id, u.ffxiv_id AS ffxivId FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  req.user = { id: user.id, ffxivId: user.ffxivId };
  next();
}

function admin(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({ error: '운영자 비밀번호가 틀렸습니다' });
  next();
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

app.post('/api/signup', (req, res) => {
  const email = str(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const ffxivId = str(req.body.ffxivId);
  const pepero = Number(req.body.pepero);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 100) return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다' });
  if (password.length < 4 || password.length > 100) return res.status(400).json({ error: '비밀번호는 4~100자입니다' });
  if (!ffxivId || ffxivId.length > 30) return res.status(400).json({ error: 'FF14 ID는 1~30자입니다' });
  if (!Number.isInteger(pepero) || pepero < 1 || pepero > 5) return res.status(400).json({ error: '선호 빼빼로를 골라 주세요' });
  if (req.body.consent !== true) return res.status(400).json({ error: '개인정보 수집에 동의해야 가입할 수 있습니다' });
  try {
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO users (email, ffxiv_id, password_hash, pepero, consent_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).run(email, ffxivId, hashPassword(password), pepero);
    setSession(res, Number(lastInsertRowid));
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '이미 가입된 이메일 또는 FF14 ID입니다' });
    throw e;
  }
});

app.post('/api/login', (req, res) => {
  const row = db.prepare('SELECT id, password_hash FROM users WHERE ffxiv_id = ?').get(str(req.body.ffxivId));
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!row || !checkPassword(password, row.password_hash)) return res.status(401).json({ error: 'FF14 ID 또는 비밀번호가 틀렸습니다' });
  setSession(res, row.id);
  res.json({ ok: true });
});

app.get('/api/state', auth, (req, res) => {
  const after = Number(req.query.chatAfter) || 0;
  const game = games[current.name];
  res.json({
    me: req.user,
    game: { name: current.name, phase: current.phase },
    view: game && current.phase !== 'idle' ? game.view(req.user) : null,
    chat: chat.filter((m) => m.id > after),
  });
});

app.post('/api/chat', auth, (req, res) => {
  const text = str(req.body.text);
  if (!text || text.length > CHAT_MAX_LEN) return res.status(400).json({ error: `채팅은 1~${CHAT_MAX_LEN}자입니다` });
  const now = Date.now();
  if (now - (lastChatAt.get(req.user.id) ?? 0) < CHAT_COOLDOWN_MS) return res.status(429).json({ error: '3초에 한 번만 보낼 수 있습니다' });
  lastChatAt.set(req.user.id, now);
  chat.push({ id: ++chatSeq, ffxivId: req.user.ffxivId, text, at: now });
  if (chat.length > CHAT_KEEP) chat.shift();
  res.json({ ok: true });
});

app.post('/api/act', auth, (req, res) => {
  const game = games[current.name];
  if (!game || current.phase !== 'playing') return res.status(400).json({ error: '지금은 제출할 수 없습니다' });
  try {
    game.act(req.user, req.body.input);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  db.prepare("UPDATE users SET participated_at = datetime('now') WHERE id = ? AND participated_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});

// ---- 운영자 ----
app.post('/api/admin/game', admin, (req, res) => {
  if (!games[req.body.name]) return res.status(400).json({ error: '없는 게임입니다' });
  Object.assign(current, { name: req.body.name, phase: 'idle' });
  res.json(current);
});

app.post('/api/admin/start', admin, (req, res) => {
  const game = games[current.name];
  if (!game) return res.status(400).json({ error: '게임을 먼저 고르세요' });
  game.start();
  current.phase = 'playing';
  res.json(current);
});

app.post('/api/admin/resolve', admin, (req, res) => {
  if (current.phase !== 'playing') return res.status(400).json({ error: '진행 중인 판이 없습니다' });
  games[current.name].resolve();
  current.phase = 'result';
  res.json(current);
});

app.get('/api/admin/state', admin, (req, res) => res.json(current));

app.get('/api/admin/export', admin, (req, res) => {
  const rows = db.prepare('SELECT ffxiv_id, email, pepero, participated_at FROM users WHERE participated_at IS NOT NULL ORDER BY participated_at').all();
  const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const csv = ['ffxiv_id,email,pepero,participated_at', ...rows.map((r) => [r.ffxiv_id, r.email, r.pepero, r.participated_at].map(esc).join(','))].join('\n');
  res.type('text/csv; charset=utf-8').attachment('participants.csv').send('﻿' + csv);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류' });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
