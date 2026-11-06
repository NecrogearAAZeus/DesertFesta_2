// 확인용 더미 게임: 버튼 누른 횟수 겨루기. 경마가 들어오면 삭제한다.
let counts = new Map(); // userId → { ffxivId, n }
let ranking = [];

module.exports = {
  start() {
    counts = new Map();
    ranking = [];
  },
  act(user, input) {
    if (input !== 'click') throw new Error('잘못된 입력입니다');
    const c = counts.get(user.id) ?? { ffxivId: user.ffxivId, n: 0 };
    c.n++;
    counts.set(user.id, c);
  },
  resolve() {
    ranking = [...counts.values()].sort((a, b) => b.n - a.n).map((c, i) => ({ rank: i + 1, ...c }));
  },
  view(user) {
    return { mine: counts.get(user.id)?.n ?? 0, ranking };
  },
};
