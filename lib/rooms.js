'use strict';

// 公式ルーム一覧サイト (cs-web.supernewroles.com) と同じAPIを使う
const REGIONS = {
  tokyo: { host: 'cs.supernewroles.com', label: 'Tokyo' },
  'us-east': { host: 'cs-useast.supernewroles.com', label: 'US East' },
};

const MAP_NAMES = { 0: 'Skeld', 1: 'MIRA HQ', 2: 'Polus', 3: 'Dleks', 4: 'Airship', 5: 'Fungle' };

// GameState: 0=募集中 1=開始中 2=開始済み 3=ゲーム終了 4=破棄
const STATE_RECRUITING = 0;
const STATE_LABELS = { 0: '募集中', 1: '開始中', 2: '開始済み', 3: 'ゲーム終了', 4: '破棄' };

async function fetchRooms(regionKey, timeoutMs = 8000) {
  const region = REGIONS[regionKey];
  const url = `https://${region.host}/api/games/all_for_web`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${region.label}: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.games) ? data.games : [];
}

// ルームを一意に識別するキー(公式サイトと同じ組み立て方 + リージョン)
function roomKey(regionKey, game) {
  return `${regionKey}|${game.GameId}|${game.IP}|${game.Port}`;
}

// ---- ルームコード変換(公式サイトの実装を移植) ----
const V2 = 'QWXRTYLPESDFGHUJKZOCVBINMA';

function gameIdToCode(value) {
  if (value == null) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n < -1) {
    const a = n & 0x3ff;
    const b = (n >> 10) & 0xfffff;
    return [
      V2[a % 26],
      V2[Math.floor(a / 26)],
      V2[b % 26],
      V2[Math.floor(b / 26) % 26],
      V2[Math.floor(b / (26 * 26)) % 26],
      V2[Math.floor(b / (26 * 26 * 26)) % 26],
    ].join('');
  }
  const bytes = [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  return Buffer.from(bytes).toString('utf8').replace(/\+$/g, '') || String(value);
}

function describeRoom(regionKey, game) {
  return {
    roomName: game.TrueHostName || game.HostName || '(名前なし)',
    code: gameIdToCode(game.GameId),
    map: MAP_NAMES[game.MapId] ?? `Map ${game.MapId}`,
    players: `${Number(game.PlayerCount) || 0}/${Number(game.MaxPlayers) || 0}`,
    impostors: game.NumImpostors ?? '-',
    region: REGIONS[regionKey].label,
    playerCount: Number(game.PlayerCount) || 0,
    maxPlayers: Number(game.MaxPlayers) || 0,
    gameState: Number(game.GameState),
    stateLabel: STATE_LABELS[Number(game.GameState)] ?? '不明',
    joinable: Number(game.GameState) === STATE_RECRUITING &&
      (Number(game.PlayerCount) || 0) < (Number(game.MaxPlayers) || 0),
  };
}

module.exports = { REGIONS, STATE_RECRUITING, fetchRooms, roomKey, describeRoom };
