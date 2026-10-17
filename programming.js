(function (global) {
'use strict';
const SLOTS = [390, 720, 1110]; // 06:30, 12:00 e 18:30, em São Paulo.
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
function local(now = Date.now()) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, day: Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000),
    seconds: +p.hour * 3600 + +p.minute * 60 + +p.second };
}
function create(music, podcasts, random = Math.random, weekly = []) {
  if (!music.length || !podcasts.length) throw new Error('Programação vazia');
  let queue = [], history = [], cursor = -1, last = null;
  const seen = new Set();
  function fill(count) {
    while (queue.length < count) {
      const bag = music.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      const before = queue.length ? queue[queue.length - 1] : last;
      if (bag.length > 1 && bag[0] === before) [bag[0], bag[1]] = [bag[1], bag[0]];
      queue.push(...bag);
    }
  }
  function next() {
    if (cursor + 1 < history.length) return history[++cursor];
    fill(1);
    const index = queue.shift(); last = index;
    history.push(index);
    if (history.length > 100) history.shift();
    cursor = history.length - 1;
    return index;
  }
  function peek(distance = 1) {
    const future = history.length - cursor - 1;
    if (distance <= future) return history[cursor + distance];
    fill(distance - future);
    return queue[distance - future - 1];
  }
  function previous(fromPodcast = false) {
    if (fromPodcast) return history[Math.max(0, cursor)];
    if (cursor > 0) cursor--;
    return history[Math.max(0, cursor)];
  }
  function daily(now = Date.now()) {
    const date = local(now);
    const anchor = Math.floor(Date.UTC(2026, 9, 13) / 86400000);
    const ordinal = ((date.day - anchor) % podcasts.length + podcasts.length) % podcasts.length;
    return { ...podcasts[ordinal], date: date.date };
  }
  function slot(now = Date.now()) {
    const date = local(now), podcast = daily(now);
    const weekday = ((date.day + 4) % 7 + 7) % 7;
    for (const track of weekly) {
      const offset = date.seconds - track.minute * 60;
      if (weekday === track.weekday && offset >= 0 && offset < track.duration) {
        return { ...track, key: `${date.date}:weekly:${track.index}:${track.minute}`, offset };
      }
    }
    for (const minute of SLOTS) {
      const offset = date.seconds - minute * 60;
      if (offset >= 0 && offset < podcast.duration) return { ...podcast, key: `${date.date}:${minute}`, offset, minute };
    }
    return null;
  }
  function claim(value) {
    if (!value || seen.has(value.key)) return false;
    seen.add(value.key);
    if (seen.size > 12) seen.delete(seen.values().next().value);
    return true;
  }
  function upcoming(now = Date.now()) {
    const date = local(now), podcast = daily(now);
    const weekday = ((date.day + 4) % 7 + 7) % 7;
    const candidates = SLOTS.map(minute => ({...podcast, minute})).concat(weekly.filter(track => track.weekday === weekday));
    const next = candidates.filter(track => track.minute * 60 > date.seconds).sort((a, b) => a.minute - b.minute)[0];
    return next ? {...next, inSeconds: next.minute * 60 - date.seconds} : null;
  }
  return { next, peek, previous, daily, slot, claim, upcoming };
}
const api = { create, local, SLOTS };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.RadioProgramming = api;
})(typeof window === 'object' ? window : globalThis);

