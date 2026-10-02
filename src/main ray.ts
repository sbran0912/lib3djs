// ====================================================================
// RAY-DEMO – Port von Go lib3d_gl_go/main.go_ray (1:1)
// --------------------------------------------------------------------
// Zeigt Line↔Body-Intersection: Ein Lichtkegel (20 Strahlen) rotiert um
// die Y-Achse und wird an den Boxen/Pyramide „abgeschnitten“ (Clipping).
// Kamera kreist um die Szene.
// ====================================================================
import * as wgl from "./lib3d/lib-wgl.ts";
import * as l3d from "./lib3d/lib-3d.ts";
import * as render from "./lib3d/lib-render.ts";
import { Body } from "./lib3d/lib-body.ts";
import { createBoxSolid, createGridSolid, createPyramidSolid } from "./lib3d/lib-solids.ts";

function main() {
  // ====================================================================
  // KONFIGURATION  (wie Go main.go_ray: Init(1600, 1000))
  // ====================================================================

  const SCREEN_W = 1600;
  const SCREEN_H = 1000;

  const FOV_Y = 1.2;
  const Z_NEAR = 0.1;
  const Z_FAR = 1000;

  const coneLines = 20;

  const CAM_TARGET = new l3d.Vec3(0, 0, 0);
  const CAM_UP     = new l3d.Vec3(0, 1, 0);
  const CAM_RADIUS = Math.sqrt(40 * 40 + 180 * 180);
  const CAM_HEIGHT = 140;

  // ====================================================================
  // SZENE AUFBAUEN  (wie Go main.go_ray)
  // ====================================================================

  const boxMesh = createBoxSolid(100, 80, 60); // CPU-Geometrie; Upload in den GPU-Batch pro Frame
  const pyrMesh = createPyramidSolid(90, 120);
  //const gridMesh = createGridSolid(600, 24);

  //const grid = new Body(gridMesh, 0, 0, 0, { color: "#777774", lineWidth: 1 });

  const box1 = new Body(boxMesh, 150, 0, 50,   { color: "#ff0000", lineWidth: 2 });
  const box2 = new Body(boxMesh, 0, 0, 100,    { color: "#00ffff", lineWidth: 2 });
  const box3 = new Body(boxMesh, -150, 0, -100,{ color: "#ff0000", lineWidth: 2 });
  const box4 = new Body(boxMesh, -200, 0, 30,  { color: "#00ffff", lineWidth: 2, rotY: Math.PI / 2 });
  const pyr1 = new Body(pyrMesh, 100, 0, -100); // Default: weiß, lineWidth 1

  const bodies = [/*grid,*/ box1, box2, box3, box4, pyr1];

  // ====================================================================
  // DRAW-SCHLEIFE (1:1-Port der Go Render-Schleife in main.go_ray)
  // ====================================================================

  let timeAccum = 0;
  let coneRotY = 0;
  let frameCount = 0;
  let fpsLast = 0;

  function draw() {
    timeAccum += 0.02;
    frameCount++;
    const now = performance.now() / 1000;
    if (now - fpsLast >= 2.0) {
      console.log(`FPS: ${((frameCount / (now - fpsLast))).toFixed(1)}`);
      frameCount = 0;
      fpsLast = now;
    }

    const camAngle = timeAccum * 0.15;
    const camPos = new l3d.Vec3(Math.sin(camAngle) * CAM_RADIUS, CAM_HEIGHT, Math.cos(camAngle) * CAM_RADIUS);
    const view = l3d.lookAtMatrix(camPos, CAM_TARGET, CAM_UP);
    const proj = l3d.perspectiveMatrix(FOV_Y, wgl.getWidth() / wgl.getHeight(), Z_NEAR, Z_FAR);
    const sunDir = new l3d.Vec3(1, 0, 0);
    const camLight = sunDir.transformDir(view);
    wgl.setLightDirection(camLight.x, camLight.y, camLight.z);

    wgl.setProjection(proj);
    wgl.setView(view);
    wgl.background(40, 40, 40);

    // Alle Bodies zeichnen (Grid zuerst für korrekte Tiefe)
    for (const b of bodies) {
      render.drawBody(b);
    }

    // Lichtkegel rotieren
    coneRotY += 0.01;
    const coneRot = l3d.rotateMatrix(0, coneRotY, 0);

    // Clipping-Ebenen der Bodies (pro Frame neu, wie Go)
    const allPlanes = bodies.map(b => b.getFacePlanes());

    // --- Rays ---
    const apex = new l3d.Vec3(0, 0, 0);
    const coneLen = 600;
    const coneAngle = Math.PI / 60;
    const coneR = coneLen * Math.sin(coneAngle);
    const coneZ = coneLen * Math.cos(coneAngle);

    for (let i = 0; i < coneLines; i++) {
      const a = (2.0 * Math.PI * i) / coneLines;
      const end = new l3d.Vec3(
        apex.x + Math.cos(a) * coneR,
        apex.y + Math.sin(a) * coneR,
        apex.z + coneZ,
      );

      const rotatedEnd = l3d.rotateAround(end, apex, coneRot);
      let endpoint = rotatedEnd;
      let maxDist = rotatedEnd.sub(apex).squaredLength();

      for (const planes of allPlanes) {
        for (const face of planes) {
          const hit = face.intersectLine(apex, rotatedEnd);
          if (hit) {
            const dist = hit.sub(apex).squaredLength();
            if (dist < maxDist) {
              endpoint = hit;
              maxDist = dist;
            }
          }
        }
      }

      render.drawLine(
        apex.x, apex.y, apex.z, endpoint.x, endpoint.y, endpoint.z,
        { stroke: "#ff8800", lineWidth: 1 },
      );
      render.drawPoint(
        endpoint.x, endpoint.y, endpoint.z,
        { stroke: "#ff0000", pointSize: 5 },
      );
    }
  }

  // ====================================================================
  // START
  // ====================================================================

  wgl.init(SCREEN_W, SCREEN_H);
  wgl.setFog(100, 600, 0.25, 0.25, 0.25, 1);
  wgl.startAnimation(draw);
}
main()
