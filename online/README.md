# Sixty-Four online server

This small Cloudflare Worker runs online play: game codes, "find a player near me", move checking and the clocks, daily games, watching, and a Stats store for records, ratings, the leaderboard and saved games.
It runs on Cloudflare's free plan (Workers + SQLite Durable Objects).

## Deploy (one time)

1. In the Cloudflare dashboard, open **Workers & Pages** and click **Create**. Choose **Import a repository**.
2. Connect GitHub and pick `SixtyFourChess/sixtyfourchess.github.io`.
3. Name the project `sixtyfour-online`. Under the build settings, set **Root directory** (Path) to `online`. Leave the deploy command as `npx wrangler deploy`.
4. Deploy. Cloudflare gives you an address like `https://sixtyfour-online.<your-name>.workers.dev`.
5. Put that address in `index.html` at `const ONLINE_SERVER_DEFAULT = '...'`.

After this, every push to `main` redeploys the server automatically.

If you prefer the command line, run `npx wrangler login` and then `npx wrangler deploy` inside this folder.

## Local testing

`npx wrangler dev --var DEV:1`, then open the site with `?server=http://127.0.0.1:8787`.
