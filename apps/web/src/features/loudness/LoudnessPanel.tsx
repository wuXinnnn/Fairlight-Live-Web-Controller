import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ControlClient } from '../../lib/socket.js';
import { meterStore } from '../../store/meter-store.js';
import { controlsAvailable, mixerStore, setNotice } from '../../store/mixer-store.js';

export const RESET_CONFIRM_MS = 3000;

function formatReading(value: number, minimum: number, maximum: number): string {
  return Math.min(maximum, Math.max(minimum, value)).toFixed(1);
}

interface LoudnessPanelProps {
  controlClient: ControlClient;
}

export function LoudnessPanel({ controlClient }: LoudnessPanelProps) {
  const loudness = useStore(meterStore, (state) => state.loudness);
  const enabled = useStore(mixerStore, controlsAvailable);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const confirmTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(confirmTimerRef.current);
    },
    [],
  );

  const handleReset = () => {
    if (!confirming) {
      setConfirming(true);
      confirmTimerRef.current = window.setTimeout(() => {
        setConfirming(false);
      }, RESET_CONFIRM_MS);
      return;
    }

    window.clearTimeout(confirmTimerRef.current);
    setConfirming(false);
    setResetting(true);
    void controlClient.resetLoudness().then((ack) => {
      setResetting(false);
      setNotice(ack.ok ? 'Loudness reset sent.' : ack.error.message);
    });
  };

  return (
    <section className="loudness-panel" aria-label="Loudness">
      <div className="loudness-reading">
        <span>INT</span>
        <strong>{formatReading(loudness.integratedLufs, -100, 18)}</strong>
        <small>LUFS</small>
      </div>
      <div className="loudness-reading">
        <span>TP</span>
        <strong>{formatReading(loudness.truePeakDbtp, -60, 0)}</strong>
        <small>dBTP</small>
      </div>
      <button
        type="button"
        className={`reset-button ${confirming ? 'is-confirming' : ''}`}
        disabled={!enabled || resetting}
        onClick={handleReset}
      >
        {resetting ? 'RESETTING' : confirming ? 'CONFIRM RESET' : 'RESET'}
      </button>
    </section>
  );
}
