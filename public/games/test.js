// 확인용 더미 게임 화면. 경마가 들어오면 삭제한다.
// render(el, state, act): 매초 호출된다. 처음 한 번만 뼈대를 만들고 이후엔 값만 갱신한다.
GAMES.test = {
  render(el, s, act) {
    if (!el.querySelector('.test-btn')) {
      el.innerHTML = `
        <h2>버튼 누르기 <span class="muted">(확인용)</span></h2>
        <p><button class="btn primary test-btn">누르기</button></p>
        <p class="muted">내 횟수 <b class="accent mine">0</b></p>
        <ol class="ranking"></ol>`;
      el.querySelector('.test-btn').onclick = () => act('click');
    }
    el.querySelector('.test-btn').disabled = s.game.phase !== 'playing';
    el.querySelector('.mine').textContent = s.view.mine;
    el.querySelector('.ranking').innerHTML = s.view.ranking
      .map((r) => `<li>${esc(r.ffxivId)} <span class="muted">${r.n}회</span></li>`).join('');
  },
};
