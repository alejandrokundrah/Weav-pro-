'use strict';

// Second lyrics source: NetEase Cloud Music (unofficial public web endpoints, no key needed).
// Kept in its own module so it can be unit-tested without starting the server.

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getJson(url, timeout = 5000) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' },
      timeout,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// Keeps letters and digits from any script (NetEase is mostly queried in CJK / Arabic / Cyrillic).
function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function cleanQueryText(text) {
  return String(text || '')
    .replace(/\[.*?\]|\(.*?\)/g, ' ')
    .replace(/official\s*(music)?\s*video|official\s*audio|lyrics?\s*video|visualizer|clip\s*officiel|video\s*clip/gi, ' ')
    .replace(/\s*-\s*topic\b|vevo|\bfeat\.?|\bft\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Picks the first search hit whose title AND artist agree with what was asked for.
// Returning null is better than returning lyrics for the wrong song.
function pickSong(songs, title, artist) {
  const wantTitle = normalize(cleanQueryText(title));
  const wantArtist = normalize(cleanQueryText(artist));
  if (!wantTitle || !Array.isArray(songs)) return null;
  for (const song of songs) {
    const gotTitle = normalize(song && song.name);
    if (!gotTitle) continue;
    const titleOk = gotTitle === wantTitle || gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle);
    if (!titleOk) continue;
    if (!wantArtist) return song;
    const artists = (song.artists || song.ar || []).map((a) => normalize(a && a.name));
    if (artists.some((a) => a && (a.includes(wantArtist) || wantArtist.includes(a)))) return song;
  }
  return null;
}

// NetEase prepends credit lines as JSON ({"t":0,"c":[...]}) and ID tags ([ti:..], [by:..]).
// The player would show those as lyric lines, so they are dropped.
function cleanLrc(raw) {
  if (typeof raw !== 'string') return '';
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('{') && t.endsWith('}')) continue;
    if (/^\[(ti|ar|al|au|by|offset|length|re|ve|tool):/i.test(t)) continue;
    out.push(t);
  }
  return out.join('\n');
}

async function fetchNeteaseLyrics(title, artist) {
  const query = `${cleanQueryText(title)} ${cleanQueryText(artist)}`.trim();
  if (!query) return null;

  const search = await getJson(
    `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&limit=8&offset=0`
  );
  const songs = search && search.result && search.result.songs;
  const song = pickSong(songs, title, artist);
  if (!song || !song.id) return null;

  const data = await getJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(song.id)}&lv=1&kv=1&tv=-1`);
  const lrc = cleanLrc(data && data.lrc && data.lrc.lyric);
  return lrc && lrc.length > 0 ? lrc : null;
}

const hasTimestamps = (lrc) => typeof lrc === 'string' && /\[\d+:\d+(\.\d+)?\]/.test(lrc);

// KuGou (unofficial public endpoints, no key): find the song, find its lyric candidate, download.
async function fetchKugouLyrics(title, artist) {
  const query = `${cleanQueryText(title)} ${cleanQueryText(artist)}`.trim();
  if (!query) return null;

  const search = await getJson(
    `https://mobiles.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(query)}&page=1&pagesize=8&showtype=1`
  );
  const infos = search && search.data && search.data.info;
  const song = pickSong(
    (infos || []).map((i) => ({ ...i, name: i.songname, artists: [{ name: i.singername }] })),
    title, artist
  );
  if (!song || !song.hash) return null;

  const duration = Math.max(0, Number(song.duration) || 0) * 1000;
  const found = await getJson(
    `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(query)}&duration=${duration}&hash=${encodeURIComponent(song.hash)}`
  );
  const candidate = found && Array.isArray(found.candidates) && found.candidates[0];
  if (!candidate || !candidate.id || !candidate.accesskey) return null;

  const dl = await getJson(
    `https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`
  );
  if (!dl || typeof dl.content !== 'string' || !dl.content) return null;
  let text = '';
  try { text = Buffer.from(dl.content, 'base64').toString('utf8').replace(/^\uFEFF/, ''); } catch (_) { return null; }
  const lrc = cleanLrc(text);
  return lrc.length > 0 ? lrc : null;
}

// Musixmatch through its OFFICIAL public API, with the user's own API key. The free plan only returns
// plain, partial lyrics; synced lyrics need a plan that includes them (the call is tried first).
async function fetchMusixmatchLyrics(title, artist, apiKey) {
  if (!apiKey) return null;
  const base = `q_track=${encodeURIComponent(cleanQueryText(title))}&q_artist=${encodeURIComponent(cleanQueryText(artist))}&apikey=${encodeURIComponent(apiKey)}`;
  const sub = await getJson(`https://api.musixmatch.com/ws/1.1/matcher.subtitle.get?${base}&subtitle_format=lrc`);
  const synced = sub && sub.message && sub.message.header && sub.message.header.status_code === 200
    && sub.message.body && sub.message.body.subtitle && sub.message.body.subtitle.subtitle_body;
  if (synced) return cleanLrc(synced);

  const plain = await getJson(`https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?${base}`);
  const body = plain && plain.message && plain.message.header && plain.message.header.status_code === 200
    && plain.message.body && plain.message.body.lyrics && plain.message.body.lyrics.lyrics_body;
  if (!body) return null;
  // Strip the licence footer Musixmatch appends ("*******  This Lyrics is NOT for Commercial use  *******").
  const text = String(body).split(/\n?\*{5,}/)[0].trim();
  return text || null;
}

const SOURCES = ['lrclib', 'netease', 'kugou', 'musixmatch', 'auto'];
const AUTO_ORDER = ['lrclib', 'netease', 'kugou', 'musixmatch'];

// source: one of SOURCES. 'lrclib' (default) only ever talks to LRCLIB.
// 'auto' walks AUTO_ORDER and stops at the first synced result, otherwise returns the best plain one.
async function fetchLyricsBySource(source, title, artist, fetchLrclib, options = {}) {
  const run = {
    lrclib: () => fetchLrclib(title, artist),
    netease: () => fetchNeteaseLyrics(title, artist),
    kugou: () => fetchKugouLyrics(title, artist),
    musixmatch: () => fetchMusixmatchLyrics(title, artist, options.musixmatchKey),
  };
  if (source !== 'auto') return (run[source] ? await run[source]() : await run.lrclib()) || '';
  let plain = '';
  for (const name of AUTO_ORDER) {
    if (name === 'musixmatch' && !options.musixmatchKey) continue;
    let out = null;
    try { out = await run[name](); } catch (_) {}
    if (hasTimestamps(out)) return out;
    if (!plain && out && out.trim()) plain = out;
  }
  return plain;
}

function normalizeSource(value) {
  return SOURCES.includes(value) ? value : 'lrclib';
}

module.exports = { fetchNeteaseLyrics, fetchKugouLyrics, fetchMusixmatchLyrics, SOURCES, fetchLyricsBySource, normalizeSource, pickSong, cleanLrc, hasTimestamps, normalize };
