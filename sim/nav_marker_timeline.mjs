// Navigation-only smoothing for a remote car/jet. Never modifies physics,
// collision, replication packets or the authoritative pose timeline.
const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const distance = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

export class NavMarkerTimeline {
  constructor({ delayMs = 90, maxSnapshots = 10, teleportM = 35 } = {}) {
    this.delayMs = Math.max(0, Number(delayMs) || 0);
    this.maxSnapshots = Math.max(2, Math.floor(Number(maxSnapshots) || 10));
    this.teleportM = Math.max(1, Number(teleportM) || 35);
    this.snapshots = [];
  }

  reset() { this.snapshots.length = 0; }

  push(nav, receivedMs = performance.now()) {
    const { p, mode, headingRad } = nav || {};
    if (!finitePoint(p) || !Number.isFinite(headingRad) ||
        !['car', 'jet'].includes(mode) || !Number.isFinite(receivedMs)) return false;

    const last = this.snapshots.at(-1);
    if (last && receivedMs <= last.at) return false;
    // Do not interpolate a teleport, respawn, seat/mode change or major correction.
    if (last && (last.mode !== mode || distance(last.p, p) > this.teleportM)) this.reset();
    this.snapshots.push({ p: [...p], headingRad: wrap(headingRad), mode, at: receivedMs });
    while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    return true;
  }

  sample(nowMs = performance.now()) {
    if (!Number.isFinite(nowMs) || !this.snapshots.length) return null;
    const points = this.snapshots;
    const at = nowMs - this.delayMs;
    if (at <= points[0].at) return { ...points[0], p: [...points[0].p] };
    for (let i = 1; i < points.length; i++) {
      const b = points[i];
      if (at > b.at) continue;
      const a = points[i-1], t = Math.max(0, Math.min(1, (at-a.at)/(b.at-a.at)));
      return {
        mode: b.mode,
        p: a.p.map((value, axis) => value + (b.p[axis]-value)*t),
        headingRad: wrap(a.headingRad + wrap(b.headingRad-a.headingRad)*t),
        at,
      };
    }
    // No blind prediction between network packets: hold briefly; the caller
    // already drops stale peers using lastPoseMs / STALE_MS.
    const last = points.at(-1);
    return { ...last, p: [...last.p] };
  }
}
