# Fairlight Live Web Controller

A web-based remote controller for Blackmagic Design **Fairlight Live**, built on the
[Ember+](https://github.com/Lawo/ember-plus) control protocol.

It provides a clean, mixer-style web UI for fader control, channel ON switches,
level metering and loudness readouts, backed by an extensible Web API.

## Features

- Fader control for input/output channels (channels, mains, subs, auxes, mix-minus, matrix)
- Channel ON switch (Yamaha-console style; inverse presentation of the mixer's mute)
- Per-channel level meters with dB readout and channel names
- Loudness section: integrated loudness (LUFS) and true-peak (dBTP) readouts with reset
- Configurable views: pick which channels appear in each view, order and color them, group
  them under named sections, and switch views on the main page
- Views reference channels by type and name, so inserting or reordering strips in Fairlight Live
  does not break them (Fairlight Live exposes no stable channel id)
- Ember+ host/port configurable through the UI and the REST API
- Real-time updates over WebSocket (socket.io), meters at up to 50 ms resolution
- Built for a tablet: vertical paging, large hit targets, screen wake lock, fullscreen

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
apps/web             React frontend: mixer page (/), view configuration page (/views)
apps/desktop         Windows desktop launcher: Tauri shell (src-tauri) and its settings window
packages/shared      Shared types and message contracts (zod schemas)
packages/test-utils  Test fixtures (Mock Ember+ Provider)
scripts/             Shell helpers (Docker smoke test)
docs/                Project documentation (in Simplified Chinese)
```

## Requirements

Ember+ must be enabled in Fairlight Live (Show settings; the port is set there, 9000 by
default), and that port must be reachable from wherever you run this. Everything else depends
on how you run it:

| How you run it  | What the machine needs           |
| --------------- | -------------------------------- |
| Desktop app     | Nothing — see below              |
| With Docker     | Docker, and Docker Compose       |
| From a terminal | Node.js 22 or newer, and pnpm 11 |

## Desktop app

The Windows installer on the [latest release](https://github.com/wuxinnnn/Fairlight-Live-Web-Controller/releases/latest)
carries its own Node runtime and the built web app, so the machine needs nothing installed. It
installs for the current user, without administrator rights.

Start it from the Start menu. The window shows the address to open on a tablet, and lets you
change the port, start with Windows, or start hidden in the tray. Closing the window hides it
to the tray; **Exit** stops the backend. Set the Ember+ endpoint on the mixer page, in its
CONNECTION panel; the launcher has no setting for it.

macOS and Linux builds are planned.

## Run with Docker

Edit `EMBER_HOST` in `docker-compose.yml` to the address of the machine running Fairlight Live,
then:

```bash
docker compose up -d
```

Open `http://<host>:3000`. The configuration lives in a named volume, so it survives
`docker compose restart` and `docker compose down && docker compose up -d`.

To upgrade:

```bash
docker compose pull && docker compose up -d
```

To install without a registry, download `flwc-<tag>-linux-amd64.tar.gz` from the
[releases](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/releases) page and load it:

```bash
docker load -i flwc-<tag>-linux-amd64.tar.gz
docker compose up -d
```

To build from this checkout instead of pulling, uncomment the `build: .` line in
`docker-compose.yml`.

The compose file uses a named volume rather than a bind mount because the container runs as the
`node` user (uid 1000), and a host directory usually will not be writable by it. If you would
rather keep the configuration somewhere you can see it, create the directory, give it to uid 1000,
and point the volume at it:

```bash
mkdir -p ./flwc-data && sudo chown -R 1000:1000 ./flwc-data
# then in docker-compose.yml:  - ./flwc-data:/app/data
```

## Run from a terminal

Build once:

```bash
pnpm install
pnpm build
```

Then start it. On Windows, double-click `start.cmd` or run it from a terminal:

```
start.cmd
```

On macOS and Linux:

```bash
./start.sh
```

Either way the server listens on `0.0.0.0:3000`, so open `http://localhost:3000` on the
machine itself, or `http://<that machine's address>:3000` from a tablet on the same network.
`Ctrl+C` stops it.

The first time it listens on every interface, Windows asks whether to allow Node.js through the
firewall. Allow it on your private network, or the tablet will not be able to reach the page.

To change the port, the bind address or where the configuration is kept, copy `.env.example` to
`.env` and edit it. The start scripts read it; it is not committed:

```bash
cp .env.example .env    # copy .env.example .env  on Windows
```

```dotenv
PORT=8080
HOST=0.0.0.0
```

A variable already set in the shell still wins over the file, so `PORT=3100 ./start.sh` (or
`set PORT=3100 && start.cmd`) overrides it for one run. The full list of variables is in
[Configuration](#configuration) below, and every one of them is in `.env.example` with a comment.

## Configuration

| Variable                   | Default         | What it does                                                                                                                        |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                     | `127.0.0.1`     | The address the web server binds. The start scripts and the container set it to `0.0.0.0`.                                          |
| `PORT`                     | `3000`          | The port the web server binds.                                                                                                      |
| `EMBER_HOST`               | `127.0.0.1`     | Seed value: written to the config file on the very first start, when there is no file yet. After that the CONNECTION panel owns it. |
| `EMBER_PORT`               | `9000`          | Seed value, as above.                                                                                                               |
| `FLWC_DATA_DIR`            | `data/`         | Where `config.json` is kept. `/app/data` in the container.                                                                          |
| `FLWC_WEB_ROOT`            | `apps/web/dist` | Where the web build is served from.                                                                                                 |
| `FLWC_EXIT_ON_STDIN_CLOSE` | unset           | Set to `1` to exit when stdin closes, for process supervisors and the desktop launcher.                                             |

All of them can be set in a `.env` file in this directory, which the start scripts read. Copy
`.env.example` to `.env` to get a commented template. Docker does not read it -- use the
`environment:` block in `docker-compose.yml` -- and neither does `pnpm dev`.

Precedence, highest first: a variable set in the shell, then `.env`, then the start script's own
default (`HOST=0.0.0.0`, so a tablet can reach it), then the server's default.

`EMBER_HOST` and `EMBER_PORT` seed; they do not override. Once `config.json` exists, it and the
CONNECTION panel in the UI decide where Fairlight Live is, however the variables are set. Changing the
address in the UI is the normal way to do it; the variables exist so that a container has
somewhere to point on its very first start.

`config.json` holds the Ember+ endpoint and your views. It lives in `data/` in a checkout, in
`/app/data` in the container, which is the directory the compose file mounts a volume on, and in
`%APPDATA%\io.github.wuxinnnn.flwc\data` under the desktop app. The desktop app keeps its own
`launcher.json` -- port, network access, start hidden -- next to that, and writes the backend's
log to `%LOCALAPPDATA%\io.github.wuxinnnn.flwc\logs\server.log`.

## Try it without Fairlight Live

A mock Ember+ provider serves the archived tree dump, with meters that move:

```bash
pnpm --filter @flwc/server mock-provider --port 9100 --meters
```

Point the server at it with `EMBER_HOST=127.0.0.1 EMBER_PORT=9100`, or through the CONNECTION
panel. From a container, use `host.docker.internal` as the host.

## Development

```bash
pnpm install
pnpm dev        # API on :3000, Vite on :5173 (proxies /api)
pnpm lint
pnpm typecheck
pnpm test       # all packages, with coverage thresholds
pnpm build      # production build; server serves the built frontend
```

The Vite dev server listens on every interface and proxies `/api` and `/socket.io` to the
backend, so a tablet can reach `http://<your machine>:5173` while you work. The backend itself
stays on `127.0.0.1:3000` in development unless `HOST` is set.

`pnpm dev` builds `@flwc/shared` first. If you change `packages/shared`, rerun it (or
`pnpm --filter @flwc/shared build`) before the other packages see the new types.

### The desktop launcher

```bash
pnpm desktop:dev      # builds the workspace, then runs the launcher against a dev window
pnpm desktop:build    # produces the NSIS installer under apps/desktop/src-tauri/target
```

Both need the Rust toolchain, the MSVC build tools (Visual Studio's "Desktop development with
C++" workload) and the WebView2 runtime, which Windows 11 already has. The first run downloads
the Node runtime the installer ships and stages the built backend into `src-tauri/resources`;
none of that is committed.

The launcher's saved port is 3000, which is the port `pnpm dev` uses. Pass another one for a
development run so the two do not collide:

```bash
pnpm --filter @flwc/desktop tauri dev -- -- --port 3100
```

In a development build the launcher keeps a console window of its own, because
`windows_subsystem = "windows"` only applies to a release build. The installed application has
none, and neither does the backend it starts.

## Documentation

Developer documentation lives in [`docs/`](docs/) (written in Simplified Chinese):

- [`docs/architecture.md`](docs/architecture.md) — architecture and data flow
- [`docs/development-plan.md`](docs/development-plan.md) — phased development plan
- [`docs/conventions.md`](docs/conventions.md) — project conventions
- [`docs/fairlight-ember.md`](docs/fairlight-ember.md) — Fairlight Live Ember+ reference

## License

[MIT](LICENSE). All code dependencies are MIT or MIT-compatible.

The Barlow Condensed and IBM Plex Mono typefaces are used under the
[SIL Open Font License 1.1](https://openfontlicense.org/). Their licence texts are served with the
page under [`/licenses/`](apps/web/public/licenses/) and ship inside the desktop installer.
