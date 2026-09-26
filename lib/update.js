'use strict';

// 新しいバージョンが出ていないかを GitHub の Releases で確認する(SNRのサーバーは使わない)。
// ダウンロードやインストールは自動では行わず、Releases のページを開くだけ

const LATEST_URL = 'https://api.github.com/repos/kaikomziu/snr-room-notifier/releases/latest';
const RELEASES_PAGE = 'https://github.com/kaikomziu/snr-room-notifier/releases/latest';

function parseVersion(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1, 4).map(Number) : null;
}

// a が b より新しければ正の数
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// 戻り値: { version, url } (新しい版がなければ null)。取得に失敗したら例外
async function fetchNewerRelease(currentVersion, timeoutMs = 10000) {
  const res = await fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `snr-room-notifier/${currentVersion}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.draft || data.prerelease) return null;
  const version = String(data.tag_name || '').replace(/^v/, '');
  if (compareVersions(version, currentVersion) <= 0) return null;
  const url = typeof data.html_url === 'string' && data.html_url.startsWith('https://github.com/') ? data.html_url : RELEASES_PAGE;
  return { version, url };
}

module.exports = { fetchNewerRelease, compareVersions, RELEASES_PAGE };
