'use strict';

// SuperNewRoles MOD がローカルで待ち受けている参加API に直接リクエストして部屋に入る。
// 公式の「参加」ボタン(joinroom.supernewroles.com)も内部では同じ http://localhost:49152/joinGame を叩いている。

const crypto = require('crypto');

const JOIN_ENDPOINT = 'http://localhost:49152/joinGame';

// 公式サイト/MODに埋め込まれている共通の暗号鍵(AES-128-CBC)
const AES_KEY = Buffer.from('ThisIsA16ByteKey', 'utf8');
const AES_IV = Buffer.from('ThisIsA16ByteIV!', 'utf8');

// MOD側の ServerType 列挙: 3=SNRTokyo, 5=SNRUSEast
const SERVER_TYPE = { tokyo: '3', 'us-east': '5' };

function encrypt(value) {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_IV); // パディングはPKCS7(WebCryptoと同じ)
  return Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]).toString('base64');
}

// APIのIPはリトルエンディアンの整数なので a.b.c.d 形式に戻す
function intToIPv4LE(n) {
  n >>>= 0;
  return `${n & 255}.${(n >>> 8) & 255}.${(n >>> 16) & 255}.${(n >>> 24) & 255}`;
}

function buildJoinUrl(regionKey, game) {
  const params = new URLSearchParams();
  params.append('serverIP', encrypt(intToIPv4LE(game.IP)));
  params.append('serverPort', encrypt(game.Port));
  params.append('serverType', encrypt(SERVER_TYPE[regionKey]));
  params.append('gameID', encrypt(game.GameId));
  return `${JOIN_ENDPOINT}?${params.toString()}`;
}

// 戻り値: { ok: boolean, message: string }
async function joinRoom(regionKey, game) {
  try {
    // MODは参加処理後に約5秒待ってから応答するので長めに待つ
    const res = await fetch(buildJoinUrl(regionKey, game), { signal: AbortSignal.timeout(20000) });
    const text = (await res.text()).trim();
    const ok = res.ok && text === '接続しました。';
    return { ok, message: text || `HTTP ${res.status}` };
  } catch (e) {
    if (e.name === 'TimeoutError') {
      return { ok: false, message: 'MODからの応答がありませんでした。Among Usの画面を確認してください。' };
    }
    return { ok: false, message: 'Among Us(SuperNewRoles)が起動していないか、接続できませんでした。' };
  }
}

module.exports = { joinRoom, buildJoinUrl, intToIPv4LE };
