# 3D Chess

Chess in a cube. Same rules as ordinary chess — move to empty or enemy cells,
never onto your own; check when the king is attacked; checkmate when it cannot
escape — played on an `N × N × N` board you can rotate freely.

Static site, no backend. Two players connect peer-to-peer over WebRTC and
anyone else can drop in to watch.

> **Movement rules and starting positions are placeholders.** They are the
> obvious generalisation of 2D chess into 3D, chosen so the game is playable
> today. See [MOVEMENT.md](MOVEMENT.md) for what they are and how to change
> them — the engine is built so that redefining movement touches one file.

The two armies start at opposite ends of the cube's body diagonal: White low
and near, Black high and far. One consequence is that the pawn walls never
meet — see [MOVEMENT.md](MOVEMENT.md#the-pawn-walls-do-not-meet).

## Running it

The site uses ES modules, so it needs to be served over HTTP — opening
`index.html` from the filesystem will not work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

On GitHub Pages it just works: push, then enable Pages on the `main` branch.

## Modes

- **Host a game** — claims a public slot and appears in everyone's lobby.
- **Click an open game** — take the second seat, or **Watch** to spectate.
- **Practice / test mode** — play both sides locally. No network. This is the
  development mode, and it is how you eyeball new movement rules.

## Playing

Drag to rotate the board, scroll to zoom.

1. **Click one of your pieces.** It highlights, and every legal destination
   lights up — green for a quiet move, red for a capture.
2. **Click a lit cell** to move there.

Only your own pieces and their legal destinations respond to clicks, so a cell
buried three deep in the volume is still easy to hit — everything in front of it
is click-through. `Esc` cancels a selection.

**Isolate slice** in the left panel reduces the cube to a single level, rank or
file when the full volume gets too busy.

## Piece shapes

Two representations, switched with the **Pieces** button in the left panel or by
setting `Config.pieceStyle`:

- **3D** — carved geometry in `js/view/PieceModels.js`. Pawn is a sphere; rook
  is concentric cylinders under a notched crown; queen is a sphere with a
  five-spike crown; knight is a blocky horse head with slit eyes and mouth;
  bishop is a curved cone with one slit; king is an inverted rounded cone under
  a three-dimensional cross.
- **Flat** — billboarded Unicode glyphs. Less characterful, but readable from
  any angle and at any board size, which matters most on 8×8×8.

Editing a shape means editing one builder function; nothing else in the renderer
knows what a piece looks like.

## Sounds

Four cues, synthesised in the browser rather than shipped as files: move,
capture, check, and game-over.

## Layout

```
index.html          the game
tests.html          rules test suite, runs in the browser
style.css

js/rules/           the engine — no DOM, no network, no Three.js
  Config.js           board size, piece values, rule toggles
  Geometry.js         the 26 directions and how they group
  Pieces.js           >>> movement definitions — edit this one <<<
  Board.js            indexing and cell naming
  Setup.js            starting positions
  MoveGen.js          move generation, legality, check, mate
  GameState.js        position, history, captures, notation

js/view/
  Renderer3D.js       Three.js scene, lattice, picking
  PieceModels.js      carved 3D geometry for the six pieces
  UI.js               all DOM reads and writes
  Sounds.js           Web Audio cues

js/net/
  Net.js              PeerJS transport, host-authoritative
  Lobby.js            backend-free open-game discovery

js/app/App.js         orchestration and the four run modes
js/test/tests.js      the rules test suite
```

`js/rules/` deliberately imports nothing from the other directories. That is
what lets the tests run headless.

## Tests

```bash
jsc -m scripts/run-tests.mjs   # jsc ships with macOS — no install needed
node scripts/run-tests.mjs     # if you have Node
```

or open `tests.html` in the browser.

## How multiplayer works

There is no server, because GitHub Pages cannot run one.

**Transport** is WebRTC via PeerJS, using the free public broker for signalling
and Google's public STUN servers.

**Discovery** works by fixed slots. Hosts do not get a random room code — each
claims the lowest free id from a publicly known list (`3DCHESS-V1-SLOT-0` …
`-15`), so any browser can enumerate every possible game by probing that list.
Dead slots fail in one broker round-trip without any WebRTC negotiation, so a
full sweep is fast. Live hosts answer with a card describing the game.

The trade-off is a hard cap on concurrent games worldwide, set by
`Config.lobbySlots`. Raising it is one line. Replacing the whole scheme with a
real database means rewriting only `js/net/Lobby.js`.

**Authority** sits with the host's browser. It owns the real `GameState`,
validates every incoming move against the legal move list, and broadcasts a
full position snapshot after each accepted move. Clients preview their own legal
moves locally so the board feels responsive, but only the host's snapshot is
ever believed. A tampered client gets its moves rejected rather than desyncing
the game.

Known limits of this design: if the host closes their tab the game ends, and
there is no reconnection or move-history replay.

## Board size

`Config.N` / the lobby dropdown. 4×4×4 through 8×8×8 are offered; the engine
itself handles non-cubic boards (`{x: 4, y: 3, z: 6}`) and is tested on them,
though `Setup.js` only lays out cubic starting positions.

Note that the volume grows fast — an 8×8×8 board is 512 cells.
