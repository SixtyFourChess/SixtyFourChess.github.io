# Sixty-Four

A chess app that runs entirely in your browser: play Stockfish at any strength, climb a ladder of NPC opponents, battle a friend on one screen, try broken-rules chess, and get a chess.com-style review of any game.

No install, no account, no server. Open the page and play.

## Features

- **Play the computer.** Stockfish 19 at any rating from 300 to full strength. Hints, take-backs and a "review this game" button.
- **Beat the NPCs.** Twelve characters with their own personalities, from Pip (300) to OMEGA, the AI Chess Master God (3200+). Beat each one to unlock the next.
- **Friend on the same device.** Two players, one screen, with names, an auto-turning board and a chess clock (1 min up to 30 min, with increments).
- **Fischer random (Chess960)**: in Custom mode and Online. The back pieces start shuffled; castle by moving your king onto your rook.
- **Online**: find a player near you, or make a code and send it to a friend. Runs on a small Cloudflare Worker in `online/` (see `online/README.md`).
- **Custom mode: Chess, but...** Broken-rules chess against Stockfish or a friend, starting with **the Area 51 Army**: your king plus one of every alien (a Clone, the Maw, the Watcher, the UFO and the Egg that hatches into the Overlord) against a full army.
- **Game review.** Paste any PGN, for example from chess.com or lichess. You get accuracy, a rating estimate, move labels (Brilliant to Blunder), an eval graph, retry-the-mistake and "show engine line".
- **Highlights with Coach Ozzie.** A narrated replay of the key moments, with optional voice.
- **Battle mode.** Captures become fights: spears, a pistol for en passant, sabers, a sniper rifle, cannons, a magic staff and a royal sword.

## Play it online with GitHub Pages

1. Create a new **public** repository on GitHub and upload everything in this folder. Keep the `engine/` and `lib/` folders as they are.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose your main branch and the `/ (root)` folder, then **Save**.
4. After a minute or two your game is live at `https://<your-username>.github.io/<repo-name>/`. Share that link.

## Run it on your own computer

The chess engine runs in a web worker, and browsers block that when you open the file directly with a double-click. Serve the folder with any small web server instead, for example:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole app: rules, board, bots, review, animations, pieces, icons and sounds |
| `engine/sf19-lite.js`, `engine/sf19-lite.wasm` | Stockfish 19 (lite, single-threaded WebAssembly build) |
| `engine/sf10-asm.js` | Stockfish 10 (asm.js), used as a fallback on browsers without WebAssembly |
| `lib/chess.js` | chess.js 0.10.3, the move-rules library (also loaded from a CDN when online) |
| `LICENSE` | GNU General Public License v3 |
| `licenses/chess.js-LICENSE.txt` | chess.js licence (BSD 2-Clause) |

## Credits and licences

- **Sixty-Four** (this app) is released under the **GNU General Public License v3.0**. See `LICENSE`. You are free to use, change and share it, as long as anything you distribute that is based on it stays under the GPLv3 with its source available.
- **Stockfish** is licensed under the GPLv3. Source code: <https://github.com/official-stockfish/Stockfish>. The browser builds come from stockfish.js by Nathan Rugg: <https://github.com/nmrugg/stockfish.js>.
- **chess.js** 0.10.3 by Jeff Hlywa, BSD 2-Clause licence. See `licenses/chess.js-LICENSE.txt`. Source: <https://github.com/jhlywa/chess.js>.
- **Fonts** (Bricolage Grotesque, Figtree, JetBrains Mono) are loaded from Google Fonts under the SIL Open Font License.
- **Pieces, move-label icons and move sounds:** Sixty-Four set.
- **Characters** (the NPC ladder and Coach Ozzie) are original to this project.
- The example game in the review tab is Morphy's "Opera Game" (Paris, 1858), which is in the public domain.

Ratings, accuracy scores and move labels are estimates made by the app, not official ratings.
