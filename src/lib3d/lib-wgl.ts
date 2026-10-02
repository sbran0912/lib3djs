/*
-----------------------------------------------------------------
WebGL Implementierung  –  Echter 3D-Renderer (GPU-Transformation)
-----------------------------------------------------------------
Koordinatensystem: +Y zeigt nach oben, Kamera blickt in +Z.
Die 3D-Transformation (Model/View/Projection) läuft im Vertex-Shader.
Depth-Testing ist aktiviert.

Shader-Modi (setEffect):
  "flat"      – einfache Volltonfarbe  (Standard)
  "gradient"  – radialer Verlauf von Farbe A nach Farbe B (im Kamera-Raum)
  "pulse"     – pulsierende Helligkeit über die Zeit

Beleuchtung (Flat Shading, Port aus Go lib3d_gl_go):
  Alle gefüllten Flächen (fill) werden automatisch beleuchtet (uLighted=1),
  Kanten/Punkte/Linien (stroke) nicht (uLighted=0). Die Lichtrichtung setzt
  setLightDirection() in Kamerakoordinaten – Default: Headlight aus der
  Kamera (uLightDir = 0,0,-1, da die Kamera in +Z blickt).
  Die Facetten-Normale wird pro Pixel aus den Kamera-Raum-Ableitungen
  (dFdx/dFdy) rekonstruiert → kein Normalen-Attribut nötig.

BATCHED DRAWING (identisch zu Go lib3d_gl_go / lib3d.go):
  Alle Immediate-Primitives eines Frames (Punkte, Linien, Kreise, aber auch
  die Solid-Meshes) werden nur GESAMMELT: submit() hängt die Vertices an den
  Frame-Batch und speichert einen Zustands-Snapshot (drawCmd) – Farbe, Effekt,
  Linienstärke, Punktgröße, Gradient-Zentrum, lit-Flag sowie die aktuellen
  ModelView-/Projection-Matrizen. Aufeinanderfolgende Befehle mit identischem
  Zustand werden zu einem DrawArrays-Aufruf verschmolzen (LINE_LOOP nie).
  Erst flushBatch() (Frame-Ende bzw. vor background()) lädt alles in EIN
  wiederverwendbares VBO (BufferData nur beim Wachsen, sonst BufferSubData)
  und zeichnet mit einem Attributpointer + pro Befehl Uniforms/LineWidth.
  Es gibt KEIN createBuffer/deleteBuffer pro Aufruf und keinen persistenten
  GPU-Buffer pro Solid mehr (kein Retain/Release nötig – CPU-Geometrie).
-----------------------------------------------------------------
*/

/* =================================================================
   INTERNER GLSL-CODE
================================================================= */

// Vertex-Shader:
// 3D-Transformation über ModelView- und Projection-Matrix.
// aPos = 3D-Punkt in Objektkoordinaten.
const VERT_SRC = `
  attribute vec3 aPos;
  uniform mat4 uView;
  uniform mat4 uModel;
  uniform mat4 uProjection;
  uniform float uPointSize;

  varying vec3 vCamPos;

  void main() {
    vec4 worldPos = uModel * vec4(aPos, 1.0);
    vec4 camPos = uView * worldPos;
    vCamPos = camPos.xyz;
    gl_Position = uProjection * camPos;
    gl_PointSize = uPointSize;
  }
`;

// Fragment-Shader (Vorlage – wird in init() an Derivative-Support angepasst):
// uMode  0 = flat      – einfache Farbe uColor
// uMode  1 = gradient  – radialer Verlauf (vom Zentrum in Kamera-Koordinaten)
// uMode  2 = pulse     – flat mit sinusförmiger Helligkeitspulsation
// uLighted == 1 → Flat-Shading (Beleuchtung), __LIGHTING__ wird ersetzt.
const FRAG_SRC_TEMPLATE = `
precision __FRAG_PRECISION__ float;

uniform int   uMode;
uniform vec4  uColor;
uniform vec4  uColor2;
uniform float uTime;
uniform vec3  uShapeCenter;   // Zentrum in Kamera-Koordinaten
uniform float uShapeRadius;
uniform float uFogNear;
uniform float uFogFar;
uniform vec4  uFogColor;
uniform int   uLighted;       // 1 = gefüllte Fläche → beleuchten
uniform vec3  uLightDir;      // Lichtrichtung in Kamera-Koordinaten (vom Fragment zur Lichtquelle)
varying vec3  vCamPos;

void main() {
  vec3 base = uColor.rgb;

  if (uMode == 0) {
    // flat – Basis bleibt uColor
  } else if (uMode == 1) {
    float d = distance(vCamPos, uShapeCenter);
    float t = clamp(d / max(uShapeRadius, 1.0), 0.0, 1.0);
    base = mix(uColor, uColor2, t).rgb;
  } else if (uMode == 2) {
    float brightness = 0.6 + 0.4 * sin(uTime * 3.0);
    base = uColor.rgb * brightness;
  }

  // Flächige Schattierung (analog Go lib3d_gl_go):
  // Normale pro Pixel aus Kamera-Raum-Ableitungen rekonstruieren, sodass zur
  // Kamera zeigende Flächen hell und wegdrehende dunkler werden. Kein
  // gl_FrontFacing-Flip nötig (wie in Go).
  if (uLighted == 1) {
    __LIGHTING__
  }

  // Nebel (Tiefen-basiert im Kamera-Raum)
  float depth = vCamPos.z;
  float fog_t = clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = mix(vec4(base, uColor.a), uFogColor, fog_t);
}
`;

/* =================================================================
   TYPEN & INTERNER ZUSTAND
================================================================= */

export type DrawStyle  = 0 | 1 | 2;           // 0=stroke, 1=fill, 2=both
export type EffectMode = "flat" | "gradient" | "pulse";

interface ColorState { r: number; g: number; b: number; a: number; }

interface DrawState {
  fill:   ColorState;
  stroke: ColorState;
  lineW:  number;
  effect: EffectMode;
  grad2:  ColorState;
}

// Ein gesammelter Zeichenbefehl (drawCmd) für eine Immediate-Primitive.
// Alle Befehle eines Frames werden gepuffert und am Frame-Ende mit einem
// einzigen wiederverwendbaren VBO gezeichnet (Batched Drawing – wie Go).
interface DrawCmd {
  mode:      number;   // GL-Modus (gl.POINTS/LINES/TRIANGLES/LINE_LOOP)
  first:     number;   // Start-Index in batchVerts (Vertex-Nummer)
  count:     number;   // Anzahl Vertices
  col:       ColorState;
  effect:    EffectMode;
  grad2:     ColorState;
  pointSize: number;
  lineW:     number;
  center:    [number, number, number];
  radius:    number;
  view:      Float32Array;  // View-Snapshot (16, column-major)
  model:     Float32Array;  // Model-Snapshot (16, column-major)
  proj:      Float32Array;  // Projection-Snapshot
  lit:       number;        // 1 = gefüllte Fläche → beleuchten
}

// Canvas / GL
let canv: HTMLCanvasElement;
let gl:   WebGLRenderingContext;
let prog: WebGLProgram;

// Shader-Locations
let locPos:         number;
let locView:        WebGLUniformLocation;
let locModel:       WebGLUniformLocation;
let locProjection:  WebGLUniformLocation;
let locPointSize:   WebGLUniformLocation;
let locMode:        WebGLUniformLocation;
let locColor:       WebGLUniformLocation;
let locColor2:      WebGLUniformLocation;
let locTime:        WebGLUniformLocation;
let locCenter:      WebGLUniformLocation;
let locRadius:      WebGLUniformLocation;
let locFogNear:     WebGLUniformLocation;
let locFogFar:      WebGLUniformLocation;
let locFogColor:    WebGLUniformLocation;
let locLighted:     WebGLUniformLocation;
let locLightDir:    WebGLUniformLocation;

// WebGL1 braucht die Extension OES_standard_derivatives für dFdx/dFdy
// im Fragment-Shader. Wird in init() vor dem Shader-Compile geprüft.
let supportDeriv = false;

// Animation
let looping   = true;
let startTime = 0;

// Maus
export let mouseX = 0;
export let mouseY = 0;
let mouseStatus = 0;

// Aktueller Zeichenzustand (wird pro draw*-Aufruf überschrieben; kein Stack).
let state: DrawState = {
  fill:   { r: 1, g: 1, b: 1, a: 1 },
  stroke: { r: 0, g: 0, b: 0, a: 1 },
  lineW:  1,
  effect: "flat",
  grad2:  { r: 0, g: 0, b: 0, a: 1 },
};

// Batching: gesammelte Immediate-Primitives eines Frames.
let batchVerts: number[] = [];
let batchCmds:  DrawCmd[] = [];
let batchBuf:   WebGLBuffer | null = null;
let batchCap    = 0;          // aktuell allozierte Byte-Größe des VBO

// Zuletzt gesetzte Uniform-Werte (für den Batch-Snapshot pro Befehl).
// View ist pro Frame konstant, Model pro Objekt (Default: Identität).
let viewUniform  = identity16();
let modelUniform = identity16();
let projUniform  = identity16();
let pointSizeVal = 4;
let gradCenter: [number, number, number] = [0, 0, 0];
let gradRadius  = 1;

/* =================================================================
   HILFSFUNKTIONEN (intern)
================================================================= */

/** 4x4-Identitätsmatrix als flaches column-major Float32Array. */
function identity16(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Parst varargs in { r,g,b,a } mit Werten 0..1 */
function parseColor(...c: (string | number)[]): ColorState {
  if (c.length === 1 && typeof c[0] === "string") {
    let hex = (c[0] as string).replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const n = parseInt(hex, 16);
    return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255, a: 1 };
  }
  if (c.length === 1 && typeof c[0] === "number") {
    const v = (c[0] as number) / 255;
    return { r: v, g: v, b: v, a: 1 };
  }
  if (c.length === 3) {
    return { r: (c[0] as number)/255, g: (c[1] as number)/255, b: (c[2] as number)/255, a: 1 };
  }
  if (c.length === 4) {
    return { r: (c[0] as number)/255, g: (c[1] as number)/255, b: (c[2] as number)/255, a: (c[3] as number)/255 };
  }
  return { r: 1, g: 1, b: 1, a: 1 };
}

/** Kompiliert einen einzelnen GLSL-Shader */
function compileShader(type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error("Shader-Fehler: " + gl.getShaderInfoLog(shader));
  }
  return shader;
}

/** Verknüpft Vertex- und Fragment-Shader zu einem WebGL-Programm */
function createProgram(vertSrc: string, fragSrc: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER,   vertSrc));
  gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Programm-Fehler: " + gl.getProgramInfoLog(p));
  }
  return p;
}

/** Baut den Fragment-Shader-Quellcode für den aktuellen Kontext auf.
 *  - OES_standard_derivatives verfügbar → Normale per dFdx/dFdy rekonstruieren.
 *  - HINWEIS ZUM VORZEICHEN: Diese Library nutzt einen linkshändigen View-Raum
 *    (Kamera blickt in +Z). cross(dFdy, dFdx) (statt cross(dFdx, dFdy)) sorgt
 *    dafür, dass die rekonstruierte Normale zur Kamera zeigt – äquivalent zur
 *    OpenGL-Variante in Go lib3d_gl_go (rechtshändig, Kamera blickt in -Z).
 *  - Ohne Extension fällt die Beleuchtung auf eine konstante Normalen-
 *    Näherung zurück (kein 3D-Schattierungseffekt, aber kein Crash).
 *  - Höchste verfügbare Float-Präzision im Fragment-Shader (wichtig für
 *    stabile Ableitungen bei großer Kamera-Distanz).
 */
function buildFragSrc(): string {
  const ext = supportDeriv ? "#extension GL_OES_standard_derivatives : enable\n" : "";

  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const prec = hp && hp.precision > 0 ? "highp" : "mediump";

  const normalExpr = supportDeriv
    ? "normalize(cross(dFdy(vCamPos), dFdx(vCamPos)))"
    : "vec3(0.0, 0.0, -1.0)"; // grobe Annäherung: Richtung Kamera

  const lighting =
    `vec3 n = ${normalExpr};\n` +
    "  float diff = max(dot(n, normalize(uLightDir)), 0.0);\n" +
    "  base *= 0.25 + 0.75 * diff;";

  return (
    ext +
    FRAG_SRC_TEMPLATE
      .replace("__FRAG_PRECISION__", prec)
      .replace("__LIGHTING__", lighting)
  );
}

/** 4x4-Matrix row-major → column-major Float32Array (für WebGL1 transpose=false) */
function flattenMatrix(m: number[][]): Float32Array {
  return new Float32Array([
    m[0][0], m[1][0], m[2][0], m[3][0],
    m[0][1], m[1][1], m[2][1], m[3][1],
    m[0][2], m[1][2], m[2][2], m[3][2],
    m[0][3], m[1][3], m[2][3], m[3][3],
  ]);
}

function effectToMode(effect: EffectMode): number {
  if (effect === "flat") return 0;
  if (effect === "gradient") return 1;
  return 2; // pulse
}

function colEq(a: ColorState, b: ColorState): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function arrEq(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * canMerge prüft, ob zwei aufeinanderfolgende Befehle identischen Zustand
 * haben und zu einem DrawArrays-Aufruf zusammengefasst werden können.
 * LINE_LOOP wird nie zusammengefasst, weil ein Loop sich selbst schließt.
 */
function canMerge(a: DrawCmd, b: DrawCmd): boolean {
  return a.mode === b.mode &&
    a.mode !== gl.LINE_LOOP &&
    colEq(a.col, b.col) &&
    a.effect === b.effect &&
    colEq(a.grad2, b.grad2) &&
    a.pointSize === b.pointSize &&
    a.lineW === b.lineW &&
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.center[2] === b.center[2] &&
    a.radius === b.radius &&
    arrEq(a.view, b.view) &&
    arrEq(a.model, b.model) &&
    arrEq(a.proj, b.proj) &&
    a.lit === b.lit;
}

/* =================================================================
   BATCHING – SAMMELN & ZEICHNEN (Kern des Renderers)
================================================================= */

/**
 * Sammelt eine Immediate-Primitive im Frame-Batch (analog Go Renderer.submit).
 * Es wird noch nichts an die GPU geschickt; das passiert erst beim
 * flushBatch() (Frame-Ende bzw. vor background()).
 *
 * @param mode      GL-Modus (gl.POINTS, gl.LINES, gl.TRIANGLES, gl.LINE_LOOP)
 * @param verts     Flaches Vertex-Array [x,y,z, x,y,z, …]
 * @param useStroke true  → Stroke-Farbe (unbeleuchtet, lit=0)
 *                  false → Fill-Farbe   (beleuchtet,  lit=1)
 */
export function submit(mode: number, verts: Float32Array | number[], useStroke: boolean) {
  const col = useStroke ? state.stroke : state.fill;
  const lit = useStroke ? 0 : 1; // gefüllte Flächen werden beleuchtet

  const cmd: DrawCmd = {
    mode:      mode,
    first:     batchVerts.length / 3,
    count:     verts.length / 3,
    col:       { r: col.r, g: col.g, b: col.b, a: col.a },
    effect:    state.effect,
    grad2:     { r: state.grad2.r, g: state.grad2.g, b: state.grad2.b, a: state.grad2.a },
    pointSize: pointSizeVal,
    lineW:     state.lineW,
    center:    [gradCenter[0], gradCenter[1], gradCenter[2]],
    radius:    gradRadius,
    view:      new Float32Array(viewUniform),
    model:     new Float32Array(modelUniform),
    proj:      new Float32Array(projUniform),
    lit:       lit,
  };

  for (let i = 0; i < verts.length; i++) batchVerts.push(verts[i]);

  // Aufeinanderfolgende Befehle mit identischem Zustand zu einem
  // DrawArrays-Aufruf zusammenfassen (weniger Draw-Calls).
  const n = batchCmds.length;
  if (n > 0 && canMerge(batchCmds[n - 1], cmd)) {
    batchCmds[n - 1].count += cmd.count;
    return;
  }
  batchCmds.push(cmd);
}

/** Sammelt gefüllte Dreiecke (Fill-Farbe, beleuchtet) – für Solid-Faces. */
export function submitTriangles(verts: Float32Array | number[]) {
  submit(gl.TRIANGLES, verts, false);
}

/** Sammelt Linien (Stroke-Farbe, unbelichtet) – für Solid-Kanten. */
export function submitLines(verts: Float32Array | number[]) {
  submit(gl.LINES, verts, true);
}

/**
 * Zeichnet alle gesammelten Primitives des Frames mit einem einzigen
 * wiederverwendbaren VBO. Es gibt kein GenBuffers/DeleteBuffers pro Aufruf
 * mehr; der GPU-Speicher wird nur beim Wachsen neu allokiert.
 */
function flushBatch() {
  if (batchCmds.length === 0) return;

  if (batchBuf === null) batchBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, batchBuf);

  const byteLen = batchVerts.length * 4;
  const data = new Float32Array(batchVerts);
  if (byteLen > batchCap) {
    // Nur beim Wachsen neu allozieren, sonst in-place ersetzen.
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    batchCap = byteLen;
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);

  for (const c of batchCmds) {
    gl.uniformMatrix4fv(locView,       false, c.view);
    gl.uniformMatrix4fv(locModel,      false, c.model);
    gl.uniformMatrix4fv(locProjection, false, c.proj);
    gl.uniform1i(locMode,     effectToMode(c.effect));
    gl.uniform1i(locLighted,  c.lit);
    gl.uniform4f(locColor,    c.col.r, c.col.g, c.col.b, c.col.a);
    gl.uniform4f(locColor2,   c.grad2.r, c.grad2.g, c.grad2.b, c.grad2.a);
    gl.uniform1f(locPointSize, c.pointSize);
    gl.uniform3f(locCenter,   c.center[0], c.center[1], c.center[2]);
    gl.uniform1f(locRadius,   c.radius);
    gl.lineWidth(c.lineW);
    gl.drawArrays(c.mode, c.first, c.count);
  }

  batchVerts = [];
  batchCmds  = [];
}

/* =================================================================
   MAUS / TOUCH (intern)
================================================================= */

function onMouseMove(e: MouseEvent) {
  mouseX =  e.offsetX - canv.width  / 2;
  mouseY = -(e.offsetY - canv.height / 2);
}
function onMouseDown() { mouseStatus = 1; }
function onMouseUp()   { mouseStatus = 2; }

function onTouchMove(e: TouchEvent) {
  e.preventDefault();
  const rect  = (e.target as HTMLElement).getBoundingClientRect();
  const touch = e.targetTouches[0];
  mouseX =  (touch.pageX - rect.left)  - canv.width  / 2;
  mouseY = -((touch.pageY - rect.top) - canv.height / 2);
}
function onTouchStart(e: TouchEvent) { mouseStatus = 1; onTouchMove(e); }
function onTouchEnd()                { mouseStatus = 2; }

/* =================================================================
   ÖFFENTLICHE API – Setup & Matrizen
================================================================= */

export function getWidth():  number { return canv.width;  }
export function getHeight(): number { return canv.height; }

/** Stoppt die Animations-Schleife. */
export function noLoop() { looping = false; }

/** Gibt true zurück solange die Maustaste gedrückt ist. */
export function isMouseDown(): boolean { return mouseStatus === 1; }

/** Gibt einmalig true zurück wenn die Maustaste losgelassen wurde. */
export function isMouseUp(): boolean {
  if (mouseStatus === 2) { mouseStatus = 0; return true; }
  return false;
}

/** Setzt die Projection-Matrix für das 3D-Rendering. */
export function setProjection(m: number[][]) {
  projUniform = flattenMatrix(m);
  gl.uniformMatrix4fv(locProjection, false, projUniform);
}

/** Setzt die View-Matrix (Kamera) für das 3D-Rendering.
 *  Typischerweise einmal pro Frame, z.B. lookAtMatrix(...).
 *  Der Wert wird pro submit() als Snapshot in den Batch übernommen. */
export function setView(m: number[][]) {
  viewUniform = flattenMatrix(m);
  gl.uniformMatrix4fv(locView, false, viewUniform);
}

/** Setzt die Model-Matrix (Objekt-Transformation) für das 3D-Rendering.
 *  Default ist die Identität – Primitives wie line()/point()/circle()
 *  liegen damit automatisch im Weltraum. Objekte setzen ihr Model über
 *  lib-render.ts (drawSolid) und setzen es danach auf Identität zurück.
 *  Der Wert wird pro submit() als Snapshot in den Batch übernommen. */
export function setModel(m: number[][]) {
  modelUniform = flattenMatrix(m);
  gl.uniformMatrix4fv(locModel, false, modelUniform);
}

/** Setzt das Zentrum für den Gradient-Effekt (in Kamera-Koordinaten). */
export function setGradientCenter(cx: number, cy: number, cz: number, radius: number) {
  gradCenter = [cx, cy, cz];
  gradRadius = radius;
  gl.uniform3f(locCenter, cx, cy, cz);
  gl.uniform1f(locRadius, radius);
}

/** Aktiviert Tiefen-Nebel.
 *  Alle Objekte werden ab near immer mehr von der Nebelfarbe überdeckt,
 *  bis sie bei far vollständig darin verschwinden.
 *  @param near  Distanz (in Kamera-Z), ab der Nebel einsetzt
 *  @param far   Distanz, bei der Nebel voll deckt
 *  @param r,g,b,a  Nebelfarbe (0..1)
 */
export function setFog(near: number, far: number, r: number, g: number, b: number, a: number) {
  gl.uniform1f(locFogNear, near);
  gl.uniform1f(locFogFar, far);
  gl.uniform4f(locFogColor, r, g, b, a);
}

/** Setzt die Lichtrichtung für das Flat-Shading in Kamerakoordinaten.
 *  Der Vektor zeigt vom Fragment ZUR Lichtquelle (z.B. „Sonne von oben“
 *  → +Y). Für eine weltfeste Lichtrichtung muss er pro Frame mit der
 *  aktuellen View-Matrix in den Kamera-Raum gedreht werden (siehe main.ts).
 *  Default nach init(): Headlight aus der Kamera (0, 0, -1).
 */
export function setLightDirection(x: number, y: number, z: number) {
  gl.uniform3f(locLightDir, x, y, z);
}

/** Initialisiert Canvas und WebGL-Kontext.
 *  Koordinatenursprung liegt in der Mitte, +Y zeigt nach oben.
 *  Depth-Testing ist aktiviert.
 */
export function init(w: number, h: number) {
  canv = document.querySelector("canvas") as HTMLCanvasElement;
  canv.width  = w;
  canv.height = h;

  gl = canv.getContext("webgl") as WebGLRenderingContext;
  if (!gl) throw new Error("WebGL wird nicht unterstützt.");

  // OES_standard_derivatives für dFdx/dFdy aktivieren – MUSS vor dem
  // Shader-Compile passieren (sonst kompiliert der Fragment-Shader nicht).
  supportDeriv = !!gl.getExtension("OES_standard_derivatives");
  prog = createProgram(VERT_SRC, buildFragSrc());
  gl.useProgram(prog);

  locPos        = gl.getAttribLocation (prog, "aPos");
  locView       = gl.getUniformLocation(prog, "uView")!;
  locModel      = gl.getUniformLocation(prog, "uModel")!;
  locProjection = gl.getUniformLocation(prog, "uProjection")!;
  locPointSize  = gl.getUniformLocation(prog, "uPointSize")!;
  locMode       = gl.getUniformLocation(prog, "uMode")!;
  locColor      = gl.getUniformLocation(prog, "uColor")!;
  locColor2     = gl.getUniformLocation(prog, "uColor2")!;
  locTime       = gl.getUniformLocation(prog, "uTime")!;
  locCenter     = gl.getUniformLocation(prog, "uShapeCenter")!;
  locRadius     = gl.getUniformLocation(prog, "uShapeRadius")!;
  locFogNear    = gl.getUniformLocation(prog, "uFogNear")!;
  locFogFar     = gl.getUniformLocation(prog, "uFogFar")!;
  locFogColor   = gl.getUniformLocation(prog, "uFogColor")!;
  locLighted    = gl.getUniformLocation(prog, "uLighted")!;
  locLightDir   = gl.getUniformLocation(prog, "uLightDir")!;

  gl.uniform1f(locPointSize, 4.0);
  gl.uniform3f(locCenter, 0, 0, 0);
  gl.uniform1f(locRadius, 1);
  gl.uniform1i(locLighted, 0);
  gl.uniform3f(locLightDir, 0, 0, -1); // Headlight: Kamera blickt +Z → Licht aus Kamera = -Z

  // Default-Matrizen (Identität)
  gl.uniformMatrix4fv(locProjection, false, identity16());
  gl.uniformMatrix4fv(locView,       false, identity16());
  gl.uniformMatrix4fv(locModel,      false, identity16());

  // Fog-Defaults (kein Nebel)
  gl.uniform1f(locFogNear, 0);
  gl.uniform1f(locFogFar, 1);
  gl.uniform4f(locFogColor, 0, 0, 0, 0);

  // Depth-Testing + Alpha-Blending.
  // LEQUAL (statt LESS): koplanare Kanten bleiben über ihren eigenen Flächen
  // sichtbar (sonst Z-Fighting zwischen Face-Füllung und Kantenlinien).
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.viewport(0, 0, w, h);
  startTime = performance.now();

  // Batch-Zustand initialisieren (entspricht den oben gesetzten Uniforms).
  state = {
    fill:   { r: 1, g: 1, b: 1, a: 1 },
    stroke: { r: 0, g: 0, b: 0, a: 1 },
    lineW:  1,
    effect: "flat",
    grad2:  { r: 0, g: 0, b: 0, a: 1 },
  };
  viewUniform  = identity16();
  modelUniform = identity16();
  projUniform  = identity16();
  pointSizeVal = 4.0;
  gradCenter   = [0, 0, 0];
  gradRadius   = 1;
  batchBuf     = null;
  batchCap     = 0;
  batchVerts   = [];
  batchCmds    = [];

  canv.addEventListener("mousemove",  onMouseMove);
  canv.addEventListener("mousedown",  onMouseDown);
  canv.addEventListener("mouseup",    onMouseUp);
  canv.addEventListener("touchmove",  onTouchMove,  { passive: false });
  canv.addEventListener("touchstart", onTouchStart, { passive: false });
  canv.addEventListener("touchend",   onTouchEnd);
}

/** Startet die Animations-Schleife mit requestAnimationFrame.
 *  Kapselt BeginFrame (uTime setzen) und EndFrame (Batch zeichnen), sodass
 *  der Aufrufer nur noch das Zeichnen bereitstellen muss – wie Go
 *  renderer.StartAnimation. */
export function startAnimation(fnDraw: () => void) {
  looping = true;
  const animate = () => {
    // BeginFrame
    const t = (performance.now() - startTime) / 1000;
    gl.uniform1f(locTime, t);

    fnDraw();

    // EndFrame: alle gesammelten Primitives des Frames zeichnen
    flushBatch();

    if (looping) window.requestAnimationFrame(animate);
  };
  window.requestAnimationFrame(animate);
}

/* =================================================================
   ÖFFENTLICHE API – Zeichenzustand
================================================================= */

/** Füllfarbe setzen.  Hex-String | Grau(0-255) | r,g,b | r,g,b,a (0-255) */
export function fillColor(...color: (string | number)[]) {
  state.fill = parseColor(...color);
}

/** Linienfarbe setzen.  Hex-String | Grau | r,g,b | r,g,b,a (0-255) */
export function strokeColor(...color: (string | number)[]) {
  state.stroke = parseColor(...color);
}

/** Linienstärke in Pixeln (betrifft stroke-Darstellung). */
export function strokeWidth(w: number) {
  state.lineW = w;
}

/** Aktiven Shader-Effekt wählen.
 *  "flat"     – einfache Volltonfarbe (Standard)
 *  "gradient" – radialer Verlauf von fillColor nach setGradient-Farbe
 *               (im Kamera-Raum, relativ zu setGradientCenter)
 *  "pulse"    – pulsierende Helligkeit über die Zeit
 */
export function setEffect(effect: EffectMode) {
  state.effect = effect;
}

/** Zweite Farbe für den Gradient-Effekt.
 *  Hex-String | Grau | r,g,b | r,g,b,a (0-255)
 */
export function setGradient(...color: (string | number)[]) {
  state.grad2 = parseColor(...color);
}

/** Hintergrundfarbe (löscht den gesamten Canvas inkl. Tiefenpuffer).
 *  Hex-String | Grau | r,g,b (Werte 0-255)
 *  Zeichnet zuerst noch nicht geflushte Primitives (wie Go Background).
 */
export function background(...color: (string | number)[]) {
  flushBatch();
  const c = parseColor(...color);
  gl.clearColor(c.r, c.g, c.b, c.a);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

/* =================================================================
   ÖFFENTLICHE API – 3D-Primitive
================================================================= */

/** Punktgröße in Pixeln setzen (betrifft point()-Zeichnung). */
export function pointSize(px: number) {
  pointSizeVal = px;
  gl.uniform1f(locPointSize, px);
}

/** 3D-Punkt bei (x,y,z) mit aktueller strokeColor, strokeWidth und pointSize. */
export function point(x: number, y: number, z: number) {
  submit(gl.POINTS, [x, y, z], true);
}

/** 3D-Linie von (x1,y1,z1) nach (x2,y2,z2). */
export function line(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
  submit(gl.LINES, [x1, y1, z1, x2, y2, z2], true);
}

/** 3D-Dreieck (fill/stroke).
 *  style: 0=stroke | 1=fill | 2=beide  (Standard: 0)
 */
export function triangle(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  style: DrawStyle = 0,
) {
  const pts = [x1, y1, z1, x2, y2, z2, x3, y3, z3];

  if (style === 1 || style === 2) {
    submit(gl.TRIANGLES, pts, false);
  }
  if (style === 0 || style === 2) {
    submit(gl.LINES, [x1,y1,z1, x2,y2,z2,  x2,y2,z2, x3,y3,z3,  x3,y3,z3, x1,y1,z1], true);
  }
}

/** 3D-Viereck mit 4 beliebigen Punkten.
 *  style: 0=stroke | 1=fill | 2=beide  (Standard: 0)
 */
export function shape(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  x4: number, y4: number, z4: number,
  style: DrawStyle = 0,
) {
  if (style === 1 || style === 2) {
    submit(gl.TRIANGLES, [x1,y1,z1, x2,y2,z2, x3,y3,z3,  x1,y1,z1, x3,y3,z3, x4,y4,z4], false);
  }
  if (style === 0 || style === 2) {
    submit(gl.LINES, [x1,y1,z1, x2,y2,z2, x2,y2,z2, x3,y3,z3, x3,y3,z3, x4,y4,z4, x4,y4,z4, x1,y1,z1], true);
  }
}

/** Achsenparalleles Rechteck in der XY-Ebene bei z=0.
 *  (x,y) = Mittelpunkt, w×h in der XY-Ebene.
 *  z = Höhe in Z-Richtung (Default: 0).
 *  style: 0=stroke | 1=fill | 2=beide  (Standard: 0)
 */
export function rect(x: number, y: number, w: number, h: number, style: DrawStyle = 0, z = 0) {
  const hw = w / 2, hh = h / 2;
  shape(x - hw, y - hh, z,  x + hw, y - hh, z,  x + hw, y + hh, z,  x - hw, y + hh, z, style);
}

/** 3D-Kreis (Ring) in der XY-Ebene bei z.
 *  (x,y,z) = Mittelpunkt.
 *  style:    0=stroke | 1=fill | 2=beide  (Standard: 0)
 *  segments: Anzahl der Dreiecks-Segmente  (Standard: 64)
 */
export function circle(
  x: number, y: number, z: number,
  radius: number,
  style: DrawStyle = 0,
  segments = 64,
) {
  const tau = Math.PI * 2;

  if (style === 1 || style === 2) {
    const fillVerts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i       / segments) * tau;
      const a1 = ((i + 1) / segments) * tau;
      fillVerts.push(x, y, z);
      fillVerts.push(x + Math.cos(a0) * radius, y + Math.sin(a0) * radius, z);
      fillVerts.push(x + Math.cos(a1) * radius, y + Math.sin(a1) * radius, z);
    }
    submit(gl.TRIANGLES, fillVerts, false);
  }

  if (style === 0 || style === 2) {
    const strokeVerts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * tau;
      strokeVerts.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z);
    }
    submit(gl.LINE_LOOP, strokeVerts, true);
  }
}

/** Beliebiges 3D-Polygon als flaches Zahlen-Array [x0,y0,z0, x1,y1,z1, ...].
 *  style: 0=stroke | 1=fill | 2=beide  (Standard: 0)
 *  Hinweis: fill ist korrekt nur für konvexe Polygone (Fan-Triangulation).
 */
export function polygon(pts: number[], style: DrawStyle = 0) {
  if (pts.length < 4) return;

  if (style === 1 || style === 2) {
    const fillVerts: number[] = [];
    for (let i = 1; i < pts.length / 3 - 1; i++) {
      fillVerts.push(pts[0], pts[1], pts[2],
                     pts[i*3], pts[i*3+1], pts[i*3+2],
                     pts[i*3+3], pts[i*3+4], pts[i*3+5]);
    }
    submit(gl.TRIANGLES, fillVerts, false);
  }
  if (style === 0 || style === 2) {
    submit(gl.LINE_LOOP, pts, true);
  }
}
