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

// source: 'lrclib' (default, LRCLIB only), 'netease' (NetEase only),
//         'auto' (LRCLIB first, NetEase when LRCLIB has no synced lyrics).
async function fetchLyricsBySource(source, title, artist, fetchLrclib) {
  if (source === 'netease') return (await fetchNeteaseLyrics(title, artist)) || '';
  const first = await fetchLrclib(title, artist);
  if (source !== 'auto' || hasTimestamps(first)) return first;
  const second = await fetchNeteaseLyrics(title, artist);
  if (hasTimestamps(second)) return second;
  return first || second || '';
}

function normalizeSource(value) {
  return value === 'netease' || value === 'auto' ? value : 'lrclib';
}

module.exports = { fetchNeteaseLyrics, fetchLyricsBySource, normalizeSource, pickSong, cleanLrc, hasTimestamps, normalize };
