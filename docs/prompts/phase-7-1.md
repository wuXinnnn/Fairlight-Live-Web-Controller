# Phase 7.1 执行提示词 — 服务端收尾、控制台启动与 Docker

> 用法:将本文档全文作为执行会话的任务提示词。**本批次的执行会话运行在用户的本地开发机上**(Windows 11),开发机正连着真实 Fairlight Live。任务来源是 `docs/development-plan.md` 的 7.1 一节,细节以本文档为准;两者冲突时以本文档为准并在报告里指出。工作在远端分支与 PR 上进行,你要跟进 GitHub CI 与 Cursor Bugbot 的评审意见(见「本地执行边界」与「分支、PR 与评审监控」)。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,对真实 Fairlight 的最终验收由用户完成。

Phase 7 的最终发布形态是三态:**控制台脚本直接启动**(本批次)、**Docker 部署**(本批次)、**各平台 Tauri 桌面安装包**(7.2)。本批次除了交付前两态,还要给 7.2 铺好服务端这边的地基(优雅退出、stdin 守护、路径与种子环境变量),所以第 1 节的每一条都要按「桌面壳将来会这样调用它」来做。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(**第一条「本地测试安全」在本批次直接适用于你**;新增依赖的许可要求;第五条「文档只描述当前状态」是本批次文档核对的准绳)
2. `docs/development-plan.md` — Phase 7 总述、7.1 一节全文、7.2 一节(只为了解你在为谁铺路),以及「云端 Agent 开发边界」(「真机手动验收始终是本地步骤」对你同样成立)
3. `docs/architecture.md` — 全文通读一遍(本批次要核对它与实际行为是否一致),重点「部署」「持久化」「REST」三节
4. `docs/conventions.md` — 目录结构、命名、语言与许可、Git 规范(本批次要往目录结构里加东西)
5. `docs/reports/phase-6-5-report.md` — 上一批次执行报告,重点第 6 节(**`workflow_dispatch` 对 PR 分支不可用、用临时触发器在 runner 上跑一次再移除**的做法,本批次的 Docker 工作流照搬)、第 10 节(Bugbot 评审意见的处理与记录方式)
6. `docs/prompts/phase-6-5.md` 与 `docs/prompts/phase-6-4.md` — 前两批次的提示词,本批次沿用 6.4 的「本地执行边界」「分支、PR 与评审监控」与「硬性约束」,下面只写差异
7. `README.md` — 本批次要把它改成真正能照着用的快速开始,先看清它现在缺什么、错什么

## 代码现状(已确认,直接复用)

- **监听地址**:`apps/server/src/server.ts` 的 `resolveBindAddress()` 读环境变量 `HOST` / `PORT`,默认 `127.0.0.1:3000`。默认值**不改**;启动脚本、容器与桌面壳负责把 `HOST` 设为 `0.0.0.0`(平板要从局域网访问)。
- **路径解析**(`apps/server/src/paths.ts`)全部相对于 `apps/server/dist/paths.js` 所在位置:web 产物 `../../web/dist`(即 `apps/web/dist`),数据目录 `../../../data`(即仓库根 `data/`),配置文件 `data/config.json`。`start()` 已接受 `staticRoot` 与 `configDir` 选项,但 `main.ts` 没有把任何环境变量接到它们上。镜像内只要保持与仓库相同的目录布局这些解析原样可用;**桌面壳做不到**(web 产物在安装包资源目录、数据在系统应用数据目录),所以本批次要加两个可选环境变量(第 1.3 节)。
- **配置加载**(`apps/server/src/config/config-store.ts`):`load()` 在文件缺失(`ENOENT`)、无法解析、schema 不过三种情况下都回退 `defaultAppConfig()`(`127.0.0.1:9000`,由 `packages/shared/src/config.ts` 的 `DEFAULT_EMBER_HOST` / `DEFAULT_EMBER_PORT` 定义)并**只告警不落盘**;第一次 `update()` / `save()` 才会创建文件(`writeAtomic`:先 `mkdir -p`,临时文件 + `rename`)。`MixerRuntime.start()` 的顺序是 `config.load()` → `meters.start()` → `ember.configure(host, port)` → `ember.start()`。既有 `config-store.test.ts` 6 例覆盖了缺失 / 损坏 / schema 失败 / 原子写 / 版本迁移 / 并发写。
- **连接配置的校验**在 shared 里已经有:`PUT /api/v1/connection` 的 body schema(`packages/shared/src/connection.ts`)约束 host 非空、port 为 1–65535 的整数,环境变量种子值直接复用它,不另写一套规则。
- **健康检查**:`GET /api/v1/health` 返回 `{ "status": "ok" }`(`apps/server/src/app.ts`),不依赖 Ember 连接,容器 `HEALTHCHECK` 与桌面壳的就绪探测都用它。静态托管:`staticRoot` 存在时注册 `@fastify/static`,非 `/api/` 的 GET 未命中回落 `index.html`。
- **进程入口** `apps/server/src/main.ts` 只有 `await start()`,**没有任何信号处理**。Node 作为容器的 PID 1 时,内核对没有装处理器的信号一律忽略,`docker stop` 会等满 10 秒再 `SIGKILL`。`start()` 返回的 `app` 上已挂 `onClose` 钩子(关 socket.io、`runtime.stop()` 断开 Ember),所以正确的收尾就是 `app.close()`。`main.ts` 在覆盖率排除里。
- **依赖安装的两个事实**:① `emberplus-connection@0.3.1` 依赖 git 托管的 `asn1`(`pnpm-lock.yaml` 里 `codeload.github.com/evs-broadcast/node-asn1/...`),**镜像的构建阶段必须装 `git`**,运行阶段不需要;② `packages/shared` 与 `packages/test-utils` 有 `prepare` 脚本(`tsc`),`pnpm install` 时就会构建,需要 devDependencies 在场。`pnpm-workspace.yaml` 里 `allowBuilds: esbuild` 与 `blockExoticSubdeps: false` 是为此而设,镜像里照用。`packageManager` 字段钉在 `pnpm@11.17.0`,镜像里用 `corepack enable && corepack prepare pnpm@11.17.0 --activate`(Node 22 镜像自带 corepack)。
- **Mock Provider**(`packages/test-utils/src/mock-ember-provider.ts`):`MockEmberProvider.fromDumpFile()` 按 `docs/tree-dumps/` 最新 dump 建树,`listen()` / `close()`,`assertNotLiveFairlightPort()` 拒绝 9000。`@flwc/test-utils` 已是 `apps/server` 的 devDependency。soak 的 `soak-signal.ts` 有现成的 `meterSignal` / `loudnessSignal`。
- **工具脚本先例**:`apps/server/src/tools/dump-tree.ts` / `verify-ember.ts` / `soak.ts` 用 `tsx` 跑,参数解析在 `src/tools/cli-args.ts`(`parseFlagArgs` 与各自的 `parseXxxArgs`,有单测),驱动本身在 `apps/server/vitest.config.ts` 的覆盖率 `exclude` 里。
- **CI**:`.github/workflows/ci.yml`(push / PR:install → lint → typecheck → test → build)与 `soak.yml`(`workflow_dispatch`)。**两者一字不动。**
- **`apps/web/vite.config.ts`** 的开发服务器 `host` 已是 `0.0.0.0`(用户手调过),`AGENTS.md` 里「Vite 只监听 IPv6 的 `localhost`」那句已经过时——这是文档核对要抓的那类东西。
- **运行环境事实**(这台开发机):Node 22.14.0、pnpm 11.17.0;Docker Desktop 28.5.1 + Docker Compose v2.40.2(Linux 容器,WSL2 后端);Git Bash 可用。GitHub 仓库 `wuXinnnn/Fairlight-Live-Web-Controller` 是 **public**,GHCR 镜像名必须小写:`ghcr.io/wuxinnnn/fairlight-live-web-controller`。
- **基线**(6.5 与 PR #22 合并后,以你开工时实跑为准):测试 shared 44 / test-utils 22 / server 245 / web 496;覆盖率 server 94.71 / 86.98 / 97.19 / 94.65,web 96.94 / 92.47 / 98.92 / 96.90。

## 本地执行边界

沿用 `docs/prompts/phase-6-4.md` 的「本地执行边界」全文,补充以下几条:

- 本批次改 `apps/server`(`main.ts`、`config/`、`src/tools/`、`package.json`、测试)、`packages/test-utils`(只允许加一个向后兼容的可选项)、仓库根(`start.cmd`、`start.sh`、`Dockerfile`、`.dockerignore`、`docker-compose.yml`、`scripts/`、`.gitignore`)、`.github/workflows/`(**只新增** `docker.yml`)与文档;不改 `apps/web` 与 `packages/shared` 的源码。
- **不新增 npm 依赖**,`pnpm-lock.yaml` 不应有改动。
- **任何东西都不得指向真实台子**:你起的容器、脚本、mock provider 的 `EMBER_HOST` / `EMBER_PORT` 只能指向本机的 Mock Provider(第 2 节的工具),`assertNotLiveFairlightPort()` 拒绝 9000 是最后一道保险,不是许可。
- 端口 3000 与 5173 上跑着用户自己的 `pnpm dev`,照旧不占、不重启、不杀;9000 是真实台子。容器映射、启动脚本(`PORT=3100`)、mock provider 一律用其它端口,用完即停。
- Docker 试跑结束后停掉并删除你起的容器与卷(镜像可留)。`docker compose` 的项目名用 `flwc-phase7-<后缀>`,不要碰用户可能已有的容器。
- `start.cmd` 在 cmd.exe 与 PowerShell 下各试一次;`start.sh` 在 Git Bash 下试一次(macOS / Linux 由 CI 的 Docker 冒烟间接覆盖,报告里标注未在真实 macOS 上跑过)。

## 分支、PR 与评审监控

沿用 `docs/prompts/phase-6-4.md` 的同名一节,分支名如 `claude/phase-7-1-<随机后缀>`,报告文件为 `docs/reports/phase-7-1-report.md`。

## 硬性约束

- `docs/prompts/phase-6-4.md` 的「硬性约束」全部沿用:自动化测试一律基于 Mock 或夹具;代码、注释、提交信息、脚本输出、compose 与 Dockerfile 里的注释英文,文档与报告简体中文;不调低覆盖率门槛;按逻辑单元分多次提交(建议:优雅退出与 stdin 守护 → 环境变量(种子 + 路径)→ mock provider 工具 → 启动脚本 → Dockerfile / .dockerignore / compose / 冒烟脚本 → `docker.yml` → README 与文档核对 → 报告)。
- **覆盖率排除只允许新增一项**:`src/tools/mock-provider.ts`(驱动)。种子值解析、路径解析、优雅退出与 stdin 守护的逻辑必须放在有单测、计入覆盖率的模块里,`main.ts` 只做接线。
- **不改 6.x 的任何语义与数值**:前端一行不动;`EmberService` / `MixerStateStore` / 网关 / REST 路由的行为不动;`resolveBindAddress` 与 `paths.ts` 三个函数的**默认值**不动。
- **配置优先级一刀切**:`EMBER_HOST` / `EMBER_PORT` 只在「配置文件不存在」时作为种子写入文件;之后一律以文件为准,环境变量再怎么变都不覆盖;UI 始终可改。文件存在但损坏或不合 schema 时**不**用种子(文件在,说明不是首次启动),照旧回退默认值并告警。
- **镜像的运行阶段**只包含生产依赖与构建产物:没有 devDependencies、没有 `git`、没有源码;以非 root 用户(`node`)运行;带 `HEALTHCHECK`;`data/` 是卷。
- **启动脚本只做启动**:不装依赖、不构建、不改配置;缺什么就用英文提示用户该跑哪条命令然后退出。
- 数值一律做成常量并在报告的「数值初值清单」逐个列出;你不得自行调整初值。
- 不改 `docs/development-plan.md` 的任务描述与验收框;`docs/fairlight-ember.md` 只由用户回写;`docs/prompts.md` 由监督会话维护,不改。

## 任务范围

六项改动,按下面的顺序做。

### 1. 进程生命周期与环境变量

**1.1 优雅退出**

新建 `apps/server/src/shutdown.ts`:`installShutdownHandlers(target, options)`,`target` 是 `{ close(): Promise<void> }`(`start()` 返回的 `app` 满足),`options` 注入 `signals`(默认 `['SIGINT', 'SIGTERM']`)、`process`(默认全局,只用它的 `on` / `once` / `exit`)、`setTimeout` / `clearTimeout`、`logger` 与 `timeoutMs`(常量 `SHUTDOWN_TIMEOUT_MS`,初值 5000)。收到信号:记一条 info 日志,调 `close()`,完成后 `exit(0)`;超时未完成 `exit(1)` 并告警;第二次收到信号直接 `exit(130)`。返回一个 `shutdown(reason)` 函数供 1.2 复用。

单测(`shutdown.test.ts`,注入假 `process` 与假计时器):正常关闭 → `exit(0)`;`close()` 挂住 → 超时 `exit(1)`;`close()` 抛错 → `exit(1)` 且有日志;重复信号 → `exit(130)`;只注册了指定的信号。

**1.2 stdin 守护(给桌面壳用)**

同一文件加 `watchStdinForExit(stream, shutdown, logger)`:当环境变量 `FLWC_EXIT_ON_STDIN_CLOSE=1` 时,`main.ts` 把 `process.stdin` 交给它;`stream` 的 `end` 或 `close` 事件触发 `shutdown('stdin closed')`;`stream.on('error')` 也走同一条(父进程崩溃时 Windows 上是 `EPIPE` 而不是 `end`)。这是 7.2 桌面壳的进程边界:壳把子进程的 stdin 接成管道,壳以任何方式消失(退出、崩溃、被任务管理器结束、注销)管道都会断,子进程随之自行退出,Windows 与 macOS 同一套,不需要各写 Job Object 与进程组。不设该变量时不碰 `stdin`(控制台启动时用户可能还想 Ctrl+C,也不能让 `stdin` 被 `resume` 后拖住事件循环)。

单测:`end` / `close` / `error` 三种事件各触发一次 `shutdown`,且只触发一次;不设变量时不监听(`main.ts` 的分支逻辑放进一个可测的 `shouldWatchStdin(env)`)。

**1.3 路径环境变量**

`apps/server/src/paths.ts` 增加 `resolveRuntimePaths(env, moduleUrl)`:返回 `{ webRoot, dataDir, configPath }`,`FLWC_WEB_ROOT` 非空则用它(`path.resolve`),否则 `resolveWebDist()`;`FLWC_DATA_DIR` 非空则用它,否则 `resolveDataDir()`;`configPath` 是 `dataDir/config.json`。既有三个函数与它们的默认值**不改**。`server.ts` 的 `start()` 在没传 `staticRoot` / `configDir` 时改用它(这样 `main.ts` 不用碰环境变量)。`paths.test.ts` 补三种组合。

**1.4 环境变量种子值**

新建 `apps/server/src/config/env-seed.ts`:`readEmberSeed(env, logger): { host: string; port: number } | undefined`。规则:`EMBER_HOST` 与 `EMBER_PORT` **都没设**返回 `undefined`;只设了一个,另一个取 shared 的默认值;`EMBER_PORT` 用 `Number()` 转换后与 host 一起过 shared 的连接 body schema,不通过则告警(带原始值)并返回 `undefined`,不抛错——启动不能因为一个错的环境变量失败。

`ConfigStore` 增加可选构造参数 `seed?: { host; port }`:`load()` 命中 `ENOENT` 且有种子时,把「默认配置 + 种子 ember」经 `writeAtomic` **写到磁盘**再返回,并记一条 info 日志说明种子已写入;写入失败(如只读目录)只告警,仍返回带种子的内存配置。其它两种失败情形(损坏、schema 失败)不用种子。`MixerRuntime` 接受 `emberSeed` 选项透传;`server.ts` 的 `start()` 在没有显式 `runtime` 时用 `readEmberSeed(process.env, logger)` 填它。**传了 `runtime` 或显式 `emberSeed`(含 `null` 表示「不要种子」)的调用不读 env**,测试夹具 `mixer-stack.ts` 与 soak 传 `emberSeed: null`,否则 CI runner 上的环境变量会污染既有用例。

单测:`env-seed.test.ts`(都没设、只设 host、只设 port、非法 port 三种(非数字、0、65536)、空 host、正常);`config-store.test.ts` 新增(文件缺失 + 种子 → 文件被创建且内容是种子、第二次 `load()` 不带种子也读到它;文件存在 + 种子 → 文件内容优先,不被覆盖;文件损坏 + 种子 → 默认值且不落盘;只读目录 + 种子 → 返回种子且不抛)。集成(新文件 `apps/server/tests/env.integration.test.ts`):`emberSeed` 指向 Mock Provider、`configDir` 是空目录 → `start()` 后 `GET /api/v1/connection` 返回种子并连上;然后 `PUT` 改成另一个 Provider、`app.close()`、用同一 `configDir` 与**不同的**种子再 `start()` → 仍是 PUT 过的地址(文件优先);另一条用 `FLWC_WEB_ROOT` / `FLWC_DATA_DIR` 指向临时目录,断言 `/` 返回那里的 `index.html`、配置写到那里。

### 2. Mock Provider 命令行工具

新建 `apps/server/src/tools/mock-provider.ts`,`package.json` 加脚本 `"mock-provider": "tsx src/tools/mock-provider.ts"`。参数(解析函数放 `cli-args.ts`,有单测):`--port`(必填,不给就打印用法退出 1)、`--host`(默认 `0.0.0.0`,容器要从 `host.docker.internal` 连进来)、`--dump`(默认最新 dump)、`--meters`(布尔,开启后按 `soak-signal.ts` 的 `meterSignal` / `loudnessSignal` 以 20 Hz 喂电平,复用不复制)。启动后打印地址与树里映射通道的数量;`SIGINT` / `SIGTERM` 关掉退出。`MockEmberProvider` 需要监听地址参数的话,只在 `packages/test-utils` 里加一个**向后兼容的可选项**(默认值保持现状),并补一条单测;不改它的其它行为。

用途:① 你在本机验证容器与启动脚本的 Ember 链路;② README 的「没有台子怎么试」一节;③ 7.2 验证桌面壳;④ 用户以后离线演示。这是覆盖率排除里唯一允许新增的一项。

### 3. 控制台启动脚本(三态之一:黑框启动)

仓库根两个文件,行为完全对称,都只做「检查 → 设默认环境 → 前台运行」:

- `start.cmd`(Windows,双击即开一个控制台窗口):`node --version` 找不到或主版本 < 22 → 提示 `Node.js 22 or newer is required` 退出 1;`apps\server\dist\main.js` 或 `apps\web\dist\index.html` 不存在 → 提示 `Run "pnpm install" and "pnpm build" first` 退出 1;`HOST` 未设则设 `0.0.0.0`,`PORT` 未设则设 `3000`;打印 `Fairlight Live Web Controller — http://localhost:<PORT>  (Ctrl+C to stop)` 后 `node apps\server\dist\main.js`;进程退出后 `pause`,让双击打开的窗口不会一闪而过(有错误时用户能看到)。`setlocal`,不污染调用方环境。
- `start.sh`(macOS / Linux,`#!/usr/bin/env bash`,`set -euo pipefail`):同样的检查与默认值,`exec node apps/server/dist/main.js`。提交时带可执行位(`git update-index --chmod=+x`)。

不打印局域网 IP(跨平台取网卡的方式差异太大,7.2 的桌面壳会做);README 告诉用户在平板上用电脑的局域网地址访问。Windows 首次监听 `0.0.0.0` 时防火墙会弹「允许 Node.js 访问网络」,写进 README。

### 4. Docker 镜像与 compose(三态之二)

**4.1 `Dockerfile`**(仓库根)

多阶段,基础镜像 `node:22-alpine`:

- `build` 阶段:`apk add --no-cache git`;`corepack enable && corepack prepare pnpm@11.17.0 --activate`;复制 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、各包的 `package.json`,`pnpm install --frozen-lockfile`;复制其余源码,`pnpm build`;然后**把 devDependencies 剪掉**——`pnpm prune --prod` 或 `pnpm install --prod --frozen-lockfile --offline`,两种都试,取能让运行阶段 `node apps/server/dist/main.js` 起来的那种,报告里写明选了哪种与原因。
- `runtime` 阶段:不装 git、不装 pnpm;`WORKDIR /app`;从 `build` 阶段只复制运行所需——根 `package.json` / `pnpm-workspace.yaml` / `node_modules`、`apps/server/package.json` + `dist` + `node_modules`、`apps/web/dist`、`packages/shared/package.json` + `dist`(+ 它的 `node_modules`,如果 pnpm 给它建了),**目录布局与仓库一致**;`mkdir /app/data && chown node:node`;`USER node`;`ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000`;`EXPOSE 3000`;`VOLUME ["/app/data"]`;`HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"`;`CMD ["node", "apps/server/dist/main.js"]`。加 OCI 标签(`org.opencontainers.image.source` / `.description` / `.licenses`),版本标签由工作流用 `--label` 注入。
- 镜像用 `docker run --rm -e EMBER_HOST=... -e EMBER_PORT=... -p 3100:3000 -v <vol>:/app/data` 起来后:`/api/v1/health` 200、`/` 返回 index.html、`/views` 深链接也返回 index.html、`docker stop` 在 2 秒内退出(第 1.1 节生效)、容器日志里是 pino 的 JSON 行。**报告里写镜像大小**(`docker image ls`)。

**4.2 `.dockerignore`**:`node_modules`、`**/node_modules`、`**/dist`、`**/coverage`、`data`、`soak-reports`、`.git`、`docs`、`.github`、`scripts`、`start.*`、`*.md`(`README.md` 可留)、`.env*`。

**4.3 `docker-compose.yml`**(仓库根,可直接 `docker compose up -d`):

```yaml
services:
  flwc:
    image: ghcr.io/wuxinnnn/fairlight-live-web-controller:latest
    # build: .   # uncomment to build from this checkout instead of pulling
    container_name: flwc
    ports:
      - '3000:3000'
    environment:
      # Seed values: written to data/config.json on the very first start only.
      # After that the file (and the CONNECTION panel in the UI) wins.
      EMBER_HOST: 192.168.1.10
      EMBER_PORT: '9000'
    volumes:
      - flwc-data:/app/data
    restart: unless-stopped
volumes:
  flwc-data:
```

用命名卷而不是 bind mount,因为容器以 `node`(uid 1000)运行,bind mount 到宿主机目录时权限经常对不上;README 里给出想用 bind mount 时要 `chown` 的说明。

**4.4 `scripts/docker-smoke.sh`**(bash,CI 与本地共用):参数是镜像名;流程:`docker volume create` 临时卷 → `docker run -d` 带 `EMBER_HOST=203.0.113.9 EMBER_PORT=9001`(文档保留地址,永远连不上,正好验证「Ember 未连接时服务照常起」)与临时端口 → 等 health 200(最多 30 秒)→ `GET /api/v1/connection` 的 host/port 等于种子 → `PUT` 改成 `203.0.113.10:9002` → `docker stop`(计时,断言 ≤ 5 秒)→ 用**同一个卷、不同的环境变量**再 `docker run` → `GET` 仍是 PUT 过的值(持久化 + 文件优先)→ `/views` 返回 HTML → 容器内 `id -u` 非 0、`ls node_modules/.pnpm | grep -c typescript` 为 0 → 清理容器与卷。任何一步失败非零退出并打印容器日志。Windows 上用 Git Bash 跑得通。

### 5. `.github/workflows/docker.yml`

新建,`ci.yml` 与 `soak.yml` 不动:

- 触发:`pull_request`(只构建 + 冒烟,不推送)、`push` 到 `main`(构建 + 冒烟 + 推 `:main`)、`push` 标签 `v*`(构建 + 冒烟 + 推 `:vX.Y.Z` 与 `:latest` + 生成离线镜像包并挂到 Release)、`workflow_dispatch`。
- 步骤:`docker/setup-qemu-action` + `docker/setup-buildx-action`;`docker/build-push-action` 先构建 `linux/amd64` 到本地 docker(`load: true`)→ 跑 `scripts/docker-smoke.sh` → 通过后(仅 main / 标签)`docker/login-action` 登录 GHCR(`GITHUB_TOKEN`,`permissions: packages: write, contents: write`)并按 `linux/amd64,linux/arm64` 推送(`docker/metadata-action` 生成标签与 OCI 标签);标签触发时另外 `docker save <image>:<tag> | gzip > flwc-<tag>-linux-amd64.tar.gz`,`gh release view <tag> || gh release create <tag> --generate-notes`,再 `gh release upload --clobber` 挂上去(7.2 的桌面工作流会往同一个 Release 上传安装包,所以这里必须是「存在就复用」)。只用 `docker/*` 官方 action 与 `gh`,不引入第三方 action。
- **验证**:PR 分支上 `pull_request` 触发的那条会自己跑;推送路径按 6.5 报告第 6 节的做法——临时加一个 `push: branches: [<你的分支>]` 触发器、把推送目标改成 `:pr-<N>` 标签跑一次,确认 GHCR 上出现镜像、`docker pull` 得下来、跑得起来,然后**删掉临时触发器与临时标签**(`gh api -X DELETE` 删掉 package version),最终提交里没有它们。标签 → Release 的路径在合并前无法真跑,报告里写明「未验证,合并后由用户打第一个标签验证」。
- GHCR 包首次创建后的可见性由用户在 GitHub 上确认为 public(你无权改),报告的移交清单里写一条。

### 6. README 与文档核对

**6.1 `README.md`**(英文)重写「Getting Started」与「Deployment」,按三态组织:

- Requirements(台子的 Ember+ 端口 9000 可达;三态各自的前提)
- **Run from a terminal**(Windows:`pnpm install && pnpm build`,然后双击 `start.cmd` 或在终端里跑;macOS / Linux:`./start.sh`;Windows 防火墙提示要点允许;`Ctrl+C` 停止)
- **Run with Docker**:`docker compose up -d`(先改 compose 里的 `EMBER_HOST`)→ 打开 `http://<host>:3000`;升级:`docker compose pull && docker compose up -d`;离线:从 Release 下载 `flwc-<tag>-linux-amd64.tar.gz`,`docker load -i`,再 `docker compose up -d`;本地构建:取消 `build: .` 注释;bind mount 的权限说明
- **Desktop app**:一段占位,写明「A Windows desktop launcher with a tray icon is coming in Phase 7.2; until then use one of the two options above」——不写还没实现的细节
- Configuration:一张表——`HOST`、`PORT`、`EMBER_HOST`、`EMBER_PORT`(种子值,只在配置文件不存在时生效,之后由 UI 的 CONNECTION 面板管理)、`FLWC_DATA_DIR`、`FLWC_WEB_ROOT`、`FLWC_EXIT_ON_STDIN_CLOSE`(标注「for process supervisors and the desktop launcher」);`data/config.json` 是什么、在哪(仓库 `data/`;容器里 `/app/data`)
- Try it without a desk:`pnpm --filter @flwc/server mock-provider --port 9100 --meters`,然后把 `EMBER_HOST` 指向它(容器里用 `host.docker.internal`)
- Development:保留现有命令表;把「Status: early development」的提示改成符合现状的一句
- 不写任何还没实现的功能

**6.2 文档全面核对**:逐个通读 `AGENTS.md`、`docs/architecture.md`、`docs/conventions.md`、`README.md`,把每一处与实际行为不符的地方改成当前状态(例子:`AGENTS.md` 里 Vite 只监听 `::1` 那句;`architecture.md` 「部署」一节要改写成三态、Dockerfile、compose、GHCR、环境变量优先级、优雅退出与 stdin 守护的实际样子;`conventions.md` 目录结构加根目录的 Docker 文件、`scripts/`、`start.*`,Git 一节的不提交清单核对)。**每一处修改在报告里列成一行:文件、原文要点、改成什么、依据。** 不动 `docs/development-plan.md`、`docs/prompts.md`、`docs/prompts/*`、`docs/reports/*`(除本批次报告)、`docs/fairlight-ember.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放各包 `tests/`;第 1–2 节的测试项全部落地;既有测试只允许增。
- 覆盖率:`apps/server` ≥ 80%(维持既有门槛);`packages/test-utils` 若加了监听地址选项,补一条单测,门槛不变;`apps/web`、`packages/shared` 本批次不改。
- 集成用例全程只连 Mock Provider;设置环境变量的用例在 `afterEach` 里恢复。
- `scripts/docker-smoke.sh` 在本机(Git Bash + Docker Desktop)与 CI runner 上都要实际通过;启动脚本按第 3 节实际跑过并记录。

## 明确不做的事

- 不做桌面壳(7.2);不做安装包、代码签名、自动更新。
- 不做 HTTPS、反向代理、鉴权。
- 不改前端;不改 6.x 的任何数值与语义;不改 `ci.yml` 与 `soak.yml`。
- 不做 arm/v7(32 位树莓派)镜像;不做 Windows 容器镜像。
- 不给容器加 `network_mode: host`;Ember+ 是出站 TCP,bridge 网络够用。
- 启动脚本不做守护、不做自动重启、不写日志文件——那是桌面壳与容器编排的事。

## 验收自查

完成后逐条核对,在本地实际执行并记录结果:

1. 优雅退出与 stdin 守护:单测全绿;`docker stop` 实测 ≤ 5 秒;本机 `start.cmd` 后 Ctrl+C 干净退出、日志里有关闭记录;`FLWC_EXIT_ON_STDIN_CLOSE=1` 下用管道起 node、关掉写端,node 2 秒内退出。
2. 环境变量:种子与路径的单测、集成用例全绿;`docker-smoke.sh` 证明「首次种子写入 → PUT 覆盖 → 换环境变量重启仍是文件值」。
3. mock provider:`--port` 不给退出 1;`--port 9000` 被拒;`--meters` 下浏览器电平表在动;`Ctrl+C` 干净退出。
4. 启动脚本:缺 Node / 缺构建产物 / 正常三种情形各跑一次(缺 Node 用临时清空 `PATH` 模拟);`PORT=3100` 下页面能开、mock 通道可见。
5. Docker:镜像在本机 Docker Desktop 起得来,`docker-smoke.sh` 通过;镜像大小记录在报告。
6. `docker.yml`:PR 上的构建 + 冒烟绿;临时推送验证过 GHCR 拉取,临时触发器与临时标签已清理;`ci.yml` 与 `soak.yml` 无 diff。
7. 文档:README 的每条命令都在本机照着敲过一遍;文档核对清单在报告里。
8. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff,`apps/server/vitest.config.ts` 只多了 `src/tools/mock-provider.ts` 一项排除。
9. 全程没有碰真实 Fairlight,没有动 3000 / 5173 / 9000;结束时没有你起的容器、卷与 node 进程残留。

## 执行报告要求

在 `docs/reports/phase-7-1-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-6-5-report.md` 相同:结果总览、验收标准逐条核对(对上述九条)、实现摘要(每节一段;Docker 一节写清剪 devDependencies 用的是哪种方法、运行阶段复制了哪些目录、镜像大小)、**Docker 实测记录**(本机 smoke 输出、CI run 链接、GHCR 临时推送的拉取记录)、**启动脚本实测记录**、数值初值清单(本批次全部常量:名称、值、含义、文件)、**文档核对清单**(第 6.2 节要求的逐行表)、**给 7.2 的接口说明**(桌面壳要设哪些环境变量、怎么接 stdin、就绪怎么判、退出怎么等——写成 7.2 的执行会话能直接照抄的一节)、真机验收操作清单(移交用户,含:① `start.cmd` 双击启动、平板按局域网地址打开、通过 CONNECTION 面板指向真实台子、验证四个允许通道的推子、Ctrl+C 退出;② Docker Desktop 上 `docker compose up -d` 指向真实台子,浏览器验证,`docker compose restart` 后配置仍在,`docker compose down && up` 仍在;③ 合并后打第一个标签验证 Release 与镜像包,确认 GHCR 包可见性为 public;**安全约束照抄 6.4 报告第 6 节**,验收只动允许的四个通道)、交付物清单、依赖清单(应为「无新增 npm 依赖,lockfile 无 diff;GitHub Actions 新增 `docker/*` 官方 action」)、关键决策与偏离、被改写的既有用例清单(预期为空或只有夹具级调整,如 `mixer-stack.ts` 加 `emberSeed: null`)、遗留问题与移交事项、提交记录。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤、做不了的验证都要写明,不许美化。

## 完成定义

- 六项任务全部落地,测试要求全部满足。
- 本地串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,`pnpm-lock.yaml` 无改动。
- PR 已开,远端 CI(`ci.yml` 与 `docker.yml` 的 PR 路径)全绿,Bugbot 的每一条 finding 都已修复或已在线程里回复理由,且最后一轮轮询没有新 finding。
- `docker-smoke.sh` 在本机与 CI 上各通过一次;GHCR 临时推送验证过一次并已清理。
- 用户机器上没有残留:无 node 孤儿、无本批次起的容器与卷。
- 全部变更已按 Conventional Commits 提交并推送。
- `docs/reports/phase-7-1-report.md` 已产出,真机验收清单可直接交用户执行,「给 7.2 的接口说明」一节完整。
