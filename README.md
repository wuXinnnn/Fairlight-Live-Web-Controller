# Fairlight Live Web Controller

A web-based remote controller for Blackmagic Design **Fairlight Live**, built on the
[Ember+](https://github.com/Lawo/ember-plus) control protocol.

It provides a clean, mixer-style web UI for fader control, channel ON switches,
level metering and loudness readouts, backed by an extensible Web API.

> Status: early development. Interfaces and features are subject to change.

## Features

- Fader control for input/output channels (channels, mains, subs, auxes, mix-minus, matrix)
- Channel ON switch (Yamaha-console style; inverse presentation of the mixer's mute)
- Per-channel level meters with dB readout and channel names
- Loudness section: integrated loudness (LUFS) and true-peak (dBTP) readouts with reset
- Configurable views: pick which channels appear in each view, switch views on the main page
- Ember+ host/port configurable from the web UI or the REST API
- Real-time updates over WebSocket (socket.io), meters at up to 50 ms resolution

## Tech Stack

| Layer    | Technology                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| Backend  | Node.js, TypeScript, Fastify, socket.io                                                      |
| Ember+   | [sofie-emberplus-connection](https://github.com/Sofie-Automation/sofie-emberplus-connection) |
| Frontend | React, TypeScript, Vite, zustand, socket.io-client                                           |
| Testing  | Vitest, React Testing Library                                                                |
| Tooling  | pnpm workspaces, ESLint, Prettier                                                            |

## Repository Layout

```
apps/server          Fastify backend: REST API, socket.io gateway, Ember+ client
apps/web             React frontend: mixer page, settings page
packages/shared      Shared types and message contracts (zod schemas)
packages/test-utils  Test fixtures (Mock Ember+ Provider)
docs/                Project documentation (in Simplified Chinese)
```

## Getting Started

Requirements: Node.js 22 and [pnpm](https://pnpm.io/) 11. Ember+ / Fairlight Live
is not required for the current scaffold.

```bash
pnpm install
pnpm dev        # API on :3000, Vite on :5173 (proxies /api)
pnpm lint
pnpm typecheck
pnpm test       # all packages, with coverage thresholds
pnpm build      # production build; server serves the built frontend
node apps/server/dist/main.js   # after build: http://127.0.0.1:3000
```

## Deployment

- **Docker**: multi-stage image; the backend serves the frontend build. Mount `data/`
  as a volume to persist configuration.
- **Windows**: run the built server directly with Node.js — no container required.

## Documentation

Developer documentation lives in [`docs/`](docs/) (written in Simplified Chinese):

- [`docs/architecture.md`](docs/architecture.md) — architecture and data flow
- [`docs/development-plan.md`](docs/development-plan.md) — phased development plan
- [`docs/conventions.md`](docs/conventions.md) — project conventions
- [`docs/fairlight-ember.md`](docs/fairlight-ember.md) — Fairlight Live Ember+ reference

## License

[MIT](LICENSE). All dependencies are MIT or MIT-compatible.
