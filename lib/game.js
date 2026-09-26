'use strict';

// Among Us(SuperNewRoles導入済み)の起動と、MODのローカルAPIが使えるようになるまでの待機

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const API_HOST = '127.0.0.1';
const API_PORT = 49152;

// MODのローカルAPI(localhost:49152)が待ち受けているか(= SNR入りのAmong Usが起動しているか)を調べる。
// HTTPリクエストは送らずTCP接続できるかだけを見るので、MOD側のログにエラーが残らない
function isGameRunning(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: API_HOST, port: API_PORT });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function checkExePath(exePath) {
  if (!exePath) return '起動するファイルが設定されていません。設定タブで「Among Us.exe」を選んでください。';
  if (!fs.existsSync(exePath)) return `ファイルが見つかりません: ${exePath}`;
  if (path.extname(exePath).toLowerCase() !== '.exe') return 'exeファイルを選んでください。';
  return null;
}

function launchGame(exePath) {
  const problem = checkExePath(exePath);
  if (problem) return { ok: false, message: problem };
  try {
    // BepInExはexeと同じフォルダを基準に動くので、作業フォルダをexeの場所にする
    const child = spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true, message: 'Among Usを起動しました。' };
  } catch (e) {
    return { ok: false, message: `起動できませんでした: ${e.message}` };
  }
}

async function waitForGame(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isGameRunning()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

module.exports = { isGameRunning, launchGame, waitForGame, checkExePath };
