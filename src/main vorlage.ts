import * as wgl from "./lib3d/lib-wgl.ts";
import * as l3d from "./lib3d/lib-3d.ts";
import * as render from "./lib3d/lib-render.ts";
import { createGrid, createSphere } from "./lib3d/lib-body.ts";

function main() {
  const SCREEN_W = 1200;
  const SCREEN_H = 800;

  const CAM_POS    = new l3d.Vec3(50, 100, 200);
  const CAM_TARGET = new l3d.Vec3(0, 0, 0);
  const CAM_UP     = new l3d.Vec3(0, 1, 0);

  const FOV_Y  = 1.2;
  const Z_NEAR = 0.1;
  const Z_FAR  = 1000;

  // Weltfeste Lichtrichtung („Sonne“) – bleibt konsistent über die ganze Szene
  const SUN_DIR = new l3d.Vec3(0.5, 1.0, 0.3);

  const grid = createGrid(600, 24, 0, 0, 0, { color: "#777774", lineWidth: 1 });
  const ball = createSphere(20, 16, 12, 0, 16, 0, { color: "#d3ff44", lineWidth: 1 });

  let fpsFrames = 0;
  let fpsLastTime = performance.now();
  const fpsEl = document.createElement("div");
  fpsEl.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:10;padding:2px 8px;" +
    "font:bold 14px monospace;color:#fff;background:rgba(0,0,0,0.55);" +
    "border-radius:4px;pointer-events:none;user-select:none;";
  fpsEl.textContent = "FPS: --";
  document.body.appendChild(fpsEl);

  /** Einmal pro Frame aufrufen; aktualisiert die Anzeige ca. alle 0,5 s. */
  function updateFps() {
    fpsFrames++;
    const now = performance.now();
    const elapsed = now - fpsLastTime;
    if (elapsed >= 500) {
      fpsEl.textContent = `FPS: ${Math.round((fpsFrames * 1000) / elapsed)}`;
      fpsFrames = 0;
      fpsLastTime = now;
    }
  }

  // ====================================================================
  // DRAW-SCHLEIFE  (pro Frame)
  // ====================================================================
  function draw() {
    updateFps();
    // Hintergrund + Nebel
    wgl.background(40, 40, 40);
    wgl.setFog(100, 400, 0.25, 0.25, 0.25, 1);

    // Matrizen: Blick (View) + Perspektive (Projektion)
    const view = l3d.lookAtMatrix(CAM_POS, CAM_TARGET, CAM_UP);
    const proj = l3d.perspectiveMatrix(FOV_Y, wgl.getWidth() / wgl.getHeight(), Z_NEAR, Z_FAR);
    wgl.setProjection(proj);
    wgl.setView(view);

    // Lichtrichtung der „Sonne“ in den Kameraraum drehen
    const camLight = SUN_DIR.transformDir(view);
    wgl.setLightDirection(camLight.x, camLight.y, camLight.z);

    // OPTIONAL (Animation demonstrieren): Kugel rotieren lassen
    ball.rotY += 0.01;

    // Objekte zeichnen (Bodengitter zuerst für korrekte Tiefe)
    render.drawBody(grid);
    render.drawBody(ball);
  }

  wgl.init(SCREEN_W, SCREEN_H);
  wgl.startAnimation(draw);

}
main()