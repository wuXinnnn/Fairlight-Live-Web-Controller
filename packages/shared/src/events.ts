export const SOCKET_EVENTS = {
  MIXER_SNAPSHOT: 'mixer:snapshot',
  MIXER_PATCH: 'mixer:patch',
  METERS_FRAME: 'meters:frame',
  SYSTEM_STATUS: 'system:status',
  CONTROL_SET_LEVEL: 'control:set-level',
  CONTROL_SET_ON: 'control:set-on',
  CONTROL_RESET_LOUDNESS: 'control:reset-loudness',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
