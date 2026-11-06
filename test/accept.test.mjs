// 뼈대 인수 테스트 (ATDD). 실제 띄운 서버에 HTTP로 요청한다.
// 실행: docker compose up -d 후  node --test test/
// 환경: BASE_URL (기본 http://localhost:3000), ADMIN_PASSWORD (.env와 같게)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN_PASSWORD ?? 'test-admin';
const run = Date.now().toString(36);
let seq = 0;

async function api(path, { body, cookie, admin, method } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (admin) headers['x-admin-password'] = admin;
  const res = await fetch(BASE + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

async function signup() {
  const n = `${run}-${++seq}`;
  const user = { email: `u${n}@test.local`, password: 'pw-1234', ffxivId: `캐릭${n}`, pepero: 1, consent: true };
  const r = await api('/api/signup', { body: user });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.cookie, '가입 응답에 세션 쿠키가 있어야 한다');
  return { ...user, cookie: r.cookie };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/')).ok) return; } catch {}
    await sleep(500);
  }
  throw new Error('서버가 30초 안에 응답하지 않음');
}

test('1. 서버가 응답한다', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
});

test('2. 재시작 후에도 세션 유지 + 중복 가입 거부', async () => {
  const u = await signup();

  const dupEmail = await api('/api/signup', { body: { ...u, ffxivId: u.ffxivId + 'x' } });
  assert.equal(dupEmail.status, 409, '같은 이메일 재가입은 거부');
  const dupId = await api('/api/signup', { body: { ...u, email: 'x' + u.email } });
  assert.equal(dupId.status, 409, '같은 FF14 ID 재가입은 거부');

  const login = await api('/api/login', { body: { ffxivId: u.ffxivId, password: u.password } });
  assert.equal(login.status, 200);
  const bad = await api('/api/login', { body: { ffxivId: u.ffxivId, password: 'wrong' } });
  assert.equal(bad.status, 401);

  execSync('docker compose restart app', { stdio: 'ignore' });
  await waitUp();

  const s = await api('/api/state', { cookie: login.cookie });
  assert.equal(s.status, 200);
  assert.equal(s.json.me.ffxivId, u.ffxivId, '재시작 후 같은 쿠키로 로그인 상태');
});

test('3. 채팅: 2초 안에 다른 사람에게 보임, 3초 제한, 300자 제한', async () => {
  const a = await signup();
  const b = await signup();
  const before = await api('/api/state', { cookie: b.cookie });
  const after = before.json.chat.at(-1)?.id ?? 0;

  const text = `안녕 ${run}`;
  assert.equal((await api('/api/chat', { cookie: a.cookie, body: { text } })).status, 200);

  const t0 = Date.now();
  let seen = false;
  while (Date.now() - t0 < 2000 && !seen) {
    const s = await api(`/api/state?chatAfter=${after}`, { cookie: b.cookie });
    seen = s.json.chat.some((m) => m.text === text && m.ffxivId === a.ffxivId);
    if (!seen) await sleep(200);
  }
  assert.ok(seen, 'A의 채팅이 2초 안에 B에게 보여야 한다');

  assert.equal((await api('/api/chat', { cookie: a.cookie, body: { text: '또' } })).status, 429, '3초 안 재전송 거부');
  assert.equal((await api('/api/chat', { cookie: b.cookie, body: { text: 'ㄱ'.repeat(301) } })).status, 400, '301자 거부');
  assert.equal((await api('/api/chat', { cookie: b.cookie, body: { text: 'ㄱ'.repeat(300) } })).status, 200, '300자는 허용');
});

test('4. 제출한 사람만 참여 기록 + 운영자 API 보호', async () => {
  const doer = await signup();
  const chatter = await signup();

  assert.equal((await api('/api/admin/start', { body: {} })).status, 403, '비번 없으면 거부');
  assert.equal((await api('/api/admin/start', { body: {}, admin: 'wrong' })).status, 403, '틀린 비번 거부');

  assert.equal((await api('/api/admin/game', { body: { name: 'test' }, admin: ADMIN })).status, 200);
  assert.equal((await api('/api/admin/start', { body: {}, admin: ADMIN })).status, 200);
  assert.equal((await api('/api/act', { cookie: doer.cookie, body: { input: 'click' } })).status, 200);
  await api('/api/chat', { cookie: chatter.cookie, body: { text: '채팅만 함' } });
  assert.equal((await api('/api/admin/resolve', { body: {}, admin: ADMIN })).status, 200);

  const csv = await api('/api/admin/export', { admin: ADMIN });
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(doer.email), '제출한 사람은 참여자 목록에 있다');
  assert.ok(!csv.text.includes(chatter.email), '채팅만 한 사람은 없다');
});
