'use strict';

// SNR Room Notifier (非公式ツール)
// Copyright (C) 2026 kaikomziu
// This program is free software: GPL-3.0-only (LICENSE を参照)
//
// 更新履歴
//   v1.0.0 (2026-09-26) 初版: 新しい募集中ルームを検知してWindows通知
//   v1.1.0 (2026-09-26) 通知クリックでそのまま部屋に参加(MODのローカル参加APIを直接呼ぶ)
//   v1.2.0 (2026-09-26) 画面(UI)を追加: 部屋一覧・参加ボタン・設定。閉じてもトレイに常駐
//   v1.3.0 (2026-09-26) 「参加できない部屋も表示する」設定を追加(保存される)
//   v1.3.1 (2026-09-26) 非公式ツールである旨・免責事項を画面とREADMEに明記
//   v1.4.0 (2026-09-26) Among Us(SNR)の起動ボタン、未起動時は起動してから参加。通知の失敗を画面に表示、通知アイコンをasar外に配置
//   v1.4.1 (2026-09-26) アイコンを独自デザインに変更、GPL-3.0でGitHub公開
//   v1.4.2 (2026-09-26) Q&Aタブを追加(ゲーム中に通知が出ない=Windowsの応答不可の説明など)、Windowsの通知設定を開くボタン、AI(Claude Code)で作成していることを明記
//   v1.4.3 (2026-09-26) マップ名が「Map Fungle」のように表示される不具合を修正(APIのMapIdが名前で返る場合に対応)
//   v1.4.4 (2026-09-26) 起動確認をTCP接続だけで行うように変更(MOD側のログにエラーが残らない)

const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { REGIONS, STATE_RECRUITING, fetchRooms, roomKey, describeRoom } = require('./lib/rooms');
const { joinRoom } = require('./lib/join');
const { isGameRunning, launchGame, waitForGame, checkExePath } = require('./lib/game');

const APP_VERSION = '1.4.4';
const APP_UPDATED = '2026-09-26';
const APP_ID = 'com.kaikomziu.snr-room-notifier';
const POLL_MS = 10000;          // 監視間隔(公式サイトは5秒。負荷を考えて10秒)
const MAX_INDIVIDUAL = 3;       // 一度にこれ以上増えたらまとめて1件で通知
const SITE_URL = 'https://cs-web.supernewroles.com/';
const HIDDEN_ARG = '--hidden';  // Windows自動起動時はウィンドウを出さずトレイだけで起動
const GAME_BOOT_TIMEOUT_MS = 180000; // Among Usの起動を待つ最大時間(初回はコスメのDLで遅いことがある)
const JOIN_RETRY_MS = 60000;         // 起動直後、参加できる状態になるまで参加を再試行する時間

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windowsの通知はasar内の画像を読めないため、asar外(app.asar.unpacked)の画像を使う
const assetPath = (name) => path.join(__dirname, 'assets', name).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// ---- 設定 ----
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const defaultConfig = { regions: { tokyo: true, 'us-east': false }, paused: false, notify: true, showAll: false, gamePath: '', autoLaunch: true };
let config = structuredClone(defaultConfig);

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    config = { ...defaultConfig, ...saved, regions: { ...defaultConfig.regions, ...saved.regions } };
  } catch (_) {
    // 初回起動時はファイルが無いので既定値のまま
  }
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('設定の保存に失敗:', e);
  }
}

// ---- 状態 ----
// seen: 既に見たルームのキー。初回取得時は通知せず記録だけする(起動直後の通知連打防止)
// rooms: 画面表示用の最新ルーム一覧
const regionState = {};
for (const key of Object.keys(REGIONS)) {
  regionState[key] = { seen: new Set(), initialized: false, error: null, rooms: [] };
}
const roomIndex = new Map(); // key -> { regionKey, game } 参加時に元データを引くため

let tray = null;
let win = null;
let timer = null;
let lastChecked = null;
let joining = false;
let isQuitting = false;
let joinPhase = '';              // 参加処理の進み具合(画面表示用)
let lastNotify = null;           // 最後に出そうとした通知の結果(不具合調査用)
const activeNotifications = new Set(); // GCで通知のクリックハンドラが消えないよう参照を保持

// ---- 通知 ----
// onClick 省略時はウィンドウを開く
function notify(title, body, onClick = showWindow) {
  if (!Notification.isSupported()) {
    lastNotify = { time: Date.now(), ok: false, message: 'このPCでは通知が使えません' };
    sendState();
    return;
  }
  const n = new Notification({ title, body, icon: assetPath('icon.png') });
  n.on('click', onClick);
  n.on('show', () => { lastNotify = { time: Date.now(), ok: true, message: title }; sendState(); });
  n.on('failed', (_e, error) => { lastNotify = { time: Date.now(), ok: false, message: String(error) }; sendState(); });
  n.on('close', () => activeNotifications.delete(n));
  activeNotifications.add(n);
  n.show();
}

function notifyNewRooms(rooms) {
  if (!config.notify || rooms.length === 0) return;
  if (rooms.length > MAX_INDIVIDUAL) {
    const names = rooms.slice(0, 5).map((r) => r.roomName).join('、');
    notify(`新しい部屋が${rooms.length}件開かれました`, `${names}${rooms.length > 5 ? ' ほか' : ''}\nクリックで一覧を開く`);
    return;
  }
  for (const r of rooms) {
    notify(
      `部屋が開かれました: ${r.roomName}`,
      `コード ${r.code} / ${r.map} / ${r.players}人 / インポスター${r.impostors} / ${r.region}\nクリックで参加`,
      () => requestJoin(r.key)
    );
  }
}

// ---- 参加 ----
function setPhase(text) {
  joinPhase = text;
  sendState();
}

// Among Usが起動していなければ起動して、参加できる状態まで待ってから参加する
async function joinWithLaunch(entry) {
  if (await isGameRunning()) return joinRoom(entry.regionKey, entry.game);

  if (!config.autoLaunch) {
    return { ok: false, message: 'Among Us(SuperNewRoles)が起動していません。' };
  }
  const launched = launchGame(config.gamePath);
  if (!launched.ok) return launched;

  setPhase('Among Usの起動を待っています');
  if (!(await waitForGame(GAME_BOOT_TIMEOUT_MS))) {
    return { ok: false, message: 'Among Usの起動を確認できませんでした。起動してから、もう一度「参加」を押してください。' };
  }

  // MODの受付はタイトル画面より前に始まるため、少し待ってから参加を試す。
  // 読み込み中は「すでにゲームに参加しています」が返るので、その間は再試行する
  setPhase('タイトル画面を待っています');
  await sleep(8000);
  const until = Date.now() + JOIN_RETRY_MS;
  let result;
  do {
    setPhase('部屋に参加しています');
    result = await joinRoom(entry.regionKey, entry.game);
    if (result.ok || !result.message.includes('すでにゲームに参加しています')) return result;
    await sleep(4000);
  } while (Date.now() < until);
  return result;
}

async function requestJoin(key) {
  const entry = roomIndex.get(key);
  if (!entry) return { ok: false, message: 'この部屋はもう一覧にありません。' };
  if (joining) return { ok: false, message: '参加処理中です。終わるまでお待ちください。' };
  joining = true;
  setPhase('部屋に参加しています');
  try {
    const result = await joinWithLaunch(entry);
    const name = describeRoom(entry.regionKey, entry.game).roomName;
    // 画面が見えていないときは通知で結果を伝える
    if (!result.ok && !(win && win.isVisible())) notify(`参加できませんでした: ${name}`, result.message);
    return result;
  } finally {
    joining = false;
    setPhase('');
  }
}

// 画面・トレイの「Among Usを起動」
async function startGame() {
  if (await isGameRunning()) return { ok: true, message: 'Among Usはすでに起動しています。' };
  return launchGame(config.gamePath);
}

async function chooseGamePath() {
  const result = await dialog.showOpenDialog(win && win.isVisible() ? win : undefined, {
    title: 'SuperNewRolesを入れたAmong Us.exeを選択',
    defaultPath: config.gamePath ? path.dirname(config.gamePath) : undefined,
    filters: [{ name: '実行ファイル', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  config.gamePath = result.filePaths[0];
  saveConfig();
  sendState();
}

// ---- 監視 ----
async function checkRegion(regionKey) {
  const st = regionState[regionKey];
  try {
    const games = await fetchRooms(regionKey);
    const current = new Set();
    const rooms = [];
    const fresh = [];
    for (const g of games) {
      const key = roomKey(regionKey, g);
      const room = { key, ...describeRoom(regionKey, g) };
      current.add(key);
      rooms.push(room);
      roomIndex.set(key, { regionKey, game: g });
      if (st.initialized && !st.seen.has(key) && Number(g.GameState) === STATE_RECRUITING) fresh.push(room);
    }
    // 消えたルームは忘れる(同じコードで再度開かれたら再通知される)
    for (const key of st.seen) if (!current.has(key)) roomIndex.delete(key);
    st.seen = current;
    st.rooms = rooms;
    st.initialized = true;
    st.error = null;
    return fresh;
  } catch (e) {
    st.error = e.message || String(e);
    return [];
  }
}

async function poll() {
  if (config.paused) return;
  const targets = Object.keys(REGIONS).filter((k) => config.regions[k]);
  const results = await Promise.all(targets.map(checkRegion));
  lastChecked = new Date();
  notifyNewRooms(results.flat());
  updateTray();
  sendState();
}

function restartPolling() {
  if (timer) clearInterval(timer);
  poll();
  timer = setInterval(poll, POLL_MS);
}

function resetRegion(key) {
  const st = regionState[key];
  for (const k of st.seen) roomIndex.delete(k);
  st.seen = new Set();
  st.rooms = [];
  st.initialized = false;
  st.error = null;
}

// ---- 設定変更(トレイと画面の共通処理) ----
function setPaused(value) {
  config.paused = !!value;
  saveConfig();
  // 再開時は停止中に開いた部屋をまとめて通知しないよう、記録し直す
  if (!config.paused) {
    for (const k of Object.keys(regionState)) regionState[k].initialized = false;
    restartPolling();
  }
  updateTray();
  sendState();
}

function setRegion(key, value) {
  if (!REGIONS[key]) return;
  config.regions[key] = !!value;
  resetRegion(key);
  saveConfig();
  restartPolling();
  updateTray();
  sendState();
}

function setNotify(value) {
  config.notify = !!value;
  saveConfig();
  sendState();
}

function setShowAll(value) {
  config.showAll = !!value;
  saveConfig();
  sendState();
}

function setLogin(value) {
  if (!app.isPackaged) return; // 開発実行(npm start)ではelectron.exe自体が登録されてしまうため無効
  app.setLoginItemSettings({ openAtLogin: !!value, args: [HIDDEN_ARG] });
  updateTray();
  sendState();
}

// ---- 状態の送信 ----
function statusInfo() {
  if (config.paused) return { kind: 'paused', text: '一時停止中' };
  const errors = Object.keys(REGIONS)
    .filter((k) => config.regions[k] && regionState[k].error)
    .map((k) => regionState[k].error);
  if (errors.length) return { kind: 'error', text: `取得できませんでした: ${errors.join(' / ')}` };
  if (!Object.values(config.regions).some(Boolean)) return { kind: 'error', text: 'リージョンが1つも選ばれていません' };
  return {
    kind: 'ok',
    text: lastChecked ? `監視中 ${lastChecked.toLocaleTimeString('ja-JP')} に確認` : '監視を開始しています',
  };
}

function snapshot() {
  const rooms = Object.keys(REGIONS)
    .filter((k) => config.regions[k])
    .flatMap((k) => regionState[k].rooms);
  return {
    version: APP_VERSION,
    updated: APP_UPDATED,
    status: statusInfo(),
    checkedAt: lastChecked ? lastChecked.getTime() : null,
    rooms,
    joining,
    joinPhase,
    lastNotify,
    gamePathProblem: config.gamePath ? checkExePath(config.gamePath) : null,
    config,
    regions: Object.entries(REGIONS).map(([key, r]) => ({ key, label: r.label })),
    login: { available: app.isPackaged, enabled: app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin },
  };
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
}

// ---- ウィンドウ ----
function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 360,
    minHeight: 480,
    title: 'SNR Room Notifier',
    icon: assetPath('icon.ico'),
    backgroundColor: '#E9EEF3',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // ×で閉じても終了せずトレイに残る
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // 画面内のリンクは既定のブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendState();
}

// ---- トレイ ----
function trayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'assets', config.paused ? 'tray-paused.png' : 'tray.png'));
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(`SNR Room Notifier v${APP_VERSION}\n${statusInfo().text}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '画面を開く', click: showWindow },
    { label: 'Among Usを起動', click: async () => { const r = await startGame(); if (!r.ok) notify('起動できませんでした', r.message); } },
    { type: 'separator' },
    { label: '一時停止', type: 'checkbox', checked: config.paused, click: (i) => setPaused(i.checked) },
    { type: 'separator' },
    { label: `v${APP_VERSION} (${APP_UPDATED})`, enabled: false },
    { label: '終了', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// ---- IPC(画面からの操作) ----
ipcMain.handle('get-state', () => snapshot());
ipcMain.handle('join', (_e, key) => requestJoin(key));
ipcMain.handle('set-paused', (_e, v) => setPaused(v));
ipcMain.handle('set-region', (_e, key, v) => setRegion(key, v));
ipcMain.handle('set-notify', (_e, v) => setNotify(v));
ipcMain.handle('set-login', (_e, v) => setLogin(v));
ipcMain.handle('set-show-all', (_e, v) => setShowAll(v));
ipcMain.handle('choose-game-path', () => chooseGamePath());
ipcMain.handle('launch-game', () => startGame());
ipcMain.handle('set-auto-launch', (_e, v) => { config.autoLaunch = !!v; saveConfig(); sendState(); });
ipcMain.handle('refresh', () => restartPolling());
ipcMain.handle('test-notify', () => notify('テスト通知', '通知は正常に表示されています'));
ipcMain.handle('open-site', () => shell.openExternal(SITE_URL));
ipcMain.handle('open-notify-settings', () => shell.openExternal('ms-settings:notifications'));

// ---- 起動 ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windowsのトースト通知にはAppUserModelIDが必要。開発実行時はexeパスを使う
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

  // 2つ目を起動しようとしたら、既存の画面を前に出す
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    loadConfig();
    tray = new Tray(trayIcon());
    tray.on('click', showWindow);
    updateTray();
    createWindow();
    if (!process.argv.includes(HIDDEN_ARG)) win.once('ready-to-show', showWindow);
    restartPolling();
  });

  app.on('before-quit', () => { isQuitting = true; });
  // 画面を閉じてもトレイに常駐し続ける
  app.on('window-all-closed', (e) => e.preventDefault());
}
