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
      res.emit('data', Buffer.from(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)));
      res.emit('end');
    });
    return req;
  };
  return { calls, restore: () => { https.get = original; } };
}

test('normalizeSource only accepts known sources', () => {
  assert.strictEqual(L.normalizeSource('netease'), 'netease');
  assert.strictEqual(L.normalizeSource('auto'), 'auto');
  assert.strictEqual(L.normalizeSource('bogus'), 'lrclib');
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

test('normalizeSource accepts the new sources', () => {
  assert.strictEqual(L.normalizeSource('kugou'), 'kugou');
  assert.strictEqual(L.normalizeSource('musixmatch'), 'musixmatch');
});

test('fetchKugouLyrics follows search, candidate, download and decodes base64 LRC', async () => {
  const lrc = '[00:01.00]Hello\n[00:03.00]World';
  const net = stubHttps([
    { match: 'mobiles.kugou.com/api/v3/search/song', body: { data: { info: [{ hash: 'H1', songname: 'Shiver', singername: 'Ed Sheeran', duration: 200 }] } } },
    { match: 'lyrics.kugou.com/search', body: { candidates: [{ id: '7', accesskey: 'AK' }] } },
    { match: 'lyrics.kugou.com/download', body: { content: Buffer.from('﻿' + lrc).toString('base64') } },
  ]);
  try {
    assert.strictEqual(await L.fetchKugouLyrics('Shiver', 'Ed Sheeran'), lrc);
    assert.ok(net.calls[1].includes('hash=H1') && net.calls[1].includes('duration=200000'));
    assert.ok(net.calls[2].includes('id=7') && net.calls[2].includes('accesskey=AK'));
  } finally { net.restore(); }
});

test('fetchKugouLyrics returns null for a mismatched song or missing candidate', async () => {
  let net = stubHttps([{ match: 'search/song', body: { data: { info: [{ hash: 'H', songname: 'Other', singername: 'X' }] } } }]);
  try { assert.strictEqual(await L.fetchKugouLyrics('Shiver', 'Ed Sheeran'), null); } finally { net.restore(); }
  net = stubHttps([
    { match: 'search/song', body: { data: { info: [{ hash: 'H', songname: 'Shiver', singername: 'Ed Sheeran' }] } } },
    { match: 'lyrics.kugou.com/search', body: { candidates: [] } },
  ]);
  try { assert.strictEqual(await L.fetchKugouLyrics('Shiver', 'Ed Sheeran'), null); } finally { net.restore(); }
});

test('Musixmatch needs a key and never calls the network without one', async () => {
  const net = stubHttps([]);
  try {
    assert.strictEqual(await L.fetchMusixmatchLyrics('a', 'b', ''), null);
    assert.strictEqual(net.calls.length, 0);
  } finally { net.restore(); }
});

test('Musixmatch uses the official API: synced first, plain fallback with footer stripped', async () => {
  let net = stubHttps([{ match: 'matcher.subtitle.get', body: { message: { header: { status_code: 200 }, body: { subtitle: { subtitle_body: '[00:01.00]synced' } } } } }]);
  try {
    assert.strictEqual(await L.fetchMusixmatchLyrics('a', 'b', 'KEY'), '[00:01.00]synced');
    assert.ok(net.calls[0].startsWith('https://api.musixmatch.com/ws/1.1/') && net.calls[0].includes('apikey=KEY'));
  } finally { net.restore(); }
  net = stubHttps([
    { match: 'matcher.subtitle.get', body: { message: { header: { status_code: 401 } } } },
    { match: 'matcher.lyrics.get', body: { message: { header: { status_code: 200 }, body: { lyrics: { lyrics_body: 'line one\nline two\n\n*******  This Lyrics is NOT for Commercial use  *******' } } } } },
  ]);
  try {
    assert.strictEqual(await L.fetchMusixmatchLyrics('a', 'b', 'KEY'), 'line one\nline two');
  } finally { net.restore(); }
});

test('auto walks lrclib, netease, kugou in order and skips Musixmatch without a key', async () => {
  const net = stubHttps([
    { match: 'music.163.com/api/search/get', body: { result: { songs: [] } } },
    { match: 'mobiles.kugou.com', body: { data: { info: [{ hash: 'H', songname: 'a', singername: 'b', duration: 100 }] } } },
    { match: 'lyrics.kugou.com/search', body: { candidates: [{ id: '1', accesskey: 'K' }] } },
    { match: 'lyrics.kugou.com/download', body: { content: Buffer.from('[00:02.00]kugou line').toString('base64') } },
  ]);
  try {
    const out = await L.fetchLyricsBySource('auto', 'a', 'b', async () => 'plain from lrclib', {});
    assert.strictEqual(out, '[00:02.00]kugou line');
    assert.ok(!net.calls.some((u) => u.includes('musixmatch')));
  } finally { net.restore(); }
});

test('auto returns the best plain lyrics when nothing is synced', async () => {
  const net = stubHttps([]);
  try {
    assert.strictEqual(await L.fetchLyricsBySource('auto', 'a', 'b', async () => 'only plain', {}), 'only plain');
  } finally { net.restore(); }
});

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
 <head><metadata><ttm:agent type="person" xml:id="v1"/><iTunesMetadata><songwriters><songwriter>Ed Sheeran</songwriter></songwriters></iTunesMetadata></metadata></head>
 <body dur="3:20.0"><div begin="0.5s" end="30s">
  <p begin="0:12.340" end="0:15.000" ttm:agent="v1"><span begin="0:12.340" end="0:13.000">I'm</span> <span begin="0:13.000" end="0:14.000">in</span> <span begin="0:14.000" end="0:15.000">love</span><span ttm:role="x-bg" begin="0:14.500" end="0:15.000"><span>(oh)</span></span><span ttm:role="x-translation" xml:lang="fr">Je suis amoureux</span></p>
  <p begin="1:05.5" end="1:08.0"><span begin="1:05.5">Rock &amp; roll &#39;n&#39; soul</span></p>
  <p begin="00:02:10.250" end="00:02:12.000">Plain line</p>
 </div></body></tt>`;

test('parseTtmlTime understands the TTML clock formats', () => {
  assert.strictEqual(L.parseTtmlTime('12.5s'), 12.5);
  assert.strictEqual(L.parseTtmlTime('1500ms'), 1.5);
  assert.strictEqual(L.parseTtmlTime('1:02.5'), 62.5);
  assert.strictEqual(L.parseTtmlTime('00:02:10.250'), 130.25);
  assert.strictEqual(L.parseTtmlTime('7'), 7);
  assert.ok(Number.isNaN(L.parseTtmlTime('soon')));
  assert.ok(Number.isNaN(L.parseTtmlTime(undefined)));
});

test('ttmlToLrc keeps line starts, joins words, drops translation and background vocals', () => {
  assert.strictEqual(L.ttmlToLrc(TTML), [
    "[00:12.34]I'm in love",
    "[01:05.50]Rock & roll 'n' soul",
    '[02:10.25]Plain line',
  ].join('\n'));
});

test('ttmlToLrc falls back to span times, then to plain text, and rejects junk', () => {
  assert.strictEqual(L.ttmlToLrc('<tt><body><p><span begin="3s">Hi</span> <span begin="4s">there</span></p></body></tt>'), '[00:03.00]Hi there');
  assert.strictEqual(L.ttmlToLrc('<tt><body><p>One</p><p>Two</p></body></tt>'), 'One\nTwo');
  assert.strictEqual(L.ttmlToLrc('not xml'), '');
  assert.strictEqual(L.ttmlToLrc(null), '');
});

test('the converted Apple lyrics are accepted by the same line pattern the player uses', () => {
  const rx = /\[(\d+):(\d+(\.\d+)?)\](.*)/;
  for (const line of L.ttmlToLrc(TTML).split('\n')) assert.ok(rx.test(line), line);
});

test('fetchAppleLyrics prefers word-timed matches, ignores wrong songs and unsafe sheet URLs', async () => {
  const net = stubHttps([
    { match: 'lyrics-api.binimum.org', body: { results: [
      { track_name: 'Other Song', artist_name: 'Ed Sheeran', timing_type: 'word', lyricsUrl: 'https://cdn.example.org/other.ttml' },
      { track_name: 'Shiver', artist_name: 'Ed Sheeran', timing_type: 'line', lyricsUrl: 'https://cdn.example.org/line.ttml' },
      { track_name: 'Shiver', artist_name: 'Ed Sheeran', timing_type: 'word', lyricsUrl: 'http://cdn.example.org/insecure.ttml' },
      { track_name: 'Shiver', artist_name: 'Ed Sheeran', timing_type: 'word', lyricsUrl: 'https://127.0.0.1/local.ttml' },
      { track_name: 'Shiver', artist_name: 'Ed Sheeran', timing_type: 'syllable', lyricsUrl: 'https://cdn.example.org/word.ttml' },
    ] } },
    { match: 'cdn.example.org/word.ttml', body: TTML },
    { match: 'cdn.example.org/line.ttml', body: '<tt><body><p begin="1s">WRONG ORDER</p></body></tt>' },
  ]);
  try {
    const lrc = await L.fetchAppleLyrics('Shiver', 'Ed Sheeran');
    assert.ok(lrc.startsWith("[00:12.34]I'm in love"));
    assert.ok(net.calls.every((u) => !u.includes('other.ttml') && !u.includes('insecure') && !u.includes('127.0.0.1')));
    assert.ok(net.calls[0].includes('track=Shiver') && net.calls[0].includes('artist=Ed+Sheeran'));
  } finally { net.restore(); }
});

test('fetchAppleLyrics returns null when the catalogue has no match or is down', async () => {
  let net = stubHttps([{ match: 'lyrics-api.binimum.org', body: { results: [] } }]);
  try { assert.strictEqual(await L.fetchAppleLyrics('Shiver', 'Ed Sheeran'), null); } finally { net.restore(); }
  net = stubHttps([]);
  try { assert.strictEqual(await L.fetchAppleLyrics('Shiver', 'Ed Sheeran'), null); } finally { net.restore(); }
});

test('apple is a valid source and sits second in the Auto order, after LRCLIB', async () => {
  assert.strictEqual(L.normalizeSource('apple'), 'apple');
  const net = stubHttps([
    { match: 'lyrics-api.binimum.org', body: { results: [{ track_name: 'a', artist_name: 'b', timing_type: 'word', lyricsUrl: 'https://cdn.example.org/s.ttml' }] } },
    { match: 'cdn.example.org/s.ttml', body: '<tt><body><p begin="2s">from apple</p></body></tt>' },
  ]);
  try {
    assert.strictEqual(await L.fetchLyricsBySource('auto', 'a', 'b', async () => 'plain from lrclib', {}), '[00:02.00]from apple');
    assert.ok(!net.calls.some((u) => u.includes('163.com') || u.includes('kugou')));
  } finally { net.restore(); }
});
