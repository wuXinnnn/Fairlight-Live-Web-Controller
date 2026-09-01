import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../lib/socket.js';
import { applyMetersFrame, resetMeterStore } from '../../store/meter-store.js';
import { resetMixerStore, setEmberStatus, setSocketConnected } from '../../store/mixer-store.js';
import { LoudnessPanel, RESET_CONFIRM_MS } from './LoudnessPanel.js';

function createControlClient(): ControlClient {
  return {
    setLevel: vi.fn().mockResolvedValue({ ok: true }),
    setOn: vi.fn().mockResolvedValue({ ok: true }),
    resetLoudness: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('LoudnessPanel', () => {
  beforeEach(() => {
    resetMixerStore();
    resetMeterStore();
    setSocketConnected(true);
    setEmberStatus('connected');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders clamped readings with their engineering units', () => {
    applyMetersFrame({
      meters: [],
      loudness: { integratedLufs: 99, truePeakDbtp: -7.2 },
    });
    render(<LoudnessPanel controlClient={createControlClient()} />);
    expect(screen.getByText('18.0')).toBeInTheDocument();
    expect(screen.getByText('-7.2')).toBeInTheDocument();
    expect(screen.getByText('LUFS')).toBeInTheDocument();
    expect(screen.getByText('dBTP')).toBeInTheDocument();
  });

  it('requires a second click before resetting loudness', async () => {
    const controlClient = createControlClient();
    render(<LoudnessPanel controlClient={controlClient} />);
    fireEvent.click(screen.getByRole('button', { name: 'RESET' }));
    expect(screen.getByRole('button', { name: 'CONFIRM RESET' })).toBeInTheDocument();
    expect(controlClient.resetLoudness).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM RESET' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(controlClient.resetLoudness).toHaveBeenCalledOnce();
  });

  it('expires confirmation and disables reset while disconnected', () => {
    const controlClient = createControlClient();
    const { rerender } = render(<LoudnessPanel controlClient={controlClient} />);
    fireEvent.click(screen.getByRole('button', { name: 'RESET' }));
    act(() => {
      vi.advanceTimersByTime(RESET_CONFIRM_MS);
    });
    expect(screen.getByRole('button', { name: 'RESET' })).toBeInTheDocument();

    setSocketConnected(false);
    rerender(<LoudnessPanel controlClient={controlClient} />);
    expect(screen.getByRole('button', { name: 'RESET' })).toBeDisabled();
  });
});
