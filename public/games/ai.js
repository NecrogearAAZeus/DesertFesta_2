// AI 생존게임 화면. render(el, s, act)는 매초 호출된다.
// 뼈대는 문제마다 한 번 만들고, 남은 시간·타이핑·자동 제출은 자체 100ms 타이머로 그린다.
// 시각은 서버 기준: offset = 서버 now - 내 시계
(() => {
  const KIND = { bottom: '하위', funny: '웃긴 사망', top: '상위' };
  let v = null, me = null, act = null, root = null, roundId = null, timer = null;
  let offset = 0, local = null, sending = false, autoTried = false;
  const now = () => Date.now() + offset;
  const $ = (sel) => root.querySelector(sel);

  const verdict = (r) =>
    `<span class="ai-badge ${r.survived ? 'live' : 'dead'}">${r.failed ? '판정 불가' : r.survived ? '생존' : '사망'}</span>
     <b class="ai-score">${r.score}점</b>${r.penalty ? ' <span class="muted">시간 초과 -5</span>' : ''}`;

  function build(el) {
    el.innerHTML = `
      <style>
        .ai-head { display: flex; justify-content: space-between; margin: 0 0 8px; }
        .ai textarea { resize: none; }
        .ai-row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; }
        .ai blockquote { margin: 8px 0 16px; padding: 12px 16px; background: var(--bg); border-left: 3px solid var(--line); border-radius: 8px; white-space: pre-wrap; word-break: break-all; }
        .ai-story { font-size: 18px; min-height: 4.5em; white-space: pre-wrap; }
        .ai-badge { display: inline-block; padding: 4px 12px; border-radius: 6px; font-weight: 700; color: var(--bg); }
        .ai-badge.live { background: var(--yellow); }
        .ai-badge.dead { background: var(--red); }
        .ai-score { font-size: 18px; margin-left: 8px; }
        .ai-rank li { margin-bottom: 4px; }
        .ai-rank li.me { color: var(--yellow); }
      </style>
      <div class="ai">
        <p class="muted ai-head"><span class="ai-no"></span><b class="accent ai-clock"></b></p>
        <h2 class="ai-q"></h2>
        <section class="ai-answer">
          <textarea rows="7" aria-label="내 대처법" placeholder="어떻게 대처할지 적어 주세요"></textarea>
          <div class="ai-row"><span class="muted ai-len"></span><button class="btn primary ai-send">제출</button></div>
          <p class="muted">한 번만 제출할 수 있습니다. 시간이 끝나면 쓰던 답이 자동 제출되고 5점 감점됩니다.</p>
        </section>
        <section class="ai-sent" hidden>
          <p class="accent ai-sent-title"></p>
          <blockquote class="ai-mytext"></blockquote>
          <p class="muted ai-wait"></p>
        </section>
        <section class="ai-reveal" hidden>
          <p class="muted"><span class="ai-kind"></span> · <span class="ai-step"></span></p>
          <p><b class="ai-who"></b></p>
          <blockquote class="ai-text"></blockquote>
          <p class="ai-story"></p>
          <p class="ai-verdict"></p>
        </section>
        <section class="ai-done" hidden>
          <h2>내 결과</h2>
          <div class="ai-mine"></div>
          <h2>이번 문제 등수</h2>
          <ol class="ai-rank"></ol>
        </section>
      </div>`;
    root = el.querySelector('.ai');
    const ta = $('textarea');
    ta.oninput = () => ($('.ai-len').textContent = `${ta.value.length} / ${v.maxLen}자`);
    $('.ai-send').onclick = () => submit(false);
  }

  async function submit(auto) {
    const text = $('textarea').value.trim();
    if (!text || sending) return;
    sending = true;
    $('.ai-send').disabled = true;
    const r = await act({ text, auto }); // 실패하면 index.html이 토스트를 띄우고 undefined
    if (r?.ok) local = { text, auto };
    sending = false;
    $('.ai-send').disabled = false;
    draw();
  }

  function draw() {
    if (!root?.isConnected) { clearInterval(timer); timer = null; return; } // 게임이 바뀌어 화면이 지워짐
    const t = now();
    const mine = v.mine ?? local;
    const st = v.stage;

    $('.ai-no').textContent = `문제 ${v.number}`;
    $('.ai-q').textContent = v.question;
    $('.ai-clock').textContent = st === 'answer' ? `남은 시간 ${Math.max(0, Math.ceil((v.deadline - t) / 1000))}초` : '';

    if (st === 'answer' && !mine && !autoTried && t >= v.deadline) { autoTried = true; submit(true); } // 시간 초과 자동 제출 (빈칸이면 안 보냄)

    $('.ai-answer').hidden = !(st === 'answer' && !mine);
    $('.ai-sent').hidden = !(st === 'grading' || (st === 'answer' && mine));
    $('.ai-reveal').hidden = st !== 'reveal';
    $('.ai-done').hidden = st !== 'done';

    if (st === 'answer' || st === 'grading') {
      $('.ai-sent-title').textContent = mine ? '제출 완료' : '이번 문제에 답하지 않았습니다';
      $('.ai-mytext').hidden = !mine;
      $('.ai-mytext').textContent = mine?.text ?? '';
      $('.ai-wait').textContent = st === 'grading' ? '판정 연산 중...' : `제출 ${v.count}명 · 마감을 기다리는 중`;
    }

    if (st === 'reveal' && v.reveals.length) {
      let i = v.reveals.findLastIndex((r) => r.showAt <= t);
      if (i < 0) i = 0;
      const r = v.reveals[i];
      $('.ai-kind').textContent = KIND[r.kind];
      $('.ai-step').textContent = `공개 ${i + 1} / ${v.reveals.length}`;
      $('.ai-who').textContent = r.ffxivId;
      $('.ai-text').textContent = r.text;
      const n = Math.floor(Math.max(0, Math.min(1, (t - r.typeAt) / r.typeMs)) * r.story.length);
      $('.ai-story').textContent = r.story.slice(0, n);
      const v2 = t >= r.verdictAt ? verdict(r) : '';
      if ($('.ai-verdict').innerHTML !== v2) $('.ai-verdict').innerHTML = v2;
    }

    if (st === 'done') {
      $('.ai-mine').innerHTML = v.mine
        ? `<p>${verdict(v.mine)}</p><blockquote>${esc(v.mine.text)}</blockquote><p class="ai-story">${esc(v.mine.story)}</p>`
        : '<p class="muted">이번 문제에 답하지 않았습니다.</p>';
      $('.ai-rank').innerHTML = v.ranking
        .map((r) => `<li class="${r.ffxivId === me ? 'me' : ''}">${esc(r.ffxivId)} <span class="muted">${r.score}점 · ${r.survived ? '생존' : '사망'}</span></li>`)
        .join('');
    }
  }

  GAMES.ai = {
    render(el, s, actFn) {
      v = s.view;
      me = s.me.ffxivId;
      act = actFn;
      if (v.stage === 'none') { el.innerHTML = '<h2>잠시 기다려 주세요</h2><p class="muted">운영자가 문제를 시작하면 바로 참여할 수 있습니다.</p>'; root = null; return; }
      offset = v.now - Date.now();
      if (v.roundId !== roundId || !root?.isConnected) {
        roundId = v.roundId;
        local = null; sending = false; autoTried = false;
        build(el);
        $('.ai-len').textContent = `0 / ${v.maxLen}자`;
        $('textarea').maxLength = v.maxLen;
      }
      if (!timer) timer = setInterval(draw, 100);
      draw();
    },
  };
})();
