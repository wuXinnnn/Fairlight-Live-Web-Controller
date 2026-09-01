import type { ControlAck } from '@flwc/shared';
import type { MixerSocket } from '../src/lib/socket.js';

type Listener = (...args: unknown[]) => void;

export class FakeSocket implements MixerSocket {
  connected = false;
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];
  readonly acknowledgements = new Map<string, ControlAck>();
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args });
    const possibleAck = args.at(-1);
    if (typeof possibleAck === 'function') {
      possibleAck(this.acknowledgements.get(event) ?? { ok: true });
    }
  }

  connect(): void {
    this.connected = true;
    this.serverEmit('connect');
  }

  disconnect(): void {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.serverEmit('disconnect');
  }

  serverEmit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}
