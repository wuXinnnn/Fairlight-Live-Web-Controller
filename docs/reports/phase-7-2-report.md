# Phase 7.2 执行报告 — 桌面启动器(Tauri,Windows)

## 1. 结果总览

交付 Phase 7 的第三种发布形态:`apps/desktop`(`@flwc/desktop`)——Tauri 2 的桌面启动器,一个小设置窗口
加一个托盘图标,后端跑在它的子进程里,混音页仍然在平板的浏览器里打开。窗口不嵌混音页,里面没有任何能改变
声音的控件。

- Windows NSIS 安装包(按用户安装,不需要管理员权限),自带官方 Node 运行时与铺好的服务端、web 产物,
  目标机器不需要装任何东西。
- 进程边界只有一条:子进程的 stdin 是启动器持有的管道。没有 Job Object,没有保活代码。
- Rust 单测 63 条,窗口前端 49 条;`cargo clippy -D warnings` 与 `cargo fmt --check` 全绿;
  窗口覆盖率远超 80% 门槛。
- `ci.yml` / `soak.yml` / `docker.yml` 一字未动;Rust 全部在新增的 `desktop.yml` 里。
- **实测中发现并修复了四个真实缺陷**(见第 11.1 节),其中一个会让整个进程模型不成立;
  Cursor Bugbot 另报 4 条,全部成立并已修复(见第 11.2.5 节,其中一条与实测发现的是同一个问题,
  另一条是修那一条带出来的)。
- 全程没有改动真实 Fairlight Live 的任何参数,没有碰过任何推子。

## 2. 验收标准逐条核对

对照提示词「验收自查」八条:

| # | 标准 | 结果 |
| --- | --- | --- |
| ① | 第 5 节 1–9 全部实测通过,10 标注移交 | ✅ 全部通过,含评审修复后的最终构建复验(第 4 节) |
| ② | `desktop.yml` 在 PR 上全绿,artifact 可下载并实装过一次 | ✅ run 35330008199 绿;artifact 已下载实装(第 5 节) |
| ③ | `ci.yml` 在 PR 上全绿;三个既有 workflow 无 diff | ✅ `git diff origin/main -- .github/workflows/{ci,soak,docker}.yml` 为空(第 5 节) |
| ④ | Rust 单测、clippy、fmt 全绿;前端覆盖率达标 | ✅ 63 / 49 条,覆盖率 99%(第 3.7 节) |
| ⑤ | `pnpm-lock.yaml` 只因 `apps/desktop` 而变;依赖逐个列出许可 | ✅ lockfile 新增项全部在 `apps/desktop:` 下(第 7 节) |
| ⑥ | 仓库里没有二进制 | `git ls-files \| grep -E 'binaries\|icons\|resources'` 为空 |
| ⑦ | 用户机器上没有残留 | ✅ 三轮安装后都复查过(第 4.9、4.10 与 5 节) |
| ⑧ | 没有碰真实 Fairlight,没有动 3000 / 5173 / 9000 | ✅ 仅首启一次只读连接,经用户同意(第 9 节) |

## 3. 实现摘要

### 3.1 包骨架与 Tauri 配置

`apps/desktop` 是 workspace 成员,所以根脚本 `lint` / `typecheck` / `test` / `build` 自动带上它。它的
`build` **只是 `vite build`**,不碰 cargo——这是 `ci.yml` 能在 ubuntu 上继续全绿的原因。

`tauri.conf.json` 里三处值得点名:

- **`bundle.resources` 用「目录 → 目录」的对象写法**,不是数组 glob。Tauri 文档明说 `dir/**` 只匹配目录、
  匹配不到文件就抛错;而 map 形式下的 glob 源会把子树**拍平**,用它铺 `node_modules` 会静默毁掉安装包。
  对象写法保留子结构,并且让 Rust 侧拿到的是 `resource_dir()/server/dist/main.js`。
- **capability 没有给窗口开 shell 的 sidecar 权限**。ACL 只管从 webview 发起的 IPC,而 sidecar 是 Rust
  侧起的,窗口自己不 spawn 任何东西。
- **窗口初始不可见**,由 Rust 决定要不要显示,这样 `Start hidden in the tray` 与 `--hidden` 不会先闪一下窗口。

`apps/server/package.json` 加了 `files: ["dist"]`。不加的话 `pnpm deploy` 会回落到根 `.gitignore`,
看到 `dist/` 就把整个 `dist` 排除掉,**而且不报错**——得到一个有依赖没代码的空壳。

### 3.2 取 Node 运行时(`scripts/fetch-node.mjs`)

零依赖。常量 `NODE_VERSION = 22.23.2`(执行时最新的 22.x LTS)。下载 `node-v22.23.2-win-x64.zip`,
用同目录 `SHASUMS256.txt` 校验 SHA256(实测 `1177b413…99f97`),只取 `node.exe` 与 `LICENSE`。

三元组映射表本批次只有一行,但结构上带了三项而不是一项:压缩包名、包内可执行文件路径、落盘后缀——
这三样在 darwin / linux 上都不同。表里没有的三元组直接报错退出。落盘名是 `node-<triple>.exe`,
`-<triple>` 后缀是 `externalBin` 的硬要求,`tauri-build` 拷进 target 目录时会把它去掉,所以运行期 Rust 侧
要传 `sidecar("node")` 而**不是** `"binaries/node"`。

解压用的是**显式的 `%SystemRoot%\System32\tar.exe`**。Windows 自带的那个是 bsdtar,能解 zip;而 Git for
Windows 带的 GNU tar 在 Git Bash 里排在 PATH 前面,根本不支持 zip(实测第一次就踩到,报的还是
`Cannot connect to C: resolve failed`——它把 `C:\...` 当成了远程主机)。

### 3.3 铺放服务端(`scripts/stage-server.mjs`)

走的是 `pnpm --filter @flwc/server deploy --prod --legacy --ignore-scripts
--config.node-linker=hoisted --config.package-import-method=copy`。四个开关各有原因:

- `--legacy`:pnpm 11.17 仍然拒绝 deploy 一个没有 inject 的 workspace 包。
- `--ignore-scripts`:`@flwc/shared` 的 `prepare` 是 `tsc`,而 `--prod` 不装 devDependencies。
- `node-linker=hoisted`:**这条是硬要求**。Tauri 打包资源用 `walkdir` 且不跟随链接,遇到链接既不展开
  也不报错——直接跳过。pnpm 默认的 isolated 布局全是链接,那样产出的安装包会静默缺掉绝大部分依赖,
  只在用户机器上炸。
- `package-import-method=copy`:仓库在 `F:`、pnpm store 在 `C:`,跨卷本来就硬链接不了,写明确让结果确定。

然后脚本递归 `lstat` 整棵树断言**一个链接都没有**(实测 5144 个条目,0 链接),再断言几个关键文件在位,
其中 `dist/tools/expand-ember-tree.js` 是专门列出来的:它不是开发工具,`ember-service.js` 会 import 它。

**副作用与处理**:`pnpm deploy` 会在仓库根跑一次 filtered + production 的安装,并把这个记进根的
`node_modules/.pnpm-workspace-state-v1.json`。留着不管的话,这个 checkout 里下一条 `pnpm exec` 或
`pnpm run` 会认为工作区已过期,进而尝试 `pnpm install --production`——有 TTY 时它会提示清空
`node_modules` 并重装成没有开发依赖的样子。实测第一次就撞上了(`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`)。
脚本现在在 deploy 前后原样保存与还原这些状态文件。

### 3.4 铺好之后的冒烟(`scripts/smoke-staged-server.mjs`)

提示词里没有这一步,是本批次自己加的,理由是上面那个「静默跳过」的坑代价太大:它用**与运行期完全一致的
合同**真起一次铺好的服务端(随机空闲端口,避开 3000 / 5173 / 9000),等 `/api/v1/health` 返回 200,
再确认 `/` 由 staged web 产物提供,然后关掉 stdin 断言 5 秒内以退出码 0 退出。

它同时也是 stdin 守护这条链路在构建期的回归锁。不放进 `prepare.mjs`,免得拖慢 `tauri dev`;
本地与 `desktop.yml` 里各单列一步。

### 3.5 进程模型(`src-tauri/src/server/` 与 `bridge.rs`)

状态机是 `Stopped → Starting → Running { port } | Failed { reason, exit_code, tail }`,
`reason` 四选一:`SpawnFailed` / `ExitedBeforeReady` / `HealthTimeout` / `ExitedWhileRunning`。
没有 `Stopping` 状态:停止对调用方是同步的,窗口自己显示 `Restarting…`,多一个状态就多一个真相来源。

核心设计是**状态机做成一个可以单步调用的同步 `tick()`**;运行期只是一个
`while tick() == Continue { sleep(500ms) }` 的线程外壳。`server/` 下四个文件**一个 `tauri` 都不引用**,
进程、健康探测、时钟、事件、日志抽运全是 trait,真实实现集中在 `bridge.rs`。这就是为什么全部失败路径
都能在没有进程、没有 socket、没有真时钟、没有线程的情况下覆盖。

用 `generation: u64` 作废旧的一代:没有它,重启期间旧的监督线程会看到自己那个子进程退出,然后报一个
根本没发生的失败。

`PORT` 一路由 `u16` 承载。服务端**不校验** `PORT`(7.1 报告 §14.6),非数字会让它监听一个随机端口而不是
报错,所以这个保证只能由类型给。

**四种退出路径各靠什么**

| 路径 | 保证 |
| --- | --- |
| 托盘 `Exit` / 窗口 `Exit` | `quit_now()` → `stop()`:关 stdin、每 100 ms 轮询、最多等 5 s、还活着才 `kill()`;然后 `app.exit(0)`。同步执行,进程不会先于子进程消失 |
| 注销 / 关机 | `RunEvent::ExitRequested` / `Exit` 走同一个 `stop()` |
| 关闭按钮 | **不退出**:`prevent_close` + 隐藏窗口,后端照跑 |
| 崩溃 / 被任务管理器结束 | 没有任何代码会运行。stdin 管道随进程消失而断,子进程收到 EOF 后按 `FLWC_EXIT_ON_STDIN_CLOSE=1` 自行优雅退出 |

**stdin 守护的实测表现**:强杀启动器后,后端在开发构建上 **255 ms**、在安装后的 release 构建上
**105 ms** 退出,端口随即释放,`server.log` 里留下 `{"reason":"stdin closed","msg":"shutting down"}` 与
`{"msg":"shutdown complete"}` 两行——这两行是后端在启动器已经不存在之后自己写进去的。

### 3.6 为什么输出走文件而不是管道

这是本批次最重要的一处偏离,也是实测逼出来的。

最初 stdout / stderr 都是管道,启动器起两个线程逐行读。测「强杀启动器」这一条时,**后端不退出**:
HTTP 服务确实关掉了(端口释放),但进程一直在,静止无 CPU,连它自己 5 秒的关闭超时都没把它救出来。
实测挂了 38 秒仍然活着,最后只能手动结束。

分离变量:

| 父进程 | 子进程 stdio | 强杀父进程后 |
| --- | --- | --- |
| Node 写的最小复现父进程 | 三个管道,父进程持续读 | 子进程 **4 ms** 退出 |
| Node 写的最小复现父进程 | stdin 管道,stdout/stderr `ignore` | 子进程 **108 ms** 退出 |
| 本启动器(Rust) | 三个管道 | **不退出**(38 s 后仍在) |
| 本启动器(Rust) | stdin 管道,stdout/stderr `null` | 子进程 **255 ms** 退出 |

结论很清楚:卡住的是那两个管道,不是关闭流程。于是改成**子进程直接写 `server.log`,启动器 tail 这个
文件**喂给窗口;stdin 成为唯一的管道。改完之后同样的强杀,后端 255 ms 就没了。

附带的好处有两个:日志由后端自己落盘,**带走启动器的那次崩溃反而留下了完整日志**(上面那两行 shutdown
记录就是这么来的);以及少了两个读线程。代价是日志事件失去了 stdout / stderr 的区分——窗口本来也没有
用它区分任何东西,所以一并去掉了,没有留一个名不副实的字段。

`open_log()` 先 `File::create` 截断,再开两个 **append** 句柄分给 stdout 与 stderr;append 模式是它们
不互相覆盖的原因。

### 3.7 质量门

| 项 | 结果 |
| --- | --- |
| `cargo test` | 63 passed |
| `cargo clippy --all-targets -- -D warnings` | 干净 |
| `cargo fmt --check` | 干净 |
| `@flwc/desktop` vitest | 49 passed;语句 99.13% / 分支 89.47% / 函数 100% / 行 99.13%(门槛 80%) |
| 既有包 | shared 44、test-utils 23、server 287、web 497,覆盖率与合并前一致 |
| 根 `pnpm lint` / `typecheck` / `test` / `build` | 全绿 |

窗口的覆盖率排除只有两项,与提示词一致:`src/main.tsx`(只做挂载)与 `src/tauri-api.ts`
(真实 Tauri 适配器,它正是测试要替换掉的那道缝——覆盖它等于在断言 mock)。

## 4. 本机实测记录

**安全前提**:全程没有碰任何推子;3000 / 5173 不占不杀;Ember 端点指向 mock
(`pnpm --filter @flwc/server mock-provider --port 9100 --meters`)。

> **关于首次启动**:本机 `127.0.0.1:9000` 上监听的就是真实的 Blackmagic「Fairlight Live」应用
> (PID 5388),而服务端在 `config.json` 不存在时的默认 Ember 种子恰好是 `127.0.0.1:9000`。经用户同意,
> 首次启动允许连上它并顺带验证首启行为——**只读观察,没有发送任何控制命令,没有动任何推子**——随后立刻
> 通过 CONNECTION 面板(`PUT /api/v1/connection`)把地址改到 `127.0.0.1:9100`,此后所有验证都对 mock 做。
> 实测首启:`{"host":"127.0.0.1","port":9000,"status":"connected"}`,切换后
> `{"host":"127.0.0.1","port":9100,"status":"connected"}`。

### 4.1 开发模式与构建(第 1 条)

`pnpm desktop:dev` 本身不转发参数(它是 `pnpm build && pnpm --filter @flwc/desktop tauri dev`),要指定端口
用 filter 形式,README 的开发一节写的就是这条:

```
pnpm --filter @flwc/desktop tauri dev -- -- --port 3100
```

窗口正常起来,状态 RUNNING,地址 `http://192.168.50.115:3100`。

`pnpm desktop:build` 产出:

| 项 | 值 |
| --- | --- |
| 安装包 | `src-tauri/target/release/bundle/nsis/Fairlight Live Web Controller_0.2.0_x64-setup.exe` |
| 安装包大小 | **27,973,921 字节 = 26.68 MiB** |
| 安装后目录 | `%LOCALAPPDATA%\Fairlight Live Web Controller` |
| 安装后大小 | **4,526 个文件,116.0 MiB**(其中 `node.exe` 未压缩就占 83 MiB) |
| 安装目录内容 | `flwc-launcher.exe`、`node.exe`、`uninstall.exe`、`NODE_LICENSE`、`server/`、`web/` |

铺放阶段的断言输出:`staged the server and the web build into resources/ (5144 entries, no links)`。
铺好之后的冒烟:`health ok and / served from the staged web root on port 4238` /
`exited cleanly 6 ms after stdin closed`。

### 4.2 从开始菜单启动(第 2 条)

按 `currentUser` 静默安装(`/S`,退出码 0),从
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Fairlight Live Web Controller.lnk` 启动:

```
launcher pid: 46232  path: C:\Users\...\AppData\Local\Fairlight Live Web Controller\flwc-launcher.exe
node pid: 19480  parent: 46232  MainWindowHandle: 0
node command line: "...\node.exe" "...\Fairlight Live Web Controller\server\dist\main.js"
```

- **没有控制台窗口闪过**。后端确实有一个 `conhost.exe` 子进程,但它 `MainWindowHandle = 0`、没有标题——
  `CREATE_NO_WINDOW` 的语义就是「分配控制台但不建窗口」,屏幕上什么都不会出现。启动器自己是 GUI 子系统,
  连 conhost 都没有。
- **托盘图标出现**:在通知区域溢出面板里,是混音页那个琥珀色推子图标(已截图);UIA 里它是一个
  `SystemTray.NormalButton`,提示文本为 `Fairlight Live Web Controller / Running at http://192.168.50.115:3100`
  ——随状态变化。
- 窗口显示 `RUNNING` 与局域网地址 `http://192.168.50.115:3000`(此时还是保存的默认端口)。

### 4.3 改端口并 Apply(第 3 条)

通过 UI Automation 把窗口里的 Port 改成 3100 再点 Apply:

```
backend before: 19480
button now says: ... Restarting… ...
status: RUNNING
backend after: 46800 (restarted: True)
port 3000 listening: False
port 3100 listening: True
launcher.json: { "version": 1, "port": 3100, "bindLan": true, "startHidden": false }
```

混音页经新端口验证(数据源是 mock,不是真台子):

```
index=200
channels: 20 -> MIC, MIC-REVERB, BASS, Anagram-Wet, Anagram-Dry, PC
{"host":"127.0.0.1","port":9100,"status":"connected"}
```

### 4.4 关闭按钮、托盘、单实例(第 4 条)

```
before: window visible=True launcher=46232 backend=46800
after close: launcher alive=True window visible=False
backend alive=True  port 3100=True
```

托盘菜单三项齐全:`Open in browser | Show window | Exit`;点 `Show window`:
`tray 'Show window' brought it back: True`。

再从开始菜单启动一次:

```
launcher processes now: 1 (pids: 46232)
same pid as before: True
window visible again: True
backends: 1
```

### 4.5 强杀启动器,后端自行退出(第 5 条)

在安装后的版本上:

```
launcher=39268 backend=47648
backend exited: True after 105ms
port 3100 listening: False
stray node under the install dir: 0
--- last lines of server.log ---
{... "reason":"stdin closed","timeoutMs":5000,"layer":"lifecycle","msg":"shutting down"}
{... "reason":"stdin closed","layer":"lifecycle","msg":"shutdown complete"}
```

**这两行是 stdin 守护的直接证据**,而且是在启动器已经不存在之后由后端自己写进日志文件的——管道方案永远
拿不到这个记录。(这一条第一次做的时候是失败的,见第 3.6 与 11.1 节。)

### 4.6 手动结束后端(第 6 条)

```
reached FAILED: True
no replacement started on its own: True
Apply enabled while failed: True
back to RUNNING after Apply: True
new backend pid: 47648  port 3100: True
```

窗口在 FAILED 下显示 `The backend stopped while it was running (exit code -1).`,下面高亮了退出前的日志尾部
(-1 是 `TerminateProcess` 的结果,不是后端自己的退出码)。(这一条第一次做的时候 Apply 点了没反应,
见 11.1 第 3 条。)

### 4.7 开机自启(第 7 条)

```
--- before ---            (no value)
--- after ticking ---     Fairlight Live Web Controller = C:\Users\...\flwc-launcher.exe --hidden
--- after unticking ---   (no value)
```

复选框状态跟着注册表走(`Off → On → Off`)。`--hidden` 是插件按注册时给的参数写进去的,这样开机自启不会
把窗口甩到用户脸上。**结束时已确认该值不存在。**

### 4.8 托盘 Exit(第 8 条)

先点 `Hide to tray`(窗口隐藏、后端照跑),再从托盘菜单选 `Exit`:

```
after tray Exit (223ms): launcher gone=True backend gone=True port3100 listening=False
{... "reason":"stdin closed","layer":"lifecycle","msg":"shutting down"}
{... "reason":"stdin closed","layer":"lifecycle","msg":"shutdown complete"}
```

### 4.9 卸载与残留(第 9 条)

用它自己的 `uninstall.exe /S`(退出码 0):

| 项 | 卸载后 |
| --- | --- |
| 安装目录 `%LOCALAPPDATA%\Fairlight Live Web Controller` | 已删除 |
| 开始菜单快捷方式 | 已删除 |
| `HKCU\...\Run` 的值 | 已删除 |
| `HKCU\...\Uninstall` 的项 | 已删除 |
| 启动器 / 后端进程 | 0 |
| `%APPDATA%\io.github.wuxinnnn.flwc`(`launcher.json` + `data/config.json`,2 个文件) | **未删除** |
| `%LOCALAPPDATA%\io.github.wuxinnnn.flwc`(`logs/` + WebView2 的 `EBWebView/`,334 个文件) | **未删除** |

应用数据目录卸载程序不动,这是 NSIS 静默卸载(`/S`)的标准行为——交互式卸载时 Tauri 的 NSIS 模板会问一句
要不要一并删除用户数据,`/S` 下不会问。按提示词要求**已手动删除并复查**:

```
%APPDATA%      : gone
%LOCALAPPDATA% : gone
install dir    : gone
HKCU Run       : gone
processes      : launcher=0 node-under-install=0
ports 3000/3100: False
```

### 4.10 含评审修复的最终构建复验

第 11.1 与 11.2.5 的修复都落在 Apply 这条路上,所以在最终代码上重新打了一次安装包
(**27,980,384 字节 = 26.68 MiB**,装后仍是 4,526 个文件 / 116.0 MiB),重装后把受影响的几条又走了一遍。
这一次在首次启动**之前**就把 `config.json` 预置成了 `127.0.0.1:9100`,全程没有再连过真台子:

```
status: RUNNING   port 3100: True
--- kill the backend, then Apply unchanged ---
FAILED: True
Apply enabled: True
RUNNING again: True
--- change the port and Apply ---
RUNNING on the new port: True
3100 released: True  3200 listening: True
launcher.json: { "version": 1, "port": 3200, "bindLan": true, "startHidden": false }
address shown: http://192.168.50.115:3200
```

最后一行就是「改端口后地址栏仍显示旧端口」那条修复的现场证据。托盘也复验了一遍:

```
tray tooltip: Running at http://192.168.50.115:3200
tray Exit: launcher gone=True backend gone=True port3200=False
```

然后卸载并再次清空残留,复查结果与第 4.9 条一致,并确认 9000 仍然只属于 Fairlight Live 本体:

```
install dir / %APPDATA% data / %LOCALAPPDATA% data / start menu / HKCU Run / uninstall key : gone
launcher processes: 0   stray node procs: 0
ports 3000/3100/3200 listening: False
port 9000 owned by : Fairlight Live
```

### 4.11 注销 / 关机(第 10 条)

**移交用户**。这条要真的注销和关机才能验,见第 13 节的验收清单。代码侧的依据:
`RunEvent::ExitRequested` 与 `RunEvent::Exit` 都走 `stop()`;即使这两个事件因为系统强制结束而没有机会跑到,
stdin 管道也会随启动器消失而断,后端照样退出——第 4.5 条就是这条路径的证据。

## 5. CI 记录

PR [#25](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/pull/25),最终提交 `dc80412`
(评审修复)之后的一轮:

| 工作流 | 结果 | run |
| --- | --- | --- |
| `ci`(ubuntu-latest,`push` 事件) | ✅ SUCCESS | [35330006888](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35330006888) |
| `ci`(ubuntu-latest,`pull_request` 事件) | ✅ SUCCESS | [35330008221](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35330008221) |
| `docker` | ✅ SUCCESS | [35330008306](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35330008306) |
| `desktop`(windows-latest) | ✅ SUCCESS,16 分 08 秒 | [35330008199](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/35330008199) |

**`ci` 在 ubuntu 上继续全绿**,这就是「`@flwc/desktop` 没有把 cargo 带进根脚本」的证明:那台 runner 上
没有 Tauri 需要的任何系统库,而 `@flwc/desktop` 的 `build` 只是 `vite build`。

`desktop` job 的步骤顺序与结果:

| 步骤 | 结果 |
| --- | --- |
| Checkout / pnpm / Node 22 / rustup / Cache cargo | ✅ |
| `pnpm install --frozen-lockfile` → `pnpm build` | ✅ |
| `node scripts/prepare.mjs --target x86_64-pc-windows-msvc` | ✅(在 cargo 之前,见偏离 ②) |
| `node scripts/smoke-staged-server.mjs` | ✅ |
| `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings` / `cargo test` | ✅ |
| `pnpm tauri build` | ✅ |
| `actions/upload-artifact`(`flwc-launcher-windows-x64`) | ✅ |
| 标签相关的两步 | 跳过(PR 上 `startsWith(github.ref, 'refs/tags/v')` 为假) |

**artifact 实装验证**:`flwc-launcher-windows-x64`,内容是
`Fairlight Live Web Controller_0.2.0_x64-setup.exe`,**27,967,097 字节 = 26.67 MiB**(与本机构建的
27,980,384 字节差几 KB,正常——两台机器的 NSIS 压缩不是逐字节可复现的)。用 `gh run download` 取回本机后
静默安装了一次:

```
installed from the CI artifact: 4,526 files, 116.0 MiB
status: RUNNING
backend pid 42764, parent 46436 = launcher 46436, MainWindowHandle 0
port 3100 listening: True
health=200  mixer page=200
connection: {"host":"127.0.0.1","port":9101,"status":"connecting", ...}
```

这一次在首启前就把 Ember 指到了 `127.0.0.1:9101`(一个**什么都没有**的端口),所以 CI 产物的这轮验证
完全没有可能碰到 9000;`connecting` + 连接超时正是预期结果。验完即卸载,残留复查与第 4.9 条一致。

一点值得记的:`gh run download` 取回的文件**没有** Mark-of-the-Web,所以这次没弹 SmartScreen。
用浏览器从 Release 下载会带上 MOTW,**那时会弹**——见第 12 节第 1 条。

**并发**:`desktop.yml` 带了 `concurrency` 组。第一轮验证时同时有三个 Windows 构建在跑,每个都是几十分钟,
而其中两个对应的提交早就被取代了;加上这一组之后,后来的提交会自动取消前一个的构建,标签构建例外
(它是发布用的那个,不能被取消)。

## 6. 数值初值清单

| 常量 | 值 | 含义 | 文件 |
| --- | --- | --- | --- |
| `NODE_VERSION` | `22.23.2` | 安装包自带的 Node 运行时版本 | `scripts/fetch-node.mjs` |
| `LOG_POLL_MS` | 200 | tail 日志文件的间隔 | `src-tauri/src/bridge.rs` |
| `HEALTH_REQUEST_TIMEOUT_MS` | 300 | 单次健康探测的超时,必须短于 `HEALTH_POLL_MS` | `src-tauri/src/bridge.rs` |
| `CREATE_NO_WINDOW` | `0x0800_0000` | Windows 上不让子进程弹控制台窗口 | `src-tauri/src/bridge.rs` |
| `HEALTH_POLL_MS` | 500 | 就绪探测间隔 | `src-tauri/src/server/mod.rs` |
| `HEALTH_TIMEOUT_MS` | 30 000 | 就绪最长等待,超时即 `HealthTimeout` | `src-tauri/src/server/mod.rs` |
| `EXIT_WAIT_MS` | 5 000 | 关 stdin 后的优雅退出宽限,与服务端 `SHUTDOWN_TIMEOUT_MS` 对齐 | `src-tauri/src/server/mod.rs` |
| `EXIT_POLL_MS` | 100 | 等待退出期间的轮询间隔 | `src-tauri/src/server/mod.rs` |
| `LOG_RING_LINES` | 500 | 内存里保留的日志行数 | `src-tauri/src/server/mod.rs` |
| `FAILURE_TAIL_LINES` | 20 | 随失败状态一起发给窗口的日志尾部行数 | `src-tauri/src/server/mod.rs` |
| `SETTINGS_VERSION` | 1 | `launcher.json` 的版本 | `src-tauri/src/settings.rs` |
| `DEFAULT_PORT` | 3000 | 与服务端默认端口一致 | `src-tauri/src/settings.rs` |
| `DEFAULT_BIND_LAN` | `true` | 默认允许局域网访问——平板要用 | `src-tauri/src/settings.rs` |
| `DEFAULT_START_HIDDEN` | `false` | 默认显示窗口 | `src-tauri/src/settings.rs` |
| `LOG_LINES` | 500 | 窗口日志缓冲上限,与 Rust 环形缓冲对齐 | `src/view-model.ts` |
| 窗口尺寸 | `560 × 440`,`resizable: false` | | `src-tauri/tauri.conf.json` |
| `version` | `0.2.0` | 与 `apps/desktop/package.json` 一致,`desktop.yml` 校验标签 | `src-tauri/tauri.conf.json` |
| `identifier` | `io.github.wuxinnnn.flwc` | 决定三个应用数据目录的位置 | `src-tauri/tauri.conf.json` |
| vite dev 端口 | 1420 | 只给 `tauri dev` 的窗口前端用 | `vite.config.ts` |

没有自行调整任何初值。

## 7. 依赖清单

**npm(全部新增在 `apps/desktop/package.json`)**

| 包 | 版本 | 许可 |
| --- | --- | --- |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT |
| `@tauri-apps/cli` | 2.11.4 | Apache-2.0 OR MIT |
| `react` / `react-dom` | ^19.2.8 | MIT |
| `@types/react` / `@types/react-dom` | ^19.2.8 / ^19.2.5 | MIT |
| `@vitejs/plugin-react` | ^6.0.1 | MIT |
| `vite` | ^8.2.2 | MIT |
| `vitest` / `@vitest/coverage-v8` | ^4.1.11 | MIT |
| `jsdom` | ^27.0.0 | MIT |
| `@testing-library/dom` / `jest-dom` / `react` | ^10.4.1 / ^7.0.1 / ^16.3.3 | MIT |
| `typescript` | ^5.9.3 | Apache-2.0 |

除 Tauri 的两个之外,全部与 `apps/web` 同版本。没有引入 `@testing-library/user-event`:`apps/web` 用的是
`fireEvent`,窗口测试跟着用同一套。也没有用任何 `@tauri-apps/plugin-*` 的 JS 端——窗口只通过 `invoke`
与 `listen` 说话,插件都在 Rust 侧用。

**crate**

| crate | 版本 | 许可 |
| --- | --- | --- |
| `tauri` | 2.11.5 | Apache-2.0 OR MIT |
| `tauri-build` | 2.6.3 | Apache-2.0 OR MIT |
| `tauri-plugin-shell` | 2.3.6 | Apache-2.0 OR MIT |
| `tauri-plugin-opener` | 2.5.5 | Apache-2.0 OR MIT |
| `tauri-plugin-autostart` | 2.5.1 | Apache-2.0 OR MIT |
| `tauri-plugin-single-instance` | 2.4.4 | Apache-2.0 OR MIT |
| `serde` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 |
| `ureq` | 3.4.2 | MIT OR Apache-2.0 |
| `if-addrs` | 0.15.0 | MIT OR BSD-3-Clause |

全部可按 MIT 使用,满足「新增依赖必须 MIT 或兼容许可」。提示词要求「把 Tauri 与插件钉到同一条 2.x 小版本
线」——官方插件各有独立的小版本线(2.5.5 / 2.5.1 / 2.4.4 / 2.3.6),字面做不到;实际口径是**全部钉精确版、
全部取 2.x 线、JS 端与 Rust 端对齐**,并且 `Cargo.lock` 入库,可复现性由它保证。

`ureq` 与 `if-addrs` 是提示词点名允许的两项(最小阻塞式 HTTP 客户端 + 取网卡地址),没有额外新增任何 crate。

## 8. 可移植性说明(给将来做 macOS 的会话)

平台相关的地方只有下面这些,每一处都已经隔离:

| 位置 | 平台相关的原因 | 怎么隔离的 |
| --- | --- | --- |
| `bridge.rs` `CREATE_NO_WINDOW` | 只有 Windows 有控制台窗口要抑制 | `#[cfg(windows)]` 包住常量与 `creation_flags` 调用 |
| `bridge.rs` `simplified()` | 只有 Windows 有 `\\?\` verbatim 路径 | 不做 `#[cfg]`:其它平台的路径不会以它开头,天然是 no-op;有单测锁住三种输入 |
| sidecar 可执行文件名 | Windows 要 `.exe` | 完全交给 `tauri-plugin-shell` 的 `sidecar("node")`,代码里没有任何字面量 `.exe` |
| `fetch-node.mjs` 的 `TARGETS` 表 | 压缩包名、包内路径、落盘后缀三者都不同 | 一张三元组映射表,加平台就是加一行(注释里已经写好 darwin / linux 的样子) |
| `fetch-node.mjs` 的 `systemTar()` | Windows 要用 System32 的 bsdtar 才能解 zip | `process.platform !== 'win32'` 时直接用 `tar` |
| 自启动注册 | Windows 写 `HKCU\...\Run`,macOS 用 LaunchAgent | 全部交给 `tauri-plugin-autostart`;调用处只有 `enable()` / `disable()` / `is_enabled()` |
| 三个数据目录 | 各平台位置不同 | 全部走 `app_config_dir()` / `app_data_dir()` / `app_log_dir()`,没有手拼路径 |
| `bundle.targets` | `["nsis"]` | 加平台时追加对应 target |
| `desktop.yml` | runner 与 bundle 路径 | `strategy.matrix` 已经是列表,追加一项即可 |

代码里**没有**写死任何 Windows 路径或注册表项。

## 9. 关于真实设备的说明

- 自动化测试全部基于 Mock,没有一条连过真实设备。
- 本机验证期间,启动器起的后端在**首次启动**时按用户明确同意连上了 `127.0.0.1:9000`(真实 Fairlight Live
  应用),用于验证首启行为;**只读,没有发送任何控制命令,没有改动任何通道或推子**。随后立刻改到 mock。
- 端口 3000 / 5173 全程没有被占用、重启或杀掉;启动器的试跑一律用 3100。
- 9000 除上述首启的只读连接外没有任何操作。

## 10. 交付物清单

**新增 —— `apps/desktop`(`@flwc/desktop`)**

| 文件 | 作用 |
| --- | --- |
| `package.json` / `tsconfig.json` / `vite.config.ts` / `vitest.config.ts` / `vitest.setup.ts` | 包与工具链,版本与 `apps/web` 对齐 |
| `index.html` / `src/main.tsx` | 窗口的挂载点 |
| `src/App.tsx` | 一页 UI:状态、地址、Server、Startup、按钮行、日志 |
| `src/view-model.ts` | 窗口的全部判断:文案、按钮可用性、端口校验、日志裁剪 |
| `src/launcher-api.ts` / `src/tauri-api.ts` | 可注入的接口与真实 Tauri 适配器 |
| `src/styles.css` | 深色配色,token 从 `apps/web/src/styles.css` 抄值并注明来源 |
| `src/view-model.test.ts` / `src/App.test.tsx` / `tests/fake-launcher-api.ts` | 前端测试与假实现 |
| `scripts/fetch-node.mjs` | 下载并校验 Node 运行时 |
| `scripts/stage-server.mjs` | 铺服务端与 web 产物,断言无链接 |
| `scripts/smoke-staged-server.mjs` | 铺好之后按运行期合同真起一次 |
| `scripts/prepare.mjs` | 上面两个 + `tauri icon`,是 `before*Command` 的前半段 |
| `src-tauri/Cargo.toml` / `Cargo.lock` / `build.rs` / `tauri.conf.json` / `capabilities/default.json` | Tauri 侧的配置 |
| `src-tauri/src/settings.rs` | `launcher.json` 的读写,损坏回默认,写入原子 |
| `src-tauri/src/net.rs` | 局域网地址选择(纯函数)与 URL 组装 |
| `src-tauri/src/cli.rs` | `--hidden` 与 `--port` |
| `src-tauri/src/server/{mod,state,ports,ring,tests}.rs` | 子进程状态机,不引用 `tauri` |
| `src-tauri/src/bridge.rs` | 真实实现:spawn、日志文件与 tail、健康探测、时钟、事件 |
| `src-tauri/src/tray.rs` / `commands.rs` / `lib.rs` / `main.rs` | 托盘、命令、窗口生命周期、入口 |

**新增 —— 其它**

- `.github/workflows/desktop.yml`
- `docs/reports/phase-7-2-report.md`(本文件)

**修改**

| 文件 | 改动 |
| --- | --- |
| `package.json` | 只加 `desktop:dev` / `desktop:build` 两个脚本 |
| `apps/server/package.json` | 只加 `files: ["dist"]` |
| `.gitignore` | 加 `apps/desktop/src-tauri` 下的 `binaries/` `resources/` `icons/` `target/` `gen/` |
| `eslint.config.js` / `.prettierignore` | 见偏离 ③ |
| `pnpm-lock.yaml` | 只来自 `apps/desktop/package.json` |
| `README.md` / `docs/architecture.md` / `docs/conventions.md` / `AGENTS.md` | 文档 |

**没有改动**:`apps/server/src`、`apps/web`、`packages/*`、`ci.yml`、`soak.yml`、`docker.yml`、
`docs/development-plan.md`、`docs/prompts*`、`docs/fairlight-ember.md`、其它 `docs/reports/*`。

## 11. 关键决策与偏离

### 11.1 实测中发现并修复的四个缺陷

都是本地实测发现的,不是评审提出的。

1. **强杀启动器后后端不退出**(严重):见第 3.6 节。这条如果留着,整个「不写保活代码、靠 stdin 守护」的
   设计就不成立。改成子进程直接写日志文件,stdin 成为唯一管道。
2. **Tauri 的 `resolve()` 返回 verbatim 路径**(`\\?\F:\...`)。Node 把它当 UNC 共享解析,去 stat `F:`,
   于是后端连启动都启动不了(`EISDIR: illegal operation on a directory, lstat 'F:'`)。加了 `simplified()`
   把驱动器路径的前缀剥掉,真正的 `\\?\UNC\...` 保持不动,三条单测锁住。
3. **FAILED 之后 `Apply` 点了没反应**:窗口侧 `Apply` 只在设置有变化时可用,Rust 侧又在「端口与绑定都没变」
   时直接返回不重启。两边合起来的结果是后端死掉之后没有任何办法把它拉起来。现在:窗口在后端不运行时
   也提供 `Apply`,Rust 在「有东西变了 **或** 没有后端可留着不动」时重启。
4. **改端口后地址栏仍显示旧端口**:快照只在挂载时读过一次,改完端口窗口还在宣传一个已经没人监听的端口。
   现在 apply 之后重读一次 launcher state。

### 11.2 对提示词的偏离

| # | 偏离 | 原因 |
| --- | --- | --- |
| ① | `bundle.resources` 用对象 map 而不是 `["resources/**"]` | 提示词的写法会让 `cargo build` 直接失败(Tauri 明说 `dir/**` 匹配不到文件就抛错),而且落点会多一层 `resources/`,不合第 2 节的路径约定;map 形式下 glob 源还会拍平子树 |
| ② | `desktop.yml` 在 cargo 三步之前插 `prepare.mjs` | 否则 `build.rs` 的 `copy_binaries` / `copy_resources` 找不到文件,`clippy` 与 `test` 先挂 |
| ③ | 改了 `eslint.config.js` 与 `.prettierignore` | 两者都不在提示词的可改清单里。前者把 React 规则块的 glob 从 `apps/web/**` 扩到也含 `apps/desktop/**`(不改的话窗口前端拿不到 react-hooks 规则和 browser globals);后者与 eslint 的 ignore 一起把 `apps/desktop/src-tauri` 排除掉——那底下是 Rust 与 `prepare.mjs` 生成的内容,铺进去的 web 产物会让 lint 去检查压缩后的 JS。**已获用户同意** |
| ④ | 新增 `scripts/smoke-staged-server.mjs` | 提示词没有要求;用来拦「链接被 Tauri 静默跳过」这个代价最大的坑,顺带在构建期锁住 stdin 守护 |
| ⑤ | capability 不给窗口开 shell 的 sidecar 权限 | ACL 只管 webview 发起的 IPC,sidecar 是 Rust 侧起的,窗口不 spawn 任何东西 |
| ⑥ | 用 `sidecar()` **构造**命令,再转成 `std::process::Command` 自己 spawn | `tauri-plugin-shell` 2.3.6 的 `CommandChild` 只有 `write` / `kill(self)` / `pid`,`stdin_writer` 是私有字段且没有 `Drop` impl:**没法在不丢掉 child 句柄的前提下单独关 stdin**。要实现「关 stdin → 等 5 s → kill」只能 drop 之后按 pid 杀,那会引入 PID 复用竞态和平台专属的杀进程代码——正是硬性约束要避免的。折中是借它的 sidecar 路径解析、`.exe` 后缀与 `CREATE_NO_WINDOW`,再用公开的 `impl From<Command> for StdCommand` 拿回 std 句柄 |
| ⑦ | stdout / stderr 落文件,不走管道 | 见第 3.6 节。提示词第 2 节写的是「stdout / stderr 逐行读」,实测那条路会让强杀后的后端永不退出 |
| ⑧ | 日志事件没有 stdout / stderr 的区分 | 输出现在是一个文件、一条流;窗口本来也没有用它区分任何东西,留一个名不副实的字段不如去掉 |
| ⑨ | Tauri 插件做不到「同一条 2.x 小版本线」 | 官方插件各有独立小版本线;改为全部钉精确版、JS 与 Rust 对齐,`Cargo.lock` 入库 |
| ⑩ | `stage-server.mjs` 会保存并还原仓库根的 pnpm workspace 状态文件 | `pnpm deploy` 会把一次 filtered + production 安装记到根上,留着不管会让开发者下一条 `pnpm exec` 被提示清空 `node_modules` 重装。见第 3.3 节 |

### 11.2.5 评审后的修订(Cursor Bugbot)

Bugbot 一共报了 4 条,全部成立、全部修掉,并在各自线程里回复。前 3 条在 `6baeef4` 上报出:

| # | Finding | 判断 | 改法与回归锁 |
| --- | --- | --- | --- |
| 1 | **Apply does not restart a failed backend**(High,`commands.rs`) | **成立**,而且是同一个问题——本机实测已经先一步发现并在 `969797c` 修掉了 | `should_restart(previous, next, server)`:设置变了**或**没有后端可留着不动就重启。四条单测覆盖「端口变」「绑定变」「都没变且健康」「都没变但已死」。窗口侧配套:一次不重启的 apply 不会有状态事件,所以改成用刷新回来的已落定状态来结束等待 |
| 2 | **Startup can miss the running state**(Medium,`App.tsx`) | **成立**。事件处理器往一个还不存在的 snapshot 里合并,于是在 `launcher_state` 还在路上时到达的状态事件被丢掉。后端在几百毫秒内就绪是这里的常态而不是罕见情况,丢掉它会让窗口停在 STARTING 而台子其实已经起来了 | 服务器状态挪出 snapshot 单独存,snapshot 只在没有事件先到时提供它(`setServer((current) => current ?? loaded.server)`)。回归锁:一条把 `launcher_state` 挂起、期间发 Running 事件的用例——**对旧代码是红的**(已验证) |
| 3 | **Settings update before disk save**(Medium,`commands.rs`) | **成立**。先写内存后写盘,写盘失败就会让内存与 `launcher.json` 不一致;而 `should_restart` 拿 previous 比对,于是下一次 Apply 会以为端口已经生效而跳过重启 | 顺序调成先 `settings::save` 再换内存 |

第 2、3 条在 `dc80412`。

Bugbot 在 `dc80412` 上又报了第 4 条,而且是上面第 1 条的修复带出来的:

| # | Finding | 判断 | 改法与回归锁 |
| --- | --- | --- | --- |
| 4 | **Start hidden restarts a dead backend**(Medium,`commands.rs`) | **成立**。`should_restart` 把「后端没在跑」一律当成要重启,于是勾一下 `Start hidden in the tray` 也会把一个已经死掉的后端拉起来——而窗口用的是不显示 `Restarting…`、不清日志的那条路径,用户看不到发生了什么 | `Start hidden` 本来就不是后端设置,它只在启动时读一次。给它一个自己的命令 `set_start_hidden`:只存盘,永远不重启。`apply_settings` 因此只剩 Apply 一个入口,`should_restart` 的语义也回到了它该有的样子。两条回归锁:一条断言勾选走的是 `setStartHidden` 而不是 `applySettings`,一条断言后端处于 FAILED 时勾它不会把后端拉回来 |

这一条在 `f325f55`。

### 11.3 明确评估过并否决的

- **用 esbuild 把服务端打成单文件**:文件数能从 4500 降到个位数,但 `pino` 走 `thread-stream` + worker、
  `emberplus-connection` 有动态 require,打包后极易在运行期炸;而且 esbuild 不在提示词允许的依赖清单里。
- **`tauri-plugin-shell` 的 `CommandChild` + 按 pid 杀**:见偏离 ⑥。
- **对 `pnpm deploy` 的产物做「跟随链接复制」**:pnpm 的 `.pnpm` 目录在 peer 依赖下存在环,
  `fs.cp({ dereference: true })` 没有环检测,会无限递归。

### 11.4 其它值得记下的判断

- **`--port` 覆盖不单独保存**:它只改内存里的设置;如果之后点了 `Apply`,这个端口就会被写进
  `launcher.json`。这是开发用的旗标,README 的开发一节写明了。
- **`launcher.json` 要到第一次 `Apply` 才落盘**。缺失时读到的就是默认值,没有必要为了让文件存在而写盘。
- **`tauri dev` 下启动器自己带一个控制台窗口**:`windows_subsystem = "windows"` 只对 release 生效。
  这是预期行为,不是缺陷;安装后的程序没有,它起的后端也没有。
- **后端会有一个 `conhost.exe` 子进程,但它没有窗口**。`CREATE_NO_WINDOW` 的语义就是「分配控制台但不建
  窗口」,实测那个 conhost 的 `MainWindowHandle` 为 0、无标题,屏幕上什么都不会闪。

## 12. 遗留问题与移交事项

1. **安装包没有代码签名**(提示词明确不做)。后果是实际会遇到的:在没见过这个文件的机器上,Windows
   SmartScreen 会弹「Windows 已保护你的电脑」,要点「更多信息 → 仍要运行」才能装。本机因为文件是本地
   构建的没有弹,**从 Release 下载之后大概率会弹**。要去掉只能买证书签名,那是另一个批次的事。
2. **注销 / 关机 / 断电的行为没有实测**,标注移交(第 13 节 ② ③)。代码路径与证据见第 4.10 条。
3. **标签 → Release 这条路合并前没法真跑**。`desktop.yml` 的标签分支只在 `refs/tags/v*` 上生效,PR 上
   跑不到。版本校验的逻辑本身很短,但没有被执行过一次。移交(第 13 节 ④)。
4. **macOS / Linux 没有构建、没有验证**。代码保持可移植(第 8 节),`fetch-node.mjs` 的三元组表和
   `desktop.yml` 的矩阵都留了位置,但一行都没有填,也没有在任何非 Windows 机器上编译过。
5. **卸载程序不删应用数据目录**。静默卸载(`/S`)下 NSIS 不会问;交互式卸载时 Tauri 的模板会问一句。
   如果希望「卸载即清空配置」,那要改 NSIS 模板,本批次没做。
6. **`--port` 会被 Apply 固化**。它只覆盖内存里的设置,但用户随后点 Apply 就会写进 `launcher.json`。
   这是开发用的旗标,README 写明了,不打算再加一层区分。
7. **窗口日志面板的横向滚动**。pino 的单行 JSON 很长,560px 宽的窗口里要横向拖。没有换行是有意的
   (换行会让一条日志占满整个面板),但如果实际用起来嫌难读,值得在后续批次里考虑做一个精简显示。
8. **GHCR 包的可见性**是 7.1 的遗留项,与本批次无关,顺带列在第 13 节 ④。

## 13. 真机验收操作清单(移交用户)

**安全约束**(照抄 6.4 报告第 6 节):本批次改的是交付方式与进程生命周期,**不会改动 Fairlight 的任何参数**;
验收过程中不要操作混音页推子;如确需操作,**只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子
并测后复原**;不得切 ON/mute、不得动其它通道、不得删改任何通道。凡是要按 ON 的地方**一律不要真的按**。

> 本机验收期间启动器曾把 `%APPDATA%\io.github.wuxinnnn.flwc` 整个删掉了,所以你装上之后是**全新的
> `config.json`**:它会按种子连 `127.0.0.1:9000`,也就是这台机器上的 Fairlight Live 本体。第 ① 组第 4 步
> 就是让你先把它指到正确的地方。

### ① 安装、连真台子

前提:从 PR #25 的 artifact(`flwc-launcher-windows-x64`)或合并后 Release 里的
`Fairlight Live Web Controller_0.2.0_x64-setup.exe` 下载安装包。

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 双击安装包 | 不要管理员权限就装完;装到 `%LOCALAPPDATA%\Fairlight Live Web Controller`;约 116 MiB |
| 2 | 从开始菜单启动 | **没有任何控制台窗口闪过**;托盘出现琥珀色推子图标;窗口显示 `STARTING` 然后 `RUNNING`,旁边是 `http://<本机局域网 IP>:3000` |
| 3 | 首次启动时 Windows 弹「允许 Node.js 访问网络」 | 勾**专用网络**并允许。不允许的话平板连不上 |
| 4 | 点 `Copy`,在平板浏览器里打开那个地址 | 混音页出现;**先到 CONNECTION 面板把 Ember 地址确认/改成真实 Fairlight Live 的地址与端口**,页头变 `MIXER ONLINE` |
| 5 | 看四个允许通道 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry | 通道名、电平表、推子位置与台子一致 |
| 6 | 如需验证控制链路:只动这四个推子,小幅推一下 | 台子跟随;**测完把电平复原到验收前的值** |
| 7 | 关闭窗口的 X | 窗口消失,托盘图标还在,平板上的混音页**不受影响** |
| 8 | 托盘图标右键 → `Show window` | 窗口回来 |
| 9 | 再从开始菜单点一次 | **不会出现第二个实例**,原窗口被调到前台 |

### ② 开机自启与隐藏启动

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 勾上 `Start with Windows` 与 `Start hidden in the tray` | 两个都打勾 |
| 2 | 注销当前用户,再登录回来 | 启动器自己起来了,**只有托盘图标,没有窗口**;平板上的混音页重连后恢复 |
| 3 | 从托盘 `Show window` | 窗口出现,状态 `RUNNING` |
| 4 | 验完之后去掉 `Start with Windows` 的勾 | 下次登录不再自启 |

### ③ 关机再开机

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 托盘 `Exit`,然后直接关机 | — |
| 2 | 开机后打开任务管理器 | **没有残留的 `node.exe`**,端口 3000 没被占 |
| 3 | 再狠一点:启动器正在跑的时候直接按电源键断电,重新开机 | 同上,没有残留。后端的进程边界是启动器持有的 stdin 管道,启动器以任何方式消失它都会跟着走 |

### ④ 合并后打标签

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 合并 PR 后在 `main` 上打 `v0.2.0` 并推送 | `docker.yml` 与 `desktop.yml` 都被触发 |
| 2 | 看 Release `v0.2.0` | 上面**同时**有 `flwc-v0.2.0-linux-amd64.tar.gz`(镜像包)与 `Fairlight Live Web Controller_0.2.0_x64-setup.exe`(安装包)。两个工作流共用这一个 Release,谁先跑完谁建 |
| 3 | 如果标签与 `tauri.conf.json` 的 `version` 不一致 | `desktop.yml` 会在 `Check the tag against tauri.conf.json` 这一步红掉。这是有意的 |
| 4 | 顺带确认 GHCR 包是 public | 7.1 的遗留项 |

**这四组里只有第 ① 组第 4–6 步会碰到真实 Fairlight,而且只是连接与那四个推子。其余全部与台子无关。**

## 14. 提交记录

分支 `claude/phase-7-2-launcher`,PR [#25](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/pull/25)。

| 提交 | 说明 |
| --- | --- |
| `cce76db` | chore: scaffold the desktop launcher package |
| `0562880` | build: fetch the node runtime and stage the server for the bundle |
| `a33122b` | feat: supervise the backend process from the launcher |
| `b5969d6` | feat: add the tray icon, the window lifecycle and the commands |
| `82d2a18` | feat: add the launcher window |
| `6e96a60` | fix: give the backend a log file instead of pipes so it can die with us |
| `59e6b93` | ci: build the Windows installer in a workflow of its own |
| `9744bfa` | docs: document the desktop launcher |
| `6baeef4` | fix: let Apply bring a failed backend back, and keep the address honest |
| `969797c` | fix: Apply has to restart a backend that is not running |
| _(待补)_ | 报告与评审后的修订 |

