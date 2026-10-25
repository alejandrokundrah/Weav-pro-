const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../scrobble');

const KEY = 'a'.repeat(32);
const SECRET = 'b'.repeat(32);
const LB_TOKEN = '11111111-2222-3333-4444-555555555555';
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

function fakeNet(handler) {
  const calls = [];
  const request = async (url, opts = {}) => {
    const call = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || null };
    calls.push(call);
    return handler(call);
  };
  return { calls, request };
}
const form = (call) => Object.fromEntries(new URLSearchParams(call.body || new URL(call.url).search));

test('lastfmSign sorts by name, ignores format, appends the secret', () => {
  const sig = S.lastfmSign({ track: 'T', api_key: 'K', artist: 'A', format: 'json' }, 'SEC');
  assert.strictEqual(sig, md5('api_keyKartistAtrackTSEC'));
});

test('cleanMetadata strips topic/vevo/official-video noise and artist prefix', () => {
  assert.deepStrictEqual(S.cleanMetadata({ artist: 'Ed Sheeran - Topic', title: 'Shape of You (Official Video)', duration: 233.6 }),
    { artist: 'Ed Sheeran', title: 'Shape of You', album: undefined, duration: 234 });
  assert.strictEqual(S.cleanMetadata({ artist: 'Ed Sheeran', title: 'Ed Sheeran - Perfect [Lyrics]' }).title, 'Perfect');
  assert.strictEqual(S.cleanMetadata({ artist: '', title: 'x' }), null);
  assert.strictEqual(S.cleanMetadata(null), null);
});

test('scrobbleDue: >30s tracks, half the length or 4 minutes', () => {
  assert.strictEqual(S.scrobbleDue(20, 20), false);
  assert.strictEqual(S.scrobbleDue(200, 99), false);
  assert.strictEqual(S.scrobbleDue(200, 100), true);
  assert.strictEqual(S.scrobbleDue(900, 239), false);
  assert.strictEqual(S.scrobbleDue(900, 240), true);
  assert.strictEqual(S.scrobbleDue(NaN, 500), false);
});

test('Last.fm connect flow then now-playing and scrobble are signed correctly', async () => {
  const net = fakeNet((c) => {
    const p = form(c);
    if (p.method === 'auth.getToken') return { status: 200, json: { token: 'TOK' } };
    if (p.method === 'auth.getSession') return { status: 200, json: { session: { name: 'alejandro', key: 'SK' } } };
    return { status: 200, json: {} };
  });
  const sc = S.createScrobbler({ request: net.request });
  assert.strictEqual(sc.setLastfmKeys({ apiKey: 'short', secret: SECRET }).success, false);
  assert.strictEqual(sc.setLastfmKeys({ apiKey: KEY, secret: SECRET }).success, true);
  const begin = await sc.lastfmBegin();
  assert.ok(begin.url.startsWith('https://www.last.fm/api/auth/?api_key=' + KEY) && begin.url.includes('token=TOK'));
  assert.strictEqual((await sc.lastfmFinish()).status.lastfm.user, 'alejandro');

  const meta = { artist: 'Ed Sheeran', title: 'Shiver', album: 'Plus', duration: 207 };
  await sc.nowPlaying(meta);
  const np = form(net.calls.at(-1));
  assert.strictEqual(np.method, 'track.updateNowPlaying');
  assert.strictEqual(np.sk, 'SK');
  const { api_sig, format, ...signed } = np;
  assert.strictEqual(api_sig, S.lastfmSign(signed, SECRET));

  const out = await sc.scrobble(meta, 1700000000);
  const sb = form(net.calls.at(-1));
  assert.strictEqual(sb.method, 'track.scrobble');
  assert.strictEqual(sb.timestamp, '1700000000');
  assert.strictEqual(out.results.lastfm, 'ok');
});

test('Last.fm invalid session disconnects; temporary errors ask for a retry', async () => {
  let reply = { status: 200, json: { error: 9, message: 'Invalid session key' } };
  const net = fakeNet((c) => {
    const p = form(c);
    if (p.method === 'auth.getToken') return { status: 200, json: { token: 'T' } };
    if (p.method === 'auth.getSession') return { status: 200, json: { session: { name: 'u', key: 'SK' } } };
    return reply;
  });
  const sc = S.createScrobbler({ request: net.request });
  sc.setLastfmKeys({ apiKey: KEY, secret: SECRET });
  await sc.lastfmBegin(); await sc.lastfmFinish();

  reply = { status: 0, json: null };
  assert.strictEqual((await sc.scrobble({ artist: 'A', title: 'T' }, 1)).results.lastfm, 'retry');
  assert.strictEqual(sc.status().lastfm.connected, true);

  reply = { status: 200, json: { error: 9 } };
  assert.strictEqual((await sc.scrobble({ artist: 'A', title: 'T' }, 1)).results.lastfm, 'auth');
  assert.strictEqual(sc.status().lastfm.connected, false);
});

test('ListenBrainz validates the token and submits single and playing_now listens', async () => {
  const net = fakeNet((c) => c.url.endsWith('validate-token')
    ? { status: 200, json: { valid: true, user_name: 'alejandro' } }
    : { status: 200, json: { status: 'ok' } });
  const sc = S.createScrobbler({ request: net.request });
  assert.strictEqual((await sc.setListenBrainzToken('nope')).success, false);
  const set = await sc.setListenBrainzToken(LB_TOKEN);
  assert.strictEqual(set.status.listenbrainz.user, 'alejandro');
  assert.strictEqual(net.calls[0].headers.Authorization, `Token ${LB_TOKEN}`);

  await sc.nowPlaying({ artist: 'A', title: 'T', duration: 100 });
  let body = JSON.parse(net.calls.at(-1).body);
  assert.strictEqual(body.listen_type, 'playing_now');
  assert.strictEqual(body.payload[0].listened_at, undefined);

  await sc.scrobble({ artist: 'A', title: 'T', album: 'Al', duration: 100 }, 1700000123);
  body = JSON.parse(net.calls.at(-1).body);
  assert.strictEqual(body.listen_type, 'single');
  assert.strictEqual(body.payload[0].listened_at, 1700000123);
  assert.strictEqual(body.payload[0].track_metadata.artist_name, 'A');
  assert.strictEqual(body.payload[0].track_metadata.release_name, 'Al');
  assert.strictEqual(body.payload[0].track_metadata.additional_info.duration_ms, 100000);
});

test('ListenBrainz 401 disconnects; rejected token is not stored', async () => {
  let valid = false;
  const net = fakeNet((c) => c.url.endsWith('validate-token')
    ? { status: valid ? 200 : 401, json: valid ? { valid: true, user_name: 'u' } : { valid: false } }
    : { status: 401, json: {} });
  const sc = S.createScrobbler({ request: net.request });
  assert.strictEqual((await sc.setListenBrainzToken(LB_TOKEN)).success, false);
  assert.strictEqual(sc.status().listenbrainz.connected, false);
  valid = true;
  await sc.setListenBrainzToken(LB_TOKEN);
  assert.strictEqual((await sc.scrobble({ artist: 'A', title: 'T' }, 5)).results.listenbrainz, 'auth');
  assert.strictEqual(sc.status().listenbrainz.connected, false);
});

test('"only" limits a retry to the services that failed', async () => {
  const net = fakeNet((c) => c.url.endsWith('validate-token') ? { status: 200, json: { valid: true, user_name: 'u' } } : { status: 200, json: {} });
  const sc = S.createScrobbler({ request: net.request });
  await sc.setListenBrainzToken(LB_TOKEN);
  const n = net.calls.length;
  const out = await sc.scrobble({ artist: 'A', title: 'T' }, 5, ['lastfm']);
  assert.deepStrictEqual(out.results, {});
  assert.strictEqual(net.calls.length, n);
});

test('credentials are encrypted at rest and reloaded; nothing secret is in status()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrobble-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
  };
  const net = fakeNet(() => ({ status: 200, json: { valid: true, user_name: 'alejandro' } }));
  const a = S.createScrobbler({ dataDir: dir, safeStorage, request: net.request });
  await a.setListenBrainzToken(LB_TOKEN);
  assert.ok(!fs.readFileSync(path.join(dir, 'scrobble-auth.enc'), 'utf8').includes(LB_TOKEN));
  const b = S.createScrobbler({ dataDir: dir, safeStorage, request: net.request });
  assert.strictEqual(b.status().listenbrainz.user, 'alejandro');
  assert.ok(!JSON.stringify(b.status()).includes(LB_TOKEN));
  assert.strictEqual(b.status().persisted, true);
  b.disconnect('listenbrainz');
  assert.strictEqual(S.createScrobbler({ dataDir: dir, safeStorage, request: net.request }).status().listenbrainz.connected, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without OS encryption nothing is written to disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrobble-'));
  const net = fakeNet(() => ({ status: 200, json: { valid: true, user_name: 'u' } }));
  const sc = S.createScrobbler({ dataDir: dir, safeStorage: { isEncryptionAvailable: () => false }, request: net.request });
  await sc.setListenBrainzToken(LB_TOKEN);
  assert.strictEqual(sc.status().persisted, false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'scrobble-auth.enc')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
