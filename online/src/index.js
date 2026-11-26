// Sixty-Four online server (Cloudflare Worker + Durable Objects)
//
//   POST /api/new            -> { code }     make a private game you share with a friend
//   GET  /ws/game/CODE       -> WebSocket    play a game (?token=&name=&pref=w|b|r)
//   GET  /ws/lobby           -> WebSocket    "find a player near me" matchmaking
//   GET  /ws/game/CODE?watch=1 -> WebSocket  watch a game (and chat) without playing
//   GET  /api/status?codes=A,B -> where each of your daily games stands
//   GET  /api/player?pid=      -> your record, head-to-head against everyone, your recent games
//   GET  /api/leaderboard      -> everyone, best rating first
//   GET  /api/game?id=CODE-2   -> one finished game (share links)
//   GET  /api/live             -> games being played right now (to watch)
//
// Every move is checked with chess.js here, and the clocks are kept here, so nobody can cheat
// by editing the page.
import { Chess } from './chess.js';
import { Chess960 } from './chess960.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// the same time controls the app offers: [seconds, increment]
const TCS = [[0, 0], [60, 0], [180, 2], [300, 0], [600, 0], [900, 10], [1800, 0], [86400, 0]];
const DAY = 86400;
const isDaily = tc => tc && tc[0] === DAY; // Daily: a fresh day for every move, play over days
const validVariant = v => v === '960' ? '960' : 'std';
const validTc = tc => Array.isArray(tc) && TCS.some(t => t[0] === tc[0] && t[1] === tc[1]) ? [tc[0], tc[1]] : [600, 0];

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L mix-ups
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Guest';
const cleanToken = s => /^[A-Za-z0-9-]{8,64}$/.test(String(s || '')) ? String(s) : null;
const cleanPid = s => /^[a-f0-9]{12}$/.test(String(s || '')) ? String(s) : null;
// a player's public id: a hash of their secret token, so it can be shown without letting anyone take their seat
async function pidOf(token) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sixtyfour:' + token));
  return Array.from(new Uint8Array(h).slice(0, 6), b => b.toString(16).padStart(2, '0')).join('');
}
const stats = env => env.STATS.get(env.STATS.idFromName('global'));

async function createGame(env, opts) {
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    const res = await env.GAME.get(env.GAME.idFromName(code)).fetch('https://game/init', { method: 'POST', body: JSON.stringify({ ...opts, code }) });
    if (res.ok) return code;
  }
  throw new Error('Could not make a game code');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = url.pathname.replace(/\/+$/, '');
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';

    if (path === '' || path === '/') return new Response('Sixty-Four online server is running.', { headers: CORS });

    if (path === '/api/new' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) { /* defaults */ }
      const code = await createGame(env, { tc: validTc(body.tc), variant: validVariant(body.variant), reserved: null });
      return json({ code });
    }

    if (path === '/ws/lobby') {
      if (!upgrade) return new Response('Expected a WebSocket', { status: 426 });
      const cf = request.cf || {};
      // Cloudflare tells us roughly where the player is (city level). Local testing with DEV=1 may pass ?lat=&lon= instead.
      const fake = env.DEV === '1' && url.searchParams.has('lat');
      const lat = fake ? url.searchParams.get('lat') : cf.latitude;
      const lon = fake ? url.searchParams.get('lon') : cf.longitude;
      const u = new URL('https://lobby/ws');
      u.searchParams.set('lat', String(parseFloat(lat) || 0));
      u.searchParams.set('lon', String(parseFloat(lon) || 0));
      u.searchParams.set('known', lat != null && lat !== '' && !isNaN(parseFloat(lat)) ? '1' : '0');
      u.searchParams.set('cc', String(cf.country || '').slice(0, 2));
      return env.LOBBY.get(env.LOBBY.idFromName('global')).fetch(new Request(u, request));
    }

    if (request.method === 'GET' && path === '/api/status') {
      const codes = [...new Set(String(url.searchParams.get('codes') || '').split(',').map(cleanCode).filter(c => c.length >= 4))].slice(0, 25);
      const out = await Promise.all(codes.map(async code => {
        try { const r = await env.GAME.get(env.GAME.idFromName(code)).fetch('https://game/status'); return r.ok ? await r.json() : { code, gone: true }; } catch (e) { return { code, error: true }; }
      }));
      return json({ games: out });
    }
    if (request.method === 'GET' && ['/api/player', '/api/leaderboard', '/api/game', '/api/live'].includes(path)) {
      const r = await stats(env).fetch('https://stats' + path.slice(4) + url.search);
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    const m = path.match(/^\/ws\/game\/([A-Za-z0-9]+)$/);
    if (m) {
      if (!upgrade) return new Response('Expected a WebSocket', { status: 426 });
      const code = cleanCode(m[1]);
      return env.GAME.get(env.GAME.idFromName(code)).fetch(request);
    }

    return json({ error: 'Not found' }, 404);
  }
};

/* ------------------------------------------------------------------ */
/* Game: one per code                                                  */
/* ------------------------------------------------------------------ */
const ABANDON_MS = 60_000;      // a player who leaves a started game for this long loses
const EXPIRE_MS = 24 * 3600_000; // old games are cleaned up after a day of nothing happening
const other = c => c === 'w' ? 'b' : 'w';

function canMate(fen, color) {
  let minors = 0;
  const board = fen.split(' ')[0];
  for (const ch of board) {
    if (!/[pnbrqPNBRQ]/.test(ch) || (ch === ch.toUpperCase()) !== (color === 'w')) continue;
    const t = ch.toLowerCase();
    if (t === 'p' || t === 'r' || t === 'q') return true;
    minors++;
  }
  if (minors >= 2) return true;
  if (minors === 1) return board.replace(/[^a-zA-Z]/g, '').split('').some(ch => (ch === ch.toUpperCase()) !== (color === 'w') && ch.toLowerCase() !== 'k');
  return false;
}

export class Game {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.g = undefined; }

  async load() { if (this.g === undefined) this.g = (await this.ctx.storage.get('g')) || null; return this.g; }
  async save() { this.g.touched = Date.now(); await this.ctx.storage.put('g', this.g); await this.schedule(); await this.report(); }
  // tell the stats server when a game starts (so friends can watch it) and when it ends (records, ratings, saved games)
  async report() {
    const g = this.g;
    if (!g || !this.env.STATS) return;
    const both = g.seats.w && g.seats.b, key = g.code + '-' + g.round;
    const who = c => ({ pid: g.seats[c].pid, name: g.seats[c].name });
    try {
      if (both && !g.over && g.liveKey !== key) {
        g.liveKey = key;
        await this.ctx.storage.put('g', g);
        await stats(this.env).fetch('https://stats/live', { method: 'POST', body: JSON.stringify({ on: true, code: g.code, round: g.round, w: who('w'), b: who('b'), tc: g.tc, variant: g.variant || 'std' }) });
      }
      if (both && g.over && g.reportedKey !== key) {
        g.reportedKey = key;
        await this.ctx.storage.put('g', g);
        await stats(this.env).fetch('https://stats/live', { method: 'POST', body: JSON.stringify({ on: false, code: g.code }) });
        if (g.over.result !== '*' && g.moves.length >= 2) {
          await stats(this.env).fetch('https://stats/record', { method: 'POST', body: JSON.stringify({ id: key, w: who('w'), b: who('b'), result: g.over.result, reason: g.over.reason, tc: g.tc, variant: g.variant || 'std', startFen: g.startFen || null, moves: g.moves, ended: Date.now() }) });
        }
      }
    } catch (e) { /* the stats server is optional: games still work without it */ }
  }

  // Fischer random gets a new random starting position every game
  newStart(g) {
    if (g.variant === '960') { g.n960 = Chess960.random(); g.startFen = Chess960.startFen(g.n960); }
    else { g.n960 = null; g.startFen = null; }
  }
  // rebuilding a game from its moves is slow, so keep the current one in memory
  chessOf(g) {
    const k = this.cache;
    if (k && k.round === g.round && k.code === g.code && k.chess.history().length === g.moves.length) return k.chess;
    const c = g.startFen ? new Chess960(g.startFen) : new Chess();
    for (const u of g.moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
    this.cache = { round: g.round, code: g.code, chess: c };
    return c;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      if (await this.load()) return new Response('taken', { status: 409 });
      const o = await request.json();
      const base = o.tc[0] * 1000;
      this.g = {
        code: o.code, tc: o.tc, daily: isDaily(o.tc), variant: validVariant(o.variant), reserved: o.reserved || null, round: 1,
        seats: { w: null, b: null }, moves: [], over: null, drawOffer: null, rematch: { w: false, b: false },
        clock: { w: base, b: base, running: null, since: 0 }, gone: { w: null, b: null }, created: Date.now()
      };
      this.newStart(this.g);
      if (o.reserved) for (const c of ['w', 'b']) this.g.seats[c] = { token: o.reserved[c].token, pid: await pidOf(o.reserved[c].token), id: crypto.randomUUID().slice(0, 8), name: cleanName(o.reserved[c].name), info: o.reserved[c].info || '' };
      await this.save();
      return new Response('ok');
    }

    // a quick look at the game for the daily-games list
    if (url.pathname === '/status') {
      const g = await this.load();
      if (!g) return new Response('none', { status: 404 });
      this.checkClock(g);
      const c = this.clockNow(g), turn = g.moves.length % 2 === (g.startFen && g.startFen.split(' ')[1] === 'b' ? 1 : 0) ? 'w' : 'b';
      return new Response(JSON.stringify({
        code: g.code, round: g.round, tc: g.tc, ply: g.moves.length, turn, over: g.over,
        players: { w: g.seats.w ? { name: g.seats.w.name, pid: g.seats.w.pid } : null, b: g.seats.b ? { name: g.seats.b.name, pid: g.seats.b.pid } : null },
        left: g.tc[0] && c.running ? c[c.running] : null, running: c.running
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // WebSocket join
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const g = await this.load();
    const fail = msg => { server.send(JSON.stringify({ t: 'error', msg })); server.close(4000, 'nope'); return new Response(null, { status: 101, webSocket: client }); };
    if (!g) return fail('No game with that code. Check the code and try again.');
    const token = cleanToken(url.searchParams.get('token'));
    if (!token) return fail('Bad request.');
    let color = ['w', 'b'].find(c => g.seats[c] && g.seats[c].token === token);
    // watching: no seat, but you see the game and the chat
    if (!color && url.searchParams.get('watch') === '1') {
      server.serializeAttachment({ token, watch: true, name: cleanName(url.searchParams.get('name')) });
      server.send(JSON.stringify(this.stateFor(null)));
      server.send(JSON.stringify({ t: 'chatlog', chat: g.chat || [] }));
      this.broadcast();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!color) {
      if (g.reserved) return fail('That game is already taken.');
      const free = ['w', 'b'].filter(c => !g.seats[c]);
      if (!free.length) return fail('That game already has two players.');
      if (free.length === 2) { const pref = url.searchParams.get('pref'); color = pref === 'w' || pref === 'b' ? pref : (Math.random() < 0.5 ? 'w' : 'b'); }
      else color = free[0];
      g.seats[color] = { token, pid: await pidOf(token), id: crypto.randomUUID().slice(0, 8), name: cleanName(url.searchParams.get('name')), info: '' };
    } else if (url.searchParams.get('name')) {
      g.seats[color].name = cleanName(url.searchParams.get('name'));
    }
    if (!g.seats[color].id) g.seats[color].id = crypto.randomUUID().slice(0, 8);
    if (!g.seats[color].pid) g.seats[color].pid = await pidOf(token);
    server.serializeAttachment({ token });
    g.gone[color] = null;
    this.checkClock(g);
    await this.save();
    this.broadcast();
    server.send(JSON.stringify({ t: 'chatlog', chat: g.chat || [] }));
    return new Response(null, { status: 101, webSocket: client });
  }

  colorOf(ws) {
    const a = ws.deserializeAttachment();
    if (!a || !this.g) return null;
    return ['w', 'b'].find(c => this.g.seats[c] && this.g.seats[c].token === a.token) || null;
  }
  online(color) {
    const s = this.g.seats[color];
    return !!s && this.ctx.getWebSockets().some(ws => { const a = ws.deserializeAttachment(); return a && a.token === s.token && ws.readyState === 1; });
  }

  // how much time each side has right now
  clockNow(g, now = Date.now()) {
    const c = { w: g.clock.w, b: g.clock.b, running: g.clock.running };
    if (g.tc[0] && c.running && !g.over) c[c.running] = Math.max(0, c[c.running] - (now - g.clock.since));
    return c;
  }
  end(g, result, reason, extra = {}) {
    if (g.over) return;
    if (g.tc[0]) { const c = this.clockNow(g); g.clock.w = c.w; g.clock.b = c.b; }
    g.clock.running = null;
    g.over = { result, reason, ...extra };
    g.drawOffer = null;
    g.rematch = { w: false, b: false };
  }
  checkClock(g) {
    if (g.over || !g.tc[0] || !g.clock.running) return;
    const c = this.clockNow(g), loser = c.running;
    if (c[loser] > 0) return;
    g.clock[loser] = 0;
    const winner = other(loser);
    if (canMate(this.chessOf(g).fen(), winner)) this.end(g, winner === 'w' ? '1-0' : '0-1', 'time', { loser });
    else this.end(g, '1/2-1/2', 'time-draw', { loser });
  }
  checkGone(g, now = Date.now()) {
    if (g.over || isDaily(g.tc)) return; // daily games are meant to be left and come back to
    for (const c of ['w', 'b']) {
      if (!g.gone[c] || now - g.gone[c] < ABANDON_MS) continue;
      if (g.moves.length < 2) this.end(g, '*', 'aborted', { loser: c });
      else this.end(g, c === 'w' ? '0-1' : '1-0', 'abandoned', { loser: c });
    }
  }
  async schedule() {
    const g = this.g, now = Date.now();
    let at = (g.touched || now) + (isDaily(g.tc) ? 8 * EXPIRE_MS : EXPIRE_MS);
    if (!g.over) {
      if (g.tc[0] && g.clock.running) at = Math.min(at, g.clock.since + g.clock[g.clock.running] + 50);
      for (const c of ['w', 'b']) if (g.gone[c]) at = Math.min(at, g.gone[c] + ABANDON_MS + 50);
    }
    await this.ctx.storage.setAlarm(Math.max(at, now + 50));
  }
  async alarm() {
    const g = await this.load();
    if (!g) return;
    const now = Date.now();
    if (now - (g.touched || 0) >= (isDaily(g.tc) ? 8 * EXPIRE_MS : EXPIRE_MS) && !this.ctx.getWebSockets().length) { await this.ctx.storage.deleteAll(); this.g = null; return; }
    const was = JSON.stringify(g.over);
    this.checkClock(g); this.checkGone(g, now);
    if (JSON.stringify(g.over) !== was) { await this.save(); this.broadcast(); }
    else await this.schedule();
  }

  stateFor(color) {
    const g = this.g, now = Date.now();
    const pl = c => g.seats[c] ? { id: g.seats[c].id, pid: g.seats[c].pid || null, name: g.seats[c].name, online: this.online(c), info: g.seats[c].info || '', away: !!g.gone[c] } : null;
    const watchers = this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && (ws.deserializeAttachment() || {}).watch).length;
    return {
      t: 'state', code: g.code, you: color, round: g.round, tc: g.tc, variant: g.variant || 'std', startFen: g.startFen || null, n960: g.n960 ?? null, players: { w: pl('w'), b: pl('b') },
      moves: g.moves, over: g.over, drawOffer: g.drawOffer, rematch: g.rematch,
      clock: { ...this.clockNow(g, now) }, abandonMs: isDaily(g.tc) ? 0 : ABANDON_MS, watching: color === null, watchers
    };
  }
  broadcast() {
    if (!this.g) return;
    for (const ws of this.ctx.getWebSockets()) {
      const c = this.colorOf(ws);
      try { ws.send(JSON.stringify(this.stateFor(c))); } catch (e) { /* closed */ }
    }
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    const g = await this.load();
    if (!g) return;
    const color = this.colorOf(ws);
    const att = ws.deserializeAttachment() || {};
    if (!color && !att.watch) return;
    if (m.t === 'chat') {
      const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      const now = Date.now();
      this.spam = this.spam || {};
      const who = color || 'watch:' + att.token;
      const seen = this.spam[who] = (this.spam[who] || []).filter(t => now - t < 10_000); // at most 6 messages per 10 seconds
      if (seen.length >= 6) { ws.send(JSON.stringify({ t: 'reject', msg: 'Slow down, you are sending messages too fast.' })); return; }
      seen.push(now);
      const msg = color ? { id: g.seats[color].id, name: g.seats[color].name, text, ts: now } : { id: 'w-' + att.token.slice(0, 6), name: att.name, watcher: true, text, ts: now };
      g.chat = (g.chat || []).concat(msg).slice(-60);
      await this.ctx.storage.put('g', g);
      const out = JSON.stringify({ t: 'chat', msg });
      for (const s of this.ctx.getWebSockets()) { try { s.send(out); } catch (e) { /* closed */ } }
      return;
    }
    if (!color) return; // watchers can only chat
    const opp = other(color), both = g.seats.w && g.seats.b;
    this.checkClock(g);
    const reject = msg => { ws.send(JSON.stringify({ t: 'reject', msg })); ws.send(JSON.stringify(this.stateFor(color))); };

    if (m.t === 'move') {
      if (g.over) return reject('The game is over.');
      if (!both) return reject('Wait for your opponent to join.');
      if (m.ply !== g.moves.length) return reject('Out of sync.');
      const chess = this.chessOf(g);
      if (chess.turn() !== color) return reject('Not your turn.');
      const u = String(m.uci || '');
      const mv = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u) ? chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }) : null;
      if (!mv) return reject('Illegal move.');
      const now = Date.now();
      g.moves.push(mv.from + mv.to + (mv.promotion || ''));
      if (g.tc[0]) {
        if (g.clock.running === color) { g.clock[color] = Math.max(0, g.clock[color] - (now - g.clock.since)) + g.tc[1] * 1000; }
        if (isDaily(g.tc)) g.clock[opp] = DAY * 1000; // daily: every move gets a fresh day
        // clocks start once White has moved
        g.clock.running = opp; g.clock.since = now;
      }
      if (g.drawOffer === opp) g.drawOffer = null;
      if (chess.in_checkmate()) this.end(g, color === 'w' ? '1-0' : '0-1', 'checkmate');
      else if (chess.in_stalemate()) this.end(g, '1/2-1/2', 'stalemate');
      else if (chess.in_threefold_repetition()) this.end(g, '1/2-1/2', 'repetition');
      else if (chess.insufficient_material()) this.end(g, '1/2-1/2', 'material');
      else if (chess.in_draw()) this.end(g, '1/2-1/2', 'fifty');
    } else if (m.t === 'resign') {
      if (g.over || !both) return;
      if (g.moves.length < 2) this.end(g, '*', 'aborted', { loser: color });
      else this.end(g, color === 'w' ? '0-1' : '1-0', 'resign', { loser: color });
    } else if (m.t === 'draw') {
      if (g.over || !both || g.moves.length < 2) return;
      if (g.drawOffer === opp) this.end(g, '1/2-1/2', 'agreed');
      else g.drawOffer = color;
    } else if (m.t === 'decline') {
      if (g.drawOffer === opp) g.drawOffer = null;
    } else if (m.t === 'rematch') {
      if (!g.over || !both) return;
      g.rematch[color] = true;
      if (g.rematch[opp]) {
        const base = g.tc[0] * 1000;
        g.seats = { w: g.seats.b, b: g.seats.w }; // swap colours
        g.gone = { w: g.gone.b, b: g.gone.w };
        g.moves = []; g.over = null; g.drawOffer = null; g.rematch = { w: false, b: false }; g.round++;
        g.clock = { w: base, b: base, running: null, since: 0 };
        this.newStart(g);
      }
    } else if (m.t === 'cancelRematch') {
      g.rematch[color] = false;
    } else return;
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    const g = await this.load();
    if (!g) return;
    const color = this.colorOf(ws);
    if (color && !this.online(color)) {
      if (!g.seats[other(color)] && !g.moves.length) { /* host left before anyone joined: keep the seat for a reconnect */ }
      if (!g.over) g.gone[color] = Date.now();
      await this.save();
    }
    this.broadcast();
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}

/* ------------------------------------------------------------------ */
/* Lobby: pairs people who are searching, nearest first                */
/* ------------------------------------------------------------------ */
function km(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// how far we look for an opponent grows the longer you wait: 100 km, then 200, 400, ... then anyone
const radiusFor = waitedMs => waitedMs > 30_000 ? Infinity : 100 * Math.pow(2, waitedMs / 4000);
function placeHint(me, them, d) {
  if (!me.known || !them.known) return them.cc ? `from ${them.cc}` : '';
  if (d < 50) return 'near you';
  if (d < 300) return `about ${Math.round(d / 10) * 10} km away`;
  if (me.cc && me.cc === them.cc) return `${Math.round(d / 100) * 100} km away`;
  return `${them.cc ? 'from ' + them.cc + ', ' : ''}${Math.round(d / 100) * 100} km away`;
}

export class Lobby {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.busy = false; }

  async fetch(request) {
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      lat: +url.searchParams.get('lat') || 0, lon: +url.searchParams.get('lon') || 0,
      known: url.searchParams.get('known') === '1', cc: (url.searchParams.get('cc') || '').toUpperCase(), searching: false
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  waiting() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && (ws.deserializeAttachment() || {}).searching); }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const a = ws.deserializeAttachment() || {};
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (m.t === 'search') {
      const token = cleanToken(m.token);
      if (!token) return;
      // the same person searching from two tabs only keeps the newest search
      for (const o of this.waiting()) if (o !== ws && o.deserializeAttachment().token === token) { const oa = o.deserializeAttachment(); oa.searching = false; o.serializeAttachment(oa); try { o.send('{"t":"cancelled"}'); } catch (e) { } }
      Object.assign(a, { searching: true, token, name: cleanName(m.name), tc: validTc(m.tc).join('+') + '|' + validVariant(m.variant), since: Date.now() });
      ws.serializeAttachment(a);
      ws.send(JSON.stringify({ t: 'searching', waiting: this.waiting().length - 1 }));
      await this.match();
    } else if (m.t === 'cancel') {
      a.searching = false; ws.serializeAttachment(a);
    }
  }

  async match() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const list = this.waiting().map(ws => ({ ws, a: ws.deserializeAttachment() })).sort((x, y) => x.a.since - y.a.since);
      const used = new Set();
      for (const x of list) {
        if (used.has(x.ws)) continue;
        let best = null, bestD = Infinity;
        for (const y of list) {
          if (y === x || used.has(y.ws) || y.a.tc !== x.a.tc || y.a.token === x.a.token) continue;
          const d = x.a.known && y.a.known ? km(x.a, y.a) : 20000;
          if (d < bestD) { best = y; bestD = d; }
        }
        if (!best) continue;
        const reach = Math.max(radiusFor(now - x.a.since), radiusFor(now - best.a.since));
        if (bestD > reach) continue;
        used.add(x.ws); used.add(best.ws);
        for (const p of [x, best]) { p.a.searching = false; p.ws.serializeAttachment(p.a); }
        const [w, b] = Math.random() < 0.5 ? [x, best] : [best, x];
        const [tcStr, variant] = w.a.tc.split('|');
        const tc = tcStr.split('+').map(Number);
        try {
          const code = await createGame(this.env, {
            tc, variant,
            reserved: {
              w: { token: w.a.token, name: w.a.name, info: placeHint(b.a, w.a, bestD) },
              b: { token: b.a.token, name: b.a.name, info: placeHint(w.a, b.a, bestD) }
            }
          });
          w.ws.send(JSON.stringify({ t: 'matched', code, color: 'w' }));
          b.ws.send(JSON.stringify({ t: 'matched', code, color: 'b' }));
        } catch (e) {
          for (const p of [x, best]) { try { p.ws.send(JSON.stringify({ t: 'error', msg: 'Matchmaking hiccup, searching again…' })); } catch (er) { } p.a.searching = true; p.ws.serializeAttachment(p.a); }
        }
      }
    } finally { this.busy = false; }
    const left = this.waiting();
    for (const ws of left) { try { ws.send(JSON.stringify({ t: 'searching', waiting: left.length - 1 })); } catch (e) { } }
    if (left.length > 1) await this.ctx.storage.setAlarm(Date.now() + 2000);
  }
  async alarm() { await this.match(); }

  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch (e) { } }
  async webSocketError(ws) { try { ws.close(1011, 'err'); } catch (e) { } }
}

/* ------------------------------------------------------------------ */
/* Stats: records, ratings, head-to-head, saved games, live games      */
/* ------------------------------------------------------------------ */
const K = 32;
export class Stats {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (pid TEXT PRIMARY KEY, name TEXT, rating REAL DEFAULT 1200, w INTEGER DEFAULT 0, l INTEGER DEFAULT 0, d INTEGER DEFAULT 0, last INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, wpid TEXT, bpid TEXT, wname TEXT, bname TEXT, result TEXT, reason TEXT, tc TEXT, variant TEXT, startfen TEXT, moves TEXT, ended INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS gw ON games (wpid, ended)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS gb ON games (bpid, ended)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS live (code TEXT PRIMARY KEY, data TEXT, since INTEGER)`);
  }
  one(q, ...a) { const r = this.sql.exec(q, ...a).toArray(); return r[0] || null; }
  all(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  player(pid, name) {
    const now = Date.now();
    this.sql.exec(`INSERT INTO players (pid, name, last) VALUES (?, ?, ?) ON CONFLICT(pid) DO UPDATE SET name = excluded.name, last = excluded.last`, pid, cleanName(name), now);
    return this.one(`SELECT * FROM players WHERE pid = ?`, pid);
  }
  gameOut(r) {
    return { id: r.id, w: { pid: r.wpid, name: r.wname }, b: { pid: r.bpid, name: r.bname }, result: r.result, reason: r.reason, tc: JSON.parse(r.tc || '[0,0]'), variant: r.variant, startFen: r.startfen || null, moves: (r.moves || '').split(' ').filter(Boolean), ended: r.ended };
  }
  async fetch(request) {
    const url = new URL(request.url), p = url.pathname, q = url.searchParams;
    const out = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: { 'Content-Type': 'application/json' } });
    if (request.method === 'POST' && p === '/record') {
      const g = await request.json();
      const wp = cleanPid(g.w && g.w.pid), bp = cleanPid(g.b && g.b.pid);
      if (!wp || !bp || wp === bp || !/^[A-Z0-9]{4,8}-\d+$/.test(String(g.id))) return out({ ok: false }, 400);
      if (this.one(`SELECT id FROM games WHERE id = ?`, g.id)) return out({ ok: true, dup: true });
      const W = this.player(wp, g.w.name), B = this.player(bp, g.b.name);
      const sw = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
      const ew = 1 / (1 + Math.pow(10, (B.rating - W.rating) / 400));
      const dw = K * (sw - ew);
      const col = s => s === 1 ? 'w' : s === 0 ? 'l' : 'd';
      this.sql.exec(`UPDATE players SET rating = rating + ?, ${col(sw)} = ${col(sw)} + 1 WHERE pid = ?`, dw, wp);
      this.sql.exec(`UPDATE players SET rating = rating - ?, ${col(1 - sw)} = ${col(1 - sw)} + 1 WHERE pid = ?`, dw, bp);
      this.sql.exec(`INSERT INTO games (id, wpid, bpid, wname, bname, result, reason, tc, variant, startfen, moves, ended) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        g.id, wp, bp, cleanName(g.w.name), cleanName(g.b.name), String(g.result), String(g.reason || ''), JSON.stringify(g.tc || [0, 0]), g.variant === '960' ? '960' : 'std', g.startFen || null, (g.moves || []).filter(u => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)).join(' '), +g.ended || Date.now());
      return out({ ok: true });
    }
    if (request.method === 'POST' && p === '/live') {
      const d = await request.json(), code = cleanCode(d.code);
      if (!code) return out({ ok: false }, 400);
      if (d.on) this.sql.exec(`INSERT OR REPLACE INTO live (code, data, since) VALUES (?, ?, ?)`, code, JSON.stringify({ code, round: d.round, w: d.w, b: d.b, tc: d.tc, variant: d.variant }), Date.now());
      else this.sql.exec(`DELETE FROM live WHERE code = ?`, code);
      return out({ ok: true });
    }
    if (p === '/live') {
      // fast games that never reported an end are dropped after 3 hours, daily ones after 9 days
      this.sql.exec(`DELETE FROM live WHERE since < ? AND data NOT LIKE '%[86400,%'`, Date.now() - 3 * 3600_000);
      this.sql.exec(`DELETE FROM live WHERE since < ?`, Date.now() - 9 * 86400_000);
      return out({ games: this.all(`SELECT data, since FROM live ORDER BY since DESC LIMIT 40`).map(r => ({ ...JSON.parse(r.data), since: r.since })) });
    }
    if (p === '/leaderboard') {
      return out({ players: this.all(`SELECT pid, name, rating, w, l, d, last FROM players WHERE w + l + d > 0 ORDER BY rating DESC LIMIT 100`).map(r => ({ ...r, rating: Math.round(r.rating) })) });
    }
    if (p === '/player') {
      const pid = cleanPid(q.get('pid'));
      if (!pid) return out({ error: 'bad id' }, 400);
      const me = this.one(`SELECT pid, name, rating, w, l, d FROM players WHERE pid = ?`, pid);
      const rows = this.all(`SELECT * FROM games WHERE wpid = ? OR bpid = ? ORDER BY ended DESC LIMIT 400`, pid, pid);
      const h = {};
      for (const r of rows) {
        const white = r.wpid === pid, op = white ? r.bpid : r.wpid, opName = white ? r.bname : r.wname;
        const o = h[op] || (h[op] = { pid: op, name: opName, w: 0, l: 0, d: 0, last: r.ended, streak: 0, streakDone: false });
        const res = r.result === '1/2-1/2' ? 'd' : (r.result === '1-0') === white ? 'w' : 'l';
        o[res]++;
        // rows are newest first: count how many in a row you've won (or lost) against them
        if (!o.streakDone) { if (o.streak === 0) { o.streakRes = res; o.streak = 1; } else if (o.streakRes === res) o.streak++; else o.streakDone = true; }
      }
      const opponents = Object.values(h).map(o => { const rr = this.one(`SELECT name, rating FROM players WHERE pid = ?`, o.pid); return { pid: o.pid, name: rr ? rr.name : o.name, rating: rr ? Math.round(rr.rating) : null, w: o.w, l: o.l, d: o.d, last: o.last, streak: o.streakRes === 'd' ? 0 : o.streak, streakRes: o.streakRes }; }).sort((a, b) => b.last - a.last);
      return out({ me: me ? { ...me, rating: Math.round(me.rating) } : null, opponents, games: rows.slice(0, 50).map(r => this.gameOut(r)) });
    }
    if (p === '/game') {
      const id = String(q.get('id') || '').toUpperCase();
      const r = /^[A-Z0-9]{4,8}-\d+$/.test(id) ? this.one(`SELECT * FROM games WHERE id = ?`, id) : null;
      return r ? out({ game: this.gameOut(r) }) : out({ error: 'not found' }, 404);
    }
    return out({ error: 'not found' }, 404);
  }
}
