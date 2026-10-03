// ====================================================================
// VEHICLE – autonomes Boid mit Steering Behaviors (Port von Go vehicle.go)
// --------------------------------------------------------------------
// Umsetzt die Flocking-Regeln Alignment, Separation und Cohesion sowie
// Weltgrenzen und Hindernis-Ausweichen.
// ====================================================================
import * as l3d from "../../lib3d/lib-3d.ts";
import type { Body } from "../../lib3d/lib-body.ts";
import type { FloatingBox } from "./obstacle.ts";

export class Vehicle {
  body: Body;
  accel: l3d.Vec3;
  heading: l3d.Vec3;

  constructor(body: Body) {
    this.body = body;
    this.accel = new l3d.Vec3(0, 0, 0);
    this.heading = new l3d.Vec3(0, 0, 0);
  }

  /** Richtet den Body an der Geschwindigkeit aus. */
  alignToVelocity() {
    const vel = this.body.vel;

    const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (mag < 0.0001) return;

    const magXZ = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

    // vel.y/mag muss in [-1,1] liegen (Schutz vor NaN durch Float-Rundung)
    const cosY = l3d.constrain(vel.y / mag, -1, 1);
    this.body.rotX = Math.acos(cosY);
    this.body.rotY = magXZ < 0.0001 ? 0 : Math.atan2(vel.x / magXZ, vel.z / magXZ);
    this.body.rotZ = 0;

    // heading als normalisierte Richtung ableiten
    this.heading = new l3d.Vec3(vel.x / mag, vel.y / mag, vel.z / mag);
  }

  /** Kraft auf das Fahrzeug anwenden (akkumuliert in accel). */
  applyForce(force: l3d.Vec3) {
    this.accel = this.accel.add(force);
  }

  /** Integriert die Bewegung und begrenzt die Geschwindigkeit. */
  update() {
    this.body.vel = this.body.vel.add(this.accel);
    const speed = this.body.vel.length();
    this.body.vel = this.body.vel.normalize().scale(l3d.constrain(speed, 0.5, 2.0));

    this.accel = new l3d.Vec3(0, 0, 0);
    this.body.pos = this.body.pos.add(this.body.vel);
  }

  /** Steuert das Fahrzeug in Richtung eines Ziels. */
  seek(target: l3d.Vec3) {
    const desired = target.sub(this.body.pos).limit(3.0);
    const steer = desired.sub(this.body.vel).limit(2.0);
    this.applyForce(steer.scale(0.2));
  }

  /** Flocking-Regel: Alignment – eigene Geschwindigkeit an Nachbarn angleichen. */
  align(vehics: Vehicle[]) {
    const minDistance = 50.0;
    let sumVel = new l3d.Vec3(0, 0, 0);
    let count = 0;

    for (const other of vehics) {
      const distance = this.body.pos.distanceTo(other.body.pos);
      if (distance > 0 && distance < minDistance) {
        sumVel = sumVel.add(other.body.vel);
        count++;
      }
    }

    if (count > 0) {
      sumVel = sumVel.scale(1 / count); // Durchschnittsgeschwindigkeit
      sumVel = sumVel.mag(0.1);
      const steer = sumVel.sub(this.body.vel).scale(0.1);
      this.applyForce(steer);
    }
  }

  /** Flocking-Regel: Separation – Abstand zu nahen Nachbarn halten. */
  separate(vehics: Vehicle[]) {
    const minDistance = 40.0;
    let diffSum = new l3d.Vec3(0, 0, 0);
    let count = 0;

    for (const other of vehics) {
      const distance = this.body.pos.distanceTo(other.body.pos);
      if (distance > 0 && distance < minDistance) {
        const diff = this.body.pos.sub(other.body.pos).normalize();
        diffSum = diffSum.add(diff);
        count++;
      }
    }

    if (count > 0) {
      diffSum = diffSum.scale(1 / count); // Durchschnitt
      diffSum = diffSum.mag(0.1);
      const steer = diffSum.sub(this.body.vel).scale(0.1);
      this.applyForce(steer);
    }
  }

  /** Flocking-Regel: Kohäsion – in Richtung des Schwerpunkts der Nachbarn. */
  cohesion(vehics: Vehicle[]) {
    const minDistance = 50.0;
    let sumPos = new l3d.Vec3(0, 0, 0);
    let count = 0;

    for (const other of vehics) {
      const distance = this.body.pos.distanceTo(other.body.pos);
      if (distance > 0 && distance < minDistance) {
        sumPos = sumPos.add(other.body.pos);
        count++;
      }
    }

    if (count > 0) {
      sumPos = sumPos.scale(1 / count); // Schwerpunkt der Nachbarn
      let desired = sumPos.sub(this.body.pos); // Richtung zur Gruppenmitte
      desired = desired.mag(0.1);
      const steer = desired.sub(this.body.vel).scale(0.1);
      this.applyForce(steer);
    }
  }

  /** Reflektiert die Geschwindigkeit an den Weltgrenzen. */
  applyBoundary() {
    const minX = -200.0, maxX = 200.0;
    const minY = -130.0, maxY = 130.0;
    const minZ = -130.0, maxZ = 130.0;

    if (this.body.pos.x < minX || this.body.pos.x > maxX) this.body.vel.x *= -1.0;
    if (this.body.pos.y < minY || this.body.pos.y > maxY) this.body.vel.y *= -1.0;
    if (this.body.pos.z < minZ || this.body.pos.z > maxZ) this.body.vel.z *= -1.0;
  }

  /**
   * Hält das Vehicle mit einem Sicherheitsabstand (`margin`) außerhalb der
   * schwebenden Boxen. Die Kollisionserkennung nutzt die konvexen
   * Flächen-Ebenen des Hindernisses (`Body.getFacePlanes`) und einen
   * Abstands-Test auf Basis der Ebenengleichung.
   */
  avoidObstacles(obstacles: FloatingBox[], margin: number) {
    for (const o of obstacles) {
      // Schneller Vorab-Test (Bounding Sphere).
      if (this.body.pos.distanceTo(o.body.pos) > o.radius + margin) continue;

      const planes = o.body.getFacePlanes();
      if (planes.length === 0) continue;

      // Außen: die getroffene Fläche mit kleinstem positiven Abstand ist die
      // nächste Oberfläche. Innen: alle Abstände negativ → größter signed
      // distance zeigt auf die Fläche, die zum Herauschieben am nächsten liegt.
      // Kanten/Ecken außen: kein Flächentreffer → größter signed distance als
      // konservative Untergrenze.
      let nearest = Infinity;
      let signed = 0.0;
      let normal = new l3d.Vec3(0, 0, 0);
      let deepest = -Infinity;
      let deepestNormal = new l3d.Vec3(0, 0, 0);

      for (const p of planes) {
        // Signed distance zur Ebene (EINMAL berechnet).
        const dist = p.normal.dot(this.body.pos) + p.distance;
        // Projektion auf die Fläche und Test, ob sie innerhalb liegt.
        const proj = this.body.pos.sub(p.normal.scale(dist));
        const within = l3d.isPointInConvexPolygon(proj, p.boundary!, p.normal);

        if (dist > deepest) {
          deepest = dist;
          deepestNormal = p.normal;
        }

        if (within && dist > 0 && dist < nearest) {
          nearest = dist;
          signed = dist; // Wiederverwendung!
          normal = p.normal;
        }
      }

      // Innen (deepest <= 0) oder außen an Kante/Ecke ohne Flächentreffer.
      if (deepest <= 0 || nearest === Infinity) {
        signed = deepest;
        normal = deepestNormal;
      }

      if (signed >= margin) continue;

      // Herauschieben: verhindert, dass das Boid eindringt und verschwindet.
      this.body.pos = this.body.pos.add(normal.scale(margin - signed));

      // Geschwindigkeit UND Beschleunigung ins Hindernis hinein streichen.
      let into = this.body.vel.dot(normal);
      if (into < 0) this.body.vel = this.body.vel.sub(normal.scale(into));
      into = this.accel.dot(normal);
      if (into < 0) this.accel = this.accel.sub(normal.scale(into));
      this.applyForce(normal.scale(0.01));
    }
  }
}
