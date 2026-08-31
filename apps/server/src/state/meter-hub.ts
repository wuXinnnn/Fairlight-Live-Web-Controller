import type { LoudnessState, MetersFrame } from '@flwc/shared';

export const METER_FRAME_MS = 50;

export class MeterHub {
  private readonly meters = new Map<string, number>();
  private loudness: LoudnessState | undefined;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private onFrame: (frame: MetersFrame) => void,
    private readonly intervalMs: number = METER_FRAME_MS,
  ) {}

  setListener(onFrame: (frame: MetersFrame) => void): void {
    this.onFrame = onFrame;
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      this.flush();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  ingestMeter(id: string, meterDb: number): void {
    this.meters.set(id, meterDb);
    this.dirty = true;
  }

  ingestLoudness(loudness: LoudnessState): void {
    this.loudness = loudness;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) {
      return;
    }
    const frame: MetersFrame = {
      meters: [...this.meters.entries()],
    };
    if (this.loudness !== undefined) {
      frame.loudness = this.loudness;
    }
    this.meters.clear();
    this.loudness = undefined;
    this.dirty = false;
    this.onFrame(frame);
  }
}
