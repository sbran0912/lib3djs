export type Matrix4x4 = number[][];
export type Vec2 = { x: number; y: number; s: number }; // s = Skalierungsfaktor (für Punktgröße)

export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // ---- Arithmetik ----

  /** Vektoraddition: this + v */
  add(v: Vec3): Vec3 {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  /** Vektorsubtraktion: this - v */
  sub(v: Vec3): Vec3 {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  /** Skalarmultiplikation: this * s */
  scale(s: number): Vec3 {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  /** Auf eine bestimmte Ziel-Länge skalieren (Magnitude).
   *  Nullvektor bleibt null. */
  mag(m: number): Vec3 {
    const len = this.length();
    if (len === 0) return new Vec3(0, 0, 0);
    return this.scale(m / len);
  }

  /** Länge des Vektors auf einen Maximalwert begrenzen. */
  limit(max: number): Vec3 {
    const mSq = this.squaredLength();
    if (mSq > max * max) {
      return this.scale(max / Math.sqrt(mSq));
    }
    return this.clone();
  }

  /** Vorzeichen umkehren: -this */
  negate(): Vec3 {
    return new Vec3(-this.x, -this.y, -this.z);
  }

  // ---- Produkte & Betrag ----

  /** Skalarprodukt (dot product): this · v */
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** Kreuzprodukt (cross product): this × v */
  cross(v: Vec3): Vec3 {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }

  /** Quadrat der Länge (√-frei, performanter für Vergleiche) */
  squaredLength(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** Länge (Betrag) des Vektors */
  length(): number {
    return Math.sqrt(this.squaredLength());
  }

  /** Distanz zu einem anderen Vektor */
  distanceTo(v: Vec3): number {
    return this.sub(v).length();
  }

  // ---- Normalisierung & Interpolation ----

  /** Normalisierung – Einheitsvektor (Länge 1). Nullvektor bleibt null. */
  normalize(): Vec3 {
    const len = this.length();
    if (len === 0) return new Vec3(0, 0, 0);
    return this.scale(1 / len);
  }

  /** Lineare Interpolation: this + (v - this) * t  (t = 0 → this, t = 1 → v) */
  lerp(v: Vec3, t: number): Vec3 {
    return this.add(v.sub(this).scale(t));
  }

  // ---- Utility ----

  /** Kopie des Vektors */
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  /** Vergleich mit optionaler Toleranz (Default: 1e-10) */
  equals(v: Vec3, epsilon = 1e-10): boolean {
    return (
      Math.abs(this.x - v.x) < epsilon &&
      Math.abs(this.y - v.y) < epsilon &&
      Math.abs(this.z - v.z) < epsilon
    );
  }

  // ---- Transformation ----

  /** 4x4-Matrix-Transformation */
  transform(m: Matrix4x4): Vec3 {
    return new Vec3(
      m[0][0] * this.x + m[0][1] * this.y + m[0][2] * this.z + m[0][3],
      m[1][0] * this.x + m[1][1] * this.y + m[1][2] * this.z + m[1][3],
      m[2][0] * this.x + m[2][1] * this.y + m[2][2] * this.z + m[2][3],
    );
  }

  /** Wendet nur den Rotationsteil einer Matrix an (ohne Translation) – für
   *  Richtungen wie Licht-/Normalenvektoren (anders als transform(), das für
   *  Punkte auch die Translationsspalte einbezieht).
   *  Für M = View-Matrix (lookAtMatrix): deren Zeilen 0..2 sind die Kamera-
   *  Basisvektoren (right/realUp/forward), angewandt auf eine Weltrichtung
   *  ergeben sie deren Komponenten im Kamera-Koordinatensystem (Welt→Kamera,
   *  z. B. eine weltfeste Lichtrichtung). Für eine Modell-Matrix ist es
   *  Modell→Welt.
   */
  transformDir(m: Matrix4x4): Vec3 {
    return new Vec3(
      this.x * m[0][0] + this.y * m[0][1] + this.z * m[0][2],
      this.x * m[1][0] + this.y * m[1][1] + this.z * m[1][2],
      this.x * m[2][0] + this.y * m[2][1] + this.z * m[2][2],
    );
  }
}

// 4x4 Translationsmatrix
export function translateMatrix(dx: number, dy: number, dz: number): Matrix4x4 {
  return [
    [1, 0, 0, dx],
    [0, 1, 0, dy],
    [0, 0, 1, dz],
    [0, 0, 0, 1],
  ];
}

// 4x4 Rotationsmatrix (kombiniert)
export function rotateMatrix(ax: number, ay: number, az: number): Matrix4x4 {
  const Rx = [
    [1, 0, 0, 0],
    [0, Math.cos(ax), -Math.sin(ax), 0],
    [0, Math.sin(ax), Math.cos(ax), 0],
    [0, 0, 0, 1],
  ];

  const Ry = [
    [Math.cos(ay), 0, Math.sin(ay), 0],
    [0, 1, 0, 0],
    [-Math.sin(ay), 0, Math.cos(ay), 0],
    [0, 0, 0, 1],
  ];

  const Rz = [
    [Math.cos(az), -Math.sin(az), 0, 0],
    [Math.sin(az), Math.cos(az), 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];

  // Multipliziere (Ry * Rx) * Rz
  return multMatrix(Rz, multMatrix(Ry, Rx));
}

// 4x4 Matrixmultiplikation
export function multMatrix(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
  const result = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}

/** 4x4 Identitätsmatrix */
export function identityMatrix(): Matrix4x4 {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

/** Kombiniert View- und World-Matrix (view × world)
 *  Explizite Benennung macht die Absicht im draw()-Aufruf klarer.
 */
export function viewWorldMatrix(view: Matrix4x4, world: Matrix4x4): Matrix4x4 {
  return multMatrix(view, world);
}

/** LOOKAT-MATRIX (View-Matrix)
 * Erzeugt eine 4x4-Matrix, die Weltkoordinaten in Kamerakoordinaten transformiert.
 *
 * @param cameraPos  Position der Kamera im Weltraum
 * @param target     Punkt, den die Kamera anschaut
 * @param up         Vektor, der "oben" definiert (muss nicht normiert sein)
 * @returns 4x4-View-Matrix
 *
 * Beispiel:
 *   const view = lookAtMatrix(
 *     new Vec3(250, 120, -250),  // Kamera von rechts oben
 *     new Vec3(0, 0, 100),       // Blick auf die Szene
 *     new Vec3(0, 1, 0),         // Y zeigt nach oben
 *   );
 */
export function lookAtMatrix(cameraPos: Vec3, target: Vec3, up: Vec3): Matrix4x4 {
  // forward zeigt von der Kamera zum Target (Blickrichtung = +Z in Kamera-Koordinaten)
  const forward = target.sub(cameraPos).normalize();
  const right = forward.cross(up).normalize();
  const realUp = right.cross(forward);

  // View-Matrix: Kamera blickt in +Z-Richtung (kompatibel mit project())
  return [
    [right.x,        right.y,        right.z,       -right.dot(cameraPos)],
    [realUp.x,       realUp.y,       realUp.z,      -realUp.dot(cameraPos)],
    [forward.x,      forward.y,      forward.z,     -forward.dot(cameraPos)],
    [0,              0,              0,              1],
  ];
}

/** Transformiert einen Weltpunkt in Kamerakoordinaten (view × world).
 *  Der resultierende Vektor liegt im Kamera-Koordinatensystem
 *  und kann direkt an project() übergeben werden.
 */
export function worldToCamera(point: Vec3, view: Matrix4x4, world: Matrix4x4): Vec3 {
  return point.transform(multMatrix(view, world));
}

/** Rotiert einen Punkt um ein Pivot (Drehpunkt).
 *
 * @param point    Zu rotierender Punkt (Weltkoordinaten)
 * @param pivot    Drehpunkt (Pivot) in Weltkoordinaten
 * @param rotation 4x4-Rotationsmatrix (z.B. von rotateMatrix())
 * @returns Rotierter Punkt in Weltkoordinaten
 *
 * Beispiel:
 *   const rot = rotateMatrix(0, 0.5, 0);  // 0.5 rad um Y
 *   const p = rotateAround(new Vec3(2,0,0), new Vec3(0,0,0), rot);
 *   // p ≈ (1.755, 0, 0.959)
 */
export function rotateAround(point: Vec3, pivot: Vec3, rotation: Matrix4x4): Vec3 {
  // 1. Relativ zum Pivot
  const rel = point.sub(pivot);
  // 2. Rotation anwenden
  const rotated = rel.transform(rotation);
  // 3. Zurück ins Weltkoordinatensystem
  return rotated.add(pivot);
}

/** PROJEKTION (3D → 2D Bildschirm)
 * Projiziert einen 3D-Punkt auf den Bildschirm
 * @param fov - Field of View (Kamerawinkel)
 * @param v - 3D-Punkt im Kamerakoordinatensystem
 * @returns 2D-Bildschirmkoordinaten + Skalierungsfaktor
 *
 * HINWEIS: Für das 3D-Rendering wird diese Funktion nicht mehr verwendet.
 * Die Projektion übernimmt jetzt die GPU via perspectiveMatrix().
 * project() kann für 2D-Overlays weiter genutzt werden.
 */
export function project(fov: number, v: Vec3): Vec2 {
  const s = fov / (fov + v.z); // Projektionsfaktor
  return {
    x: v.x * s,
    y: v.y * s,
    s, // Skalierungsfaktor (nützlich z.B. für Punktgröße)
  };
}

/** PERSPEKTIV-PROJEKTIONSMATRIX (WebGL-kompatibel)
 * Erzeugt eine 4x4-Matrix, die Kamerakoordinaten in Clipspace transformiert.
 *
 * KONVENTION: Kamera blickt in +Z-Richtung (kompatibel mit lookAtMatrix()).
 *
 * @param fovY   Vertikales Sichtfeld in Radians (z.B. Math.PI/4 für 45°)
 * @param aspect Seitenverhältnis (width / height)
 * @param near   Distanz zur nahen Clipping-Ebene (> 0)
 * @param far    Distanz zur fernen Clipping-Ebene
 * @returns 4x4-Projektionsmatrix
 *
 * Beispiel:
 *   const proj = perspectiveMatrix(Math.PI / 4, 800 / 600, 0.1, 1000);
 */
export function perspectiveMatrix(fovY: number, aspect: number, near: number, far: number): Matrix4x4 {
  const f = 1.0 / Math.tan(fovY / 2);
  return [
    [f / aspect, 0, 0, 0],
    [0, f, 0, 0],
    [0, 0, (far + near) / (far - near), -2 * near * far / (far - near)],
    [0, 0, 1, 0],
  ];
}

/** EBENE (Plane)
 * Ebene im 3D-Raum, dargestellt als:
 * 
 *   n · x + d = 0
 * 
 * wobei:
 * - n = Normalenvektor (zeigt senkrecht aus der Ebene, muss normiert sein)
 * - d = Abstand der Ebene vom Ursprung (entlang der Normalenrichtung)
 * 
 * KONVENTION: y zeigt nach oben!
 * - Boden (XZ-Ebene bei y=0): n = (0, 1, 0), d = 0
 * - Decke (bei y=10): n = (0, -1, 0), d = 10
 * - Wand (bei x=5): n = (1, 0, 0), d = -5
 * 
 * Optional kann die Ebene durch ein konvexes Polygon (boundary) begrenzt werden.
 * Dann prüft intersectLine() automatisch, ob der Schnittpunkt innerhalb
 * des Polygons liegt.
 */
export class Plane {
  normal: Vec3;     // Normalenvektor (MUSS normiert sein!)
  distance: number; // d in n·x + d = 0

  /** Optionales begrenzendes Polygon (konvex, CCW-Winding bzgl. normal).
   *  Wenn gesetzt, liefert intersectLine() nur Treffer innerhalb des Polygons. */
  boundary?: Vec3[];

  constructor(normal: Vec3, distance: number, boundary?: Vec3[]) {
    this.normal = normal;
    this.distance = distance;
    this.boundary = boundary;
  }

  /**
   * Berechnet den Schnittpunkt einer Strecke (p1→p2) mit der Ebene.
   *
   * Wenn die Ebene eine boundary (Polygon) besitzt, wird zusätzlich geprüft,
   * ob der Schnittpunkt innerhalb des Polygons liegt.
   *
   * @param p1 Startpunkt der Strecke
   * @param p2 Endpunkt der Strecke
   * @returns Schnittpunkt (Vec3) oder null, wenn die Strecke die Ebene nicht
   *          schneidet (parallel zur Ebene oder Schnitt außerhalb der Strecke
   *          bzw. außerhalb des Polygons)
   *
   * Beispiel:
   *   const ground = new Plane(new Vec3(0, 1, 0), 0);
   *   const hit = ground.intersectLine(
   *     new Vec3(0, 5, 0),
   *     new Vec3(0, -5, 0),
   *   );
   *   // hit = (0, 0, 0)  ← Schnitt am Boden
   */
  intersectLine(p1: Vec3, p2: Vec3): Vec3 | null {
    const dir = p2.sub(p1);
    const denom = this.normal.dot(dir);

    // Strecke parallel zur Ebene → kein Schnitt
    if (Math.abs(denom) < 1e-10) return null;

    const t = -(this.normal.dot(p1) + this.distance) / denom;

    // Schnitt liegt außerhalb der Strecke
    if (t < 0 || t > 1) return null;

    const hit = p1.add(dir.scale(t));

    // Wenn die Ebene begrenzt ist → Polygon-Test
    if (this.boundary && !isPointInConvexPolygon(hit, this.boundary, this.normal)) {
      return null;
    }

    return hit;
  }
}

/**
 * Ebene aus einem Face (3 oder 4 Vertices) erstellen – mit Boundary.
 * Die ersten 3 Vertices definieren die Ebene, alle Vertices das Polygon.
 *
 * Beispiel: Vorderseite einer Box
 *   const front = createPlaneFromFace([
 *     boxVerts[0], boxVerts[3], boxVerts[2], boxVerts[1],
 *   ]);
 *   // front.intersectLine(p1, p2) prüft automatisch auf Polygon-Treffer
 */
export function createPlaneFromFace(faceVerts: Vec3[]): Plane {
  const normal = faceVerts[1].sub(faceVerts[0])
    .cross(faceVerts[2].sub(faceVerts[0]))
    .normalize();
  const distance = -normal.dot(faceVerts[0]);
  return new Plane(normal, distance, [...faceVerts]);
}

/**
 * Prüft, ob ein Punkt innerhalb eines konvexen Polygons liegt (Edge-Cross-Test).
 *
 * @param p        zu prüfender Punkt (auf der Polygonebene)
 * @param polygon  konvexes Polygon als Vec3-Array (CCW-Winding bzgl. `normal`)
 * @param normal   Normalenvektor der Polygonebene
 */
export function isPointInConvexPolygon(p: Vec3, polygon: Vec3[], normal: Vec3): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const edge = b.sub(a);
    const toPoint = p.sub(a);
    if (edge.cross(toPoint).dot(normal) < 0) return false;
  }
  return true;
}

export function constrain(value:number, min:number, max:number):number {
  return Math.min(max, Math.max(min, value));
}

export function random(n1:number, n2:number):number {
  return Math.floor(Math.random() * (n2 - n1) + n1);
}

export function randomFloat(min:number, max:number):number {
  return Math.random() * (max - min) + min;
}

