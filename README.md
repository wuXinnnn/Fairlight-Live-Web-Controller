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

| Layer | Technology |
| --- | --- |
| Backend | Node.js, TypeScript, Fastify, socket.io |
| Ember+ | [sofie-emberplus-connection](https://github.com/Sofie-Automation/sofie-emberplus-connection) |
| Frontend | React, TypeScript, Vite, zustand, socket.io-client |
| Testing | Vitest, React Testing Library |
| Tooling | pnpm workspaces, ESLint, Prettier |

## Repository Layout

```
apps/server      Fastify backend: REST API, socket.io gateway, Ember+ client
apps/web         React frontend: mixer page, settings page
packages/shared  Shared types and message contracts (zod schemas)
docs/            Project documentation (in Simplified Chinese)
```

## Getting Started

> Placeholder — filled in once the project scaffold lands (Phase 1).

```bash
pnpm install
pnpm dev        # start backend + frontend in development mode
pnpm test       # run all tests with coverage
pnpm build      # production build; server serves the built frontend
```

Requirements: a running Fairlight Live instance with Ember+ enabled
(Fairlight Live > Show settings > Ember+ > Enable).

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
