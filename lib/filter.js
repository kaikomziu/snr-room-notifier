'use strict';

// 通知の条件(設定タブの「通知の条件」)。空の条件は「すべて対象」

const FILTER_MAPS = ['Skeld', 'MIRA HQ', 'Polus', 'Dleks', 'Airship', 'Fungle'];
const FILTER_IMPOSTORS = [1, 2, 3]; // 3 は「3人以上」
const MAX_PLAYERS_LIMIT = 100;

const defaultFilter = { maps: [], impostors: [], minPlayers: 0, keywords: '' };

// 画面から来た値を安全な形にそろえる
function sanitizeFilter(f) {
  const src = f && typeof f === 'object' ? f : {};
  const maps = Array.isArray(src.maps) ? src.maps.filter((m) => FILTER_MAPS.includes(m)) : [];
  const impostors = Array.isArray(src.impostors)
    ? src.impostors.map(Number).filter((n) => FILTER_IMPOSTORS.includes(n))
    : [];
  const min = Math.floor(Number(src.minPlayers));
  return {
    maps: [...new Set(maps)],
    impostors: [...new Set(impostors)],
    minPlayers: Number.isFinite(min) ? Math.min(Math.max(min, 0), MAX_PLAYERS_LIMIT) : 0,
    keywords: typeof src.keywords === 'string' ? src.keywords.slice(0, 200) : '',
  };
}

function keywordList(text) {
  return String(text || '').toLowerCase().split(/[\s,、]+/).filter(Boolean);
}

// room は rooms.js の describeRoom の結果
function matchesFilter(room, filter) {
  const f = filter || defaultFilter;
  if (f.maps.length && !f.maps.includes(room.map)) return false;
  if (f.impostors.length) {
    const n = Number(room.impostors);
    const bucket = n >= 3 ? 3 : n;
    if (!f.impostors.includes(bucket)) return false;
  }
  if (room.playerCount < f.minPlayers) return false;
  const words = keywordList(f.keywords);
  if (words.length && !words.some((w) => room.roomName.toLowerCase().includes(w))) return false;
  return true;
}

// ---- お気に入り/ミュートのホスト(部屋名で判定) ----
const defaultHosts = { favorites: [], muted: [], favoritesOnly: false };
const HOST_LIST_LIMIT = 100;

function cleanNames(list) {
  if (!Array.isArray(list)) return [];
  const names = list.map((n) => String(n ?? '').trim().slice(0, 50)).filter(Boolean);
  return [...new Set(names)].slice(0, HOST_LIST_LIMIT);
}

function sanitizeHosts(h) {
  const src = h && typeof h === 'object' ? h : {};
  const favorites = cleanNames(src.favorites);
  // 両方に入っていたらお気に入りを優先
  const muted = cleanNames(src.muted).filter((n) => !favorites.includes(n));
  return { favorites, muted, favoritesOnly: !!src.favoritesOnly };
}

// 通知するかどうか: ミュートは常に通知しない、お気に入りは条件に関係なく通知する
function shouldNotify(room, cfg) {
  const hosts = cfg.hosts || defaultHosts;
  if (hosts.muted.includes(room.roomName)) return false;
  if (hosts.favorites.includes(room.roomName)) return true;
  if (hosts.favoritesOnly) return false;
  return matchesFilter(room, cfg.filter);
}

function filterIsActive(f) {
  return !!(f && (f.maps.length || f.impostors.length || f.minPlayers > 0 || keywordList(f.keywords).length));
}

module.exports = { FILTER_MAPS, FILTER_IMPOSTORS, MAX_PLAYERS_LIMIT, defaultFilter, sanitizeFilter, matchesFilter, filterIsActive, defaultHosts, sanitizeHosts, shouldNotify };
