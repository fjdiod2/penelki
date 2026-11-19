// Панельки, the arithmetic of walking about at street level (the photo mode), kept apart from the scene so it can be
// tested in Node: lenses, where you look, and walking that slides along walls instead of going through them.

export const EYE = 1.7;                            // eye height above what you stand on (m)
export const BODY = 0.45;                          // how close to a wall you can get (m)
export const PITCH_MAX = (85 * Math.PI) / 180;     // look up or down at most this far

// a lens on a full-frame camera (mm) -> the vertical field of view in degrees, as three's camera wants it
export const lensFov = (mm) => (2 * Math.atan(12 / mm) * 180) / Math.PI;
export const fovLens = (fov) => 12 / Math.tan((fov * Math.PI) / 360);

// yaw (round from +x toward +z) and pitch (up) -> the unit direction you look in, [x, y, z]
export function lookDir(yaw, pitch) { const c = Math.cos(pitch); return [Math.cos(yaw) * c, Math.sin(pitch), Math.sin(yaw) * c]; }
// and back: a direction -> { yaw, pitch }
export function yawPitch(d) { const h = Math.hypot(d[0], d[2]); return { yaw: Math.atan2(d[2], d[0]), pitch: Math.atan2(d[1], h || 1e-9) }; }
export const clampPitch = (p) => Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p));

// one step of walking from p [x, z] by move [dx, dz]; room(q) -> metres from q to the nearest wall (negative inside).
// Into a wall, the step slides along it (trying the two halves of the move on their own); never ends closer than BODY.
export function walkStep(p, move, room) {
  const ok = (q) => room(q) >= BODY;
  const full = [p[0] + move[0], p[1] + move[1]];
  if (ok(full)) return full;
  const xs = [p[0] + move[0], p[1]], zs = [p[0], p[1] + move[1]];
  if (Math.abs(move[0]) >= Math.abs(move[1])) { if (ok(xs)) return xs; if (ok(zs)) return zs; }
  else { if (ok(zs)) return zs; if (ok(xs)) return xs; }
  return p;
}
// where to stand to walk toward a target: stop short of walls -> the last spot on the straight way there with room
export function walkTo(p, target, room, step = 0.5) {
  const d = [target[0] - p[0], target[1] - p[1]], L = Math.hypot(d[0], d[1]); let last = p;
  for (let s = step; s <= L + 1e-9; s += step) { const q = [p[0] + (d[0] * s) / L, p[1] + (d[1] * s) / L]; if (room(q) < BODY) break; last = q; }
  return last;
}
