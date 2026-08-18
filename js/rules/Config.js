/*
 * 3D Chess — Config.js
 *
 * Every tunable knob lives here. Board size is a variable (N) so 4x4x4, 6x6x6,
 * 8x8x8 all work without touching anything else. Piece point values are
 * PLACEHOLDERS — they get revisited once real movement rules are chosen.
 */

export const Config = {
  // ---- board -----------------------------------------------------------
  // Board is N x N x N. Coordinates are (x, y, z):
  //   x = file   (left/right)
  //   y = level  (up/down)      <- the new third dimension
  //   z = rank   (near/far)     <- pawns advance along +z for white
  N: 6,

  // Non-cubic boards are supported by the engine (it reads dims, not N), but
  // Setup.js currently only lays out cubic ones. Set via setBoardSize().
  dims: { x: 6, y: 6, z: 6 },

  // ---- rules toggles ---------------------------------------------------
  pawnDoubleStep: true,
  enPassant: true,
  castling: true,
  autoPromoteTo: 'q',       // null => prompt (not implemented yet)

  // Draw rules
  halfmoveDrawLimit: 100,   // 50-move rule, counted in plies
  repetitionDrawLimit: 3,

  // ---- piece values (PLACEHOLDER) --------------------------------------
  // Used only for the captured-material display. Revisit after movement is
  // finalised — a 3D bishop sliding 20 directions is worth far more than 3.
  values: { p: 1, n: 3, b: 5, r: 6, q: 12, k: 0 },

  // ---- networking ------------------------------------------------------
  // Public PeerJS broker. Hosts claim one of `lobbySlots` well-known IDs so
  // that browsers can discover open games with no backend. See net/Lobby.js.
  lobbyPrefix: '3DCHESS-V1-SLOT-',
  lobbySlots: 16,
  probeBatchSize: 8,
  probeTimeoutMs: 4500,

  // ---- presentation ----------------------------------------------------
  cellSize: 1,
  sounds: true,

  // How pieces are drawn. 'model' builds real geometry (js/view/PieceModels.js);
  // 'sprite' uses the flat billboarded glyphs, which stay legible at any board
  // size and camera angle. Also switchable in-game from the left panel.
  pieceStyle: 'model',    // 'model' | 'sprite'
};

/** Resize the board. Accepts a single number (cubic) or {x,y,z}. */
export function setBoardSize(size) {
  if (typeof size === 'number') {
    Config.N = size;
    Config.dims = { x: size, y: size, z: size };
  } else {
    Config.dims = { x: size.x, y: size.y, z: size.z };
    Config.N = Math.max(size.x, size.y, size.z);
  }
  return Config.dims;
}

/** Colours. 'w' moves first and advances along +z. */
export const WHITE = 'w';
export const BLACK = 'b';
export const other = (c) => (c === WHITE ? BLACK : WHITE);
