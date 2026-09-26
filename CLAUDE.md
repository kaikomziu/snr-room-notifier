# SNR Room Notifier(非公式ツール)

Among Us の MOD「SuperNewRoles(SNR)」のカスタムサーバーで公開部屋が開かれたら Windows 通知を出し、通知や一覧からそのまま参加できる Windows 常駐アプリ(Electron)。

- GitHub: https://github.com/kaikomziu/snr-room-notifier(public、main ブランチ、GPL-3.0-only)
- 現在: v1.4.4(2026-09-26)
- 技術: Electron 44 / electron-builder 26(NSIS、oneClick、per-user)。ランタイム依存パッケージなし
- 起動: `npm start` / ビルド: `npm run dist`(dist/ に出力)

## ファイル構成
- `main.js` — メインプロセス。監視ループ、通知、参加処理、トレイ、IPC、設定保存(userData/config.json)
- `preload.js` — contextBridge で `window.snr` を公開(contextIsolation / sandbox 有効)
- `lib/rooms.js` — ルーム一覧API取得、ルームキー作成、ルームコード変換、表示用データ作成
- `lib/join.js` — MOD のローカル参加APIへの参加リクエスト(AES-128-CBC 暗号化)
- `lib/game.js` — Among Us.exe 起動、MOD ローカルAPIの起動確認(TCP接続のみ)
- `renderer/index.html` / `style.css` / `app.js` — 画面(部屋タブ・設定タブ)。CSP は `'self'` のみ
- `assets/` — 独自デザインのアイコン(ベル+赤ドット)。Windows 通知が asar 内画像を読めないため package.json の `asarUnpack` で asar 外に置いている
- `publish.bat` — 初回公開用(.gitignore 済み、今後は使わない)。`release/` も .gitignore 済み

## 外部の仕組み
### ルーム一覧
- `GET https://cs.supernewroles.com/api/games/all_for_web`(US East は `cs-useast.supernewroles.com`)→ `{ games: [...] }`
- 主なフィールド: GameId, HostName, TrueHostName, PlayerCount, MaxPlayers, GameState(0=募集中 1=開始中 2=開始済み 3=ゲーム終了 4=破棄), MapId, NumImpostors, IP(リトルエンディアン整数), Port
- 参考: 公式ルーム一覧サイト https://github.com/SuperNewRoles/SuperNewMatchMaker.Web

### 参加
- SNR MOD 起動中に立つ `http://localhost:49152/joinGame` に GET
- パラメータ `serverIP` / `serverPort` / `serverType` / `gameID` をそれぞれ AES-128-CBC(key `ThisIsA16ByteKey`、IV `ThisIsA16ByteIV!`、PKCS7)で暗号化 → Base64
- serverType: Tokyo=3、US East=5(公式サイトは常に3を送るが、MOD 側では US East は 5)
- 成功時レスポンス本文: 「接続しました。」
- MOD 側実装: SuperNewRoles/SuperNewRoles の `SuperNewRoles/API/APIServer.cs`、`API/Handlers/JoinRoomByURL.cs`
- MOD の API はタイトル画面より前(プラグイン読み込み時)に起動する。読み込み中に参加要求すると「すでにゲームに参加しています」が返るため、起動直後は再試行している

## 守ること(厳守)
- 取得間隔 `POLL_MS` は **10秒より短くしない**(SNR開発者に「公式サイトより長い間隔」と伝えてある)
- 使うエンドポイントは **3つだけ**(all_for_web ×2、localhost の joinGame)。増やす場合は SNR 開発者への報告が必要なので **先にユーザーに確認**
- 「非公式ツール」の明記(README 冒頭、設定タブの免責事項)を消さない
- 「AI(Claude Code)で作成している」明記(README 冒頭と「開発」、設定タブの免責事項)も消さない
- Among Us のキャラクター(クルー)など Innersloth / SNR の素材は使わない
- 変更のたびにバージョンと日付を記録し、次の **4か所をすべて揃える**:
  1. `main.js` 冒頭の更新履歴コメント
  2. `main.js` の `APP_VERSION` と `APP_UPDATED`(画面に表示)
  3. `package.json` の `version`
  4. `README.md` の「更新履歴」
- ゲームではなくツールなので MY GAMES LINKS(game-links)には追加しない
- PC 用常駐アプリなのでスマホ対応は不要

## リリース手順
1. 上の4か所のバージョンと日付を更新
2. `npm run dist` でインストーラー作成(dist/)
3. `git add -A` → commit → `git push origin main`
4. README のインストール手順に合わせ、`dist/SNR-Room-Notifier-Setup-X.Y.Z.exe`(ハイフン区切り)にコピーしてから添付する:
   `gh release create vX.Y.Z dist/SNR-Room-Notifier-Setup-X.Y.Z.exe --title "vX.Y.Z" --notes "変更内容"`
- Windows では初回に `npm install` が必要(node_modules は Linux ビルド時のもので無かった)

## 未確認・既知の懸念
- Linux 上でビルドしたため Windows 実機での動作確認が不十分。特に:
  - 通知: v1.4.0 でアイコンを asar 外に置いたことで直ったか(設定タブに最後の通知の成否を表示している)
  - 起動→そのまま参加の流れ: 起動待ち最大180秒 → 8秒待機 → 最大60秒再試行、の待ち時間が実機で合っているか
- (v1.4.4で解消)起動確認はパラメータなし joinGame ではなく、127.0.0.1:49152 への TCP 接続可否だけで判定している(HTTP は送らない)
