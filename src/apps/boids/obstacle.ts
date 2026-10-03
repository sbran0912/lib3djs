// ====================================================================
// FLOATINGBOX – schwebendes Hindernis (Port von Go obstacle.go)
// --------------------------------------------------------------------
// Ein Body mit Grundposition, sanfter Auf-und-Ab-Bewegung und langsamer
// Rotation. Der Bounding-Sphere-Radius dient als schneller Vorab-Test
// für die Kollisionserkennung.
// ====================================================================
import * as l3d from "../../lib3d/lib-3d.ts";
import { Body } from "../../lib3d/lib-body.ts";
import type { Solid } from "../../lib3d/lib-solids.ts";

export class FloatingBox {
  body: Body;
  base: l3d.Vec3;
  phase: number;
  spin: number;
  radius: number; // Bounding-Sphere-Radius für den schnellen Vorab-Test

  /** Erstellt eine schwebende Hindernis-Box an Position `pos`. */
  constructor(mesh: Solid, pos: l3d.Vec3, color: string, phase: number, spin: number) {
    let radius = 0;
    for (const vert of mesh.vertices) {
      const l = vert.length();
      if (l > radius) radius = l;
    }

    this.body = new Body(mesh, pos.x, pos.y, pos.z, { color, lineWidth: 1.5 });
    this.base = pos;
    this.phase = phase;
    this.spin = spin;
    this.radius = radius;
  }

  /** Animiert die Box (Schweben + Rotation). `t` ist die Zeit in Sekunden. */
  update(t: number) {
    this.body.pos = new l3d.Vec3(
      this.base.x,
      this.base.y + Math.sin(t + this.phase) * 6,
      this.base.z,
    );
    this.body.rotY = t * this.spin;
    this.body.rotX = Math.sin(t * 0.6 + this.phase) * 0.3;
  }
}
