/*
 * 3D Chess — Renderer3D.js
 *
 * Draws the N x N x N lattice, the pieces, and the move highlights; owns the
 * camera, the orbit controls and mouse picking.
 *
 * Structure of the scene:
 *   latticeLines   one LineSegments holding the whole faint grid
 *   highlightMesh  InstancedMesh of translucent boxes; cells that are not
 *                  highlighted are given a zero-scale matrix
 *   pickMesh       InstancedMesh of fully transparent boxes, raycast targets
 *   sprites        one billboarded Sprite per piece, so glyphs stay readable
 *                  no matter how the board is rotated
 *
 * Picking is deliberately constrained rather than clever: App.js supplies the
 * set of currently pickable cells (your own pieces when idle; legal
 * destinations plus your own pieces when a piece is selected). The raycaster
 * takes the nearest hit that is in that set and ignores everything in front of
 * it, which is what makes clicking into a solid volume of 216 cells workable.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PIECE_GLYPHS } from '../rules/Pieces.js';

const COLOURS = {
  bg: 0x0e1015,
  lattice: 0x5c6b86,
  latticeDim: 0x232a36,
  outer: 0x8fa5c8,
  quiet: 0x35d07f,
  capture: 0xef4b45,
  selected: 0xffd23f,
  lastMove: 0x4a8ef0,
  check: 0xff2d55,
  hover: 0xa9c4ef,
};

export class Renderer3D {
  constructor(container) {
    this.container = container;
    this.dims = { x: 6, y: 6, z: 6 };
    this.cells = 0;

    this.pickable = new Set();
    this.highlights = new Map();   // cellIndex -> colour hex
    this.slice = { axis: null, index: 0 };  // axis: null | 'x' | 'y' | 'z'
    this.hovered = -1;
    this.spritePool = new Map();   // "wq" -> THREE.Texture
    this.pieceSprites = [];
    this.onPick = null;            // (cellIndex) => void
    this.onHover = null;

    this._initScene();
    this._initEvents();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  // ---- setup -----------------------------------------------------------

  _initScene() {
    const { clientWidth: w, clientHeight: h } = this.container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOURS.bg);
    this.scene.fog = new THREE.FogExp2(COLOURS.bg, 0.018);

    this.camera = new THREE.PerspectiveCamera(45, (w || 1) / (h || 1), 0.1, 500);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w || 1, h || 1);
    this.renderer.sortObjects = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.75;
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 120;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(6, 10, 8);
    this.scene.add(key);

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  _initEvents() {
    const el = this.renderer.domElement;

    // Distinguish a click from an orbit drag: only fire onPick when the
    // pointer barely moved between down and up.
    let downAt = null;
    el.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return;
      const cell = this._cellAt(e);
      if (cell >= 0 && this.onPick) this.onPick(cell);
      else if (cell < 0 && this.onPick) this.onPick(-1);
    });

    el.addEventListener('pointermove', (e) => {
      const cell = this._cellAt(e);
      if (cell !== this.hovered) {
        this.hovered = cell;
        el.style.cursor = cell >= 0 ? 'pointer' : 'grab';
        this._refreshHighlights();
        if (this.onHover) this.onHover(cell);
      }
    });

    el.addEventListener('pointerleave', () => {
      if (this.hovered !== -1) { this.hovered = -1; this._refreshHighlights(); }
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ---- board construction ---------------------------------------------

  /** (Re)build all geometry for a board of the given dimensions. */
  build(dims) {
    this.dims = { ...dims };
    this.cells = dims.x * dims.y * dims.z;

    while (this.boardGroup.children.length) {
      const c = this.boardGroup.children.pop();
      // Sprites all share one module-level geometry inside Three.js — disposing
      // it would yank the buffers out from under every future sprite.
      if (!c.isSprite) c.geometry?.dispose?.();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
    }
    this.pieceSprites = [];
    this._pieceSig = null;

    this._buildLattice();
    this._buildInstancedCells();
    this._buildAxisLabels();

    const radius = Math.max(dims.x, dims.y, dims.z);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(radius * 1.15, radius * 1.0, radius * 1.9);
    this.controls.update();
  }

  /** World-space centre of a cell. The board is centred on the origin. */
  cellPos(x, y, z) {
    return new THREE.Vector3(
      x - (this.dims.x - 1) / 2,
      y - (this.dims.y - 1) / 2,
      z - (this.dims.z - 1) / 2,
    );
  }

  idx(x, y, z) { return ((z * this.dims.y) + y) * this.dims.x + x; }

  xyz(i) {
    const x = i % this.dims.x;
    const y = Math.floor(i / this.dims.x) % this.dims.y;
    const z = Math.floor(i / (this.dims.x * this.dims.y));
    return { x, y, z };
  }

  /**
   * The lattice is drawn as three families of full-length lines rather than
   * N^3 individual wireframe cubes — same picture, a fraction of the geometry,
   * and no double-drawn shared edges.
   */
  _buildLattice() {
    const { x: DX, y: DY, z: DZ } = this.dims;
    const pts = [];
    const colours = [];
    const inner = new THREE.Color(COLOURS.lattice);
    const outer = new THREE.Color(COLOURS.outer);

    const half = (n) => n / 2;
    const push = (ax, ay, az, bx, by, bz, isEdge) => {
      pts.push(ax, ay, az, bx, by, bz);
      const c = isEdge ? outer : inner;
      colours.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };

    // Grid planes sit on cell boundaries, so they run from -N/2 to +N/2.
    for (let y = 0; y <= DY; y++) {
      for (let z = 0; z <= DZ; z++) {
        const isEdge = (y === 0 || y === DY) && (z === 0 || z === DZ);
        push(-half(DX), y - half(DY), z - half(DZ), half(DX), y - half(DY), z - half(DZ), isEdge);
      }
    }
    for (let x = 0; x <= DX; x++) {
      for (let z = 0; z <= DZ; z++) {
        const isEdge = (x === 0 || x === DX) && (z === 0 || z === DZ);
        push(x - half(DX), -half(DY), z - half(DZ), x - half(DX), half(DY), z - half(DZ), isEdge);
      }
    }
    for (let x = 0; x <= DX; x++) {
      for (let y = 0; y <= DY; y++) {
        const isEdge = (x === 0 || x === DX) && (y === 0 || y === DY);
        push(x - half(DX), y - half(DY), -half(DZ), x - half(DX), y - half(DY), half(DZ), isEdge);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false,
    });
    this.lattice = new THREE.LineSegments(geom, mat);
    this.lattice.renderOrder = 0;
    this.boardGroup.add(this.lattice);
  }

  _buildInstancedCells() {
    const n = this.cells;

    // Highlight boxes — visible only where a highlight colour is set.
    const hlGeom = new THREE.BoxGeometry(0.86, 0.86, 0.86);
    const hlMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.42, depthWrite: false,
    });
    this.highlightMesh = new THREE.InstancedMesh(hlGeom, hlMat, n);
    this.highlightMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.highlightMesh.renderOrder = 2;
    this.highlightMesh.frustumCulled = false;
    this.boardGroup.add(this.highlightMesh);

    // Pick boxes — full cell size, never drawn, raycast only.
    const pickGeom = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    const pickMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    this.pickMesh = new THREE.InstancedMesh(pickGeom, pickMat, n);
    this.pickMesh.frustumCulled = false;
    this.boardGroup.add(this.pickMesh);

    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const { x, y, z } = this.xyz(i);
      m.makeTranslation(...this.cellPos(x, y, z).toArray());
      this.pickMesh.setMatrixAt(i, m);
      this.highlightMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this.pickMesh.instanceMatrix.needsUpdate = true;
    this.highlightMesh.instanceMatrix.needsUpdate = true;
  }

  /** Small file / rank / level tick labels floating just outside the lattice. */
  _buildAxisLabels() {
    const { x: DX, y: DY, z: DZ } = this.dims;
    const add = (text, pos) => {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._labelTexture(text), transparent: true, depthWrite: false, opacity: 0.55,
      }));
      spr.position.copy(pos);
      spr.scale.set(0.7, 0.7, 1);
      spr.renderOrder = 1;
      this.boardGroup.add(spr);
    };
    for (let x = 0; x < DX; x++) {
      add(String.fromCharCode(97 + x), this.cellPos(x, -0.9, -0.9));
    }
    for (let z = 0; z < DZ; z++) {
      add(String(z + 1), this.cellPos(-0.9, -0.9, z));
    }
    for (let y = 0; y < DY; y++) {
      add('L' + (y + 1), this.cellPos(-0.9, y, -0.9));
    }
  }

  // ---- textures --------------------------------------------------------

  _labelTexture(text) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#9db0d0';
    g.font = 'bold 34px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 32, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /**
   * A piece is a glyph on a soft rounded backing. The backing matters: against
   * a lattice of thin lines a bare glyph gets visually shredded by whatever is
   * behind it.
   */
  _pieceTexture(colour, type) {
    const key = colour + type;
    if (this.spritePool.has(key)) return this.spritePool.get(key);

    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');

    const light = colour === 'w';
    const fill = light ? '#f6f2e7' : '#20222c';
    const edge = light ? '#14161c' : '#c9d4e8';

    // Backing disc.
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.46);
    grad.addColorStop(0, light ? 'rgba(20,24,34,0.85)' : 'rgba(8,10,14,0.9)');
    grad.addColorStop(1, 'rgba(8,10,14,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
    g.fill();

    g.font = `${Math.round(S * 0.62)}px "Segoe UI Symbol", "Apple Symbols", "DejaVu Sans", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = S * 0.035;
    g.lineJoin = 'round';
    g.strokeStyle = edge;
    g.strokeText(PIECE_GLYPHS[type], S / 2, S * 0.54);
    g.fillStyle = fill;
    g.fillText(PIECE_GLYPHS[type], S / 2, S * 0.54);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.spritePool.set(key, tex);
    return tex;
  }

  // ---- content updates -------------------------------------------------

  /**
   * Re-place every piece sprite from the board array.
   *
   * refreshAll() runs on every click, including selection changes that leave
   * the position untouched, so this short-circuits on an unchanged board
   * rather than tearing down and rebuilding ~50 sprites each time.
   */
  setPieces(board) {
    let sig = '';
    for (const p of board) sig += p ? p.c + p.t : '.';
    if (sig === this._pieceSig) return;
    this._pieceSig = sig;

    for (const s of this.pieceSprites) {
      this.boardGroup.remove(s);
      s.material.dispose();
    }
    this.pieceSprites = [];

    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      if (!p) continue;
      const { x, y, z } = this.xyz(i);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._pieceTexture(p.c, p.t),
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }));
      spr.position.copy(this.cellPos(x, y, z));
      spr.scale.set(0.82, 0.82, 1);
      spr.renderOrder = 3;
      spr.userData.cell = i;
      this.boardGroup.add(spr);
      this.pieceSprites.push(spr);
    }
    this._applySliceOpacity();
  }

  /**
   * @param {Map<number,string>} map cellIndex -> one of
   *        'quiet' | 'capture' | 'selected' | 'lastMove' | 'check'
   */
  setHighlights(map) {
    this.highlights = map;
    this._refreshHighlights();
  }

  setPickable(set) {
    this.pickable = set || new Set();
    // Hover shading is derived from the pickable set, so it has to be redrawn.
    this._refreshHighlights();
  }

  /** axis: null shows everything; 'x'|'y'|'z' isolates one slice. */
  setSlice(axis, index) {
    this.slice = { axis, index };
    this._applySliceOpacity();
    this._refreshHighlights();
  }

  /** Is a cell inside the active slice? Always true when slicing is off. */
  inSlice(i) {
    if (!this.slice.axis) return true;
    return this.xyz(i)[this.slice.axis] === this.slice.index;
  }

  _applySliceOpacity() {
    for (const s of this.pieceSprites) {
      const on = this.inSlice(s.userData.cell);
      s.material.opacity = on ? 1 : 0.14;
      s.material.needsUpdate = true;
    }
    if (this.lattice) this.lattice.material.opacity = this.slice.axis ? 0.14 : 0.28;
  }

  _refreshHighlights() {
    if (!this.highlightMesh) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();

    for (let i = 0; i < this.cells; i++) {
      let kind = this.highlights.get(i);
      if (!kind && i === this.hovered && this.pickable.has(i)) kind = 'hover';

      if (!kind || !this.inSlice(i)) {
        this.highlightMesh.setMatrixAt(i, zero);
        continue;
      }
      const { x, y, z } = this.xyz(i);
      const scale = kind === 'selected' ? 1.02 : 1;
      m.compose(
        this.cellPos(x, y, z),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      this.highlightMesh.setMatrixAt(i, m);
      col.setHex(COLOURS[kind] ?? COLOURS.quiet);
      this.highlightMesh.setColorAt(i, col);
    }
    this.highlightMesh.instanceMatrix.needsUpdate = true;
    if (this.highlightMesh.instanceColor) this.highlightMesh.instanceColor.needsUpdate = true;
  }

  // ---- picking ---------------------------------------------------------

  /**
   * Nearest pickable cell under the pointer, or -1. Non-pickable cells in front
   * are skipped rather than blocking — that is what lets you click a legal
   * destination buried behind three other cells.
   */
  _cellAt(event) {
    if (!this.pickMesh) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObject(this.pickMesh, false);
    for (const hit of hits) {
      const i = hit.instanceId;
      if (i === undefined) continue;
      if (!this.inSlice(i)) continue;
      if (this.pickable.has(i)) return i;
    }
    return -1;
  }

  // ---- camera ----------------------------------------------------------

  /** Swing the camera to look from the given side. */
  viewFrom(colour) {
    const r = Math.max(this.dims.x, this.dims.y, this.dims.z);
    const sign = colour === 'b' ? -1 : 1;
    this.camera.position.set(r * 1.15 * sign, r * 1.0, r * 1.9 * sign);
    this.controls.update();
  }

  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 0.8; }

  // ---- loop ------------------------------------------------------------

  _animate() {
    requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
