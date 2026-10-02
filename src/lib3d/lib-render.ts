/**
 * lib-render.ts  –  Zeichen-Fassade (Solids, Bodies und Immediate-Primitives)
 *
 * Analog zur Go-Fassung (ray3d/lib3d/draw.go: Renderer.DrawSolid / DrawBody):
 * Solid und Body bleiben reine Daten (Geometrie bzw. Physik + Darstellung),
 * das Zeichnen liegt hier beim Renderer-Modul. Dadurch müssen lib-solids.ts
 * und lib-body.ts kein WebGL kennen und es gibt keinen Import-Zyklus.
 *
 * Rollenverteilung:
 *   lib-render.ts → Fassade für das Zeichnen. Die Szene ruft ausschließlich
 *                   draw*() auf; Farbe/Linienbreite/Punktgröße kommen als
 *                   Options-Objekt (PrimitiveStyle) mit.
 *   lib-wgl.ts    → Low-Level-Renderer (Batching, Shader, Primitive, Setup).
 *                   Wird von der Szene nicht mehr direkt zum Zeichnen benutzt.
 *
 * GPU-Modell: Das Solid hält nur CPU-Geometrie (flatEdges/flatFaces). Der
 * Upload in den GPU-Batch passiert pro Frame hier – es gibt KEINEN
 * persistenten GPU-Buffer pro Solid.
 */

import * as l3d from "./lib-3d.ts";
import * as wgl from "./lib-wgl.ts";
import type { Solid } from "./lib-solids.ts";
import type { Body } from "./lib-body.ts";

// ====================================================================
// STIL / OPTIONS
// ====================================================================

/** Farbeingabe für die Fassade: Hex-String | Grau(0..255) | [r,g,b] | [r,g,b,a]. */
export type ColorInput = string | number | number[];

/** Zeichen-Optionen für alle Primitive. Alle Felder sind optional und
 *  überschreiben den aktuellen Low-Level-Zustand. */
export interface PrimitiveStyle {
  stroke?: ColorInput;   // Linienfarbe (unbeleuchtet)
  fill?: ColorInput;     // Füllfarbe  (beleuchtet)
  lineWidth?: number;    // Linienstärke in Pixeln
  pointSize?: number;    // Punktgröße in Pixeln
}

/** Wie PrimitiveStyle, zusätzlich der Zeichenmodus für Füll-Primitive.
 *  mode: 0 = stroke | 1 = fill | 2 = beide  (Standard: 0) */
export interface ShapeStyle extends PrimitiveStyle {
  mode?: wgl.DrawStyle;
}

/** Normalisiert ein ColorInput auf die varargs-Form von wgl.strokeColor/fillColor. */
function colorArgs(c: ColorInput): (string | number)[] {
  return Array.isArray(c) ? c : [c];
}

/** Übernimmt die gesetzten Felder in den Low-Level-Zeichenzustand.
 *  Nicht gesetzte Felder bleiben unverändert (wie im Immediate-Mode üblich). */
function applyStyle(o: PrimitiveStyle): void {
  if (o.stroke    !== undefined) wgl.strokeColor(...colorArgs(o.stroke));
  if (o.fill      !== undefined) wgl.fillColor(...colorArgs(o.fill));
  if (o.lineWidth !== undefined) wgl.strokeWidth(o.lineWidth);
  if (o.pointSize !== undefined) wgl.pointSize(o.pointSize);
}

// ====================================================================
// SOLIDS / BODIES
// ====================================================================

/**
 * Zeichnet ein Solid (analog Go Renderer.DrawSolid):
 *   Pipeline: Objekt-Koordinaten
 *     → wgl.setModel(world)   (View ist global pro Frame gesetzt)
 *     → Faces als TRIANGLES in den Batch (Fill-Farbe, beleuchtet)
 *     → Kanten als LINES in den Batch   (Stroke-Farbe, unbelichtet)
 * Danach wird das Model auf Identität zurückgesetzt, damit nachfolgende
 * Primitive wieder im Weltraum liegen (kein Model-Stack).
 * Das eigentliche Zeichnen passiert erst beim Frame-Ende (flushBatch).
 */
export function drawSolid(s: Solid, world: l3d.Matrix4x4): void {
  wgl.setModel(world);
  if (s.flatFaces.length > 0) {
    wgl.submitTriangles(s.flatFaces); // Flächen (Fill-Farbe, beleuchtet)
  }
  wgl.submitLines(s.flatEdges);       // Kanten (Stroke-Farbe, unbelichtet)
  wgl.setModel(l3d.identityMatrix());
}

/**
 * Zeichnet einen Body (analog Go Renderer.DrawBody).
 * Setzt Farbe und Linienbreite des Bodies, baut die Modellmatrix und
 * zeichnet dessen Solid. Farbe und Model werden pro Body gesetzt und
 * in den GPU-Batch gesammelt (flushBatch am Frame-Ende).
 */
export function drawBody(b: Body): void {
  wgl.strokeWidth(b.lineWidth);
  wgl.strokeColor(b.color);
  wgl.fillColor(b.color); // Füllfarbe für die (beleuchteten) Flächen
  drawSolid(b.solid, b.modelMatrix());
}

// ====================================================================
// IMMEDIATE-PRIMITIVES
// ====================================================================

/** 3D-Punkt bei (x,y,z). */
export function drawPoint(x: number, y: number, z: number, style: PrimitiveStyle = {}): void {
  applyStyle(style);
  wgl.point(x, y, z);
}

/** 3D-Linie von (x1,y1,z1) nach (x2,y2,z2). */
export function drawLine(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  style: PrimitiveStyle = {},
): void {
  applyStyle(style);
  wgl.line(x1, y1, z1, x2, y2, z2);
}

/** 3D-Dreieck (mode: 0=stroke | 1=fill | 2=beide). */
export function drawTriangle(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  style: ShapeStyle = {},
): void {
  applyStyle(style);
  wgl.triangle(x1, y1, z1, x2, y2, z2, x3, y3, z3, style.mode ?? 0);
}

/** 3D-Viereck mit 4 beliebigen Punkten (mode: 0=stroke | 1=fill | 2=beide). */
export function drawShape(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  x4: number, y4: number, z4: number,
  style: ShapeStyle = {},
): void {
  applyStyle(style);
  wgl.shape(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, style.mode ?? 0);
}

/** Achsenparalleles Rechteck in der XY-Ebene (mode + optionale Z-Höhe). */
export function drawRect(
  x: number, y: number, w: number, h: number,
  style: ShapeStyle & { z?: number } = {},
): void {
  applyStyle(style);
  wgl.rect(x, y, w, h, style.mode ?? 0, style.z ?? 0);
}

/** 3D-Kreis (Ring) in der XY-Ebene (mode + optionale Segmentzahl). */
export function drawCircle(
  x: number, y: number, z: number,
  radius: number,
  style: ShapeStyle & { segments?: number } = {},
): void {
  applyStyle(style);
  wgl.circle(x, y, z, radius, style.mode ?? 0, style.segments ?? 64);
}

/** Beliebige 3D-Polygone [x0,y0,z0, x1,y1,z1, …] (mode: 0=stroke | 1=fill | 2=beide). */
export function drawPolygon(pts: number[], style: ShapeStyle = {}): void {
  applyStyle(style);
  wgl.polygon(pts, style.mode ?? 0);
}
