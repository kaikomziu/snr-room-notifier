'use strict';

const $ = (id) => document.getElementById(id);
let state = null;
let toastTimer = null;
let phaseShown = false;
const firstSeen = new Map(); // key -> 最初に見えた時刻(新しい部屋の強調用)
let initialized = false;

// ---- タブ ----
function selectTab(name) {
  for (const t of ['rooms', 'settings', 'faq']) {
    const on = t === name;
    $(`tab-${t}`).setAttribute('aria-selected', String(on));
    $(`view-${t}`).hidden = !on;
  }
}
$('tab-rooms').addEventListener('click', () => selectTab('rooms'));
$('tab-settings').addEventListener('click', () => selectTab('settings'));
$('tab-faq').addEventListener('click', () => selectTab('faq'));

// ---- お知らせ ----
// sticky=true のときは自動で消さない(参加処理の進み具合の表示用)
function toast(message, kind = 'info', sticky = false) {
  const el = $('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 3000);
}

// ---- 描画 ----
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function renderRooms() {
  const onlyJoinable = !state.config.showAll;
  const now = Date.now();
  // 最初の取得結果に含まれていた部屋は「新しい」扱いにしない
  for (const r of state.rooms) if (!firstSeen.has(r.key)) firstSeen.set(r.key, initialized ? now : 0);
  if (state.checkedAt) initialized = true;

  const rooms = state.rooms
    .filter((r) => !onlyJoinable || r.joinable)
    .sort((a, b) => (b.joinable - a.joinable) || (b.playerCount - a.playerCount));

  const list = $('rooms');
  list.replaceChildren();
  for (const r of rooms) {
    const li = el('li', 'room');
    if (!r.joinable) li.classList.add('closed');
    if (now - (firstSeen.get(r.key) || 0) < 60000) li.classList.add('new'); // 開かれて1分以内

    li.append(el('div', 'name', r.roomName));

    const meta = el('div', 'meta');
    const st = el('span', 'state', r.stateLabel);
    st.dataset.state = r.gameState;
    const fill = el('span', 'fill');
    const bar = el('span', 'fill-bar');
    const inner = el('span');
    inner.style.width = `${r.maxPlayers ? Math.min(100, (r.playerCount / r.maxPlayers) * 100) : 0}%`;
    bar.append(inner);
    fill.append(bar, `${r.playerCount}/${r.maxPlayers}人`);
    meta.append(st, fill, el('span', null, r.map), el('span', null, `インポスター${r.impostors}`));
    if (state.config.regions.tokyo && state.config.regions['us-east']) meta.append(el('span', null, r.region));
    li.append(meta);

    const side = el('div', 'side');
    const code = el('button', 'code', r.code);
    code.type = 'button';
    code.title = 'クリックでコードをコピー';
    code.addEventListener('click', async () => {
      await navigator.clipboard.writeText(r.code);
      toast(`コード ${r.code} をコピーしました`);
    });
    const join = el('button', 'join', '参加');
    join.type = 'button';
    join.disabled = !r.joinable || state.joining;
    join.addEventListener('click', () => doJoin(r));
    side.append(code, join);
    li.append(side);

    list.append(li);
  }

  const empty = $('empty');
  empty.hidden = rooms.length > 0;
  if (state.config.paused) empty.textContent = '一時停止中です。再開すると部屋の監視を始めます。';
  else if (state.status.kind === 'error') empty.textContent = state.status.text;
  else if (onlyJoinable) empty.textContent = '今は参加できる部屋がありません。\n新しく開かれたら通知します。';
  else empty.textContent = '今は公開されている部屋がありません。';
  empty.style.whiteSpace = 'pre-line';
}

function renderSettings() {
  const list = $('region-list');
  list.replaceChildren();
  for (const r of state.regions) {
    const label = el('label', 'check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!state.config.regions[r.key];
    input.addEventListener('change', () => window.snr.setRegion(r.key, input.checked));
    label.append(input, ` ${r.label}`);
    list.append(label);
  }
  $('notify-toggle').checked = state.config.notify;
  $('show-all').checked = state.config.showAll;
  $('show-all-setting').checked = state.config.showAll;
  $('login-toggle').checked = state.login.enabled;
  $('login-toggle').disabled = !state.login.available;
  $('login-note').hidden = state.login.available;
  $('game-path').textContent = state.config.gamePath || '未設定';
  $('game-path-problem').textContent = state.gamePathProblem || '';
  $('game-path-problem').hidden = !state.gamePathProblem;
  $('auto-launch-toggle').checked = state.config.autoLaunch;
  const n = state.lastNotify;
  $('notify-status').textContent = !n
    ? 'まだ通知は出ていません。'
    : n.ok
      ? `最後の通知: ${new Date(n.time).toLocaleTimeString('ja-JP')} に表示しました`
      : `最後の通知: ${new Date(n.time).toLocaleTimeString('ja-JP')} に失敗しました(${n.message})`;
  $('version').textContent = `v${state.version}(${state.updated} 更新)`;
}

function render(s) {
  state = s;
  $('lamp').dataset.kind = s.status.kind;
  $('status-text').textContent = s.status.text;
  $('status-text').title = s.status.text;
  $('pause-btn').textContent = s.config.paused ? '再開' : '一時停止';
  if (s.joinPhase) {
    toast(`${s.joinPhase}…`, 'info', true);
    phaseShown = true;
  } else if (phaseShown) {
    // 通知から参加した場合など、結果表示がないときは進み具合の表示を消す
    phaseShown = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }
  renderRooms();
  renderSettings();
}

// ---- 操作 ----
async function doJoin(room) {
  const result = await window.snr.join(room.key);
  if (result.ok) toast(`${room.roomName} に参加しました`);
  else toast(result.message, 'error');
}

$('pause-btn').addEventListener('click', () => window.snr.setPaused(!state.config.paused));
$('refresh-btn').addEventListener('click', () => window.snr.refresh());
// 部屋タブと設定タブのどちらで切り替えても同じ設定を保存する
$('show-all').addEventListener('change', (e) => window.snr.setShowAll(e.target.checked));
$('show-all-setting').addEventListener('change', (e) => window.snr.setShowAll(e.target.checked));
$('notify-toggle').addEventListener('change', (e) => window.snr.setNotify(e.target.checked));
$('login-toggle').addEventListener('change', (e) => window.snr.setLogin(e.target.checked));
$('test-btn').addEventListener('click', () => window.snr.testNotify());
$('choose-path-btn').addEventListener('click', () => window.snr.chooseGamePath());
$('auto-launch-toggle').addEventListener('change', (e) => window.snr.setAutoLaunch(e.target.checked));
$('launch-btn').addEventListener('click', async () => {
  const r = await window.snr.launchGame();
  toast(r.message, r.ok ? 'info' : 'error');
});
$('site-btn').addEventListener('click', () => window.snr.openSite());
$('faq-notify-settings').addEventListener('click', () => window.snr.openNotifySettings());

window.snr.onState(render);
window.snr.getState().then(render);
