# Phase 4 执行提示词 — 前端混音页 MVP

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项)
2. `docs/architecture.md` — 架构设计(本阶段的实现蓝图:前端结构、socket.io 事件契约、逻辑通道模型)
3. `docs/development-plan.md` — Phase 4 交付物与验收标准(本阶段的任务来源),以及「云端 Agent 开发边界」一节
4. `docs/conventions.md` — 目录结构、命名、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/fairlight-ember.md` — 实测确认的参数量程与单位约定(推子 -100…10 dB、电平表 -60…0 dB、integrated -100…18 LUFS、true-peak -60…0 dBTP)
6. `docs/reports/phase-3-report.md` — Phase 3 执行报告(后端模块能力、事件契约实现现状、真机实测帧率约 20 帧/s)

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。后端联调用 `packages/test-utils` 的 Mock Ember+ Provider + Phase 3 已完成的 `apps/server`;树结构参考 `docs/tree-dumps/` 与 `docs/fairlight-ember.md`。
- 验收标准中「对本地真实 Fairlight 手动验收」一条由用户本地执行,你在报告中标注**移交用户**,并给出一份可直接照做的真机验收操作清单(启动命令、页面操作步骤、预期结果、安全注意事项)。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build)全绿;不得改动 CI 流水线结构。
- 云端手动冒烟可用 `pnpm dev`(server 3000 + web 5173):web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`,`127.0.0.1:5173` 连不上);可在本地起 Mock Provider 让 server 连接,形成端到端数据流。

## 硬性约束

- 自动化测试(vitest + React Testing Library)一律基于 Mock(mock socket 或 Mock Provider),**禁止任何连接真实设备的逻辑与硬编码真机地址**。
- 代码、注释、提交信息、日志与 UI 文案用**英文**;文档与报告用**简体中文**。
- 新增依赖必须 MIT 或 MIT 兼容许可,引入前确认 `license` 字段,记入报告。本阶段原则上不需要新增运行时依赖(socket.io-client、zustand 如未安装则按架构文档引入);禁止引入 UI 组件库,推子/电平表/开关全部自绘。
- 提交遵循 Conventional Commits,按逻辑单元分多次提交;不得破坏已有的 lint / typecheck / test / build 全绿与覆盖率门槛(不许为凑覆盖率调低门槛)。
- 消息契约**只使用 `packages/shared` 的既有导出**(事件名、负载 schema、ack 类型),前端不得重新定义或绕过;若发现契约缺口或 bug,可做最小修正并在报告「关键决策与偏离」中说明。改动 `packages/shared` 后需重跑 `pnpm --filter @flwc/shared build` 其它包才能拿到新类型。
- 前端不接触任何原始 Ember 路径,只使用逻辑通道模型(`ChannelRef` / `ChannelState`,id 形如 `channel/3`)。
- 不改动 `docs/` 下与本阶段无关的文档;`docs/fairlight-ember.md` 只由用户回写,你只在报告中提出建议。

## 任务范围

按 `docs/development-plan.md` 的 Phase 4 与 `docs/architecture.md` 的前端结构实现混音页 MVP。本阶段**不做 views 配置**(Phase 5)、**不做深度视觉打磨与触屏优化**(Phase 6),但样式需简洁、贴近真实调音台直觉、少解释性文本。

### 1. socket.io 客户端与状态层(`apps/web/src/lib/`、`apps/web/src/store/`)

- socket.io-client 接入,同源连接(开发时经 Vite `/api` 之外的 socket 代理或直连 3000,生产同源);断线自动重连,重连后以新 `mixer:snapshot` 整体替换本地状态。
- zustand stores 按架构文档拆分:
  - `mixerStore`:`mixer:snapshot` 全量替换 + `mixer:patch` 增量合成(level/mute/name 变化、通道增删),连接状态(socket 连接态 + `system:status` 的 Ember 连接态);
  - `meterStore`:**独立 store**,消费 `meters:frame`(紧凑数组 `[id, meterDb][]` + 响度读数),电平表与响度读数组件直接订阅,避免高频帧触发整页重渲。
- 上行命令封装:`control:set-level` / `control:set-on` / `control:reset-loudness`,处理 ack 回执;ack 失败时回滚本地乐观值并给出不打断操作的提示。

### 2. 混音页(`apps/web/src/features/mixer/`)

- 按通道类型分区排列:`channel` / `main` / `sub` / `aux` / `mixm` / `mtx`;快照中不存在的类型不渲染空分区(当前 show 没有 sub/mixm/mtx 属正常)。
- 通道条带:名称(来自 `name`,**不显示 Ember 编号**)、推子、ON 开关、电平表。
- 通道增删(patch 携带)时平滑增删条带,不整页闪烁。

### 3. 推子组件(`apps/web/src/components/`)

- 量程 -100…+10 dB,竖向,带 dB 刻度与单位标注,主要刻度参考真实调音台(如 +10 / 0 / -10 / -20 / -40 / -60 / -100 或 -∞ 显示)。
- 交互:拖动、轨道点击跳变、键盘微调(方向键小步进、可加 PageUp/PageDown 大步进),写入值钳制到量程内。
- **拖动本地回显优先**:拖动中进入 pending 态,本地值立即渲染并按合理频率发送 `control:set-level`;拖动中收到的远端更新不覆盖本地值;松手后以 ack/远端值收敛。
- 值换算与钳制逻辑抽成纯函数(dB ↔ 推子行程的映射、步进、钳制),便于单测。

### 4. ON 开关

- Yamaha 风格 ON 按钮:`on = !muted`,仅展示层反转,状态源仍是 `muted`;点击发 `control:set-on { id, on }`。
- 乐观更新 + ack 失败回滚。

### 5. 电平表组件(`apps/web/src/components/`)

- 竖表 + 当前 dB 读数,量程 -60…0 dB,越界值钳制显示。
- 峰值保持(peak hold,保持约 1–2s 后衰减或重置)与颜色分段(如 绿 ≤ -18、黄 -18…-6、红 > -6,具体分段可微调但需在报告中说明)。
- 直接订阅 `meterStore`,渲染路径避免经过 React 全树(参考架构文档;实现方式如订阅回调内改 DOM/CSS 变量或独立小组件,由你决定并在报告说明)。

### 6. 响度区(`apps/web/src/features/loudness/`)

- integrated 读数(单位 LUFS)与 true-peak 读数(单位 dBTP),数据来自快照与 `meters:frame` 的响度字段。
- reset 按钮发 `control:reset-loudness`,处理 ack;按钮需有防误触确认(响度归零不可逆)。

### 7. 断线降级

- socket 断线或 Ember 未连接(`system:status`)时:控件禁用、显著的连接状态提示、电平表停走;恢复后以新快照自动回到正常态。

## 测试要求

- 组件单测(RTL)与被测代码同目录,集成测试放 `apps/web/tests/`;socket 层用 mock socket(如自造 EventEmitter 假件)驱动,不要求在前端测试中起真实后端。
- 必须覆盖 `docs/conventions.md` 前端边界场景清单中本阶段适用项 + Phase 4 验收标准点名场景:
  - 推子值换算与钳制(含越界写入、-100 下限、+10 上限、键盘步进);
  - 推子拖动与远端更新冲突(拖动中远端 patch 不覆盖本地值,松手后收敛);
  - ON/mute 反转逻辑(显示反转、上行负载正确、ack 失败回滚);
  - 电平表越界钳制与峰值保持;
  - WS 断线时 UI 降级(控件禁用、提示出现)与重连后快照恢复;
  - `mixer:patch` 合成(改名、通道增删)与 `meters:frame` 进入 `meterStore`。
  - (view 相关场景属 Phase 5,本阶段不做。)
- 覆盖率:`apps/web` 行/分支/函数 ≥ 80%;若改动 `packages/shared` 则其 ≥ 90% 同样必须维持。

## 明确不做的事

- 不实现 views 模型、CRUD 与配置页(Phase 5)。
- 不做暗色主题深度打磨、触屏专项优化、长时间运行性能验证(Phase 6)。
- 不改后端模块与 REST API(契约最小修正除外,须在报告说明)。
- 不改 CI 流水线结构(`.github/workflows/ci.yml`)。
- 不连接、不模拟连接真实 Fairlight;不硬编码真机地址。
- 不改动 `docs/` 下与本阶段无关的文档。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 4 验收标准,在云端实际执行并记录结果:

1. 组件单测覆盖:推子值换算与钳制、拖动与远端更新冲突、ON/mute 反转逻辑、电平表越界钳制、断线时 UI 降级 — 以测试文件与通过记录为证。
2. 对本地真实 Fairlight 手动验收 — **移交用户**,附可照做的验收操作清单。
3. 覆盖率达标 — 附 `apps/web`(及如有改动的 `packages/shared`)覆盖率数字。
4. 全量质量门:串行 lint → typecheck → test(覆盖率门槛)→ build 全绿,远端 CI 全绿;另附一次 `pnpm dev` + Mock Provider 的端到端冒烟结果(页面能显示通道、推子可动、电平表走动)。

## 执行报告要求

执行完成后,在 `docs/reports/phase-4-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对上述四条:通过/未通过/移交用户,附实际执行的命令与关键输出摘要。
3. **实现摘要** — 状态层(store 拆分、patch 合成、重连恢复)、推子(pending 态与收敛策略、发送频率)、ON 开关、电平表(峰值保持与颜色分段参数、避免整页重渲的具体做法)、响度区、断线降级各自的关键设计点,以及与 `docs/architecture.md` 不一致之处。
4. **真机验收操作清单(移交用户)** — 启动命令、页面操作步骤与预期结果(允许通道推子操作流畅、电平表与 Fairlight 软件表现一致、响度读数与软件一致、reset 生效)。**必须写明安全约束:只允许拖动 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子且测后复原;不得在真机上切 ON/mute、不得动其它通道;reset 响度仅在用户明确接受归零时执行。**
5. **交付物清单** — 新增/修改的主要源码与测试文件路径及一句话用途。
6. **依赖清单与许可确认** — 新增 npm 依赖的名称、版本、许可证;无则写明。
7. **关键决策与偏离** — 与计划/规范/架构文档不一致的地方及理由(含覆盖率排除项);没有则明确写"无偏离"。
8. **遗留问题与移交事项** — 契约缺口、建议回写文档的条目、留给 Phase 5/6 的事项、需要用户完成的步骤。
9. **提交记录** — 本阶段新增提交的 `git log --oneline` 输出与分支名。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿。
- `pnpm dev` + Mock Provider 端到端冒烟通过。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-4-report.md` 已产出,真机验收清单可直接交用户执行。
