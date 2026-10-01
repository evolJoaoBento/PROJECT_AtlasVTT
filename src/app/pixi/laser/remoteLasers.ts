/**
 * Other people's lasers as messages bring them: each a trail that fades like Atlas's own, its
 * newest point held at full strength until the laser is let go. A laser that hears nothing for
 * a second is let go, so a lost lift never leaves one hanging. Shared by the GM's view
 * (`RemoteLaserRenderer`) and the join page.
 */
import type { BeamPoint } from './laserBeamGeometry';
import { LaserTrail } from './laserTrail';

export const LASER_STALE_MS = 1000;

interface Point {
  x: number;
  y: number;
}

export interface RemoteLaserFrame {
  from: string;
  color: string;
  /** Oldest to newest, the held point last at full strength. */
  trail: BeamPoint[];
  /** Where the laser is while it is held; null once let go. */
  head: Point | null;
}

interface Entry {
  color: string;
  trail: LaserTrail;
  lifted: boolean;
  lastAt: number;
  head: Point | null;
}

export class RemoteLasers {
  private readonly entries = new Map<string, Entry>();

  get isActive(): boolean {
    return this.entries.size > 0;
  }

  receive(from: string, color: string, points: ReadonlyArray<Point>, lifted: boolean, now: number): void {
    let entry = this.entries.get(from);
    if (!entry) {
      if (points.length === 0) return;
      entry = { color, trail: new LaserTrail(), lifted, lastAt: now, head: null };
      this.entries.set(from, entry);
    }
    for (const point of points) entry.trail.add(point.x, point.y, now);
    const last = points[points.length - 1];
    if (last) entry.head = { x: last.x, y: last.y };
    entry.color = color;
    entry.lifted = lifted;
    entry.lastAt = now;
  }

  /** What to draw now; lasers that faded out are forgotten. */
  frame(now: number): RemoteLaserFrame[] {
    const frames: RemoteLaserFrame[] = [];
    for (const [from, entry] of this.entries) {
      if (!entry.lifted && now - entry.lastAt > LASER_STALE_MS) entry.lifted = true;
      entry.trail.prune(now);
      if (entry.lifted && entry.trail.length === 0) {
        this.entries.delete(from);
        continue;
      }
      const head = entry.lifted ? null : entry.head;
      const trail = entry.trail.beamPoints(now);
      if (head) trail.push({ x: head.x, y: head.y, life: 1 });
      frames.push({ from, color: entry.color, trail, head });
    }
    return frames;
  }

  clear(): void {
    this.entries.clear();
  }
}
