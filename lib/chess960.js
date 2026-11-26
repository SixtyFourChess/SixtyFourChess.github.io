// Fischer random (Chess960) on top of chess.js 0.10.3, with the same API the app uses.
// Castling is written as the king moving onto its own rook (from: king square, to: rook square).
// FEN castling rights use rook files (Shredder-FEN, e.g. "HAha"), so a FEN alone says it is a 960 game.
function makeChess960(Chess) {
  const FILES = 'abcdefgh';
  const fileIdx = sq => FILES.indexOf(sq[0]);
  function toMap(pl) {
    const m = {}, rows = pl.split('/');
    for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[r] || '') { if (ch >= '1' && ch <= '8') f += +ch; else { m[FILES[f] + (8 - r)] = ch; f++; } } }
    return m;
  }
  function fromMap(m) {
    let s = '';
    for (let r = 8; r >= 1; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) { const p = m[FILES[f] + r]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; }
      if (e) s += e;
      if (r > 1) s += '/';
    }
    return s;
  }
  const kingFile = (m, c) => { const rk = c === 'w' ? 1 : 8; for (let f = 0; f < 8; f++) if (m[FILES[f] + rk] === (c === 'w' ? 'K' : 'k')) return f; return -1; };
  function parseRights(str, m) {
    const R = { w: { k: null, q: null }, b: { k: null, q: null } };
    if (!str || str === '-') return R;
    for (const ch of str) {
      const c = ch === ch.toUpperCase() ? 'w' : 'b', rk = c === 'w' ? 1 : 8, rook = c === 'w' ? 'R' : 'r', kf = kingFile(m, c);
      if (kf < 0) continue;
      const u = ch.toUpperCase();
      if (u === 'K') { for (let f = 7; f > kf; f--) if (m[FILES[f] + rk] === rook) { R[c].k = FILES[f]; break; } }
      else if (u === 'Q') { for (let f = 0; f < kf; f++) if (m[FILES[f] + rk] === rook) { R[c].q = FILES[f]; break; } }
      else if (u >= 'A' && u <= 'H') { const f = u.charCodeAt(0) - 65; if (m[FILES[f] + rk] === rook) R[c][f > kf ? 'k' : 'q'] = FILES[f]; }
    }
    return R;
  }
  const rightsStr = R => (R.w.k ? R.w.k.toUpperCase() : '') + (R.w.q ? R.w.q.toUpperCase() : '') + (R.b.k || '') + (R.b.q || '') || '-';

  class Chess960 {
    constructor(fen) { this._hist = []; this._load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1'); }
    _load(fen) {
      const f = String(fen).trim().split(/\s+/);
      this._pl = f[0]; this._turn = f[1] === 'b' ? 'b' : 'w';
      this._rights = parseRights(f[2], toMap(f[0]));
      this._ep = f[3] || '-'; this._half = +f[4] || 0; this._full = +f[5] || 1;
    }
    _stdFen() { return [this._pl, this._turn, '-', this._ep, this._half, this._full].join(' '); }
    _std() { return new Chess(this._stdFen()); }
    fen() { return [this._pl, this._turn, rightsStr(this._rights), this._ep, this._half, this._full].join(' '); }
    _key() { return [this._pl, this._turn, rightsStr(this._rights), this._ep].join(' '); }
    turn() { return this._turn; }
    board() { return this._std().board(); }
    get(sq) { return this._std().get(sq); }
    in_check() { return this._std().in_check(); }
    insufficient_material() { return this._std().insufficient_material(); }
    in_checkmate() { return this.in_check() && this.moves().length === 0; }
    in_stalemate() { return !this.in_check() && this.moves().length === 0; }
    in_threefold_repetition() {
      const k = this._key();
      let n = 1;
      for (const h of this._hist) if (h.key === k) n++;
      return n >= 3;
    }
    in_draw() { return this._half >= 100 || this.in_stalemate() || this.insufficient_material() || this.in_threefold_repetition(); }
    game_over() { return this.in_checkmate() || this.in_draw(); }
    history(o = {}) { return this._hist.map(h => o.verbose ? Object.assign({}, h.move) : h.move.san); }
    remove(sq) { const m = toMap(this._pl), p = m[sq]; if (!p) return null; delete m[sq]; this._pl = fromMap(m); this._rights = parseRights(rightsStr(this._rights), m); return { type: p.toLowerCase(), color: p === p.toUpperCase() ? 'w' : 'b' }; }
    // legal castling moves for the side to move
    _castles() {
      const us = this._turn, rk = us === 'w' ? 1 : 8, m = toMap(this._pl), out = [];
      const kf = kingFile(m, us);
      if (kf < 0 || this.in_check()) return out;
      const kSq = FILES[kf] + rk, them = us === 'w' ? 'b' : 'w';
      for (const side of ['k', 'q']) {
        const rf = this._rights[us][side];
        if (!rf) continue;
        const rSq = rf + rk;
        if (m[rSq] !== (us === 'w' ? 'R' : 'r')) continue;
        const kDest = (side === 'k' ? 'g' : 'c') + rk, rDest = (side === 'k' ? 'f' : 'd') + rk;
        const span = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b), r = []; for (let f = lo; f <= hi; f++) r.push(FILES[f] + rk); return r; };
        const need = new Set([...span(kf, fileIdx(kDest)), ...span(fileIdx(rSq), fileIdx(rDest))]);
        let ok = true;
        for (const s of need) if (m[s] && s !== kSq && s !== rSq) { ok = false; break; }
        if (!ok) continue;
        // the king may not pass through or land on an attacked square
        const step = fileIdx(kDest) > kf ? 1 : -1;
        for (let f = kf + step; ok && f !== fileIdx(kDest) + step && fileIdx(kDest) !== kf; f += step) {
          const t = Object.assign({}, m); delete t[kSq]; if (FILES[f] + rk === rSq) delete t[rSq];
          t[FILES[f] + rk] = us === 'w' ? 'K' : 'k';
          if (new Chess(fromMap(t) + ' ' + us + ' - - 0 1').in_check()) ok = false;
        }
        if (!ok) continue;
        const fin = Object.assign({}, m); delete fin[kSq]; delete fin[rSq];
        fin[kDest] = us === 'w' ? 'K' : 'k'; fin[rDest] = us === 'w' ? 'R' : 'r';
        if (new Chess(fromMap(fin) + ' ' + us + ' - - 0 1').in_check()) continue;
        const after = new Chess(fromMap(fin) + ' ' + them + ' - - 0 1');
        const san = (side === 'k' ? 'O-O' : 'O-O-O') + (after.in_checkmate() ? '#' : after.in_check() ? '+' : '');
        out.push({ color: us, from: kSq, to: rSq, flags: side, piece: 'k', san, rook: rSq, castle: { side, kDest, rDest, pl: fromMap(fin) } });
      }
      return out;
    }
    moves(o = {}) {
      const c = this._std();
      let list = o.square ? c.moves({ square: o.square, verbose: true }) : c.moves({ verbose: true });
      let cs = this._castles();
      if (o.square) cs = cs.filter(x => x.from === o.square);
      if (o.square && o.verbose) { // let the player also drop the king on g1/c1 when that square isn't a normal king move
        for (const x of cs.slice()) if (x.castle.kDest !== x.from && x.castle.kDest !== x.to && !list.some(y => y.to === x.castle.kDest)) cs.push(Object.assign({}, x, { to: x.castle.kDest, alias: true }));
      }
      list = list.concat(cs.map(x => { const y = Object.assign({}, x); delete y.castle; return y; }));
      return o.verbose ? list : list.filter(x => !x.alias).map(x => x.san);
    }
    move(mv) {
      const us = this._turn, them = us === 'w' ? 'b' : 'w', before = this.fen(), key = this._key();
      // only work out castling when the move could be one (it's the slow part)
      const kSq = (() => { const m = toMap(this._pl), f = kingFile(m, us); return f < 0 ? null : FILES[f] + (us === 'w' ? 1 : 8); })();
      const maybe = typeof mv === 'string' ? /^[O0]-[O0]/.test(mv) : !!(mv && mv.from && mv.from === kSq);
      const cs = maybe ? this._castles() : [];
      let castle = null;
      if (typeof mv === 'string') {
        const s = mv.replace(/0/g, 'O').replace(/[+#!?]+$/, '');
        if (s === 'O-O') castle = cs.find(x => x.castle.side === 'k');
        else if (s === 'O-O-O') castle = cs.find(x => x.castle.side === 'q');
        if ((s === 'O-O' || s === 'O-O-O') && !castle) return null;
      } else if (mv && mv.from) {
        castle = cs.find(x => x.from === mv.from && x.to === mv.to) || null;
        if (!castle) {
          const alias = cs.find(x => x.from === mv.from && x.castle.kDest === mv.to);
          if (alias && !this._std().moves({ square: mv.from, verbose: true }).some(y => y.to === mv.to)) castle = alias;
        }
      }
      let out;
      if (castle) {
        this._pl = castle.castle.pl;
        this._rights[us] = { k: null, q: null };
        this._ep = '-'; this._half++; if (us === 'b') this._full++;
        this._turn = them;
        out = Object.assign({}, castle); delete out.castle;
      } else {
        const c = this._std();
        const m = c.move(mv, { sloppy: true });
        if (!m) return null;
        const f = c.fen().split(' ');
        this._pl = f[0]; this._turn = f[1]; this._ep = f[3]; this._half = +f[4]; this._full = +f[5];
        const R = this._rights, rk = us === 'w' ? '1' : '8', ork = us === 'w' ? '8' : '1';
        if (m.piece === 'k') R[us] = { k: null, q: null };
        for (const side of ['k', 'q']) {
          if (R[us][side] && m.from === R[us][side] + rk) R[us][side] = null;
          if (R[them][side] && m.to === R[them][side] + ork) R[them][side] = null;
        }
        out = m;
      }
      this._hist.push({ fen: before, key, move: out });
      return Object.assign({}, out);
    }
    undo() { const h = this._hist.pop(); if (!h) return null; this._load(h.fen); return Object.assign({}, h.move); }
  }

  // position number 0..959 (Scharnagl numbering; 518 is the normal starting position)
  Chess960.startFen = n => {
    n = ((n % 960) + 960) % 960;
    const r = Array(8).fill(null);
    let q = n;
    r[(q % 4) * 2 + 1] = 'B'; q = Math.floor(q / 4);
    r[(q % 4) * 2] = 'B'; q = Math.floor(q / 4);
    const empty = () => r.map((x, i) => x ? -1 : i).filter(i => i >= 0);
    r[empty()[q % 6]] = 'Q'; q = Math.floor(q / 6);
    const KN = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]][q];
    const e = empty(); r[e[KN[0]]] = 'N'; r[e[KN[1]]] = 'N';
    const rest = empty(); r[rest[0]] = 'R'; r[rest[1]] = 'K'; r[rest[2]] = 'R';
    const back = r.join('');
    const rights = (FILES[rest[2]] + FILES[rest[0]]).toUpperCase() + FILES[rest[2]] + FILES[rest[0]];
    return `${back.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${back} w ${rights} - 0 1`;
  };
  Chess960.random = () => Math.floor(Math.random() * 960);
  // a FEN whose castling rights name rook files belongs to a 960 game
  Chess960.isFen = fen => /[A-Ha-h]/.test(String(fen || '').trim().split(/\s+/)[2] || '');
  return Chess960;
}
