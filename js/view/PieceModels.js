/*
 * 3D Chess — PieceModels.js
 *
 * Real geometry for the six piece classes, as an alternative to the flat
 * billboarded glyph sprites in Renderer3D.
 *
 * Switch between the two with `Config.pieceStyle` ('model' | 'sprite'), or at
 * runtime with the "Pieces" button in the left panel. Nothing else in the
 * renderer depends on which is active.
 *
 * The shapes:
 *   Pawn    a sphere
 *   Rook    stacked concentric cylinders with a crenellated crown
 *   Queen   a sphere wearing a five-spike crown
 *   Knight  a blocky horse head with slit eyes and mouth
 *   Bishop  a curved lathed cone with one slit
 *   King    an inverted rounded cone under a three-dimensional cross
 *
 * There is no CSG here, so nothing is literally cut out. Notches are the gaps
 * between added blocks; slits are thin dark bars pushed through the surface so
 * they break it from both sides. At one-cell scale that reads the same and
 * costs a fraction as much.
 *
 * Everything is built in a canonical space: centred on the origin, roughly
 * +-0.45 tall, then scaled by SCALE so a piece sits comfortably inside its
 * cell. Pieces face +z; Black is turned around at assembly time so knights and
 * bishops look down the board at each other.
 *
 * Geometry is merged per piece type and cached — one draw call per piece, and
 * the 24 pawns on a 6x6x6 board share a single BufferGeometry. Materials are
 * per piece, because slice isolation dims them individually.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Canonical pieces are ~0.9 tall; this keeps them clear of the cell walls. */
const SCALE = 0.92;

const Y_UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

// ---- primitive helpers --------------------------------------------------
// All of these return a BufferGeometry already positioned in canonical space,
// so a piece is just a list of them.

function cylinder(rTop, rBot, h, y, seg = 20) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(0, y, 0);
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** A box leant about the x axis — positive `rx` tips the top toward +z. */
function tiltedBox(w, h, d, x, y, z, rx) {
  return new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z);
}

/** A box standing off-axis on a ring of the given radius, turned to face out. */
function radialBox(w, h, d, radius, angle, y) {
  return new THREE.BoxGeometry(w, h, d)
    .rotateY(angle)
    .translate(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
}

function ball(r, y, seg = 20) {
  return new THREE.SphereGeometry(r, seg, Math.round(seg / 2)).translate(0, y, 0);
}

/** Surface of revolution from a [radius, height] profile, listed bottom-up. */
function lathe(profile, seg = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

/** A cone whose base sits at `from` and whose axis points along `dir`. */
function spike(r, h, from, dir, seg = 8) {
  const d = dir.clone().normalize();
  const m = new THREE.Matrix4().compose(
    from.clone().addScaledVector(d, h / 2),
    new THREE.Quaternion().setFromUnitVectors(Y_UP, d),
    ONE,
  );
  return new THREE.ConeGeometry(r, h, seg).applyMatrix4(m);
}

// ---- the six pieces -----------------------------------------------------
// Each builder returns { body, detail }: body takes the piece colour, detail
// takes the dark accent colour used for slits.

/** Pawn — a sphere, and nothing else. It is the piece you see most of. */
function pawn() {
  return { body: [ball(0.27, 0, 24)], detail: [] };
}

/**
 * Rook — concentric cylinders stepping inward, then a wide rim carrying eight
 * blocks. The gaps between the blocks are the notches.
 */
function rook() {
  const body = [
    cylinder(0.28, 0.31, 0.09, -0.355),   // foot
    cylinder(0.21, 0.27, 0.26, -0.18),    // lower drum
    cylinder(0.235, 0.235, 0.05, -0.03),  // collar
    cylinder(0.20, 0.215, 0.22, 0.09),    // upper drum
    cylinder(0.285, 0.245, 0.07, 0.235),  // flared rim
  ];
  // Six, not eight: at one-cell scale the gap has to be nearly as wide as the
  // block or the crown just reads as a solid ring.
  const merlons = 6;
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    body.push(radialBox(0.12, 0.15, 0.10, 0.205, a, 0.34));
  }
  return { body, detail: [] };
}

/** Queen — sphere on a stem, crowned with five outward-leaning spikes. */
function queen() {
  const body = [
    cylinder(0.25, 0.30, 0.08, -0.36),
    cylinder(0.13, 0.20, 0.16, -0.24),
    ball(0.235, 0.02, 24),
    cylinder(0.13, 0.16, 0.05, 0.215),    // crown band
  ];

  const spikes = 5;
  const tilt = 0.38;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    const dir = new THREE.Vector3(
      Math.sin(a) * Math.sin(tilt),
      Math.cos(tilt),
      Math.cos(a) * Math.sin(tilt),
    );
    const from = new THREE.Vector3(Math.sin(a) * 0.115, 0.235, Math.cos(a) * 0.115);
    body.push(spike(0.055, 0.20, from, dir));
  }
  return { body, detail: [] };
}

/**
 * Knight — deliberately rough: a leaning neck, a blocky head, a muzzle, two
 * ears and a mane crest. The eye and mouth slits are single bars driven all the
 * way through, so each shows on both cheeks.
 */
function knight() {
  const body = [
    cylinder(0.26, 0.30, 0.09, -0.355),                     // foot
    tiltedBox(0.21, 0.36, 0.17, 0, -0.15, -0.05, 0.22),     // neck, leaning forward
    box(0.23, 0.21, 0.25, 0, 0.11, 0.03),                   // skull
    tiltedBox(0.17, 0.15, 0.20, 0, 0.045, 0.20, 0.25),      // muzzle
    box(0.075, 0.30, 0.11, 0, 0.13, -0.145),                // mane crest
    // Ears, angled up and back.
    spike(0.05, 0.13, new THREE.Vector3(0.07, 0.20, -0.03), new THREE.Vector3(0.2, 1, -0.35)),
    spike(0.05, 0.13, new THREE.Vector3(-0.07, 0.20, -0.03), new THREE.Vector3(-0.2, 1, -0.35)),
  ];

  const detail = [
    box(0.25, 0.035, 0.075, 0, 0.155, 0.09),        // eye slits, through the skull
    tiltedBox(0.19, 0.03, 0.16, 0, 0.03, 0.235, 0.25), // mouth
  ];
  return { body, detail };
}

/** Bishop — a lathed curve rather than a straight cone, with the traditional
 *  single slit cut into the front of the mitre. */
function bishop() {
  const body = [
    lathe([
      [0.00, -0.40], [0.27, -0.40], [0.30, -0.36], [0.26, -0.31],
      [0.175, -0.25], [0.205, -0.17], [0.175, -0.08], [0.135, 0.01],
      [0.15, 0.065], [0.115, 0.13], [0.075, 0.23], [0.035, 0.31],
      [0.00, 0.335],
    ]),
    ball(0.055, 0.365, 12),
  ];
  // Sits on the straightest stretch of the mitre and pushed forward just far
  // enough to break the front face — one slit, not a fin, and not two.
  const detail = [tiltedBox(0.045, 0.17, 0.11, 0, 0.065, 0.095, -0.10)];
  return { body, detail };
}

/**
 * King — an inverted cone: narrow at the foot, flaring out and rounding over at
 * the top. On it stands a three-dimensional cross, a stake with two bars
 * crossing it at right angles to each other.
 */
function king() {
  const body = [
    lathe([
      [0.00, -0.40], [0.10, -0.40], [0.105, -0.33], [0.115, -0.25],
      [0.145, -0.15], [0.19, -0.05], [0.235, 0.05], [0.265, 0.13],
      [0.275, 0.19], [0.25, 0.235], [0.185, 0.265], [0.09, 0.275],
      [0.00, 0.28],
    ]),
    box(0.055, 0.21, 0.055, 0, 0.365, 0),   // the stake
    box(0.21, 0.05, 0.05, 0, 0.385, 0),     // bar along x
    box(0.05, 0.05, 0.21, 0, 0.385, 0),     // bar along z
  ];
  return { body, detail: [] };
}

const BUILDERS = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };

// ---- assembly -----------------------------------------------------------

const geomCache = new Map();

/**
 * Merged, scaled geometry for a piece type. Shared by every piece of that type
 * on the board, so this is built at most six times per session.
 */
export function pieceGeometry(type) {
  if (geomCache.has(type)) return geomCache.get(type);

  const { body, detail } = (BUILDERS[type] || pawn)();
  const merge = (parts) => {
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    merged.scale(SCALE, SCALE, SCALE);
    return merged;
  };

  const entry = { body: merge(body), detail: merge(detail) };
  geomCache.set(type, entry);
  return entry;
}

const PALETTE = {
  // Black is a lifted slate rather than true black: against a near-black
  // background an actually black piece is a silhouette with no readable shape.
  w: { body: 0xf1ead9, detail: 0x2b2b33 },
  b: { body: 0x3b4157, detail: 0x0d0f16 },
};

function pieceMaterial(colour, accent) {
  const pal = PALETTE[colour] || PALETTE.w;
  return new THREE.MeshStandardMaterial({
    color: accent ? pal.detail : pal.body,
    roughness: accent ? 0.85 : 0.45,
    metalness: accent ? 0.0 : 0.2,
    // Kept transparent so slice isolation can fade a piece without swapping
    // the material and forcing a shader recompile mid-game.
    transparent: true,
    opacity: 1,
  });
}

/** A ready-to-place piece. Caller sets `.position` and `.userData.cell`. */
export function makePieceMesh(type, colour) {
  const geo = pieceGeometry(type);
  const group = new THREE.Group();

  group.add(new THREE.Mesh(geo.body, pieceMaterial(colour, false)));
  if (geo.detail) group.add(new THREE.Mesh(geo.detail, pieceMaterial(colour, true)));

  // Pieces are modelled facing +z, the direction White advances.
  if (colour === 'b') group.rotation.y = Math.PI;
  return group;
}

/** Fade a piece. Works on a model group or on a plain sprite. */
export function setPieceOpacity(obj, opacity) {
  if (obj.isSprite) {
    obj.material.opacity = opacity;
    return;
  }
  obj.traverse((o) => {
    if (o.material) o.material.opacity = opacity;
  });
}

/** Release a piece's materials. Geometry is shared and deliberately kept. */
export function disposePieceObject(obj) {
  obj.traverse((o) => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

/** Drop the shared geometry cache. Only needed when tearing the scene down. */
export function disposePieceGeometry() {
  for (const { body, detail } of geomCache.values()) {
    body?.dispose();
    detail?.dispose();
  }
  geomCache.clear();
}
