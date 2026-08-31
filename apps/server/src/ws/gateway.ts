import type { Server, Socket } from 'socket.io';
import {
  controlAckSchema,
  ERROR_CODES,
  resetLoudnessCommandSchema,
  setLevelCommandSchema,
  setOnCommandSchema,
  SOCKET_EVENTS,
  type ControlAck,
  type MixerPatch,
  type MixerSnapshot,
  type ConnectionStatus,
} from '@flwc/shared';
import { ChannelNotFoundError, EmberProtocolError } from '../ember/errors.js';
import type { AppLogger } from '../logger.js';
import { errorMessage } from '../logger.js';
import type { MixerRuntime } from '../runtime.js';

type AckFn = (ack: ControlAck) => void;

export function attachGateway(io: Server, runtime: MixerRuntime, logger: AppLogger): void {
  runtime.store.on('snapshot', (snapshot: MixerSnapshot) => {
    io.emit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  });
  runtime.store.on('patch', (patch: MixerPatch) => {
    io.emit(SOCKET_EVENTS.MIXER_PATCH, patch);
  });
  runtime.store.on('status', (status: ConnectionStatus) => {
    io.emit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: status });
  });
  runtime.meters.setListener((frame) => {
    io.volatile.emit(SOCKET_EVENTS.METERS_FRAME, frame);
  });

  io.on('connection', (socket: Socket) => {
    socket.emit(SOCKET_EVENTS.MIXER_SNAPSHOT, runtime.store.snapshot());
    bindControl(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, async (payload) => {
      const parsed = setLevelCommandSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.message, layer: 'validation' }, 'invalid set-level');
        return fail(ERROR_CODES.VALIDATION, parsed.error.message);
      }
      await runtime.setLevel(parsed.data.id, parsed.data.levelDb);
      return { ok: true };
    });
    bindControl(socket, SOCKET_EVENTS.CONTROL_SET_ON, async (payload) => {
      const parsed = setOnCommandSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.message, layer: 'validation' }, 'invalid set-on');
        return fail(ERROR_CODES.VALIDATION, parsed.error.message);
      }
      await runtime.setOn(parsed.data.id, parsed.data.on);
      return { ok: true };
    });
    bindControl(socket, SOCKET_EVENTS.CONTROL_RESET_LOUDNESS, async (payload) => {
      const parsed = resetLoudnessCommandSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.message, layer: 'validation' }, 'invalid reset-loudness');
        return fail(ERROR_CODES.VALIDATION, parsed.error.message);
      }
      await runtime.resetLoudness();
      return { ok: true };
    });
  });
}

function bindControl(
  socket: Socket,
  event: string,
  handler: (payload: unknown) => Promise<ControlAck>,
): void {
  socket.on(event, (payload: unknown, ack?: AckFn) => {
    void handler(payload)
      .catch((error: unknown) => toAck(error))
      .then((result) => {
        if (typeof ack === 'function') {
          ack(controlAckSchema.parse(result));
        }
      });
  });
}

function fail(code: string, message: string): ControlAck {
  return { ok: false, error: { code, message } };
}

function toAck(error: unknown): ControlAck {
  if (error instanceof ChannelNotFoundError || error instanceof EmberProtocolError) {
    return fail(error.code, error.message);
  }
  return fail(ERROR_CODES.INTERNAL, errorMessage(error));
}
