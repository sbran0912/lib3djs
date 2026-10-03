// ====================================================================
// BOIDS – Port der Go-App lib3dgo/apps/boids (main.go)
// --------------------------------------------------------------------
// 50 Boids (Pyramiden) mit den Flocking-Regeln Alignment, Separation und
// Cohesion, Weltgrenzen und Ausweichen vor sieben schwebenden Hindernis-
// Boxen. Bei gedrückter Maustaste streben alle Boids zum Ursprung.
// ====================================================================
import * as wgl from "../../lib3d/lib-wgl.ts";
import * as l3d from "../../lib3d/lib-3d.ts";
import * as render from "../../lib3d/lib-render.ts";
import { Body } from "../../lib3d/lib-body.ts";
import { createBoxSolid, createGridSolid, createPyramidSolid } from "../../lib3d/lib-solids.ts";
import { Vehicle } from "./vehicle.ts";
import { FloatingBox } from "./obstacle.ts";

function main() {
  // ====================================================================
  // KONFIGURATION  (wie Go main.go: Init(1600, 1000), Kamera (50,20,200))
  // ====================================================================

  const SCREEN_W = 1600;
  const SCREEN_H = 1000;

  const CAM_POS    = new l3d.Vec3(50, 20, 200);
  const CAM_TARGET = new l3d.Vec3(0, 0, 0);
  const CAM_UP     = new l3d.Vec3(0, 1, 0);

  const FOV_Y  = 1.2;
  const Z_NEAR = 0.1;
  const Z_FAR  = 1000;
  const VEHICLE_COUNT = 50;

  // Weltfeste Lichtrichtung („Sonne“) – bleibt konsistent über die ganze Szene
  const SUN_DIR = new l3d.Vec3(0.5, 1.0, 0.3);

  wgl.init(SCREEN_W, SCREEN_H);
  wgl.setFog(100.0, 400.0, 0.25, 0.25, 0.25, 1.0);

  // ====================================================================
  // SZENE AUFBAUEN
  // ====================================================================

  // Bodengitter (createGridSolid(600, 24))
  const grid = new Body(createGridSolid(600, 24), 0, 0, 0, { color: "#777774", lineWidth: 1.0 });

  // Boid-Mesh: Pyramide (createPyramidSolid(2, 6))
  const vehicMesh = createPyramidSolid(2, 6);
  const vehics: Vehicle[] = [];
  for (let i = 0; i < VEHICLE_COUNT; i++) {
    const vehic = new Vehicle(new Body(vehicMesh, 0, 20, 100));
    vehic.body.vel = new l3d.Vec3(
      l3d.randomFloat(-2, 2),
      l3d.randomFloat(-2, 2),
      l3d.randomFloat(-2, 2),
    );
    vehics.push(vehic);
  }

  // Sieben schwebende Boxen als Hindernisse für die Boids.
  const boxMesh = createBoxSolid(40, 40, 40);
  const obstacles: FloatingBox[] = [
    new FloatingBox(boxMesh, new l3d.Vec3(-90, 40, -50), "#e06c5a", 0.0, 0.35),
    new FloatingBox(boxMesh, new l3d.Vec3(60, 70, 20), "#5aa9e0", 1.7, -0.25),
    new FloatingBox(boxMesh, new l3d.Vec3(10, 60, -90), "#8ad06a", 3.1, 0.2),
    new FloatingBox(boxMesh, new l3d.Vec3(80, 0, -40), "#ff6b6b", 2.5, 0.15),
    new FloatingBox(boxMesh, new l3d.Vec3(-40, 100, 40), "#4ecdc4", 4.2, -0.3),
    new FloatingBox(boxMesh, new l3d.Vec3(-110, 80, 80), "#f4a259", 5.5, 0.28),
    new FloatingBox(boxMesh, new l3d.Vec3(120, 50, -80), "#b07ce8", 0.9, -0.22),
  ];
  const OBSTACLE_MARGIN = 20.0;

  const start = performance.now();

  // ====================================================================
  // DRAW-SCHLEIFE (1:1-Port der Go Render-Schleife in main.go)
  // ====================================================================

  function draw() {
    wgl.background(40, 40, 40);

    const view = l3d.lookAtMatrix(CAM_POS, CAM_TARGET, CAM_UP);
    const proj = l3d.perspectiveMatrix(FOV_Y, wgl.getWidth() / wgl.getHeight(), Z_NEAR, Z_FAR);
    wgl.setProjection(proj);
    wgl.setView(view);

    const camLight = SUN_DIR.transformDir(view);
    wgl.setLightDirection(camLight.x, camLight.y, camLight.z);

    render.drawBody(grid);

    // Hindernisse animieren und zeichnen.
    const now = (performance.now() - start) / 1000;
    for (const o of obstacles) {
      o.update(now);
      render.drawBody(o.body);
    }

    for (const v of vehics) {
      if (wgl.isMouseDown()) {
        v.seek(new l3d.Vec3(0, 0, 0));
      }
      v.align(vehics);
      v.separate(vehics);
      v.cohesion(vehics);
      v.applyBoundary();
      v.avoidObstacles(obstacles, OBSTACLE_MARGIN);
      v.alignToVelocity();
      v.update();
      render.drawBody(v.body);
    }
  }

  // ====================================================================
  // START
  // ====================================================================

  wgl.startAnimation(draw);
}
main()
