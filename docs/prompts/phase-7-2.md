# Phase 7.2 执行提示词 — 桌面启动器(Tauri)

> 用法:将本文档全文作为执行会话的任务提示词。**本批次的执行会话运行在用户的本地开发机上**(Windows 11),开发机正连着真实 Fairlight Live。任务来源是 `docs/development-plan.md` 的 7.2 一节,细节以本文档为准;两者冲突时以本文档为准并在报告里指出。工作在远端分支与 PR 上进行,你要跟进 GitHub CI 与 Cursor Bugbot 的评审意见(见「本地执行边界」与「分支、PR 与评审监控」)。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,Windows 安装包的最终验收由用户完成。

Phase 7 的最终发布形态是三态:控制台脚本直接启动与 Docker 部署(7.1 已交付)、**Tauri 桌面安装包**(本批次)。桌面壳的定位是 Bitfocus Companion 那种「一个小设置窗口 + 托盘」的启动器:后端跑在它的子进程里,混音页仍在浏览器(通常是平板)里打开;它不是混音页的容器。**本批次只交付 Windows 安装包**;选 Tauri 是为了将来的 macOS 适配,所以代码不得写死 Windows(平台差异放 `#[cfg]` 或交给 Tauri 插件),但本批次不在其它平台构建、不做其它平台的验证——用户目前没有 mac 设备,不让它阻塞开发。

---

## 前置阅读(开始工作前必须完成)

1. `AGENTS.md` — 项目说明与关键约束(第一条「本地测试安全」直接适用;新增依赖必须 MIT 兼容——Tauri 及其官方插件是 MIT / Apache-2.0 双许可,Node.js 是 MIT 加自带组件许可,都可以)
2. `docs/development-plan.md` — Phase 7 总述与 7.2 一节全文
3. `docs/reports/phase-7-1-report.md` — 上一批次报告,**「给 7.2 的接口说明」一节是本批次与服务端之间的合同**:环境变量(`HOST`、`PORT`、`FLWC_DATA_DIR`、`FLWC_WEB_ROOT`、`FLWC_EXIT_ON_STDIN_CLOSE`、`EMBER_HOST` / `EMBER_PORT` 种子)、就绪判定(`GET /api/v1/health`)、退出方式(信号或关掉 stdin,`SHUTDOWN_TIMEOUT_MS`)
4. `docs/architecture.md` — 「部署」一节(7.1 改写后的三态描述,本批次要补桌面壳的一段)与「持久化」
5. `docs/conventions.md` — 目录结构、命名、语言与许可、Git 规范
6. `docs/prompts/phase-7-1.md`、`docs/prompts/phase-6-4.md` — 沿用「本地执行边界」「分支、PR 与评审监控」「硬性约束」,下面只写差异
7. `README.md` — 7.1 留了「Desktop app」占位段,本批次填实
8. Tauri 2 官方文档:项目结构与 `tauri.conf.json`、sidecar(`bundle.externalBin`)、resources(`bundle.resources`)、tray icon、窗口事件、`tauri-plugin-autostart`、`tauri-plugin-single-instance`、`tauri-plugin-shell`、`tauri-plugin-opener`、`tauri icon` 命令、Windows 的 NSIS bundler。**以官方文档的当前版本为准**,不要凭记忆写 API;`Cargo.toml` 与 `package.json` 里把 Tauri 与插件钉到同一条 2.x 小版本线。

## 代码现状(已确认,直接复用)

- 服务端合同见 7.1 报告。要点:`node <server>/dist/main.js` 起来后监听 `HOST:PORT`;`FLWC_WEB_ROOT` 指向 web 产物目录,`FLWC_DATA_DIR` 指向存 `config.json` 的目录;`FLWC_EXIT_ON_STDIN_CLOSE=1` 时 stdin 一断就自行优雅退出(`SHUTDOWN_TIMEOUT_MS` 内);健康检查 `GET /api/v1/health` 200 即就绪;日志是 pino 的单行 JSON。
- `pnpm build` 产出 `apps/server/dist`、`apps/web/dist`、`packages/shared/dist`;`apps/server/package.json` 的 `files` 字段(7.1 加的,若没加本批次补上)限定 `pnpm deploy` 只带 `dist`。
- 图标源文件:`apps/web/public/icon-512.png`。
- CI:`ci.yml` 在 `ubuntu-latest` 上跑根脚本 `lint` / `typecheck` / `test` / `build`,**它不会装 Tauri 需要的系统库**,所以 `apps/desktop` 的 `build` 脚本只能是窗口前端的 `vite build`,Rust 的构建、测试与打包全部只在本批次新增的 `desktop.yml` 里跑(见硬性约束)。
- 前端工具链:`apps/web` 用 React 19 + `@vitejs/plugin-react` + Vitest + React Testing Library + jsdom,版本见 `apps/web/package.json`;窗口前端用同一套、同版本。
- **运行环境事实**(这台开发机):Rust 1.95(`x86_64-pc-windows-msvc`)、Visual Studio 2022 Community(MSVC 链接器在)、WebView2 运行时 152、Node 22.14、pnpm 11.17。GitHub 的 `windows-latest` runner 预装 Rust stable。

## 本地执行边界

沿用 `docs/prompts/phase-6-4.md` 的「本地执行边界」全文,补充以下几条:

- 本批次新增 `apps/desktop/`(workspace 包 `@flwc/desktop`,含 `src-tauri/`),改仓库根 `package.json`(只加 `desktop:*` 脚本)、`.gitignore`、`.github/workflows/`(**只新增** `desktop.yml`)、`apps/server/package.json`(只允许 `files` 字段)与文档;不改 `apps/server/src`、`apps/web`、`packages/*` 的源码。
- **npm 依赖只允许新增在 `apps/desktop/package.json`**:`@tauri-apps/api`、`@tauri-apps/cli`、官方插件的 JS 端(`@tauri-apps/plugin-*`),以及与 `apps/web` **同版本**的 `react`、`react-dom`、`@types/react`、`@types/react-dom`、`@vitejs/plugin-react`、`vite`、`typescript`、`vitest`、`@vitest/coverage-v8`、`jsdom`、`@testing-library/*`。`pnpm-lock.yaml` 的改动只能来自这些。Rust 依赖:`tauri`、`tauri-build`、`tauri-plugin-shell`、`tauri-plugin-opener`、`tauri-plugin-autostart`、`tauri-plugin-single-instance`、`serde` / `serde_json`、一个最小的阻塞式 HTTP 客户端(如 `ureq`)、一个取网卡地址的 crate(如 `if-addrs`);再多要在报告里逐个说明理由,且许可必须 MIT / Apache-2.0。
- **任何东西都不得指向真实台子**:启动器试跑时 `EMBER_HOST` / `EMBER_PORT` 种子只能指向本机 `pnpm --filter @flwc/server mock-provider --port 9100 --meters`;不得通过启动器起的混音页对 9000 做任何操作。
- 端口 3000 与 5173 上跑着用户自己的 `pnpm dev`,照旧不占、不重启、不杀。**启动器的默认端口就是 3000,所以你试跑时必须在窗口里改成别的端口(如 3100)再 Apply,或用第 5 节的 `--port` 参数**。
- **安装与卸载要留干净**:你可以在这台机器上按用户安装(`currentUser`)一次来验证 NSIS 安装包,但结束前必须用它自己的卸载程序卸掉,并确认 `%LOCALAPPDATA%\Programs\` 下的安装目录、`%APPDATA%` 与 `%LOCALAPPDATA%` 下的应用数据目录都已删除(卸载程序不删数据目录的话你手动删,报告里写明)、`HKCU\...\Run` 下没有自启动值、没有残留的 launcher 或 node 进程。
- 本批次只在 Windows 上构建与验证;不要顺手加 macOS / Linux 的 CI 矩阵项或 bundler 配置,那是后续批次的事。代码里遇到平台差异时用 `#[cfg]` 或 Tauri 插件处理,不写死 Windows 路径与注册表。
- Node 官方二进制由构建脚本从 nodejs.org 下载到 `src-tauri/binaries/`(gitignored),校验 SHA256;不得把它提交进仓库。

## 分支、PR 与评审监控

沿用 `docs/prompts/phase-6-4.md` 的同名一节,分支名如 `claude/phase-7-2-<随机后缀>`,报告文件为 `docs/reports/phase-7-2-report.md`。

## 硬性约束

- `docs/prompts/phase-6-4.md` 的「硬性约束」全部沿用:代码、注释、提交信息、**窗口与托盘的全部文案**英文,文档与报告简体中文;不调低覆盖率门槛;按逻辑单元分多次提交(建议:包骨架与 Tauri 配置 → 构建脚本(取 Node、铺服务端、生成图标)→ Rust 进程管理与设置 → 托盘与窗口 → 窗口前端 → `desktop.yml` → 文档 → 报告)。
- **`ci.yml` 与 `soak.yml`、`docker.yml` 一字不动**,而且 `ci.yml` 在 `ubuntu-latest` 上必须继续全绿:`@flwc/desktop` 的 `lint` / `typecheck` / `test` / `build` 四个脚本只涉及窗口前端(TS + vitest + `vite build`),不碰 cargo;Rust 的 `fmt --check`、`clippy -D warnings`、`cargo test` 与 `tauri build` 只在 `desktop.yml` 里。
- **进程边界靠 7.1 的 stdin 守护,不写平台专属的进程保活**:子进程的 stdin 必须是启动器持有的管道,启动器退出、崩溃、被结束、注销、关机时管道断开,子进程自行退出;启动器正常退出时另外主动结束子进程并等 `EXIT_WAIT_MS`。不写 Job Object——如果 stdin 那条路在实测里不够,先在报告里写清现象再补,补也要放在 `#[cfg(windows)]` 后面。
- **子进程不得闪出控制台窗口**(Windows 上 `node.exe` 是控制台程序,spawn 时必须带 `CREATE_NO_WINDOW`;`tauri-plugin-shell` 的 sidecar 已经这样做,自己用 `std::process::Command` 就要自己加)。
- **启动器自己的设置与服务端配置分开**:启动器的 `launcher.json` 只存端口、绑定范围、是否隐藏启动;Ember 地址永远在服务端的 `config.json`,由混音页的 CONNECTION 面板管理,启动器不提供 Ember 地址的 UI。
- **窗口里不放任何影响声音的控件**;它不嵌混音页。
- 数值一律做成常量并在报告的「数值初值清单」逐个列出;你不得自行调整初值。
- 不改 `docs/development-plan.md` 的任务描述与验收框;`docs/fairlight-ember.md` 只由用户回写;`docs/prompts.md` 由监督会话维护,不改。

## 任务范围

### 1. 包骨架与构建脚本

`apps/desktop/`:

```
package.json            @flwc/desktop:scripts dev / build(vite)/ typecheck / test / tauri
index.html, src/        窗口前端(Vite + React + TS,与 apps/web 同一套工具链)
scripts/fetch-node.mjs  下载官方 Node 二进制到 src-tauri/binaries/
scripts/stage-server.mjs 把服务端与 web 产物铺进 src-tauri/resources/
scripts/prepare.mjs     依次跑上面两个 + `tauri icon`,是 beforeDevCommand / beforeBuildCommand 的前半段
src-tauri/              Cargo.toml, tauri.conf.json, capabilities/, src/*.rs
```

- **`fetch-node.mjs`**(零依赖,只用 `node:https`、`node:fs`、`node:child_process`):常量 `NODE_VERSION`(取执行时最新的 22.x LTS,报告里写明具体版本);按目标三元组查一张「三元组 → nodejs.org 压缩包名」的映射表下载,用同目录 `SHASUMS256.txt` 校验;用系统 `tar` 解压(Windows 10 以上自带的 bsdtar 能解 zip);只取出 `node.exe` 与 `LICENSE`,放到 `src-tauri/binaries/node-<triple>.exe` 与 `src-tauri/resources/NODE_LICENSE`。**映射表本批次只填 `x86_64-pc-windows-msvc` → `win-x64.zip` 一行**,结构留给以后加 darwin / linux;目标三元组默认取当前主机,`--target <triple>` 可指定,不在表里的三元组报错退出;已存在且校验通过则跳过。
- **`stage-server.mjs`**:前置 `pnpm build` 已跑过(检查 `apps/server/dist/main.js` 与 `apps/web/dist/index.html`,缺则报错退出);`pnpm --filter @flwc/server deploy --prod --legacy src-tauri/resources/server`(或 7.1 Dockerfile 用的那种剪枝复制,取能跑的,报告里写明);复制 `apps/web/dist` 到 `src-tauri/resources/web`;先清空再铺,保证没有上一次的残留。
- **图标**:`prepare.mjs` 调 `tauri icon ../web/public/icon-512.png -o src-tauri/icons`;`src-tauri/icons/`、`binaries/`、`resources/server`、`resources/web`、`target/`、`gen/` 全部 gitignored——仓库里不提交任何二进制。
- **`tauri.conf.json`**:`productName` `Fairlight Live Web Controller`,`identifier` `io.github.wuxinnnn.flwc`,`version` 与 `apps/desktop/package.json` 一致(**初值 `0.2.0`**:`v0.1.0` 已在 7.1 合并后发布并挂了镜像包,7.2 合并后用户打的下一个标签就是 `v0.2.0`;`desktop.yml` 校验标签与它一致);窗口 `label: main`,初值 `width: 560, height: 440`,`resizable: false`,`visible: false`(由 Rust 按设置决定是否显示),深色背景;`bundle.externalBin: ["binaries/node"]`,`bundle.resources: ["resources/**"]`,`bundle.targets: ["nsis"]`(`installMode: currentUser`,`webviewInstallMode` 保持默认的 bootstrapper);其它平台的 targets 留待后续批次;`beforeDevCommand` / `beforeBuildCommand` 先 `node scripts/prepare.mjs` 再 `vite`。capabilities 只开需要的权限(shell 的 sidecar `node`、opener 的 `http://localhost:*`、autostart、single-instance、core 的窗口与事件)。
- 根 `package.json` 加 `"desktop:dev": "pnpm build && pnpm --filter @flwc/desktop tauri dev"` 与 `"desktop:build": "pnpm build && pnpm --filter @flwc/desktop tauri build"`;根 `build` / `test` / `lint` / `typecheck` 对 desktop 只跑前端那部分。

### 2. Rust 侧(`src-tauri/src/`)

模块划分(每个纯逻辑模块带 `#[cfg(test)]` 单测):

- **`settings.rs`**:`LauncherSettings { version: 1, port: u16, bind_lan: bool, start_hidden: bool }`,默认 `3000 / true / false`;读写 `app_config_dir()/launcher.json`,损坏或缺失回默认并告警,写入原子(临时文件 + rename)。单测:缺失、损坏、版本不认识、正常往返。
- **`net.rs`**:`pick_lan_ipv4(interfaces) -> Option<Ipv4Addr>`(纯函数,输入是 `(name, addr, is_loopback)` 列表):排除回环与链路本地 `169.254/16`,优先私有网段 `192.168/16` > `10/8` > `172.16/12`,再其它;`urls(settings, lan) -> { local: String, lan: Option<String> }`。单测覆盖优先级与无网卡。
- **`server.rs`**:子进程生命周期。`spawn(app, settings)`:定位 sidecar `node` 与 `resource_dir()/server/dist/main.js`;环境 `HOST`(`bind_lan` 则 `0.0.0.0` 否则 `127.0.0.1`)、`PORT`、`FLWC_WEB_ROOT=<resource_dir>/web`、`FLWC_DATA_DIR=<app_data_dir>/data`、`FLWC_EXIT_ON_STDIN_CLOSE=1`、`NODE_ENV=production`,其余环境原样继承(`EMBER_HOST` / `EMBER_PORT` 由此透传);stdin 接管道且**启动器一直持有写端**;stdout / stderr 逐行读:追加到 `app_log_dir()/server.log`(启动时截断)与内存环形缓冲(`LOG_RING_LINES`,初值 500),并以 `server-log` 事件发给窗口。就绪探测:每 `HEALTH_POLL_MS`(初值 500)`GET http://127.0.0.1:<port>/api/v1/health`,最多 `HEALTH_TIMEOUT_MS`(初值 30 000);状态机 `Stopped → Starting → Running | Failed { exit_code, tail }`,每次变化发 `server-state` 事件。`stop()`:关掉 stdin 写端(触发子进程优雅退出),等最多 `EXIT_WAIT_MS`(初值 5000),没退就 `kill()`。`restart(settings)` = `stop` + `spawn`。子进程意外退出(`Running` 时 `wait` 返回)→ `Failed`,不自动重启(7.1 明确「启动脚本不做守护」,这里同样:让用户看到失败原因)。单测:状态机转换与「就绪前退出 / 探测超时 / 运行中退出」三条路径(用 trait 把 HTTP 探测与子进程抽出来注入假实现)。
- **`tray.rs`**:托盘图标(同一套图标),提示文本随状态变(`Starting…` / `Running at <lan or local url>` / `Failed`),菜单 `Open in browser` / `Show window` / 分隔 / `Exit`;左键单击 = `Show window`。
- **`commands.rs`**:暴露给窗口的命令 `launcher_state`(设置 + 服务器状态 + 两个 URL + autostart 是否启用 + 日志尾部)、`apply_settings(settings)`(写盘并 `restart`;端口不变且绑定不变则不重启)、`open_in_browser`(`opener` 打开 `http://localhost:<port>/`)、`hide_window`、`set_autostart(bool)`(`tauri-plugin-autostart`,它在 Windows 上写当前用户的 `Run` 注册表值,其它平台的方式将来由插件自己处理)、`quit`(`stop()` 后 `app.exit(0)`)。
- **`main.rs` / `lib.rs`**:`single-instance`(第二个实例把已有窗口调到前台);启动:读设置 → `spawn` → 若 `start_hidden` 为假或命令行没有 `--hidden` 则显示窗口;窗口 `CloseRequested` → `prevent_close` + 隐藏(关闭按钮 = 隐藏到托盘,退出只在托盘 `Exit` 与窗口的 `Exit` 按钮);`RunEvent::ExitRequested` / `Exit` → `stop()`;`--port N` 命令行参数覆盖设置里的端口(只用于你在开发机上避开 3000,写进 README 的开发一节即可)。

### 3. 窗口前端(`apps/desktop/src/`)

一页,React + TS,深色,配色 token 从 `apps/web/src/styles.css` 里**抄那几个变量**并注明来源(包之间不能相对路径引用源码);不引 zustand、不引路由,一个 `useReducer` 或几个 `useState` 足够:

- 顶部状态行:大字 `STOPPED` / `STARTING` / `RUNNING` / `FAILED` + 一行地址(`http://192.168.x.x:3000`,取不到局域网地址时只显示 `http://localhost:3000`),旁边 `Copy` 按钮(写剪贴板)。
- Server 分组:`Port`(数字输入,1–65535)、`Allow access from other devices on the network`(复选,即 `bind_lan`)、`Apply`(仅在与已保存设置不同时可用;点击后按钮显示 `Restarting…` 直到状态回到 Running / Failed)。
- Startup 分组:`Start with Windows`、`Start hidden in the tray`。
- 按钮行:`Open in browser`、`Hide to tray`、`Exit`。
- 底部 `Server log` 只读文本框,显示尾部 `LOG_RING_LINES` 行,新行到达自动滚到底;`Failed` 时把退出码与最后几行高亮。
- 所有状态来自 `launcher_state` 与两个事件;前端不自己猜。纯逻辑(状态 → 文案与按钮可用性、端口输入校验、日志缓冲裁剪)拆到 `src/view-model.ts` 并用 vitest 覆盖;组件用 React Testing Library 测,Tauri 的 `invoke` / `listen` 走一个可注入的 `LauncherApi` 接口,测试里给假实现(与 `apps/web` 的 `FakeSocket` 同样的思路),不 mock `@tauri-apps/api` 模块本身;`apps/desktop/vitest.config.ts` 的门槛与 `apps/*` 一致(80%),把 `src/main.tsx`(挂载)与真实的 Tauri 适配器 `src/tauri-api.ts` 列入排除并在报告里写明——这是本批次仅有的两项覆盖率排除。

### 4. `.github/workflows/desktop.yml`

新建:

- 触发:`pull_request`、`push` 标签 `v*`、`workflow_dispatch`。
- 单个 job,`windows-latest`(`x86_64-pc-windows-msvc`);写成 `strategy.matrix` 只含一项,以后加平台只需追加矩阵项。
- 步骤:checkout / pnpm / node 22(与 `ci.yml` 相同的三步)→ runner 自带的 rustup → `pnpm install --frozen-lockfile` → `pnpm build` → `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`(在 `src-tauri` 下)→ `pnpm --filter @flwc/desktop tauri build` → `actions/upload-artifact` 上传 `src-tauri/target/release/bundle/nsis/*.exe`。
- 标签触发时:校验标签去掉 `v` 后等于 `tauri.conf.json` 的 `version`,不等则失败;`gh release view <tag> || gh release create <tag> --generate-notes`,`gh release upload --clobber` 把安装包挂上去(与 `docker.yml` 共用同一个 Release,两个工作流谁先到谁建)。
- 只用 `actions/*` 官方 action 与 `gh`;Rust 用 runner 自带的 rustup,不引第三方 action。
- **验证**:PR 上这个 job 绿、artifact 能下载;你把 artifact 下载回来实际安装一次(第 5 节);标签路径合并前无法真跑,报告里写明。

### 5. 你在本机要实际验证的(写进报告,附命令与关键输出)

1. `pnpm desktop:dev` 能起窗口(用 `--port 3100`),`pnpm desktop:build` 产出 `src-tauri/target/release/bundle/nsis/*.exe`;记录安装包大小与安装后的目录大小。
2. 安装(currentUser)后从开始菜单启动:没有任何控制台窗口闪过(启动器与 node 都没有);托盘图标出现;窗口显示 STARTING → RUNNING 与局域网地址;`Get-Process` 里 node 的父进程是启动器、`MainWindowHandle` 为 0。
3. 改端口为 3100 → Apply → 状态经 Restarting 回到 RUNNING,旧端口释放、新端口可访问;混音页在浏览器里显示 mock 的通道。
4. 关闭按钮 → 窗口隐藏、托盘还在、后端还在;托盘 `Show window` 回来;再从开始菜单启动一次 → 没有第二个实例,原窗口被调到前台。
5. `Stop-Process -Force` 结束启动器(模拟崩溃):node 在 `SHUTDOWN_TIMEOUT_MS` 内退出、端口释放——这是 stdin 守护的证据。
6. 把 node 进程手动结束:窗口进入 FAILED,退出码与日志尾部可见,不自动重启;`Apply` 能重新拉起。
7. `Start with Windows` 勾上 → `HKCU\...\Run` 出现值;去勾 → 消失;**结束时确认不存在**。
8. 托盘 `Exit`:node 与启动器都退出,端口释放,`server.log` 里有优雅关闭的记录。
9. 卸载并按「本地执行边界」检查残留。
10. 注销 / 关机时的行为:标注**移交用户**。

### 6. 文档

- `README.md`:填实「Desktop app」一段——从 Release 下载 Windows `.exe` 安装包、安装后窗口里做什么、平板用哪个地址、`Start with Windows`;一句「macOS and Linux builds are planned」,不写细节;开发一节加 `pnpm desktop:dev` / `pnpm desktop:build` 与前置(Rust、MSVC 构建工具、WebView2)。
- `docs/architecture.md`「部署」一节加桌面壳:进程模型(sidecar Node、stdin 守护、健康探测)、数据与日志目录、设置文件、与服务端合同的对应关系、目前只出 Windows 包而代码保持可移植。
- `docs/conventions.md`:目录结构加 `apps/desktop`(含 `src-tauri`),Git 一节的不提交清单加 `binaries/`、`resources/server`、`resources/web`、`icons/`、`target/`;语言一节加一句 Rust 也遵守英文注释与 `cargo fmt`。
- `AGENTS.md` 目录结构加一行 `apps/desktop`。
- 不动 `docs/development-plan.md`、`docs/prompts.md`、`docs/prompts/*`、`docs/reports/*`(除本批次报告)、`docs/fairlight-ember.md`。

## 测试要求

- Rust:`settings.rs`、`net.rs`、`server.rs` 状态机各有单测,`cargo test` 在 `desktop.yml` 里跑;`clippy -D warnings` 与 `fmt --check` 全绿。
- 前端:`view-model.ts` 的 vitest 用例与组件的 RTL 用例(状态行、Apply 可用性、端口校验、日志滚动、按钮调用了对应的 `LauncherApi` 方法),覆盖率 ≥ 80%(只排除 `src/main.tsx` 与 `src/tauri-api.ts`)。
- 既有包的测试与覆盖率不受影响;`ci.yml` 在 ubuntu 上继续全绿。
- 第 5 节的手工验证逐条记录。

## 明确不做的事

- 不做 macOS / Linux 的构建、打包、CI 矩阵与验证(留待用户有设备后另开批次;代码保持可移植即可)。
- 不做代码签名;不做自动更新(`tauri-plugin-updater`);不做 MSI;不做便携版。
- 窗口里不做 Ember 地址设置、不嵌混音页、不做日志文件浏览器。
- 不做「后端崩溃自动重启」。
- 不做 Windows 服务 / launchd daemon 形态。
- 不改服务端与前端源码;7.1 合同不够用时先在报告里写清,再以最小改动补,并单列。
- 不做 Windows arm64 包。

## 验收自查

1. 第 5 节 1–9 全部实测通过,10 标注移交。
2. `desktop.yml` 在 PR 上全绿,artifact 可下载并实装过一次。
3. `ci.yml` 在 PR 上全绿(证明 desktop 包没有把 cargo 带进根脚本);`ci.yml` / `soak.yml` / `docker.yml` 无 diff。
4. Rust 单测、clippy、fmt 全绿;前端 view-model 覆盖率达标。
5. `pnpm-lock.yaml` 的改动只来自 `apps/desktop/package.json`;所有新 crate 与 npm 包的许可在报告的依赖清单里逐个列出(名称、版本、许可)。
6. 仓库里没有二进制:`git ls-files | grep -E 'binaries|icons|resources'` 为空。
7. 用户机器上没有残留:无安装目录、无应用数据目录、无 `Run` 值、无进程。
8. 全程没有碰真实 Fairlight,没有动 3000 / 5173 / 9000。

## 执行报告要求

在 `docs/reports/phase-7-2-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-7-1-report.md` 相同:结果总览、验收标准逐条核对(对上述八条)、实现摘要(每节一段;进程模型一节写清四种退出路径各靠什么保证、stdin 守护实测的表现)、**本机实测记录**(第 5 节逐条,附命令与关键输出、安装包与安装目录大小)、**CI 记录**(run 链接与 artifact 名)、数值初值清单(本批次全部常量:名称、值、含义、文件;含 `NODE_VERSION`、窗口尺寸、Tauri 与插件版本)、依赖清单(npm 与 crate 分开,每项名称、版本、许可)、**可移植性说明**(哪些地方是平台相关的、各自怎么隔离的,给将来做 macOS 的会话看)、真机验收操作清单(移交用户,含:① 从 PR artifact 或 Release 下载安装包安装、启动、平板按窗口里的地址打开、CONNECTION 面板指向真实台子、验证四个允许通道;② `Start with Windows` 勾上后注销再登录确认自启且 `Start hidden` 生效;③ 关机再开机后后端不残留;④ 合并后打标签验证 Release 上同时出现镜像包与安装包;**安全约束照抄 6.4 报告第 6 节**)、交付物清单、关键决策与偏离、遗留问题与移交事项、提交记录。

报告必须如实反映实际执行结果:构建失败、平台差异、做不了的验证都要写明,不许美化。

## 完成定义

- 六项任务全部落地,测试要求全部满足。
- 本地串行 lint / typecheck / test / build 全绿;`desktop.yml` 与 `ci.yml` 在 PR 上全绿;Bugbot 的每一条 finding 都已修复或已在线程里回复理由,且最后一轮轮询没有新 finding。
- Windows 安装包在本机实装、实测、卸载各一次。
- 用户机器上没有残留。
- 全部变更已按 Conventional Commits 提交并推送。
- `docs/reports/phase-7-2-report.md` 已产出,真机验收清单可直接交用户执行。
