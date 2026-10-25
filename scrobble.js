'use strict';

// Scrobbling for Last.fm and ListenBrainz.
//
// Credentials stay on the server side (the renderer never receives a key, secret, token or session
// key back, only connection status) and are encrypted at rest with the OS keychain via Electron's
// safeStorage when it is available, the same way the Spotify login is stored.
//
// Last.fm needs an API key and shared secret, which each user creates for themselves at
// https://www.last.fm/api/account/create ; the app does not ship one.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_AUTH = 'https://www.last.fm/api/auth/';
const LB_API = 'https://api.listenbrainz.org/1/';
const CLIENT = 'Waev Pro';

function defaultRequest(url, { method = 'GET', headers = {}, body = null, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    const req = https.request(url, { method, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.on('error', () => resolve({ status: 0, json: null }));
    if (body) req.write(body);
    req.end();
  });
}

// ---- pure helpers (unit tested) -------------------------------------------------------------

// Last.fm request signature: md5 of the parameters sorted by name, each as name+value, followed by
// the shared secret. `format` and `callback` are never part of the signature.
function lastfmSign(params, secret) {
  const base = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + String(params[k]))
    .join('');
  return crypto.createHash('md5').update(base + secret, 'utf8').digest('hex');
}

// Track metadata from streaming sources is messy ("Artist - Topic", "(Official Video)").
function cleanMetadata(meta) {
  if (!meta) return null;
  let artist = String(meta.artist || '').replace(/\s*-\s*topic\s*$/i, '').replace(/\s*vevo\s*$/i, '').replace(/\s+/g, ' ').trim();
  let title = String(meta.title || '')
    .replace(/\s*[\[(](official\s*(music\s*)?(video|audio|lyric\s*video|visuali[sz]er)|lyrics?|audio|hd|4k|visuali[sz]er|video\s*clip|clip\s*officiel)[\])]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (artist && title.toLowerCase().startsWith(artist.toLowerCase() + ' - ')) title = title.slice(artist.length + 3).trim();
  if (!artist || !title) return null;
  const album = String(meta.album || '').trim();
  const duration = Math.round(Number(meta.duration) || 0);
  return { artist, title, album: album || undefined, duration: duration > 0 ? duration : undefined };
}

// Scrobble rule shared by Last.fm and ListenBrainz: the track is longer than 30 seconds and was
// listened to for at least half its length or 4 minutes, whichever comes first.
function scrobbleDue(durationSeconds, listenedSeconds) {
  if (!(durationSeconds >= 30)) return false;
  return listenedSeconds >= Math.min(durationSeconds / 2, 240);
}

function listenBrainzListen(meta, listenedAt) {
  const info = { media_player: CLIENT, submission_client: CLIENT };
  if (meta.duration) info.duration_ms = meta.duration * 1000;
  const track_metadata = { artist_name: meta.artist, track_name: meta.title, additional_info: info };
  if (meta.album) track_metadata.release_name = meta.album;
  return listenedAt ? { listened_at: listenedAt, track_metadata } : { track_metadata };
}

function classifyLastfm(res) {
  if (!res || res.status === 0) return 'retry';
  if (res.status === 429 || res.status >= 500) return 'retry';
  const code = res.json && res.json.error;
  if (!code) return res.status >= 200 && res.status < 300 ? 'ok' : 'rejected';
  if (code === 9 || code === 4) return 'auth'; // invalid or expired session / authentication failed
  if (code === 11 || code === 16 || code === 29) return 'retry'; // offline, temporary, rate limit
  return 'rejected';
}

function classifyListenBrainz(res) {
  if (!res || res.status === 0) return 'retry';
  if (res.status === 401) return 'auth';
  if (res.status === 429 || res.status >= 500) return 'retry';
  return res.status >= 200 && res.status < 300 ? 'ok' : 'rejected';
}

// ---- scrobbler ------------------------------------------------------------------------------

function createScrobbler({ dataDir, safeStorage = null, request = defaultRequest } = {}) {
  const file = dataDir ? path.join(dataDir, 'scrobble-auth.enc') : null;
  let auth = { lastfm: {}, listenbrainz: {} };
  let loaded = false;
  let pendingToken = null; // Last.fm token waiting for the user to approve it in the browser

  const canPersist = () => !!(file && safeStorage && safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || typeof safeStorage.getSelectedStorageBackend !== 'function' ||
      safeStorage.getSelectedStorageBackend() !== 'basic_text'));

  function load() {
    if (loaded) return;
    loaded = true;
    if (!canPersist()) return;
    try {
      const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      auth = { lastfm: saved.lastfm || {}, listenbrainz: saved.listenbrainz || {} };
    } catch (_) { /* no file yet, or unreadable: start empty */ }
  }

  function save() {
    if (!canPersist()) return false;
    const tmp = `${file}.tmp`;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(auth)), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    } catch (_) {
      try { fs.rmSync(tmp, { force: true }); } catch (__) {}
      return false;
    }
  }

  const lastfmReady = () => !!(auth.lastfm.apiKey && auth.lastfm.secret && auth.lastfm.sessionKey);
  const lbReady = () => !!auth.listenbrainz.token;

  function status() {
    load();
    return {
      lastfm: {
        hasKeys: !!(auth.lastfm.apiKey && auth.lastfm.secret),
        connected: lastfmReady(),
        awaitingApproval: !!pendingToken,
        user: auth.lastfm.user || '',
      },
      listenbrainz: { connected: lbReady(), user: auth.listenbrainz.user || '' },
      persisted: canPersist(),
    };
  }

  async function lastfmCall(method, params, { post = false, signed = true } = {}) {
    const all = { method, api_key: auth.lastfm.apiKey, ...params };
    if (signed) all.api_sig = lastfmSign(all, auth.lastfm.secret);
    all.format = 'json';
    const qs = new URLSearchParams(all).toString();
    if (post) {
      return request(LASTFM_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(qs), 'User-Agent': CLIENT },
        body: qs,
      });
    }
    return request(`${LASTFM_API}?${qs}`, { headers: { 'User-Agent': CLIENT } });
  }

  function setLastfmKeys({ apiKey, secret }) {
    load();
    apiKey = String(apiKey || '').trim();
    secret = String(secret || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(apiKey) || !/^[a-f0-9]{32}$/i.test(secret)) {
      return { success: false, error: 'The Last.fm API key and shared secret are each 32 characters (letters a-f and digits).' };
    }
    auth.lastfm = { apiKey, secret };
    pendingToken = null;
    save();
    return { success: true, status: status() };
  }

  async function lastfmBegin() {
    load();
    if (!auth.lastfm.apiKey || !auth.lastfm.secret) return { success: false, error: 'Enter your Last.fm API key and shared secret first.' };
    const res = await lastfmCall('auth.getToken', {});
    const token = res.json && res.json.token;
    if (!token) return { success: false, error: (res.json && res.json.message) || 'Could not reach Last.fm.' };
    pendingToken = token;
    return { success: true, url: `${LASTFM_AUTH}?api_key=${encodeURIComponent(auth.lastfm.apiKey)}&token=${encodeURIComponent(token)}` };
  }

  async function lastfmFinish() {
    load();
    if (!pendingToken) return { success: false, error: 'Start the connection first.' };
    const res = await lastfmCall('auth.getSession', { token: pendingToken });
    const session = res.json && res.json.session;
    if (!session || !session.key) {
      return { success: false, error: (res.json && res.json.message) || 'Last.fm did not confirm the connection. Approve it in your browser, then try again.' };
    }
    auth.lastfm.sessionKey = session.key;
    auth.lastfm.user = session.name || '';
    pendingToken = null;
    save();
    return { success: true, status: status() };
  }

  async function setListenBrainzToken(token) {
    load();
    token = String(token || '').trim();
    if (!/^[A-Za-z0-9-]{20,64}$/.test(token)) return { success: false, error: 'That does not look like a ListenBrainz user token.' };
    const res = await request(`${LB_API}validate-token`, { headers: { Authorization: `Token ${token}`, 'User-Agent': CLIENT } });
    if (!(res.json && res.json.valid)) {
      return { success: false, error: res.status === 0 ? 'Could not reach ListenBrainz.' : 'ListenBrainz rejected that token.' };
    }
    auth.listenbrainz = { token, user: res.json.user_name || '' };
    save();
    return { success: true, status: status() };
  }

  function disconnect(service) {
    load();
    if (service === 'lastfm') { auth.lastfm = {}; pendingToken = null; }
    else if (service === 'listenbrainz') auth.listenbrainz = {};
    else return { success: false, error: 'Unknown service.' };
    save();
    return { success: true, status: status() };
  }

  async function lbSubmit(listenType, payload) {
    return request(`${LB_API}submit-listens`, {
      method: 'POST',
      headers: { Authorization: `Token ${auth.listenbrainz.token}`, 'Content-Type': 'application/json', 'User-Agent': CLIENT },
      body: JSON.stringify({ listen_type: listenType, payload: [payload] }),
    });
  }

  // `only` limits the services tried (used when retrying a queued scrobble).
  async function run(kind, rawMeta, timestamp, only) {
    load();
    const meta = cleanMetadata(rawMeta);
    const results = {};
    if (!meta) return { success: false, results, error: 'Missing artist or title.' };
    const want = (name) => !only || only.includes(name);

    const jobs = [];
    if (lastfmReady() && want('lastfm')) {
      jobs.push((async () => {
        const params = { artist: meta.artist, track: meta.title, sk: auth.lastfm.sessionKey };
        if (meta.album) params.album = meta.album;
        if (meta.duration) params.duration = meta.duration;
        let res;
        if (kind === 'nowplaying') res = await lastfmCall('track.updateNowPlaying', params, { post: true });
        else res = await lastfmCall('track.scrobble', { ...params, timestamp: String(timestamp) }, { post: true });
        results.lastfm = classifyLastfm(res);
        if (results.lastfm === 'auth') { auth.lastfm.sessionKey = ''; auth.lastfm.user = ''; save(); }
      })());
    }
    if (lbReady() && want('listenbrainz')) {
      jobs.push((async () => {
        const res = kind === 'nowplaying'
          ? await lbSubmit('playing_now', listenBrainzListen(meta, 0))
          : await lbSubmit('single', listenBrainzListen(meta, timestamp));
        results.listenbrainz = classifyListenBrainz(res);
        if (results.listenbrainz === 'auth') { auth.listenbrainz = {}; save(); }
      })());
    }
    await Promise.all(jobs);
    return { success: true, results };
  }

  return {
    status, setLastfmKeys, lastfmBegin, lastfmFinish, setListenBrainzToken, disconnect,
    nowPlaying: (meta) => run('nowplaying', meta, 0),
    scrobble: (meta, timestamp, only) => run('scrobble', meta, Math.floor(Number(timestamp)) || Math.floor(Date.now() / 1000), only),
  };
}

module.exports = { createScrobbler, lastfmSign, cleanMetadata, scrobbleDue, listenBrainzListen, classifyLastfm, classifyListenBrainz };
