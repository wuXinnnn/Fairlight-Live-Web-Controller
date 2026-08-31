import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetersFrame } from '@flwc/shared';
import { MeterHub } from './meter-hub.js';

describe('MeterHub', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates updates into a single 50ms frame', () => {
    vi.useFakeTimers();
    const frames: MetersFrame[] = [];
    const hub = new MeterHub((frame) => frames.push(frame), 50);
    hub.start();
    hub.start();
    hub.ingestMeter('channel/1', -30);
    hub.ingestMeter('channel/1', -12);
    hub.ingestMeter('aux/1', -8);
    hub.ingestLoudness({ integratedLufs: -23, truePeakDbtp: -6 });
    expect(frames).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(frames).toEqual([
      {
        meters: [
          ['channel/1', -12],
          ['aux/1', -8],
        ],
        loudness: { integratedLufs: -23, truePeakDbtp: -6 },
      },
    ]);
    vi.advanceTimersByTime(50);
    expect(frames).toHaveLength(1);
    hub.flush();
    hub.setListener((frame) => frames.push(frame));
    hub.stop();
  });

  it('omits loudness when only meters arrived', () => {
    const frames: MetersFrame[] = [];
    const hub = new MeterHub((frame) => frames.push(frame));
    hub.ingestMeter('main/1', -1);
    hub.flush();
    expect(frames).toEqual([{ meters: [['main/1', -1]] }]);
  });
});
