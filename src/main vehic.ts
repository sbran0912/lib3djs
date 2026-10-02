// ====================================================================
// VEHICLE-SIMULATION – Port von Go lib3d_gl_go/main.go (1:1)
// --------------------------------------------------------------------
// Fahrzeuge (Pyramiden) mit Steering Behaviors: Sie suchen gutes Futter
// (grüne Kugeln) und meiden Gift (rote Kugeln), gesteuert durch DNA-Werte.
// Zusätzlich werden pro Fahrzeug Debug-Overlays gezeichnet:
// Heading-Pfeil (Fahrtrichtung) + DNA-Suchradien als Kreise.
// ====================================================================
import * as wgl from "./lib3d/lib-wgl.ts";
import * as l3d from "./lib3d/lib-3d.ts";
import * as render from "./lib3d/lib-render.ts";
import { Body, createGrid } from "./lib3d/lib-body.ts";
import { createPyramidSolid, createSphereSolid } from "./lib3d/lib-solids.ts";
import type { Solid } from "./lib3d/lib-solids.ts";

// ====================================================================
// VEHICLE – Physik-fähiges Fahrzeug mit Steering Behaviors
// ====================================================================
class Vehicle {
  body: Body;
  vel: l3d.Vec3;
  accel: l3d.Vec3;
  heading: l3d.Vec3;
  health: number;
  dna: [number, number, number, number];

  constructor(body: Body) {
    this.body = body;
    this.vel = new l3d.Vec3(0, 0, 0);
    this.accel = new l3d.Vec3(0, 0, 0);
    this.heading = new l3d.Vec3(0, 0, 0);
    this.health = 1;
    this.dna = [
      l3d.randomFloat(-1.0, 1.0),  // dna[0]: Kraft Richtung Gift
      l3d.randomFloat(-1.0, 1.0),  // dna[1]: Kraft Richtung gutes Futter
      l3d.randomFloat(20.0, 60.0), // dna[2]: Radius für Gift
      l3d.randomFloat(20.0, 60.0), // dna[3]: Radius für gutes Futter
    ];
  }

  /** Richtung des Bodys an die aktuelle Geschwindigkeit anpassen. */
  alignToVelocity() {
    const v = this.vel;
    const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (mag < 0.0001) return;

    const magXZ = Math.sqrt(v.x * v.x + v.z * v.z);

    // v.y/mag muss in [-1,1] liegen (Schutz vor NaN durch Float-Rundung)
    const cosY = l3d.constrain(v.y / mag, -1, 1);
    this.body.rotX = Math.acos(cosY);
    this.body.rotY = magXZ < 0.0001 ? 0 : Math.atan2(v.x / magXZ, v.z / magXZ);
    this.body.rotZ = 0;

    // heading als normalisierte Richtung ableiten
    this.heading = new l3d.Vec3(v.x / mag, v.y / mag, v.z / mag);
  }

  /** Kraft auf das Fahrzeug anwenden (akkumuliert in accel). */
  applyForce(force: l3d.Vec3) {
    this.accel = this.accel.add(force);
  }

  /** Physik-Update: Geschwindigkeit aus Beschleunigung, Position aus Geschwindigkeit. */
  update() {
    this.vel = this.vel.add(this.accel);
    const speed = this.vel.length();
    // Geschwindigkeit auf [0.5, 2.0] begrenzen (wie Go constrainNum)
    this.vel = this.vel.normalize().scale(l3d.constrain(speed, 0.5, 2.0));
    this.accel = new l3d.Vec3(0, 0, 0);
    this.body.pos = this.body.pos.add(this.vel);
  }

  /**
   * Steering: Seek-Verhalten.
   * Die gewünschte Richtung wird je nach Futter-Art mit dem passenden
   * DNA-Wert skaliert (dna[0] für Gift, dna[1] für gutes Futter).
   */
  seek(target: l3d.Vec3, isBadFood: boolean) {
    let desired = target.sub(this.body.pos).limit(3);
    desired = desired.scale(isBadFood ? this.dna[0] : this.dna[1]);

    const steer = desired.sub(this.vel).limit(2);
    this.applyForce(steer.scale(0.2));
  }
}

/** Erzeugt `count` Futter-Körper an Zufallspositionen (gemeinsames Mesh). */
function createFood(count: number, color: string, mesh: Solid): Body[] {
  const food: Body[] = [];
  for (let i = 0; i < count; i++) {
    food.push(new Body(mesh, l3d.random(-100, 100), l3d.random(-100, 100), l3d.random(-100, 100), { color, lineWidth: 1 }));
  }
  return food;
}

/** Füllt das Futter-Array auf: sind weniger als `min` vorhanden, kommen `count` neue dazu. */
function respawnFood(food: Body[], mesh: Solid, min: number, count: number, color: string): Body[] {
  if (food.length < min) {
    for (let i = 0; i < count; i++) {
      food.push(new Body(mesh, l3d.random(-100, 100), l3d.random(-100, 100), l3d.random(-100, 100), { color, lineWidth: 1 }));
    }
  }
  return food;
}

/**
 * Vehicle sucht das nächste Futter im DNA-Radius und frisst es, wenn es nah genug ist.
 * - gutes Futter  → health +0.1
 * - Gift          → health -0.1
 * Ansonsten wird es angesteuert (seek).
 */
function vehicleEatFood(vehic: Vehicle, food: Body[], isBadFood: boolean) {
  const filter = isBadFood ? vehic.dna[2] : vehic.dna[3];
  let mindist = Infinity;
  let idx = -1;

  for (let i = 0; i < food.length; i++) {
    const distance = vehic.body.pos.distanceTo(food[i].pos);
    if (distance < filter && distance < mindist) {
      mindist = distance;
      idx = i;
    }
  }

  if (idx > -1) {
    if (vehic.body.pos.distanceTo(food[idx].pos) < 3) {
      // Food aufessen: aus dem Array entfernen genügt – es gibt keinen
      // GPU-Buffer/Refcount mehr freizugeben (nur CPU-Geometrie).
      food.splice(idx, 1);
      vehic.health += isBadFood ? -0.1 : 0.1;
    } else {
      vehic.seek(food[idx].pos, isBadFood);
    }
  }
}

/** Weltgrenzen: Geschwindigkeit an den Rändern umkehren (Bounce). */
function vehicBoundary(vehic: Vehicle) {
  const minX = -130, maxX = 130;
  const minY = -130, maxY = 130;
  const minZ = -130, maxZ = 130;

  if (vehic.body.pos.x < minX || vehic.body.pos.x > maxX) vehic.vel.x *= -1;
  if (vehic.body.pos.y < minY || vehic.body.pos.y > maxY) vehic.vel.y *= -1;
  if (vehic.body.pos.z < minZ || vehic.body.pos.z > maxZ) vehic.vel.z *= -1;
}

/** True, wenn das Vehicle tot ist (health < 0). */
function vehicIsDead(vehic: Vehicle): boolean {
  return vehic.health < 0;
}

// ====================================================================
// KONFIGURATION  (wie Go main.go: Init(1400, 800), Kamera (50,20,200))
// ====================================================================

const SCREEN_W = 1400;
const SCREEN_H = 800;

const CAM_POS    = new l3d.Vec3(50, 20, 200);
const CAM_TARGET = new l3d.Vec3(0, 0, 0);
const CAM_UP     = new l3d.Vec3(0, 1, 0);

const FOV_Y = 1.2;
const Z_NEAR = 0.1;
const Z_FAR = 1000;

// Weltfeste Lichtrichtung („Sonne“) – bleibt konsistent über die ganze Szene
const SUN_DIR = new l3d.Vec3(0.5, 1.0, 0.3);

// ====================================================================
// SZENE AUFBAUEN
// ====================================================================

// Bodengitter (solidGrid(600, 24))
const grid = createGrid(600, 24, 0, 0, 0, { color: "#777774", lineWidth: 1 });

// Futter-Mesh: Kugel mit Radius 3 (solidSphere(3, 8, 8))
const foodMesh = createSphereSolid(3, 8, 8);

// 30× Gift (rot) und 30× gutes Futter (grün)
let poison = createFood(30, "#FF0000", foodMesh);
let food = createFood(30, "#44ff44", foodMesh);

// Vehicle-Mesh: Pyramide (solidPyramid(2, 6))
const vehicleMesh = createPyramidSolid(2, 6);

// 10 Fahrzeuge mit zufälliger Startgeschwindigkeit
const vehicles: Vehicle[] = [];
for (let i = 0; i < 10; i++) {
  const vehic = new Vehicle(new Body(vehicleMesh, 0, 20, 100));
  vehic.vel = new l3d.Vec3(l3d.randomFloat(-2, 2), l3d.randomFloat(-2, 2), l3d.randomFloat(-2, 2));
  vehicles.push(vehic);
}

// ====================================================================
// DRAW-SCHLEIFE (1:1-Port der Go Render-Schleife in main.go)
// ====================================================================

function draw() {
  wgl.background(40, 40, 40);

  const view = l3d.lookAtMatrix(CAM_POS, CAM_TARGET, CAM_UP);
  const proj = l3d.perspectiveMatrix(FOV_Y, wgl.getWidth() / wgl.getHeight(), Z_NEAR, Z_FAR);
  wgl.setProjection(proj);
  wgl.setView(view);

  // Weltfeste „Sonne“: Die Richtung ist im Weltraum fix und wird pro Frame in
  // den Kameraraum gedreht – so bleibt die Beleuchtung über die ganze Szene
  // konsistent, unabhängig von Objektposition oder Kamera.
  const camLight = SUN_DIR.transformDir(view);
  wgl.setLightDirection(camLight.x, camLight.y, camLight.z);

  // Bodengitter
  render.drawBody(grid);

  // Futter nachwachsen lassen (min 20, +30 pro Respawn)
  food = respawnFood(food, foodMesh, 20, 30, "#44ff44");
  poison = respawnFood(poison, foodMesh, 20, 30, "#FF0000");

  // Altern: mit 1.5% Wahrscheinlichkeit pro Frame altern alle Fahrzeuge
  const getOlder = l3d.randomFloat(0, 1) < 0.015;

  // Fahrzeuge simulieren (rückwärts, damit Entfernen beim Iterieren ok ist)
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];

    vehicBoundary(v);
    vehicleEatFood(v, food, false);   // gutes Futter
    vehicleEatFood(v, poison, true);  // Gift
    v.alignToVelocity();
    v.update();

    // Farbe nach Gesundheit: rot wenn schwach, sonst weiß
    v.body.color = v.health < 0.5 ? "#FF0000" : "#ffffff";

    render.drawBody(v.body);

    if (getOlder) v.health -= 0.05;

    if (vehicIsDead(v)) {
      // Kein GPU-Aufräumen mehr nötig – der Body hält nur CPU-Geometrie.
      // Entfernen aus dem Array genügt.
      vehicles.splice(i, 1);
    }
  }

  // Futter zeichnen
  for (const p of poison) render.drawBody(p);
  for (const f of food) render.drawBody(f);

  // Debug-Overlays (Batched Drawing): Heading-Pfeile + DNA-Radien.
  // Die Primitives werden nur gesammelt und am Frame-Ende in einem
  // einzigen VBO gezeichnet (kein GenBuffers/DeleteBuffers pro Call).
  // Primitives liegen automatisch im Weltraum (Model = Identität).
  for (const v of vehicles) {
    const hp = v.body.pos;

    // Heading-Pfeil: Linie vom Fahrzeug in Fahrtrichtung.
    const end = hp.add(v.heading.scale(8));
    render.drawLine(
      hp.x, hp.y, hp.z, end.x, end.y, end.z,
      { stroke: v.health < 0.5 ? "#ff4444" : "#ffffff" },
    );

    // DNA-Radien als Kreise in der XZ-Ebene. drawCircle(x,y,z) zeichnet in
    // der XY-Ebene – durch den Tausch (x, z, y) liegt der Kreis flach.
    render.drawCircle(hp.x, hp.z, hp.y, v.dna[3], { stroke: [51, 255, 51, 64], segments: 48 });  // guter Food-Radius
    render.drawCircle(hp.x, hp.z, hp.y, v.dna[2], { stroke: [255, 51, 51, 64], segments: 48 });  // Gift-Radius
  }
}

// ====================================================================
// START
// ====================================================================

wgl.init(SCREEN_W, SCREEN_H);
wgl.setFog(100, 400, 0.25, 0.25, 0.25, 1); // wie Go main.go: SetFog(100, 400, …)
wgl.startAnimation(draw);
