/**
 * lib-body.ts  –  Physik-fähiger 3D-Körper
 *
 * Kapselt ein Solid mit Position, Rotation, Geschwindigkeit und Farbe.
 *
 * GPU-Modell (identisch zu Go lib3d_gl_go): Das Solid hält nur CPU-Geometrie
 * (Vertices/Kanten/Faces in flachen Float-Arrays). Der Upload in den GPU-Batch
 * passiert pro Frame in lib-render.ts drawBody(). Es gibt keinen persistenten
 * GPU-Buffer pro Solid und kein Retain/Release/Dispose – ein Body kann
 * einfach aus einer Liste entfernt werden.
 */

import * as l3d from "./lib-3d.ts";
import { createBoxSolid, createGridSolid, createPyramidSolid, createSphereSolid } from "./lib-solids.ts";
import type { Solid } from "./lib-solids.ts";

// ====================================================================
// BODYCONFIG (entspricht C BodyConfig + BODY_CONFIG_DEFAULT)
// ====================================================================
export interface BodyConfig {
  color?: string;
  lineWidth?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
}

export const BODY_CONFIG_DEFAULT: BodyConfig = {
  color: "#ffffff",
  lineWidth: 1,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};

// ====================================================================
// BODY
// ====================================================================
export class Body {
  /** Geometrie (CPU – kann zwischen Bodies geteilt werden) */
  solid: Solid;

  /** Position im Weltraum */
  pos: l3d.Vec3;

  /** Geschwindigkeit (für Physik) */
  vel: l3d.Vec3;

  /** Rotation um X-, Y- und Z-Achse (in Radian) */
  rotX = 0;
  rotY = 0;
  rotZ = 0;

  /** Darstellung */
  color = "#ffffff";
  lineWidth = 1;

  /**
   * Face-Topologie: Arrays von Vertex-Indizes, die jeweils ein konvexes
   * Face-Polygon definieren. z.B. [[0,3,2,1], [4,5,6,7], ...].
   * Nur für geschlossene Körper (Box, Pyramide, etc.) gesetzt.
   */
  faces?: number[][];

  constructor(solid: Solid, x: number, y: number, z: number, cfg: BodyConfig = BODY_CONFIG_DEFAULT) {
    this.solid = solid;
    // Single Source of Truth (wie Go NewBody): Kollisions-Topologie =
    // Solid-Topologie. Über `faces = undefined` lässt sich die Kollision
    // pro Body abschalten (z. B. für Kugeln mit degenerierten Pol-Quads).
    this.faces = solid.faces;
    this.pos = new l3d.Vec3(x, y, z);
    this.vel = new l3d.Vec3(0, 0, 0);
    this.color = cfg.color ?? "#ffffff";
    this.lineWidth = cfg.lineWidth ?? 1;
    this.rotX = cfg.rotX ?? 0;
    this.rotY = cfg.rotY ?? 0;
    this.rotZ = cfg.rotZ ?? 0;
  }

  // ================================================================
  // FACE / INTERSECTION
  // ================================================================

  /**
   * Liefert die Face-Planes dieses Körpers in Weltkoordinaten.
   * Berücksichtigt sowohl Translation als auch Rotation.
   * Nur Bodies mit gesetzten `faces` liefern Ergebnisse.
   */
  getFacePlanes(): l3d.Plane[] {
    if (!this.faces || this.faces.length === 0) return [];

    // Rotation + Translation über die Modellmatrix (Single Source of Truth,
    // dieselbe Matrix wie beim Rendering in lib-render.ts).
    const m = this.modelMatrix();
    const worldVerts = this.solid.vertices.map(v => v.transform(m));
    return this.faces.map(faceIdx =>
      l3d.createPlaneFromFace(faceIdx.map(i => worldVerts[i])),
    );
  }

  /** Modellmatrix (Translation × Rotation) – dieselbe Matrix, die das
   *  Rendering (lib-render.ts drawBody) und die Kollision (getFacePlanes)
   *  verwenden. Single Source of Truth, damit beide nicht divergieren. */
  modelMatrix(): l3d.Matrix4x4 {
    const t = l3d.translateMatrix(this.pos.x, this.pos.y, this.pos.z);
    if (this.rotX === 0 && this.rotY === 0 && this.rotZ === 0) {
      return t;
    }
    return l3d.multMatrix(t, l3d.rotateMatrix(this.rotX, this.rotY, this.rotZ));
  }

  /** Distanz zu einem anderen Body (Mittelpunkt zu Mittelpunkt). */
  distanceTo(other: Body): number {
    return this.pos.distanceTo(other.pos);
  }
}

// ====================================================================
// FACTORIES (freistehende Funktionen)
// ====================================================================

/**
 * Erzeugt einen achsenparallelen Quader (Box) mit faces-Topologie.
 *
 * @param w Breite (X-Richtung)
 * @param h Höhe   (Y-Richtung)
 * @param d Tiefe  (Z-Richtung)
 * @param x,y,z Weltposition
 */
export function createBox(w: number, h: number, d: number, x: number, y: number, z: number, cfg?: BodyConfig): Body {
  // Kollisions-Faces übernimmt der Body-Konstruktor aus dem Solid.
  return new Body(createBoxSolid(w, h, d), x, y, z, cfg);
}

/**
 * Erzeugt eine quadratische Pyramide mit faces-Topologie.
 */
export function createPyramid(base: number, height: number, x: number, y: number, z: number, cfg?: BodyConfig): Body {
  // Kollisions-Faces übernimmt der Body-Konstruktor aus dem Solid.
  return new Body(createPyramidSolid(base, height), x, y, z, cfg);
}

/**
 * Erzeugt ein Gitter (Grid) in der XZ-Ebene.
 */
export function createGrid(size: number, cells: number, x: number, y: number, z: number, cfg?: BodyConfig): Body {
  return new Body(createGridSolid(size, cells), x, y, z, cfg);
}

/**
 * Erzeugt eine Drahtgitter-Kugel (UV-Sphere).
 */
export function createSphere(radius: number, slices: number, stacks: number, x: number, y: number, z: number, cfg?: BodyConfig): Body {
  const sphere = new Body(createSphereSolid(radius, slices, stacks), x, y, z, cfg);
  // Das Solid trägt Faces (gefülltes Rendering), aber die Pol-Quads sind
  // degeneriert → Kollision bewusst abschalten (wie Go Body.Faces = nil).
  sphere.faces = undefined;
  return sphere;
}
