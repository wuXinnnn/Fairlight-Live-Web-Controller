# Phase 7.1 执行报告 — 服务端收尾、控制台启动与 Docker

## 1. 结果总览

六项改动全部落地,本地与远端 CI 全绿。

| 项 | 结果 |
| --- | --- |
| PR | [#23](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/pull/23) |
| 分支 | `claude/phase-7-1-c310cdff` |
| 提交 | 13 个(含一对临时触发器的加/删) |
| 测试 | shared 44 / test-utils 23 / server 287 / web 497,全绿 |
| 覆盖率 | server 94.97 / 87.64 / 97.36 / 94.91(门槛 80);test-utils 93.86 / 90.40 / 100 / 93.86(门槛 90);shared 100;web 未改动 |
| 新增 npm 依赖 | 无,`pnpm-lock.yaml` 无 diff |
| 新增覆盖率排除 | 1 项:`src/tools/mock-provider.ts` |
| 镜像 | `flwc:smoke` **206 MB**,非 root(uid 1000),无 devDependency |
| `docker stop` | 本机 521 ms / 冒烟 625 ms / CI 112 ms(预算 5000 ms;改动前是 10 秒宽限期跑满)。**启动期间就发信号**这条路径最初仍然是坏的,由 Bugbot 抓到,见第 11.5.1 节:30366 ms + SIGKILL → 354 ms + 退出码 0 |
| `ci.yml` / `soak.yml` | 一字未改(`git diff main` 为空) |

基线对照(提示词第 35 行):server 245 → 284(+39),test-utils 22 → 23(+1),shared 44 → 44。
**提示词写的 web 基线 496 与实跑不符**:`git diff main -- apps/web` 为空,本批次一行前端都没动,
实跑是 497,所以那是提示词里的笔误,不是本批次引入的变化。

## 2. 验收标准逐条核对

### ① 优雅退出与 stdin 守护

| 子项 | 结果 |
| --- | --- |
| 单测全绿 | `shutdown.test.ts` 15 例全过(正常 / 超时 / 抛错 / 重复信号 / 信号注册 / 成功后定时器 / 延迟目标三例 / stdin 三事件 / 只触发一次 / `resume` / `shouldWatchStdin` 五种取值) |
| `docker stop` ≤ 5 秒 | **521 ms**(本机手工)、**704 ms**(本机冒烟)、**112 ms**(CI 冒烟),退出码 0。**启动期间发信号**:修复前 30366 ms + SIGKILL,修复后 **354 ms** + 退出码 0(第 11.5.1 节) |
| `start.cmd` 后 Ctrl+C 干净退出、日志里有关闭记录 | 是,实测。见第 5 节 |
| `FLWC_EXIT_ON_STDIN_CLOSE=1` 管道关写端后 2 秒内退出 | **9 ms**,退出码 0。见第 5 节 |

### ② 环境变量

| 子项 | 结果 |
| --- | --- |
| 种子与路径单测 | `env-seed.test.ts` 11 例、`config-store.test.ts` 新增 4 例、`paths.test.ts` 新增 4 例、`server.test.ts` 新增 3 例(`resolveEmberSeed`),全绿 |
| 集成用例 | `tests/env.integration.test.ts` 2 例全绿:种子 → 连上 Mock → PUT → 重启(换种子)仍是 PUT 值;`FLWC_WEB_ROOT` / `FLWC_DATA_DIR` 各生效 |
| 冒烟证明「首次种子 → PUT 覆盖 → 换环境变量重启仍是文件值」 | 是,`docker-smoke.sh` 的主干就是这条,本机与 CI 各过一次 |

### ③ mock provider

| 子项 | 结果 |
| --- | --- |
| `--port` 不给退出 1 | 是,打印 `--port is required` + 用法,退出码 1 |
| `--port 9000` 被拒 | 是,`Refusing to bind Mock Ember+ Provider on port 9000 (reserved for the live Fairlight)`,退出码 1 |
| `--meters` 下电平在动 | 是。Ember 客户端订阅 `channel/channel1/meter`,2 秒收到 39 个样本(≈20 Hz),值持续变化;server 侧快照 20 个通道,名称是归档 dump 的 MIC / MIC-REVERB / BASS / Anagram-Wet / Anagram-Dry。**浏览器里的电平表没有亲眼看**——那一步留在第 9 节移交用户 |
| Ctrl+C 干净退出 | 关闭路径与 start.cmd 同一套 `SIGINT`;工具本身的 `process.once('SIGINT')` 清定时器、`provider.close()`、打印 `Mock Ember+ Provider stopped` |

### ④ 启动脚本

三种情形 × 三种外壳,见第 5 节的表。`PORT=3100` 下页面能开、20 个 mock 通道可见。

### ⑤ Docker

镜像在本机 Docker Desktop(29.8.0,Linux 容器)起得来,`docker-smoke.sh` 本机与 CI 各通过一次,镜像 206 MB。

### ⑥ `docker.yml`

PR 上的构建 + 冒烟绿([run 35213184930](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35213184930))。
临时推送验证过 GHCR 拉取(第 4.5 节),临时触发器与临时 package 都已清理。
`git diff main -- .github/workflows/ci.yml .github/workflows/soak.yml` 为空。

### ⑦ 文档

README 的命令逐条敲过(唯一例外见第 11 节),文档核对清单见第 8 节。

### ⑧ 全量质量门

本地串行 `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` 全绿;远端 `ci.yml` 与 `docker.yml` 全绿;
`git diff --stat main -- pnpm-lock.yaml` 为空;`vitest.config.ts` 只多 `src/tools/mock-provider.ts` 一项。

### ⑨ 没有碰真实台子,没有残留

- 全程没有向真实 Fairlight 发过任何命令。所有容器、脚本、mock provider 的 Ember 地址只指向本机 Mock Provider(9100)
  或 RFC 5737 文档地址(`203.0.113.9/.10/.11`,端口 9001/9002/9003),永远连不上,正好用来验证「台子不在时服务照常起」。
- 端口 3000 / 5173 / 9000 全程没占、没重启、没杀。自己用的端口是 3100(启动脚本)、3101(stdin 试验)、
  3198(compose)、3199(手工容器)、9100(mock provider),容器一律 `-p 127.0.0.1::3000` 随机回环端口。
- **一处必须说明**:仓库里的 `data/config.json` 是用户自己的、指向真实台子的配置。我起的每一个进程都设了
  `FLWC_DATA_DIR` 指向临时目录,没有读也没有写过它。
- **另一处必须说明**:用户的 `pnpm dev` 跑的是 `tsx watch src/main.ts`,我改 `main.ts` / `server.ts` /
  `config-store.ts` 时它会自动重启一次。这是在同一个工作区里改代码的必然结果,不是可以绕开的;由于用户的
  `data/config.json` 已存在,种子逻辑对它完全不生效,行为与改动前一致。
- 收尾:`docker ps -a`、`docker volume ls`、`docker image ls` 与 node 进程的清理结果见第 12 节。

## 3. 实现摘要

### 3.1 优雅退出与 stdin 守护(`apps/server/src/shutdown.ts`)

`installShutdownHandlers(target, options)` 收到信号 → info 日志 → `target.close()` → `exit(0)`;超过
`SHUTDOWN_TIMEOUT_MS` 未完成 → error 日志 → `exit(1)`;`close()` 抛错 → error 日志(带 `errorMessage`)→
`exit(1)`;关闭进行中再收到信号 → warn → `exit(130)`。返回的 `shutdown(reason)` 给 1.2 复用。

两个标志各司其职,合并任何一个都会漏掉一种情况:

- `started` 是**信号级**闩锁,决定第二个信号走 130;
- `settled` 是**单次关闭内部**的完成闩锁,决定 `close()` 与超时定时器谁能调 `exit`。

`watchStdinForExit(stream, shutdown, logger)` 监听 `end` / `close` / `error`,共用一个 `fired` 闩锁只触发一次,
末尾 `stream.resume?.()`。`shouldWatchStdin(env)` 只认 `'1'`。

`main.ts` 只有接线,每行都是对已覆盖导出函数的调用。顺序是**先装处理器、后 `await start()`**,
中间用 `deferredShutdownTarget()` 顶着——理由见第 11.5.1 节,这是 Bugbot 抓到的那条。为此
`StartOptions` 加了可选的 `logger`,`StartedServer` 上也加了 `logger`(`createApp` 拿到的是 pino 的
**配置对象**、不是实例,`app.log` 与 runtime 用的从来不是同一个)。

注入 `setTimeout` / `clearTimeout` 而不是 `vi.useFakeTimers()`:① 「成功时定时器被清掉」只有拿注入的
`clearTimeout` 记句柄才直接可断言;② `close()` 是微任务工作,假计时器会把 `setImmediate` 一起假掉,
冲洗微任务就没法一行写完。

### 3.2 路径环境变量(`apps/server/src/paths.ts`)

新增 `resolveRuntimePaths(env, moduleUrl)` → `{ webRoot, dataDir, configPath }`。既有三个函数与默认值一字未动。
空串(trim 后)当作未设,免得 compose 或 shell 里一个导出但为空的变量把服务指到工作目录。
`configPath` 走 `resolveConfigPath(dataDir, moduleUrl)`,文件名只有一处真相。

`start()` 无条件调一次,优先级 **显式选项 > 环境变量 > 仓库相对默认值**。`configDir`(目录)与
`paths.configPath`(文件)不是一个东西,合不成一个 `??`,所以是个三元式。

### 3.3 环境变量种子值(`apps/server/src/config/env-seed.ts` + `config-store.ts`)

`readEmberSeed(env, logger)`:两个都没设 → `undefined`;设一个 → 另一个取 shared 的默认值;
`Number(EMBER_PORT)` 后与 host 一起过 `connectionPutBodySchema`(复用 `PUT /api/v1/connection` 的 body schema,
不另写规则),不过则告警(带原始值)并返回 `undefined`,**不抛**。

`ConfigStore` 加第三个**可选位置参数** `seed?`。选位置参数而不是选项对象,是因为生产代码只有 1 处
`new ConfigStore(`,而 `config-store.test.ts` 里有 6 处;改成选项对象要重写 6 条既有用例,与「既有测试只允许增」冲突。

`load()` 的新分支**提在既有 warn 之上**——掉在后面会同时打出 `warn "config missing, using defaults"`(谎话)
和 `info "config seeded"`。`seedFile()` 里三处是刻意的:

1. `writeTail` 记账逐字照抄 `save()`——挂到 tail 上,再把 tail 重新赋值为**永不 reject** 的派生。直接
   `await this.writeAtomic()` 会绕过队列;把会 reject 的 promise 赋给 `writeTail` 会毒掉之后每一次 `update()`。
2. `this.current` 在 `await` **之前**赋值一次,成功与写失败两条路都留下带种子的配置。
3. 入口过一道 `appConfigSchema.parse`,与 `save` / `update` 同一套校验,落盘内容与 `save()` 写的完全一致。

贯通:`MixerRuntimeOptions.emberSeed` → `ConfigStore`;`StartOptions.emberSeed?: EmberSeed | null`;
`resolveEmberSeed(options, logger, env)` 导出以便单测。

### 3.4 Mock Provider 工具(`apps/server/src/tools/mock-provider.ts`)

`--port`(必填)、`--host`(默认 `0.0.0.0`)、`--dump`(默认最新)、`--meters`。解析在 `cli-args.ts` 的
`parseMockProviderArgs`(有单测),用法文本作为 `const` 放在被排除的驱动里,保持 `cli-args.ts` 与既有四个
解析器一致(那四个都没有 usage 先例)。

用 `MockEmberProvider.fromDump(dump, { host, port })` 而不是 `fromDumpFile()`,因为要拿 `DumpTree` 喂
`collectMeterPaths(dump)`;`meterSignal` / `loudnessSignal` 直接从 `soak-signal.ts` 相对导入,一行都没复制。

**`packages/test-utils` 源码零改动**:`MockEmberProviderOptions { host?, port? }` 本来就在,
`this.host = options.host ?? '127.0.0.1'`,`listen()` 也早就把 `this.host` 同时传给 `findFreePort` 与
`new EmberServer`。这里的交付物只有 **1 条单测**(非默认 host),测试里绑 `127.0.0.1` 而不是 `0.0.0.0`,
不在 CI runner 上开全网卡监听。

### 3.5 控制台启动脚本

对称,只做「检查 → 设默认环境 → 前台运行」。`start.cmd` 末尾 `pause`(`FLWC_NO_PAUSE=1` 可关),
`start.sh` 用 `exec`。`.gitattributes` 加了 `*.cmd` / `*.bat` 为 CRLF——原先 `* text=auto eol=lf` 会让
`start.cmd` 以 LF 入库,而 cmd.exe 对 LF 文件里的 `goto` 与括号块处理不可靠,版本检查正要用 `goto`。
`start.sh` 与 `scripts/docker-smoke.sh` 带可执行位入库。

### 3.6 Docker

**剪 devDependencies 用的是哪种方法**:两种都不行,最后用的是**第三种**。

| 方法 | 结果 |
| --- | --- |
| `pnpm prune --prod` | **不可用**。它不递归 workspace:在根上跑只剪根清单(只有 eslint / prettier / typescript),`apps/server/node_modules` 里的 vitest / tsx / typescript 原封不动 |
| `pnpm install --prod --frozen-lockfile --offline --ignore-scripts` 剪 build 阶段 | **实测不够**。各项目 `node_modules` 里的 devDependency 链接确实解掉了(`apps/server/node_modules` 只剩 6 个生产包),但 `node_modules/.pnpm` 里的包还在——`pnpm fetch` 已按**整份** lockfile 填过它。实测 `.pnpm` 496 项、230 MB,`ls node_modules/.pnpm \| grep -c '^typescript@'` 得 1,镜像 **352 MB** |
| **`deps` 单独阶段 + `pnpm fetch --prod`**(采用) | 只按生产闭包填 store,没有东西需要事后剪。`.pnpm` 134 项、`node_modules` 55 MB,dev 包计数 0,镜像 **206 MB** |

`--ignore-scripts` 在 `deps` 阶段是**必须的**:`packages/shared` 与 `packages/test-utils` 都有
`prepare: tsc`,`--prod` 之后没有 `tsc` 可跑,不加就在这一行炸。它们的 `dist` 从 `build` 阶段复制。
`CI=true` 是因为 pnpm 要清 `node_modules` 目录时会问一个没有 TTY 可答的问题
(`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`)。

**`build` 阶段的分层也换了**:不能按常规「先复制各 `package.json` 再 install」——workspace 安装会跑每个项目
的 `prepare`,而那两个 `prepare` 是 `tsc`,那时源码还没 `COPY . .` 进来,实测直接
`error TS5058: The specified path does not exist: 'tsconfig.build.json'`。改用 `pnpm fetch`(只要 lockfile)
填 store,慢的那一层仍然只在 lockfile 变时重建。

**运行阶段复制了哪些目录**:

| 来源 | 路径 |
| --- | --- |
| `deps` | `package.json`、`pnpm-workspace.yaml`、`node_modules`、`apps/server/package.json`、`apps/server/node_modules`、`packages/shared/package.json`、**`packages/shared/node_modules`** |
| `build` | `apps/server/dist`、`apps/web/dist`、`packages/shared/dist` |

- **`packages/shared/node_modules` 是最容易漏的一条**:`@flwc/shared` 要的 `zod` 是从那里解析的,不是从
  `apps/server/node_modules`。漏了就是 `ERR_MODULE_NOT_FOUND`,而且立刻炸(`app.ts` 一进来就 import
  `healthResponseSchema`)。
- **目录布局与仓库一致**是硬要求,它同时保住两套相对查找:pnpm 写进 `node_modules` 的相对符号链接
  (`COPY --from` 保留链接本身、不解引用,深度不变则目标仍有效),以及 `paths.ts` 从自身位置解析的
  `../../web/dist` 与 `../../../data`。
- `chown` 必须在 `VOLUME` 之前:Docker 用镜像里该目录的内容**与属主**初始化新命名卷。
- **`rm -rf apps/server/dist/tools` 是个错误,已撤回**:它不全是开发工具,`ember-service.js` 会 import 其中的
  `expand-ember-tree.js`,删掉之后容器起不来(见第 4 节的实测记录)。真正引用 devDependency 的那几个驱动
  从 `main.js` 根本到不了,悬空的 import 永远不会被解析。

**镜像大小**:`docker image ls` 报 **206 MB**(`node:22-alpine` 基础镜像约 150 MB,本项目层约 56 MB)。

### 3.7 `docker.yml`

构建两次是有意的:第一次 amd64 + `load: true`(多平台构建不能 `load`,而冒烟要有东西可跑),冒烟过了才登录、
才推第二次(amd64 + arm64,amd64 腿直接走 GHA 缓存)。

离线镜像包是把冒烟用的 `flwc:smoke` **重打**成 `$IMAGE:$GITHUB_REF_NAME` 与 `$IMAGE:latest` 再一起 `docker save`。
不能 save 刚推上去的那个:多平台构建把层直接送 registry,本地 daemon 里什么都没有,`docker save` 会报
`reference does not exist`。打两个标签也是为了让 `docker load -i` 之后能直接 `docker compose up -d`
(compose 里写的是 `:latest`)。

Release 用 `view || create`,因为 7.2 的桌面工作流要往同一个 Release 传安装包,谁先跑谁建。

## 4. Docker 实测记录

### 4.1 本机(Docker Desktop 29.8.0,Linux 容器,WSL2)

构建过程中的三次失败与修法,按发生顺序:

1. `RUN pnpm install --frozen-lockfile`(只复制了各 `package.json` 之后)→
   `packages/shared prepare: error TS5058: The specified path does not exist: 'tsconfig.build.json'`。
   改用 `pnpm fetch`。
2. `RUN pnpm install --prod ...` → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。加 `CI=true`。
3. 镜像建成但容器起不来 →
   `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/apps/server/dist/tools/expand-ember-tree.js'
   imported from /app/apps/server/dist/ember/ember-service.js`。删掉 `rm -rf apps/server/dist/tools`。

修完之后的手工验证:

```
$ docker image ls flwc:smoke --format 'size: {{.Size}}'
size: 206MB

$ docker run -d --name flwc-probe -e EMBER_HOST=203.0.113.9 -e EMBER_PORT=9001 -p 127.0.0.1:3199:3000 flwc:smoke
status: Up 6 seconds (healthy)
health: {"status":"ok"}
connection: {"host":"203.0.113.9","port":9001,"status":"reconnecting"}
/ : 200  /views : 200
id -u: 1000
dev packages in store: 0
.pnpm entries: 134
node_modules: 55.4M

$ docker stop -t 10 flwc-probe
docker stop took 521 ms
{"...","reason":"SIGTERM","timeoutMs":5000,"layer":"lifecycle","msg":"shutting down"}
{"...","reason":"SIGTERM","layer":"lifecycle","msg":"shutdown complete"}
exit code: 0
```

容器日志是 pino 的 JSON 行,`docker stop` 之前那条 `"tree expand error" / "Socket was disconnected"` 是
连不上 `203.0.113.9` 的预期表现。

### 4.2 `scripts/docker-smoke.sh`(本机,Git Bash)

```
$ bash scripts/docker-smoke.sh flwc:smoke
smoke: image flwc:smoke
smoke: first start, seeded with 203.0.113.9:9001
smoke: the SPA shell answers at / and at a deep link
smoke: not root, and no devDependencies
smoke: moving the endpoint to 203.0.113.10:9002 the way the CONNECTION panel does
smoke: stopping
smoke: docker stop took 625ms
smoke: second start on the same volume, seeded with 203.0.113.11:9003
smoke: PASS
```

### 4.3 `docker compose`(本机)

committed 的 `docker-compose.yml` 里写的是 `EMBER_PORT: '9000'`——那是给用户填自己台子的模板,
**我没有原样启动过它**。验证时用了一个临时 override(不入库)把镜像换成 `flwc:smoke`、端口换成
`127.0.0.1:3198`、地址换成 `203.0.113.9:9001`。

| 步骤 | 结果 |
| --- | --- |
| `docker compose up -d` | `Up 6 seconds (healthy)`,health 200,connection 是种子值 |
| `PUT` 改成 `203.0.113.10:9002` | 200 |
| `docker compose restart` | 仍是 `203.0.113.10:9002` |
| `docker compose down` 再 `up -d` | 仍是 `203.0.113.10:9002`(命名卷) |
| `docker compose down -v` | 卷已删,`docker volume ls --filter name=flwc` 为空 |

### 4.4 CI

| 项 | 结果 |
| --- | --- |
| PR 路径 run | [35213184930](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35213184930),1 分 06 秒,绿 |
| 步骤 | Build for the smoke test ✅ / Smoke test ✅ / Log in to GHCR ⏭ / Build and push ⏭ / Package the offline image ⏭ / Attach it to the release ⏭ |
| CI 上的冒烟输出 | 与本机逐行一致,`smoke: docker stop took 112ms`,`smoke: PASS` |

### 4.5 GHCR 临时推送验证

按 6.5 报告第 6 节的做法:临时给 `docker.yml` 加一个只匹配本分支的 `push` 触发器,并把
`type=ref,event=branch` **替换**成 `type=raw,value=pr-23`(替换而不是并列,保证只产生一个一次性标签,
也保证它不可能写到 `:main`)。验证完两处临时改动一起 revert。

| 项 | 结果 |
| --- | --- |
| Run | [35213628386](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35213628386),success |
| 步骤 | Build for the smoke test ✅ → Smoke test ✅ → **Log in to GHCR ✅ → Build and push ✅** |
| 推上去的 | `ghcr.io/wuxinnnn/fairlight-live-web-controller:pr-23`,OCI image index |
| 平台 | `linux/amd64` + `linux/arm64`(另有两条 `unknown/unknown`,是 buildx 的 attestation manifest) |
| 包可见性 | **首次创建即为 `public`**,不需要手动改 |
| 匿名拉取 | `docker logout ghcr.io` 之后 `docker pull` 成功,digest `sha256:8cf3cd13…` |
| 拉下来跑 | `bash scripts/docker-smoke.sh ghcr.io/wuxinnnn/fairlight-live-web-controller:pr-23` → **PASS**,`docker stop took 692ms` |
| 清理 | 5 个 package version 中 4 个未打标签的直接删掉;最后那个带 `pr-23` 标签的 GitHub 拒绝单独删(`You cannot delete the last tagged version of a package. You must delete the package instead.`),于是**把整个 package 删了**。`gh api user/packages/container/fairlight-live-web-controller` 现在返回 404,本地镜像也已 `docker rmi` |
| 临时改动 | 已 revert,`git diff d4a8a0e HEAD -- .github/workflows/docker.yml` 为空 |

两点要说清楚:

- **那个被拉下来跑的镜像是 `0fd8d88` 构建的,早于第 11 节第 1 条的关闭修复**。所以 692 ms 这个数字证明的是
  「registry 往返之后镜像仍然能跑、冒烟仍然全过」,**不是**那条修复——冒烟脚本会先等健康再 stop,
  那时 `start()` 早就返回了,老代码在这条路径上本来就是好的。修复的证据是第 11 节里 30366 ms → 354 ms 那组。
- **package 被整个删掉是 GitHub 的限制逼出来的**,不是我想删。好处是 registry 回到了这批次开始前的状态
  (`main` 从来没发布过任何东西,所以没有损失);代价是合并后第一次推送会重新创建它,**可见性要再确认一次**。
  好消息是这次它是自动 public 的,第 9 节 ③ 的第 2 步照样保留,但很可能只是看一眼就过。

## 5. 启动脚本实测记录

### 5.1 三种失败/成功情形 × 三种外壳

| 情形 | 外壳 | 输出 | 退出码 |
| --- | --- | --- | --- |
| 缺 server 产物 | cmd.exe | `Run "pnpm install" and "pnpm build" first.` | 1 |
| 缺 web 产物 | cmd.exe | 同上 | 1 |
| 缺 Node(临时把 `PATH` 清成 `C:\Windows\System32`) | cmd.exe | `Node.js 22 or newer is required, and node was not found on PATH.` | 1 |
| 缺 server 产物 | PowerShell | `Run "pnpm install" and "pnpm build" first.` | 1 |
| 缺 Node | PowerShell | `Node.js 22 or newer is required, ...` | 1 |
| 缺 server 产物 | Git Bash(`start.sh`) | `Run "pnpm install" and "pnpm build" first.` | 1 |
| 缺 web 产物 | Git Bash(`start.sh`) | 同上 | 1 |
| 缺 Node(`env -i PATH=/usr/bin:/bin`) | Git Bash(`start.sh`) | `Node.js 22 or newer is required, ...` | 1 |

**没有在真实 macOS 上跑过 `start.sh`**——手上没有那台机器。它在 Git Bash 下跑通,并且 CI 的 Docker 冒烟
(ubuntu,`bash scripts/docker-smoke.sh`)间接覆盖了同一套 bash 语法;macOS 留待有设备时验证。

### 5.2 正常启动(`PORT=3100`,`FLWC_DATA_DIR` 指临时目录,`EMBER_HOST=127.0.0.1 EMBER_PORT=9100` 指向 mock)

```
Fairlight Live Web Controller - http://localhost:3100  (Ctrl+C to stop)
{"msg":"Server listening at http://127.0.0.1:3100"}
{"msg":"Server listening at http://192.168.50.115:3100"}   (以及其它网卡,HOST 默认 0.0.0.0 生效)
{"path":"...\\flwc-ctrlc-0eee8a85\\config.json","host":"127.0.0.1","port":9100,
 "layer":"validation","msg":"config seeded from the environment"}
```

| 检查 | 结果 |
| --- | --- |
| `GET /api/v1/health` | `{"status":"ok"}` |
| `GET /api/v1/connection` | `{"host":"127.0.0.1","port":9100,"status":"connected"}` |
| `GET /` | `<!doctype html>` |
| `GET /views`(深链接) | 200 |
| 种子落盘 | `{"version":2,"ember":{"host":"127.0.0.1","port":9100},"views":[]}` |
| socket.io 快照 | 20 个通道:`channel/1 MIC`、`channel/2 MIC-REVERB`、`channel/3 BASS`、`channel/4 Anagram-Wet`、`channel/5 Anagram-Dry` … |

### 5.3 Ctrl+C(真信号,不是 kill)

Windows 上 `kill` / `Stop-Process` 走的是 `TerminateProcess`,不会投递信号,所以专门用
`AttachConsole` + `GenerateConsoleCtrlEvent(CTRL_C_EVENT)` 向 `start.cmd` 自己的控制台发了一次**真正的**
Ctrl+C(脚本在会话临时目录里,不入库):

```
node still alive after Ctrl+C: False  (waited 1153 ms)
{"reason":"SIGINT","timeoutMs":5000,"layer":"lifecycle","msg":"shutting down"}
{"reason":"SIGINT","layer":"lifecycle","msg":"shutdown complete"}
```

那 1153 ms 里大部分是启动辅助进程与它里面 300 ms 的等待,不是关闭耗时。

**`start.sh` 的 SIGTERM 在 Git Bash 下没能验证**:MSYS 的 `kill -TERM` 对原生 Windows 进程同样落到
`TerminateProcess`(退出码 143,日志里没有关闭记录)。这是 Git Bash 的限制,不是代码问题——同一条
SIGTERM 路径由 `docker stop`(Linux,第 4 节)证明,SIGINT 路径由上面的真 Ctrl+C 证明。

### 5.4 stdin 守护(7.2 的进程边界)

```
health before closing stdin: 200
exit code: 0 after 9 ms
{"reason":"stdin closed","timeoutMs":5000,"layer":"lifecycle","msg":"shutting down"}
{"reason":"stdin closed","layer":"lifecycle","msg":"shutdown complete"}
```

父进程 `spawn(node, ['apps/server/dist/main.js'], { stdio: ['pipe', ...] })`,
`FLWC_EXIT_ON_STDIN_CLOSE=1`,起来之后 `child.stdin.end()`。

## 6. 数值初值清单

本批次引入的全部常量。**没有自行调整任何既有数值**;6.x 的语义与数值一个没动。

### `apps/server/src/shutdown.ts`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| `SHUTDOWN_TIMEOUT_MS` | `5000` | 关闭的宽限期,超过即 `exit(1)`。取 5 秒是因为 `docker stop` 默认宽限 10 秒,留一半余量 |
| `SHUTDOWN_FORCED_EXIT_CODE` | `130` | 第二个信号的退出码,128 + SIGINT 的惯例 |
| `SHUTDOWN_SIGNALS` | `['SIGINT', 'SIGTERM']` | 默认监听的信号 |
| `EXIT_ON_STDIN_CLOSE_ENV` | `'FLWC_EXIT_ON_STDIN_CLOSE'` | 开关变量名 |

### `apps/server/src/config/env-seed.ts`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| `EMBER_HOST_ENV` | `'EMBER_HOST'` | 种子 host 的变量名 |
| `EMBER_PORT_ENV` | `'EMBER_PORT'` | 种子 port 的变量名 |

缺省值本身不是新常量:复用 shared 的 `DEFAULT_EMBER_HOST` / `DEFAULT_EMBER_PORT`。

### `apps/server/src/tools/cli-args.ts` / `mock-provider.ts`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| mock provider `--host` 默认 | `'0.0.0.0'` | 容器要从 `host.docker.internal` 连进来 |
| `LOUDNESS_INTERVAL_MS` | `1000` | 响度推送间隔,与 soak 驱动一致 |
| 电平频率 | 复用 `SOAK_METER_HZ = 20` | 不新增常量 |

### `start.cmd` / `start.sh`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| Node 主版本下限 | `22` | 与根 `package.json` 的 `engines` 一致 |
| `HOST` 默认 | `0.0.0.0` | 平板要从局域网访问 |
| `PORT` 默认 | `3000` | 与 `resolveBindAddress` 的默认一致 |

### `Dockerfile`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| `HEALTHCHECK --interval` | `30s` | 探测间隔 |
| `HEALTHCHECK --timeout` | `5s` | 单次探测超时 |
| `HEALTHCHECK --start-period` | `10s` | 启动期不计失败 |
| `HEALTHCHECK --retries` | `3` | 连续失败几次算 unhealthy |
| `EXPOSE` / `PORT` | `3000` | 容器内端口 |

### `scripts/docker-smoke.sh`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| `SEED_HOST` / `SEED_PORT` | `203.0.113.9` / `9001` | 首次种子,RFC 5737 文档地址,永远连不上 |
| `PUT_HOST` / `PUT_PORT` | `203.0.113.10` / `9002` | 模拟 CONNECTION 面板改地址 |
| `SECOND_HOST` / `SECOND_PORT` | `203.0.113.11` / `9003` | 第二次启动的种子,用来证明文件优先 |
| `HEALTH_TIMEOUT_S` | `30` | 等健康的上限 |
| `HEALTH_POLL_S` | `0.5` | 轮询间隔 |
| `STOP_BUDGET_MS` | `5000` | `docker stop` 预算,与 `SHUTDOWN_TIMEOUT_MS` 对齐 |

### `.github/workflows/docker.yml`

| 名称 | 值 | 含义 |
| --- | --- | --- |
| `timeout-minutes` | `60` | arm64 在 QEMU 下要跑一遍自己的 `pnpm install` |

## 7. 给 7.2 的接口说明

这一节写成 7.2 的执行会话可以直接照抄的样子。桌面壳把后端当子进程拉起,合同只有下面这些。

### 7.1 子进程怎么起

```
可执行:  <node 运行时>  <资源目录>/apps/server/dist/main.js
工作目录: 随意(所有路径都由环境变量给定,不依赖 cwd)
stdio:    ['pipe', 'pipe', 'pipe']   ← stdin 必须是管道,这是进程边界
```

环境变量(在父进程环境之上覆盖):

| 变量 | 壳应当设成 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` 或 `127.0.0.1` | 窗口里「允许局域网访问」那个开关直接对应这两个值 |
| `PORT` | 用户选的端口 | 改端口 = 杀掉子进程、换 `PORT` 重起,没有别的机制 |
| `FLWC_WEB_ROOT` | `<资源目录>/apps/web/dist` | **必须设**:安装包里 web 产物不在服务端 bundle 旁边 |
| `FLWC_DATA_DIR` | 系统应用数据目录下的一个目录 | **必须设**:否则会落到安装目录里,Program Files 下写不进去 |
| `FLWC_EXIT_ON_STDIN_CLOSE` | `'1'` | **必须设**:见下 |
| `EMBER_HOST` / `EMBER_PORT` | **不要设** | 它们只在 `FLWC_DATA_DIR/config.json` 不存在时生效,壳没有理由替用户决定台子在哪;用户在 CONNECTION 面板里改 |

两个路径变量都接受相对路径(按子进程 cwd 解析)与绝对路径,空串当作未设。给绝对路径最省事。

### 7.2 就绪怎么判

轮询 `GET http://127.0.0.1:<PORT>/api/v1/health`,200 且 body 为 `{"status":"ok"}` 即就绪。

- 它**不依赖 Ember 连接**:台子不在时照样 200。「连上台子了吗」是另一件事,读
  `GET /api/v1/connection` 的 `status` 字段(`connected` / `reconnecting` / `disconnected`)。
- HTTP 监听在 `runtime.start()` **之前**就绪,所以健康检查会比 Ember 连接早得多。窗口上的状态灯应当分两级:
  「后端起来了」看 health,「台子接上了」看 connection。
- 本机实测:从 spawn 到 health 200 大约 1 秒出头(见第 5.2 节的日志时间戳)。给 10–15 秒超时足够宽裕。
- 端口被占时 Fastify 的 `listen` 会抛,进程带非零码退出并在 stderr 上留下原因;壳应当把 stderr 收下来显示
  (窗口里的「后端日志尾部」正是干这个的)。**注意 `PORT` 不合法(如非数字)时不会抛**,见第 11 节。

### 7.3 退出怎么等

**壳不需要做任何平台专属的保活或清理。**

**关掉 stdin 在任何时刻都有效,包括后端还在启动的时候。** 处理器在 `start()` 之前就装好了,所以哪怕
台子连不上、后端还卡在连接重试里(那个等待**没有尽头**),壳照样能立刻把它收掉。这一点对 7.2 很关键:
用户第一次装完、地址还没配对的时候,正是后端会一直连不上的时候,而那时用户很可能直接退出启动器。

- 正常退出:壳关掉子进程的 stdin(`child.stdin.end()` / 丢弃写端),或者直接结束自己。
  `FLWC_EXIT_ON_STDIN_CLOSE=1` 让子进程在 `end` / `close` / `error` 任一到达时走完整的关闭路径,
  本机实测 **9 ms,退出码 0**。
- 壳被任务管理器结束、崩溃、用户注销:管道照样断,子进程照样退出。**不需要 Job Object、不需要进程组**,
  Windows 与 macOS 同一套。
- 壳如果想显式发信号也可以:`SIGTERM` / `SIGINT` 走同一条路径。但在 Windows 上 Rust/Node 的 `kill` 多半
  落到 `TerminateProcess`,不会投递信号——**所以 stdin 才是那条要依赖的路**。
- 等多久:正常关闭在毫秒级。宽限期给 `SHUTDOWN_TIMEOUT_MS`(5 秒)再加一点余量,超时后壳再强杀。
  退出码 0 = 干净;1 = 关闭超时或关闭中抛错;130 = 关闭中又收到一个信号。

### 7.4 单实例与端口

后端自己不做单实例。壳负责(Tauri 的 single-instance 插件),并且在换端口重启时要**先等旧子进程退出**
再起新的,否则新进程会撞到 `EADDRINUSE`。

## 8. 文档核对清单

逐行:文件、原文要点、改成什么、依据。

| # | 文件 | 原文要点 | 改成 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | `AGENTS.md` | 「Vite 开发服务器只监听 IPv6 的 `localhost`(`::1`)……`http://127.0.0.1:5173` 会连接失败」 | 「监听 `0.0.0.0:5173`,两种写法都可以,平板也能从局域网打开」 | `apps/web/vite.config.ts` 的 `server.host` 是 `'0.0.0.0'`(用户手调过) |
| 2 | `AGENTS.md` | 后端「监听 `127.0.0.1:3000`」 | 「默认监听 `127.0.0.1:3000`(`HOST` / `PORT` 可覆盖;启动脚本与容器设 `0.0.0.0`)」 | `resolveBindAddress()`;`start.cmd` / `start.sh` / `Dockerfile` |
| 3 | `AGENTS.md` | 目录结构树只有 4 行,没有 `packages/test-utils` | 补 `packages/test-utils`、`apps/server` 的命令行工具、`scripts/`、`start.*`、Docker 三件套 | 仓库实际内容 |
| 4 | `AGENTS.md` | Cursor 一节没有「没有台子怎么办」 | 加一行 `mock-provider` 的用法 | 本批次新增的工具 |
| 5 | `docs/conventions.md` | 目录结构树里 `apps/server/src/` 没有 `tools/` | 补 `tools/`(树 dump、Ember 校验、soak、Mock Provider),并给 `config/` 补「环境变量种子值」 | `apps/server/src/tools/` 从 Phase 2 起就存在,文档一直没跟上 |
| 6 | `docs/conventions.md` | 目录结构树没有仓库根的交付文件 | 补 `scripts/`、`start.cmd`、`start.sh`、`Dockerfile`、`.dockerignore`、`docker-compose.yml` | 本批次新增 |
| 7 | `docs/conventions.md` | 「不提交 `data/`、构建产物、覆盖率报告、`soak-reports/`」 | 补 `node_modules/`、`*.tsbuildinfo`、`.env*`、`docker-compose.override.yml` | 与 `.gitignore` 实际内容核对 |
| 8 | `docs/conventions.md` | Git 一节没有换行符与可执行位的约定 | 加两条:`.gitattributes` 的 LF/CRLF 分工;`start.sh` 与 `scripts/*.sh` 带可执行位入库 | 本批次踩到 cmd.exe 对 LF 的处理问题 |
| 9 | `docs/architecture.md` | 「部署」一节共两个 bullet(Docker 多阶段、Windows 跑 `node dist/main.js`) | 重写成五小节:进程生命周期、环境变量与优先级、控制台脚本、Docker、CI 与发布 | 本批次的实际交付物 |
| 10 | `docs/architecture.md` | 「部署」里写 Docker 是「install → build → runtime」三阶段 | 改成 `base` / `build` / `deps` / `runtime` 四阶段,并写明为什么不能靠剪 | 实测:`pnpm install --prod` 剪不掉 `.pnpm` |
| 11 | `docs/architecture.md` | 「持久化」写死 `data/config.json` | 改成「默认仓库根 `data/config.json`,可由 `FLWC_DATA_DIR` 改到别处(容器里是 `/app/data`)」 | `resolveRuntimePaths()` |
| 12 | `docs/architecture.md` | 「持久化」只说「文件损坏或缺失时回退默认配置并告警」 | 补一段:缺失且有种子时写盘再返回,写不进去只告警仍用种子;种子写入排在同一条 `writeTail` 上 | `ConfigStore.seedFile()` |
| 13 | `docs/architecture.md` | 后端分层表里 REST 行写「JSON 持久化到 `data/`」 | 「持久化到数据目录(默认仓库 `data/`,见「部署」)」 | 同 11 |
| 14 | `README.md` | 「Status: early development. Interfaces and features are subject to change.」 | 删掉。Phase 6 已经完成并经真机验收,这句话与现状不符 | `docs/development-plan.md` 的完成情况 |
| 15 | `README.md` | Getting Started 写「Ember+ / Fairlight Live is not required for the current scaffold」并把 `node apps/server/dist/main.js` 当启动方式 | 重写为 Requirements + 三态(终端 / Docker / 桌面占位) | 本批次的交付物 |
| 16 | `README.md` | Deployment 两行,承诺了当时并不存在的 Docker 镜像与启动脚本 | 写实际的 compose 用法、升级、离线包、本地构建、bind mount 权限 | 同上 |
| 17 | `README.md` | 没有配置表 | 加七个变量的表,并写明种子只在首次生效 | 本批次新增的变量 |
| 18 | `README.md` | Features 没提前端的平板特性 | 加一行(分页、大命中区、常亮、全屏) | Phase 6.3 / 6.4 的成果,README 一直没写 |
| 19 | `README.md` | Features 写「Ember+ host/port configurable through the REST API」 | 「through the UI and the REST API」 | CONNECTION 面板(Phase 5) |
| 20 | `README.md` | Repository Layout 没有 `scripts/` | 补 | 本批次新增 |

未改动(按提示词要求):`docs/development-plan.md`、`docs/prompts.md`、`docs/prompts/*`、
`docs/reports/*`(本报告除外)、`docs/fairlight-ember.md`。

## 9. 真机验收操作清单(移交用户)

**安全约束**(照抄 6.4 报告第 6 节):本批次改的是进程生命周期、配置来源与交付方式,**不会改动 Fairlight 的任何参数**;
验收过程中不要操作混音页推子;如确需操作,**只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子
并测后复原**;不得切 ON/mute、不得动其它通道、不得删改任何通道。凡是要按 ON 的地方**一律不要真的按**。

### ① 控制台启动(`start.cmd`)

前提:仓库根 `pnpm install && pnpm build`。

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 在资源管理器里**双击** `start.cmd` | 弹出一个控制台窗口,第一行是 `Fairlight Live Web Controller - http://localhost:3000  (Ctrl+C to stop)` |
| 2 | 首次启动时 Windows 弹「允许 Node.js 访问网络」 | 勾**专用网络**并允许。不允许的话平板连不上 |
| 3 | 在这台电脑上打开 `http://localhost:3000` | 混音页打开 |
| 4 | 在平板上打开 `http://<这台电脑的局域网 IP>:3000` | 同上。IP 用 `ipconfig` 看 |
| 5 | 通过页面上的 **CONNECTION 面板**把地址指向真实台子 | 页头变 `MIXER ONLINE`,通道与电平出现 |
| 6 | 只动那四个允许的推子,各推一下再复原 | 台子跟随,复原后数值与验收前一致 |
| 7 | 回到控制台窗口按 **Ctrl+C** | 日志里出现 `"msg":"shutting down"` 与 `"msg":"shutdown complete"`,窗口停在 `请按任意键继续`;进程已退出(任务管理器里没有残留的 node) |
| 8 | 再次 `start.cmd` | 仍然连着真实台子(配置在 `data/config.json`,已持久化) |

### ② Docker Desktop

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 把 `docker-compose.yml` 里的 `EMBER_HOST` 改成真实台子的 IP(`EMBER_PORT` 保持 `9000`) | — |
| 2 | 因为镜像还没发布,先把 `# build: .` 那行的注释去掉 | — |
| 3 | `docker compose up -d` | 容器 `healthy` |
| 4 | 浏览器打开 `http://localhost:3000`,平板打开 `http://<电脑 IP>:3000` | 混音页打开,页头 `MIXER ONLINE` |
| 5 | 只动那四个允许的推子,各推一下再复原 | 台子跟随,复原 |
| 6 | 在 CONNECTION 面板里把端口改成一个错的(比如 9001)再改回 9000 | 面板能改,状态会掉再回来 |
| 7 | `docker compose restart` | 配置仍在(仍是你在面板里最后设的值,**不是** compose 里的 `EMBER_HOST`) |
| 8 | `docker compose down` 再 `docker compose up -d` | 配置仍在 |
| 9 | 验收完 `docker compose down` | 容器停掉;卷留着(要连卷一起删是 `down -v`) |

### ③ 合并之后

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 合并 PR #23 | `main` 上的 `docker.yml` 会推 `ghcr.io/wuxinnnn/fairlight-live-web-controller:main` |
| 2 | 到 GitHub → 你的头像 → Packages → `fairlight-live-web-controller` → Package settings,把 **可见性改成 public** | 否则别人(和不登录的 `docker pull`)拉不到。**这一步只能由你做,我没有权限** |
| 3 | 打第一个标签:`git tag v0.1.0 && git push origin v0.1.0` | `docker.yml` 推 `:v0.1.0` 与 `:latest`(amd64 + arm64),并新建一个 Release |
| 4 | 到 Release 页面看 | 有 `flwc-v0.1.0-linux-amd64.tar.gz` 附件 |
| 5 | 下载它,`docker load -i flwc-v0.1.0-linux-amd64.tar.gz`,然后 `docker compose up -d` | 能起来。**这条路径我没能在合并前验证**(见第 11 节) |
| 6 | 把 `docker-compose.yml` 里的 `# build: .` 注释恢复回去 | 之后就是拉镜像而不是本地构建 |

## 10. 交付物清单

| 文件 | 性质 |
| --- | --- |
| `apps/server/src/shutdown.ts` + `.test.ts` | 新增 |
| `apps/server/src/config/env-seed.ts` + `.test.ts` | 新增 |
| `apps/server/tests/env.integration.test.ts` | 新增 |
| `apps/server/src/tools/mock-provider.ts` | 新增(唯一新增的覆盖率排除项) |
| `apps/server/src/main.ts` | 重写(接线,处理器先装、服务器后 attach) |
| `apps/server/src/paths.ts` + `.test.ts` | 增加 `resolveRuntimePaths`,既有函数不动 |
| `apps/server/src/server.ts` + `.test.ts` | `StartedServer.logger`、`StartOptions.logger` / `.emberSeed`、`resolveEmberSeed`、接 `resolveRuntimePaths` |
| `apps/server/src/config/config-store.ts` + `.test.ts` | 第三个可选构造参数与 `seedFile()` |
| `apps/server/src/runtime.ts` | 透传 `emberSeed` |
| `apps/server/src/tools/cli-args.ts` + `.test.ts` | `parseMockProviderArgs` |
| `apps/server/package.json` | `mock-provider` 脚本 |
| `apps/server/vitest.config.ts` | 一项新排除 |
| `packages/test-utils/src/mock-ember-provider.test.ts` | 一条新单测(源码零改动) |
| `start.cmd` / `start.sh` | 新增 |
| `.gitattributes` | `*.cmd` / `*.bat` 为 CRLF |
| `.gitignore` | `docker-compose.override.yml` |
| `Dockerfile` / `.dockerignore` / `docker-compose.yml` | 新增 |
| `scripts/docker-smoke.sh` | 新增 |
| `.github/workflows/docker.yml` | 新增 |
| `README.md` / `AGENTS.md` / `docs/architecture.md` / `docs/conventions.md` | 核对与重写 |
| `docs/reports/phase-7-1-report.md` | 本报告 |

## 11. 关键决策与偏离

提示词照做会出错或不成立的地方,逐条:

| # | 提示词怎么写 | 实际怎么做 | 为什么 |
| --- | --- | --- | --- |
| 1 | 注入的 `process` 「只用它的 `on` / `once` / `exit`」 | 只用 `on` 与 `exit`,接口里没有 `once` | 用 `once` 注册的话第二个信号根本到不了处理器,`exit(130)` 不可能发生,也没法测 |
| 2 | `watchStdinForExit(stream, shutdown, logger)` 的签名里没有 `resume` | 末尾加 `stream.resume?.()` | `process.stdin` 初始是 paused,paused 的 Readable 永远不到 EOF,不 resume 的话 `end` 不来,验收第 ① 条会直接失败 |
| 3 | 「父进程崩溃时 Windows 上是 `EPIPE` 而不是 `end`」 | 仍然监听三个事件,但注释里的**理由改写了** | 持有管道读端而写端死掉,拿到的是 EOF,不是 EPIPE;EPIPE 是往断掉的管道**写**才有。监听三个是对的,理由不对,而 7.2 会读这段注释 |
| 4 | `load()` 命中 ENOENT 且有种子时写盘「并记一条 info 日志」 | 种子分支提到既有 warn **之上** | 掉在后面会同时打出 `warn "config missing, using defaults"`(谎话)与 `info "config seeded"` |
| 5 | `emberSeed`(含 `null`)的处理 | 显式判 `=== null`,并把 `resolveEmberSeed` 导出加单测 | `??` 把 `null` 当缺省、照样读 env,正好废掉 `null` 要防的 CI 污染。这是最容易「看起来绿、其实坏了」的一处 |
| 6 | 「`MockEmberProvider` 需要监听地址参数的话,只在 `packages/test-utils` 里加一个向后兼容的可选项」 | **源码一行没改**,只加了一条单测 | `MockEmberProviderOptions.host` 本来就在,`listen()` 也早就用它 |
| 7 | `pnpm prune --prod` 或 `pnpm install --prod --frozen-lockfile --offline`「两种都试,取能让运行阶段起来的那种」 | **两种都不够**,改用第三种:`deps` 单独阶段 + `pnpm fetch --prod` | 见第 3.6 节的表。前两种的问题都在 `node_modules/.pnpm` 上 |
| 8 | build 阶段「复制 `package.json`、lockfile、各包的 `package.json`,`pnpm install --frozen-lockfile`」 | 改成 `COPY pnpm-lock.yaml` + `pnpm fetch` | workspace 安装会跑每个项目的 `prepare`,而 shared / test-utils 的 `prepare` 是 `tsc`,那时源码还没进来 |
| 9 | runtime 阶段可以 `rm -rf apps/server/dist/tools` | **不能**,已撤回 | `ember-service.js` 会 import 其中的 `expand-ember-tree.js`,删了容器起不来 |
| 10 | 标签触发时 `docker save <image>:<tag>` | 先把 `flwc:smoke` 重打成两个 GHCR 标签再一起 save | 多平台构建直接推 registry,本地 daemon 里没有东西可 save;而且只 save 一个标签的话,`docker load -i` 之后 compose 里的 `:latest` 对不上 |
| 11 | 提示词没说 `.gitattributes` | 加了 `*.cmd` / `*.bat` 为 CRLF | 原先 `* text=auto eol=lf` 会让 `start.cmd` 以 LF 入库,cmd.exe 对 LF 文件里的 `goto` 与括号块处理不可靠 |
| 12 | 提示词没说 `docker.yml` 的超时 | `timeout-minutes: 60` | arm64 在 QEMU 下要跑一遍自己的 `pnpm install` |
| 13 | 提示词给的 compose 模板里 `EMBER_PORT: '9000'` | 原样提交,但**自己从不启动它** | 那是给用户填的模板;9000 是真实台子,验证一律走临时 override |

其它值得记的决策:

- **`ConfigStore` 用第三个可选位置参数而不是选项对象**:生产代码只有 1 处 `new ConfigStore(`,测试里有 6 处;
  改成选项对象要重写 6 条既有用例,与「既有测试只允许增」冲突。
- **`shutdown.test.ts` 注入计时器而不是 `vi.useFakeTimers()`**:理由见第 3.1 节。
- **`docker-smoke.sh` 从宿主机 `curl` 轮询而不是看 `docker inspect .State.Health`**:顺带证明了用户真正要用的
  端口映射,也不必等健康检查 30 秒的间隔。Git Bash 里**没有 `jq`**,所以断言全是对 Fastify 无空格 JSON 的
  `grep -Fq` 子串匹配。
- **容器发布端口用 `-p 127.0.0.1::3000` 取随机回环端口**:不撞用户的 3000,不上局域网,不弹防火墙,
  也不需要再造一个「冒烟用哪个端口」的旋钮。

## 11.5 评审后的修订

Cursor Bugbot 在 `53ca4b5` / `0fd8d88` 上给出 **2 条 finding**。一条成立且严重,已修;一条描述属实但指的是
我自己那个临时验证脚手架,已在线程里回复并按计划撤除。

### 11.5.1 Shutdown handlers miss startup window(Medium)——成立,而且比它说的严重

**finding**:`installShutdownHandlers` 只在 `start()` 返回之后才装,而 `start()` 里已经 `listen()` 过、
正阻塞在 Ember 连接与树展开上;作为 PID 1,这段时间里内核会丢弃没有处理器的 `SIGTERM`,于是台子慢或连不上时
`docker stop` 仍然要等满宽限期——正是这批改动要消灭的那个卡顿。

**判断**:成立。实测之后发现它说的「window」根本**没有尽头**:`runtime.start()` 最后 `await this.treeReady`,
而台子连不上时树展开会一直重试(日志里每 8 秒一条 `ember socket disconnected` / `tree expand error`),
`treeReady` 永远不落定。所以**指向一个不应答地址的容器,在它整个生命周期里都没有 SIGTERM 处理器**。

**复现(先测,确认是红的)**:用修复前的镜像,指向 `203.0.113.9:9001`,启动后 300 ms 就 `docker stop -t 30`:

```
docker stop 300ms after launch: 30366 ms, exit code 137
--- logs ---   (一条 shutdown 记录都没有,最后两条还是 8 秒一次的 tree expand error)
```

30 秒等满 + `SIGKILL`。而 compose 里写着 `restart: unless-stopped`,这会变成一个循环;
「台子晚上关着」并不是什么罕见状态。

**为什么之前的实测没抓到**:第 4.1 节那次 `docker stop` 是在容器起来 6 秒之后发的,那时 `start()` 已经返回
(连接超时 5 秒之后它会带着「连不上」的状态继续),处理器装好了,所以是 521 ms。冒烟脚本同理——它先等健康
再 stop。**这条路径只有在启动期间发信号才暴露**,而那恰恰是 `docker compose down` 紧跟 `up` 时会发生的事。

**改法**:`main.ts` 先建 logger、先装处理器,再 `await start()`,中间用新的 `deferredShutdownTarget()` 顶着:

```ts
const logger = pino({ name: 'flwc' });
const target = deferredShutdownTarget();
const shutdown = installShutdownHandlers(target, { logger });
if (shouldWatchStdin(process.env)) {
  watchStdinForExit(process.stdin, shutdown, logger);
}
target.attach((await start({ logger })).app);
```

`attach` 之前收到信号就是「没有东西要关」,直接 `exit(0)` ——这是对的:那时还没写过任何配置,
而退出进程释放监听 socket 与关闭它的效果一样。`StartOptions` 顺带加了可选的 `logger`,好让先装的处理器
与 runtime 写同一个流。

**修复后同一条命令**:

```
docker stop 300ms after launch: 354 ms, exit code 0
{"reason":"SIGTERM","timeoutMs":5000,"layer":"lifecycle","msg":"shutting down"}
{"reason":"SIGTERM","layer":"lifecycle","msg":"shutdown complete"}
```

**回归锁**:`shutdown.test.ts` 新增 3 例(未 attach → `exit(0)`;attach 后 → 关它;attach 的目标抛错 → `exit(1)`),
12 → 15 例。`main.ts` 仍然只有接线,没有逻辑。

### 11.5.2 Workflow has leftover test wiring(Medium)——属实,是有意的临时脚手架

**finding**:`docker.yml` 现在会在 `claude/phase-7-1-c310cdff` 上触发,并且总是把镜像打成 `pr-23`;
合并之后推 `main` 会发成 `:pr-23` 而不是文档里写的 `:main`。

**判断**:事实完全正确,但那是第 4.5 节那次验证的临时脚手架,本来就不打算合并。已在评论线程里回复了为什么
要有它(发布路径在 PR 上根本不会触发,不临时跑一次就得等到合并后第一次推 main 才知道行不行,6.5 对
`soak.yml` 用的是同一套做法),以及它会被怎么撤掉。

**处理**:`38b03b5` revert 了 `0fd8d88`,`git diff d4a8a0e HEAD -- .github/workflows/docker.yml` 为空。
临时 package 也已删除(见第 4.5 节)。

处理完之后又等了一轮,没有新的 finding。

## 12. 被改写的既有用例清单

预期为空或只有夹具级调整,实际是三处夹具级调整加一处真修:

| 文件 | 改动 | 是否必需 |
| --- | --- | --- |
| `apps/server/tests/mixer-stack.ts` | `startServer()` 加 `emberSeed: null` | **不必需,为统一**。它先 `writeConfig()` 再 `start()`,`load()` 到不了 ENOENT,种子本就不会生效 |
| `apps/server/tests/mixer.integration.test.ts` | 两处内联 `start()` 加 `emberSeed: null` | 同上,不必需 |
| `apps/server/src/tools/soak.ts` | `buildStack()` 加 `emberSeed: null` | 同上,不必需。`soak.ts` 在覆盖率排除里,不影响任何数字 |
| `apps/server/src/config/config-store.test.ts` | 新增的「只读目录」一例**改了造故障的方式**(见下) | **必需**,CI 抓到的 |

六条既有 `ConfigStore` 用例、`paths.test.ts` 的四条、`server.test.ts` 的三条 `resolveBindAddress`、
`cli-args.test.ts` 的既有用例,全部一字未动(第三个构造参数是可选位置参数,正是为此)。

**那一处真修**:新增的「文件写不进去仍保留种子」一例,最初用「在数据目录该在的位置放一个普通文件」来造故障。
Windows 上这读作 `ENOENT`、走种子分支,本地全绿;**Linux 上同一个路径读作 `ENOTDIR`**,走的是
「config unreadable」分支,于是 CI 变红([run 35212971950](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35212971950))。

`ENOTDIR` 确实不是首次启动(是有人把文件放在了目录该在的位置),所以**代码是对的,该改的是测试**。
现在按平台分别造故障:POSIX 用一个可列目录但不可写的目录(读仍是干净的 `ENOENT`,只有临时文件写不进去),
Windows 仍用「文件挡路」(那里 `chmod` 对目录不生效)。POSIX 的假设专门在容器里验证过:

```
$ docker run --rm --user node node:22-alpine node -e "..."
{"uid":1000,"read":"ENOENT","mkdirRecursive":"ok","write":"EACCES"}
```

## 13. 依赖清单

- **无新增 npm 依赖**,`pnpm-lock.yaml` 无 diff(`git diff --stat main -- pnpm-lock.yaml` 为空)。
- GitHub Actions 新增四个**官方** `docker/*` action:`setup-qemu-action@v3`、`setup-buildx-action@v3`、
  `metadata-action@v5`、`build-push-action@v6`、`login-action@v3`(五个),外加 runner 自带的 `gh`。
  没有引入任何第三方 action。
- 镜像基础是官方 `node:22-alpine`;build / deps 阶段额外装 `git`(`emberplus-connection@0.3.1` 的 `asn1`
  托管在 GitHub),runtime 阶段不装。

## 14. 遗留问题与移交事项

1. **GHCR 包的可见性**:临时验证时它**首次创建即为 public**,不需要手动改。但因为 GitHub 不允许单独删掉
   一个 package 的最后一个带标签版本,清理临时标签只能把整个 package 删掉,所以合并后第一次推 `main` 会
   重新创建它。第 9 节 ③ 的第 2 步保留,但很可能只是看一眼确认而已。改可见性我没有权限。
2. **标签 → Release 路径合并前无法真跑**:PR 分支上打标签不会触发 `main` 的发布逻辑,而且会在仓库里留下一个
   废标签。第 9 节 ③ 的第 3–5 步就是这条路径的验收,由用户在合并后完成。README 里
   `docker load -i flwc-<tag>-linux-amd64.tar.gz` 这一条因此也是**唯一没在本机敲过**的命令。
3. **`start.sh` 没在真实 macOS 上跑过**:手上没有设备。Git Bash 与 CI 的 ubuntu 间接覆盖了语法。
4. **`start.sh` 的 SIGTERM 在 Git Bash 下验证不了**:MSYS 的 `kill` 对原生 Windows 进程走 `TerminateProcess`。
   同一条路径由 `docker stop` 在 Linux 上证明。
5. **`--meters` 下的浏览器电平表没有亲眼看**:验证做到了 Ember 层(20 Hz、值在动)与 socket 快照层
   (20 个通道、名字对),没有开浏览器看表针。用户按第 9 节验收时顺带就能看到。
6. **`resolveBindAddress` 不校验 `PORT`**(既有问题,本批次按「不改默认值」未动):
   `Number(env.PORT ?? '3000')`,所以 `PORT=abc` 会得到 `NaN`,Fastify 会监听一个**随机端口**而不是报错。
   容器与启动脚本都设了合法值,所以不影响交付;但 7.2 的桌面壳会把用户输入的端口塞进 `PORT`,
   **那里需要在壳里先校验**,或者在将来某个批次给 `resolveBindAddress` 补一道校验。已在第 7.2 节标注。
7. **`docker.yml` 的 `contents: write` 是 job 级的**,因此非标签的运行也带着它。GitHub 没有 step 级权限,
   拆成两个 job 又要多一次 checkout 与 buildx 初始化,换来的是一个 fork PR 本来就拿不到的令牌。留作现状。
8. **`tests/strip-probe.integration.test.ts` 在重载下会偶发失败**(既有用例,非本批次引入)。最后一轮全量
   跑的时候它红过一次:`10 probes should not each leave a timer behind: expected 3 to be less than or equal to 2`。
   当时这台机器同时开着 Docker Desktop、我自己的 mock provider(9100)与用户的 `pnpm dev`。把 mock provider
   停掉之后全量重跑全绿,单独重跑那个文件连过三次。这条断言数的是句柄/定时器,阈值卡在 2,机器忙的时候
   探针的收尾会晚一拍。它在 CI 上一直是绿的,本批次没碰探针相关的任何代码,**记在这里只是为了留痕**,
   将来如果在 CI 上也开始飘,阈值或等待方式值得再看一眼。
9. **镜像 206 MB 里约 150 MB 是 `node:22-alpine` 基础镜像**。想再瘦只能换基础镜像或做 single-executable,
   本批次不做。`apps/web` 的生产依赖(react 等)仍在 `.pnpm` 里——`pnpm fetch` 没有 `--filter`,而按 filter
   再装一次并不会删掉已经落地的 `.pnpm` 目录。

## 15. 提交记录

| # | 提交 | 说明 |
| --- | --- | --- |
| 1 | `d8519fd` | `feat(server): exit gracefully on a signal or a closed stdin` |
| 2 | `e60294f` | `feat(server): resolve the web root and data directory from the environment` |
| 3 | `18779e7` | `feat(server): seed the Ember endpoint from the environment on a first start` |
| 4 | `f0732e7` | `feat(server): add a mock Ember+ provider command line tool` |
| 5 | `9eb4388` | `feat: add console start scripts` |
| 6 | `fa58625` | `feat: add a Docker image, compose file and smoke script` |
| 7 | `d4a8a0e` | `ci: add the Docker build, smoke and publish workflow` |
| 8 | `3235133` | `test(server): break the seed write the way each platform can`(CI 抓到的跨平台差异) |
| 9 | `53ca4b5` | `docs: rewrite the README and reconcile the docs with the code` |
| 10 | `0fd8d88` | `ci: TEMPORARY trigger to verify the GHCR publish path from this branch` |
| 11 | `a716134` | `fix(server): install the shutdown handlers before the server is awaited`(Bugbot 11.5.1) |
| 12 | `fffb962` | `ci: remove the temporary GHCR verification trigger`(revert 10) |
| 13 | — | `docs: add the phase 7.1 execution report` |
