/**
 * lib-solids.ts  –  3D-Objekte (Drahtgittermodelle mit optionalen Flächen)
 *
 * Trennung der Zuständigkeiten:
 *   lib-3d.ts      → Mathematik (Vektoren, Matrizen, Projektion)
 *   lib-solids.ts  → 3D-Objekte + Rendering-Logik (Transformation → wgl-Batch)
 *   lib-wgl.ts     → Renderer (Batch-Sammlung, Shader, Primitives)
 *
 * Geschlossene Körper (Box, Pyramide, Kugel) tragen zusätzlich `faces`
 * (konvexe Polygon-Indizes) und werden dadurch GEFÜLLT und mit Flat Shading
 * beleuchtet gerendert – Kanten bleiben als Drahtgitter darüber sichtbar.
 *
 * GPU-Modell (identisch zu Go lib3d_gl_go):
 * Ein Solid ist reine CPU-Geometrie. Die Kanten/Flächen werden einmal in
 * flache Float-Arrays expandiert (flatEdges/flatFaces); der Upload in den
 * GPU-Batch passiert dann pro Frame in draw() – es gibt KEINEN persistenten
 * GPU-Buffer pro Solid und kein Retain/Release mehr nötig.
 */

import * as l3d from "./lib-3d.ts";
import * as wgl from "./lib-wgl.ts";

// ====================================================================
// HILFE – Hex-Farbe abdunkeln
// ====================================================================

/**
 * Gibt einen um `amount` (0..1) abgedunkelten Hex-Farbstring zurück.
 * amount=0 → unverändert, amount=1 → schwarz.
 */
export function darkenHex(hex: string, amount: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = 1 - amount;
  return `#${(r*f|0).toString(16).padStart(2,"0")}${(g*f|0).toString(16).padStart(2,"0")}${(b*f|0).toString(16).padStart(2,"0")}`;
}

// ====================================================================
// SOLID – Ein 3D-Drahtgitter-Objekt (CPU-Geometrie)
// ====================================================================

export class Solid {
  /** 3D-Punkte in Objekt-Koordinaten (lokal, relativ zum Objekt-Ursprung) */
  vertices: l3d.Vec3[];

  /** Kanten als Paare von Vertex-Indizes: [[i0, j0], [i1, j1], …] */
  edges: [number, number][];

  /** Face-Topologie: jedes Face ist ein Array von Vertex-Indizes (konvexes
   *  Polygon, 3+ Ecken, CCW von außen). Fehlt bei Drahtgittern (Grid).
   *  Wird für das gefüllte, beleuchtete Rendering genutzt. */
  faces?: number[][];

  /** Kanten einmalig in das flache Float-Format expandiert
   *  (zwei Vertices pro Kante, x,y,z,…). Upload in den GPU-Batch pro Frame. */
  flatEdges: Float32Array;

  /** Flächen trianguliert (Fan aus Index 0) und in Float-Format expandiert.
   *  Für Solids ohne Face-Daten (z. B. Grid) bleibt flatFaces leer. */
  flatFaces: Float32Array;

  constructor(vertices: l3d.Vec3[], edges: [number, number][], faces?: number[][]) {
    this.vertices = vertices;
    this.edges = edges;
    this.faces = faces;

    // Kanten einmalig expandieren (wie Go Solid.Init → FlatEdges).
    const edgeVerts: number[] = [];
    for (const [i, j] of this.edges) {
      const a = this.vertices[i];
      const b = this.vertices[j];
      edgeVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    this.flatEdges = new Float32Array(edgeVerts);

    // Flächen triangulieren (Fan aus Index 0) und expandieren.
    // Für Solids ohne Face-Daten bleibt flatFaces leer.
    const faceVerts: number[] = [];
    if (this.faces) {
      for (const face of this.faces) {
        if (face.length < 3) continue;
        for (let j = 1; j < face.length - 1; j++) {
          for (const k of [0, j, j + 1]) {
            const v = this.vertices[face[k]];
            faceVerts.push(v.x, v.y, v.z);
          }
        }
      }
    }
    this.flatFaces = new Float32Array(faceVerts);
  }

  /**
   * Zeichnet das Solid (analog Go Solid.Draw):
   *   Pipeline: Objekt-Koordinaten
   *     → wgl.setModelView(view × world)
   *     → Faces als TRIANGLES in den Batch (Fill-Farbe, beleuchtet)
   *     → Kanten als LINES in den Batch   (Stroke-Farbe, unbelichtet)
   * Das eigentliche Zeichnen passiert erst beim Frame-Ende (flushBatch).
   */
  draw(view: l3d.Matrix4x4, world: l3d.Matrix4x4): void {
    const vw = l3d.multMatrix(view, world);
    wgl.setModelView(vw);
    if (this.flatFaces.length > 0) {
      wgl.submitTriangles(this.flatFaces); // Flächen (Fill-Farbe, beleuchtet)
    }
    wgl.submitLines(this.flatEdges);       // Kanten (Stroke-Farbe, unbelichtet)
  }
}

// ====================================================================
// HILFSKONSTRUKTOREN – Standard-Geometrien
// ====================================================================

/**
 * Erzeugt einen achsenparallelen Quader (Box) mit Zentrum im Ursprung.
 *
 * @param w Breite (X-Richtung)
 * @param h Höhe   (Y-Richtung)
 * @param d Tiefe  (Z-Richtung)
 * @returns Solid mit 8 Ecken und 12 Kanten
 *
 * Beispiel:
 *   const box = createBox(40, 30, 60);
 */
export function createBoxSolid(w: number, h: number, d: number): Solid {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const V = (x: number, y: number, z: number) => new l3d.Vec3(x, y, z);

  const vertices = [
    V(-hw, -hh, -hd), // 0: vorne-unten-links
    V( hw, -hh, -hd), // 1: vorne-unten-rechts
    V( hw,  hh, -hd), // 2: vorne-oben-rechts
    V(-hw,  hh, -hd), // 3: vorne-oben-links
    V(-hw, -hh,  hd), // 4: hinten-unten-links
    V( hw, -hh,  hd), // 5: hinten-unten-rechts
    V( hw,  hh,  hd), // 6: hinten-oben-rechts
    V(-hw,  hh,  hd), // 7: hinten-oben-links
  ];

  const edges: [number, number][] = [
    // Vorderseite (Z = -hd)
    [0, 1], [1, 2], [2, 3], [3, 0],
    // Rückseite (Z = +hd)
    [4, 5], [5, 6], [6, 7], [7, 4],
    // Verbindungen vorne ↔ hinten
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  // Flächen: je ein konvexes Quad (CCW von außen). Diese Indizes sind
  // identisch mit der Body.faces-Topologie (Kollision/Raycasting).
  const faces: number[][] = [
    [0, 3, 2, 1], // vorne
    [4, 5, 6, 7], // hinten
    [0, 4, 7, 3], // links
    [1, 2, 6, 5], // rechts
    [0, 1, 5, 4], // unten
    [3, 7, 6, 2], // oben
  ];

  return new Solid(vertices, edges, faces);
}

/**
 * Erzeugt eine quadratische Pyramide mit Zentrum im Ursprung.
 *
 * @param base   Seitenlänge der Basis
 * @param height Höhe der Pyramide (Spitze in +Y-Richtung)
 * @returns Solid mit 5 Ecken und 8 Kanten
 */
export function createPyramidSolid(base: number, height: number): Solid {
  const hb = base / 2;
  const V = (x: number, y: number, z: number) => new l3d.Vec3(x, y, z);

  const vertices = [
    V(-hb, -height / 2, -hb), // 0: Basis-vorne-links
    V( hb, -height / 2, -hb), // 1: Basis-vorne-rechts
    V( hb, -height / 2,  hb), // 2: Basis-hinten-rechts
    V(-hb, -height / 2,  hb), // 3: Basis-hinten-links
    V(  0,  height / 2,   0), // 4: Spitze
  ];

  const edges: [number, number][] = [
    // Basis
    [0, 1], [1, 2], [2, 3], [3, 0],
    // Seitenkanten
    [0, 4], [1, 4], [2, 4], [3, 4],
  ];

  // Flächen: 4 Dreiecks-Seiten + Quadrat-Basis (CCW von außen),
  // identisch mit der Body.faces-Topologie.
  const faces: number[][] = [
    [0, 1, 4],    // vorne
    [1, 2, 4],    // rechts
    [2, 3, 4],    // hinten
    [3, 0, 4],    // links
    [3, 2, 1, 0], // Basis
  ];

  return new Solid(vertices, edges, faces);
}

/**
 * Erzeugt ein Gitter (Grid) in der XZ-Ebene.
 *
 * @param size   Seitenlänge des Gitters (Mittelpunkt bei y=0)
 * @param cells  Anzahl Zellen pro Seite (z.B. 5 → 5×5 Zellen)
 * @returns Solid mit (cells+1)² Punkten und passenden Kanten
 */
export function createGridSolid(size: number, cells: number): Solid {
  const half = size / 2;
  const step = size / cells;

  const vertices: l3d.Vec3[] = [];
  for (let iz = 0; iz <= cells; iz++) {
    for (let ix = 0; ix <= cells; ix++) {
      vertices.push(new l3d.Vec3(-half + ix * step, 0, -half + iz * step));
    }
  }

  const edges: [number, number][] = [];
  const stride = cells + 1;

  // Horizontale Linien (entlang X)
  for (let iz = 0; iz <= cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const idx = iz * stride + ix;
      edges.push([idx, idx + 1]);
    }
  }

  // Vertikale Linien (entlang Z)
  for (let ix = 0; ix <= cells; ix++) {
    for (let iz = 0; iz < cells; iz++) {
      const idx = iz * stride + ix;
      edges.push([idx, idx + stride]);
    }
  }

  return new Solid(vertices, edges);
}

/**
 * Erzeugt eine Drahtgitter-Kugel (UV-Sphere).
 *
 * @param radius   Radius der Kugel
 * @param slices   Anzahl Längslinien (Meridiane, z.B. 16)
 * @param stacks   Anzahl Breitenlinien (Horizontalringe, z.B. 12)
 * @returns Solid mit Gitternetz-Optik
 */
export function createSphereSolid(radius: number, slices = 16, stacks = 12): Solid {
  const V = (x: number, y: number, z: number) => new l3d.Vec3(x, y, z);

  const vertices: l3d.Vec3[] = [];
  const edges: [number, number][] = [];

  // --- Vertices generieren ---
  for (let i = 0; i <= stacks; i++) {
    const theta = (i / stacks) * Math.PI;          // 0..PI (Pol zu Pol)
    const y = radius * Math.cos(theta);
    const r = radius * Math.sin(theta);

    for (let j = 0; j <= slices; j++) {
      const phi = (j / slices) * Math.PI * 2;      // 0..2PI
      vertices.push(V(
        r * Math.cos(phi),
        y,
        r * Math.sin(phi),
      ));
    }
  }

  // --- Kanten: Meridiane (vertikal, Pol zu Pol) ---
  for (let j = 0; j <= slices; j++) {
    for (let i = 0; i < stacks; i++) {
      const a = i * (slices + 1) + j;
      const b = (i + 1) * (slices + 1) + j;
      edges.push([a, b]);
    }
  }

  // --- Kanten: Breitenringe (horizontal, Ring für Ring) ---
  for (let i = 0; i <= stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = i * (slices + 1) + j + 1;
      edges.push([a, b]);
    }
  }

  // --- Flächen: jedes Gitterzellen-Quad (stacks × slices) ist ein Face ---
  // An den Polen sind zwei Vertices identisch → degenerierte, aber harmlose
  // Quads (wie Go solidSphere – werden beim Rastern zu nichts).
  const faces: number[][] = [];
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = i * (slices + 1) + j + 1;
      const c = (i + 1) * (slices + 1) + j + 1;
      const d = (i + 1) * (slices + 1) + j;
      faces.push([a, b, c, d]);
    }
  }

  return new Solid(vertices, edges, faces);
}
