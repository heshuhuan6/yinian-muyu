export const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));
const smooth = (value: number): number => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
export interface DemoPointer { x: number; y: number; opacity: number; pressed: number }

/** Pure state; safe to replace for an arbitrary deterministic fixed-clock seek. */
export class Simulation {
  time = 0;
  light = 0;
  bpm = 60;
  count = 0;
  phase = 0;
  sinceHit = 10;
  activeSeconds = 0;
  didHit = false;
  position: number;
  target: number;
  velocity = 0;
  wobble = 0;
  wobbleVelocity = 0;
  stretch = 1;
  parallaxX = 0;
  parallaxY = 0;
  pointerX = 0;
  pointerY = 0;
  dragging = false;
  committed: boolean;
  demo: boolean;
  reduced: boolean;
  readonly cursor: DemoPointer = { x: 80, y: 78, opacity: 0, pressed: 0 };

  constructor(initial: number, demo: boolean, reduced: boolean) {
    this.demo = demo;
    this.reduced = reduced;
    this.committed = false;
    this.position = this.target = initial;
  }

  setPlaying(active: boolean): void {
    if (this.committed !== active) this.phase = 0;
    this.committed = active;
  }

  settle(): void {
    this.position = this.target;
    this.velocity = this.wobble = this.wobbleVelocity = 0;
    this.stretch = 1;
    this.parallaxX = this.parallaxY = 0;
  }

  handover(): void {
    this.demo = false;
    this.cursor.opacity = 0;
    this.dragging = false;
  }

  scriptClock(): number {
    const p = this.time % 12;
    const points = [[0, 360], [1, 360], [3, 576], [5, 576], [7, 792], [8, 792], [10, 960], [12, 360]];
    let minutes = 360;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!, b = points[i + 1]!;
      if (p >= a[0]! && p <= b[0]!) {
        const q = smooth((p - a[0]!) / (b[0]! - a[0]!));
        minutes = a[1]! + (b[1]! - a[1]!) * q;
        this.dragging = a[1] !== b[1];
        break;
      }
    }
    this.cursor.x = 45 + minutes / 1440 * 70;
    this.cursor.y = 42;
    this.cursor.opacity = Math.min(smooth(p / 0.3), 1 - smooth((p - 11.5) / 0.5));
    this.cursor.pressed = this.dragging ? 1 : 0;
    return minutes;
  }

  step(dt: number): void {
    dt = clamp(dt, 0, 0.05);
    this.time += dt;
    this.didHit = false;
    this.sinceHit += dt;
    if (this.committed) {
      this.activeSeconds += dt;
      this.phase += dt * this.bpm / 60;
      if (this.phase >= 1 - 1e-9) {
        this.phase = Math.max(0, this.phase - 1);
        this.count++;
        this.sinceHit = 0;
        this.didHit = true;
      }
    }
    if (this.reduced) {
      this.settle();
      this.cursor.opacity = 0;
      return;
    }
    // Small substeps keep the spring stable after a 50ms background-tab frame.
    const count = Math.max(1, Math.ceil(dt * 120));
    const h = dt / count;
    for (let i = 0; i < count; i++) {
      const stiffness = this.dragging ? 420 : 170;
      const damping = this.dragging ? 35 : 19;
      const acceleration = (this.target - this.position) * stiffness - this.velocity * damping;
      this.velocity += acceleration * h;
      this.position = clamp(this.position + this.velocity * h, -0.025, 1.025);
      const force = clamp(-acceleration * 0.002, -0.12, 0.12);
      this.wobbleVelocity += ((force - this.wobble) * 150 - this.wobbleVelocity * 15) * h;
      this.wobble += this.wobbleVelocity * h;
    }
    this.stretch += (1 + Math.min(0.23, Math.abs(this.velocity) * 0.085) - this.stretch) * (1 - Math.exp(-dt * 16));
    this.parallaxX += (this.pointerX - this.parallaxX) * (1 - Math.exp(-dt * 4));
    this.parallaxY += (this.pointerY - this.parallaxY) * (1 - Math.exp(-dt * 4));
    if (!this.dragging && Math.abs(this.position - this.target) < 0.00001 && Math.abs(this.velocity) < 0.0001) {
      this.position = this.target;
      this.velocity = 0;
    }
  }
}
