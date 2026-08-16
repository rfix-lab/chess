<div align="center">
<h1>🍒 Cherry</h1>
<p><b>Cherry</b> is a self-hosted online multiplayer chess app.</p>
<p>It connects two <b>berries</b> (<i>players</i>) with a <b>stem</b> (<i>server</i>) to produce a cherry!</p>
<p>It's simple and minimal, written in <code>nodejs</code>, <code>express</code> and <code>socket.io</code>. It uses websockets to enable multiplayer and supports private matches through invite links so you can play with your friends! It also supports user authentication with cookies and sessions.</p>
<a href="#getting-started">Getting started</a> • <a href="#installation">Installation</a> • <a href="#docker">Docker</a> • <a href="#tests">Tests</a> • <a href="#persistence-stateless">Persistence</a> • <a href="#usage">Usage</a>
</div>

## Getting Started
Make sure you have `node` (>= 18, 22 LTS recommended) and all the dependencies installed.

Simply run the command
```shell
npm start
```
in the root directory of the project and navigate to the url in any modern browser.

## Installation
First, clone the repository with the command,
```shell
git clone https://github.com/vnnm404/Cherry.git
```

then install `node` for whichever platform you are on, then install the dependencies with the command,
```shell
npm install
```

`cd` into the repo then run the app with the command,
```shell
npm start
```
to start the app, its locally hosted by default on `PORT` 5500. This can be configured in `./src/index.js` or by setting the `PORT` environment variable.

## Docker
A production image is provided (base `node:22-alpine`, non-root `node` user, built with `npm ci --omit=dev` so devDependencies are excluded, healthcheck on `:5500`):
```shell
docker build -t cherry .
docker run -p 5500:5500 -e PORT=5500 cherry
```
or with compose (`docker-compose.yml` includes a healthcheck and `restart: unless-stopped`):
```shell
docker compose up -d
```
No volumes are needed — the server is stateless (see below).

## Tests
The test suites are fully self-contained — they start the server in-process on an ephemeral port, no external services required:
```shell
npm test
```
This runs two suites:
- `test-evergreen.mjs` — the chess engine (move validation, castling, en passant, promotion, mate/stalemate, draw rules);
- `test-chess.mjs` — the full HTTP + websocket flow: real signup → sign-in → auth → matchmaking → moves → game end (uses the public API, ephemeral port, clean teardown).

## Persistence
User accounts persist in `users.csv` (bcrypt password hash + Elo) in the `DATA_DIR` directory — the named volume `cherry_data` on the worker node in the Docker setup; losing the node loses accounts. Sessions and matches remain in-memory only: a restart drops active sessions and games, but registered users, their passwords (hashed) and Elo survive. Elo: start 1500, K=32, updated after every match between two registered players (guests are unrated).

To login, visit the root `/` page or the `/index` page and either sign up or sign in. The username must match `[a-zA-Z0-9._-]{3,32}` and the password must be non-empty when signing up. A login produces a session for authentication which expires after 7 days.

## Usage
First start the app, then navigate to the hosted url in a modern browser, and wait to find a match or generate a link and play with a friend! This is demonstrated in the following gifs.

To simply play with another user, both users can simply play as guest and their matches aren't saved on the server.
![play](https://user-images.githubusercontent.com/94549325/207280367-e9eefc57-96ae-4d41-921d-bc855727bcf8.gif)

To play with a friend we can generate a link, this link is shared with your friend and this sets up a match between you both instead of matchmaking with random people.
![links](https://user-images.githubusercontent.com/94549325/207280409-4dba699d-597d-4d09-8306-a893d319f7db.gif)
![auth](https://user-images.githubusercontent.com/94549325/207280455-9ea7b0e1-c89a-4679-965a-777bb0a60c86.gif)

## Notes
- The server-side and client-side chess engines are intentionally separate copies (the client only needs the parts for board rendering and input validation, and the server never sends it full engine state). Keep them in sync if you modify rules — see `checkpoints/05-c3-sync.md` for how they're kept aligned.
- The history of 30 fixed bugs lives in `docs/archive/errors.md` + `docs/archive/errors/`.
