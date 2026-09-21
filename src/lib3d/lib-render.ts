/**
 * lib-render.ts  –  Zeichnen von Solids und Bodies
 *
 * Analog zur Go-Fassung (ray3d/lib3d/draw.go: Renderer.DrawSolid / DrawBody):
 * Solid und Body bleiben reine Daten (Geometrie bzw. Physik + Darstellung),
 * das Zeichnen liegt hier beim Renderer-Modul. Dadurch müssen lib-solids.ts
 * und lib-body.ts kein WebGL kennen und es gibt keinen Import-Zyklus.
 *
 * GPU-Modell: Das Solid hält nur CPU-Geometrie (flatEdges/flatFaces). Der
 * Upload in den GPU-Batch passiert pro Frame hier – es gibt KEINEN
 * persistenten GPU-Buffer pro Solid.
 */

import * as l3d from "./lib-3d.ts";
import * as wgl from "./lib-wgl.ts";
import type { Solid } from "./lib-solids.ts";
import type { Body } from "./lib-body.ts";

/**
 * Zeichnet ein Solid (analog Go Renderer.DrawSolid):
 *   Pipeline: Objekt-Koordinaten
 *     → wgl.setModelView(view × world)
 *     → Faces als TRIANGLES in den Batch (Fill-Farbe, beleuchtet)
 *     → Kanten als LINES in den Batch   (Stroke-Farbe, unbelichtet)
 * Das eigentliche Zeichnen passiert erst beim Frame-Ende (flushBatch).
 */
export function drawSolid(s: Solid, view: l3d.Matrix4x4, world: l3d.Matrix4x4): void {
  const vw = l3d.multMatrix(view, world);
  wgl.setModelView(vw);
  if (s.flatFaces.length > 0) {
    wgl.submitTriangles(s.flatFaces); // Flächen (Fill-Farbe, beleuchtet)
  }
  wgl.submitLines(s.flatEdges);       // Kanten (Stroke-Farbe, unbelichtet)
}

/**
 * Zeichnet einen Body (analog Go Renderer.DrawBody).
 * Setzt Farbe und Linienbreite des Bodies, baut die Modellmatrix und
 * zeichnet dessen Solid. Farbe und ModelView werden pro Body gesetzt und
 * in den GPU-Batch gesammelt (flushBatch am Frame-Ende).
 */
export function drawBody(b: Body, view: l3d.Matrix4x4): void {
  const world = b.modelMatrix();

  wgl.strokeWidth(b.lineWidth);
  wgl.strokeColor(b.color);
  wgl.fillColor(b.color); // Füllfarbe für die (beleuchteten) Flächen

  drawSolid(b.solid, view, world);
}
