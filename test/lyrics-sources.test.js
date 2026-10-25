const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { EventEmitter } = require('events');
const L = require('../lyrics-sources');

function stubHttps(routes) {
  const original = https.get;
  const calls = [];
  https.get = (url, opts, cb) => {
    calls.push(String(url));
    const req = new EventEmitter();
    req.destroy = () => {};
    const hit = routes.find((r) => String(url).includes(r.match));
    process.nextTick(() => {
      if (!hit) return req.emit('error', new Error('no route'));
      const res = new EventEmitter();
      res.statusCode = hit.status || 200;
      res.resume = () => {};
      cb(res);
      res.emit('data', Buffer.from(JSON.stringify(hit.body)));
      res.emit('end');
    });
    return req;
  };
  return { calls, restore: () => { https.get = original; } };
}

test('normalizeSource only accepts known sources', () => {
  assert.strictEqual(L.normalizeSource('netease'), 'netease');
  assert.strictEqual(L.normalizeSource('auto'), 'auto');
  assert.strictEqual(L.normalizeSource('musixmatch'), 'lrclib');
  assert.strictEqual(L.normalizeSource(undefined), 'lrclib');
});

test('pickSong requires title and artist to agree', () => {
  const songs = [
    { id: 1, name: 'Shape of You (Remix)', artists: [{ name: 'Someone Else' }] },
    { id: 2, name: 'Shape of You', artists: [{ name: 'Ed Sheeran' }] },
  ];
  assert.strictEqual(L.pickSong(songs, 'Shape of You', 'Ed Sheeran').id, 2);
  assert.strictEqual(L.pickSong(songs, 'Shape of You', 'Nobody'), null);
  assert.strictEqual(L.pickSong([], 'x', 'y'), null);
});

test('pickSong works for non-latin scripts', () => {
  const songs = [{ id: 7, name: '晴天', artists: [{ name: '周杰伦' }] }];
  assert.strictEqual(L.pickSong(songs, '晴天', '周杰伦').id, 7);
});

test('cleanLrc drops JSON credit lines and id tags but keeps lyrics', () => {
  const raw = '{"t":0,"c":[{"tx":"作词: "}]}\n[ti:Song]\n[by:x]\n[00:01.000]Hello\n\n[00:02.500]World';
  assert.strictEqual(L.cleanLrc(raw), '[00:01.000]Hello\n[00:02.500]World');
  assert.strictEqual(L.cleanLrc(null), '');
});

test('fetchNeteaseLyrics searches then fetches the matched song', async () => {
  const net = stubHttps([
    { match: '/api/search/get', body: { result: { songs: [{ id: 42, name: 'Shiver', artists: [{ name: 'Ed Sheeran' }] }] } } },
    { match: '/api/song/lyric', body: { lrc: { lyric: '{"t":0}\n[00:01.000]Line one' } } },
  ]);
  try {
    const lrc = await L.fetchNeteaseLyrics('Shiver', 'Ed Sheeran');
    assert.strictEqual(lrc, '[00:01.000]Line one');
    assert.ok(net.calls[1].includes('id=42'));
  } finally { net.restore(); }
});

test('fetchNeteaseLyrics returns null on a wrong-song result or network failure', async () => {
  let net = stubHttps([{ match: '/api/search/get', body: { result: { songs: [{ id: 1, name: 'Other', artists: [{ name: 'X' }] }] } } }]);
  try { assert.strictEqual(await L.fetchNeteaseLyrics('Shiver', 'Ed Sheeran'), null); } finally { net.restore(); }
  net = stubHttps([]);
  try { assert.strictEqual(await L.fetchNeteaseLyrics('Shiver', 'Ed Sheeran'), null); } finally { net.restore(); }
});

test('lrclib source never touches NetEase', async () => {
  const net = stubHttps([]);
  try {
    const out = await L.fetchLyricsBySource('lrclib', 'a', 'b', async () => 'plain');
    assert.strictEqual(out, 'plain');
    assert.strictEqual(net.calls.length, 0);
  } finally { net.restore(); }
});

test('auto keeps synced LRCLIB, falls back to NetEase otherwise', async () => {
  const synced = '[00:01.00]hi';
  let net = stubHttps([]);
  try {
    assert.strictEqual(await L.fetchLyricsBySource('auto', 'a', 'b', async () => synced), synced);
    assert.strictEqual(net.calls.length, 0);
  } finally { net.restore(); }
  net = stubHttps([
    { match: '/api/search/get', body: { result: { songs: [{ id: 9, name: 'a', artists: [{ name: 'b' }] }] } } },
    { match: '/api/song/lyric', body: { lrc: { lyric: '[00:05.000]from netease' } } },
  ]);
  try {
    assert.strictEqual(await L.fetchLyricsBySource('auto', 'a', 'b', async () => 'plain only'), '[00:05.000]from netease');
  } finally { net.restore(); }
});
