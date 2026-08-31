# Phase 3 执行报告 — 后端核心

## 1. 结果总览

Phase 3 已在云端完成：`EmberService`、`TreeMapper`、`MixerStateStore`、`MeterHub`、socket.io 网关、REST 连接配置与 `data/config.json` 原子持久化、pino 结构化日志均已落地。集成测试一律使用 Mock Ember+ Provider，未连接真实 Fairlight。云端串行 lint → typecheck → test → build 全绿，覆盖率达标。真机手动验收**移交用户**。

另：已将「PR 标题与正文用英文」写入 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/project.mdc`、`docs/conventions.md` 与 `docs/prompts.md` 通用前缀。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| Mock Provider 集成测试覆盖连接生命周期、断线重连、树变化、控制往返、非法命令、配置损坏/缺失 | 通过 | `apps/server/tests/mixer.integration.test.ts` + 同目录单元测试。`pnpm --filter @flwc/server test`：21 files / 85 tests passed。覆盖连接、PUT 到不可达端口后的 `reconnecting`、第二份 Mock 树触发通道增补、set-level/set-on/reset 往返、越界/未知 id 拒绝、并发写入、缺失/损坏配置回退（`ConfigStore` 单测）。 |
| 对本地真实 Fairlight 手动验收 | **移交用户** | 见第 4 节操作清单。云端无法访问真机。 |
| 覆盖率达标 | 通过 | `apps/server` 语句 93.5%、分支 83.84%、函数 96.7%、行 93.57%（门槛 80%）。`packages/shared` 语句/行/分支/函数 100%（门槛 90%）。 |
| 全量质量门与远端 CI | 云端全绿；远端 CI 以推送后 GitHub Actions 为准 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 串行通过。未改 `.github/workflows/ci.yml`。 |

云端串行命令结果：

```
pnpm lint        # eslint . && prettier --check .  通过
pnpm typecheck   # shared / test-utils / web / server tsc --noEmit 通过
pnpm test        # shared 24 + test-utils 19 + web 3 + server 85
pnpm build       # shared / test-utils / web / server 通过
```

`apps/server` 覆盖率摘要：

```
Statements   : 93.5% ( 662/708 )
Branches     : 83.84% ( 384/458 )
Functions    : 96.7% ( 176/182 )
Lines        : 93.57% ( 655/700 )
```

## 3. 模块实现摘要

- **EmberService**：指数退避重连（默认 1s → 封顶 30s，连上重置）；`connect` / `getDirectory` / 写入走 `withTimeout`；`disconnect` 2s 超时后 `discard()`；展开复用 `expandEmberTree` 并跳过 `sends`，单点失败只记协议日志；写入串行队列。host/port 只来自配置。
- **TreeMapper**：按 identifier 模式识别 `channel|main|sub|aux|mixm|mtx` 根与 `${kind}N` 实例；逻辑 id 为 `${kind}/${n}`（如 `channel/3`）；缺 level/mute/name 的条带跳过；meter 可缺，默认 -60；`sync()` 做 added/updated/removed diff。当前 dump 无 `sub`/`mixm`/`mtx` 时不报错，手造 `sub` 根可识别。
- **MixerStateStore**：通道/响度/连接状态；结构变化发 snapshot，值变化发 patch；meter/响度高频更新静默写入，供下次 snapshot 使用。
- **MeterHub**：50ms `setInterval` 聚合后成帧；gateway 用 volatile emit。
- **网关**：连接时下发 snapshot；`control:set-on` 翻转为 `muted = !on`；非法命令 ack `{ ok:false, error }`，不崩溃。
- **REST / 持久化**：`GET/PUT /api/v1/connection`、`GET /api/v1/health`；`config.json` zod + 临时文件 rename；缺失/损坏回退默认并告警。`views` 仅在 schema 中保留。
- **与 architecture.md 的差异**：控制写入在 Ember `setValue` 成功后同步更新 Store（Mock/部分 Provider 不会把同连接的写入再 echo 给 subscribe）。Mock `close()` 不一定触发 `EmberClient` 的 `disconnected`；真断线路径由 FakeClient 单测覆盖，集成测试用 PUT 到未监听端口验证 `reconnecting`。

## 4. 真机验收操作清单（移交用户）

开发机只允许改 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的推子。禁止 mute、禁止其它通道、禁止删改通道。测完必须复原。

1. 确认 Fairlight Live 已开 Ember+，记下 host/port（常见 `127.0.0.1:9000`）。
2. 仓库根目录：`pnpm install`（如需要）、`pnpm --filter @flwc/shared build`、`pnpm --filter @flwc/server build`。
3. 启动后端（不要用自动化测试连真机）：
   - `pnpm --filter @flwc/server start`（监听 `127.0.0.1:3000`），或 `pnpm dev`。
4. 配置连接：
   ```
   curl -s http://127.0.0.1:3000/api/v1/health
   curl -s -X PUT http://127.0.0.1:3000/api/v1/connection \
     -H 'content-type: application/json' \
     -d '{"host":"127.0.0.1","port":9000}'
   curl -s http://127.0.0.1:3000/api/v1/connection
   ```
   预期：health `{ "status":"ok" }`；PUT/GET 的 `status` 在树展开后变为 `connected`。
5. 用 socket.io 客户端连 `http://127.0.0.1:3000`，监听 `mixer:snapshot`。预期能读到全部输入/main/aux 通道名称与 `system/loudness` 读数（本 show 无 sub/mixm/mtx 属正常）。
6. 只对允许通道之一发 `control:set-level`（例如 Anagram-Dry，先读当前值，+1 dB 后立刻写回原值）。预期 ack `{ ok:true }`，随后 `mixer:patch` 与台上推子一致。
7. 不要测 mute / 其它通道。`control:reset-loudness` 会复位响度，仅在你明确接受响度归零时使用。
8. 预期失败：越界 level（如 99）或未知 id 应 ack `VALIDATION` / `NOT_FOUND`，进程仍在。

## 5. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `packages/shared/src/channel.ts` 等 | 通道模型、socket 事件、ack、config/connection 契约 |
| `apps/server/src/ember/ember-service.ts` | Ember 连接生命周期、订阅、写入、invoke |
| `apps/server/src/ember/tree-mapper.ts` | 运行时树发现与逻辑 id 映射 |
| `apps/server/src/state/mixer-state-store.ts` | 规范化混音状态 |
| `apps/server/src/state/meter-hub.ts` | 50ms 电平/响度成帧 |
| `apps/server/src/config/config-store.ts` | `data/config.json` 原子读写 |
| `apps/server/src/api/connection.ts` | GET/PUT `/api/v1/connection` |
| `apps/server/src/ws/gateway.ts` | socket.io 快照/增量/控制 |
| `apps/server/src/runtime.ts` | 模块装配与控制协调 |
| `apps/server/tests/mixer.integration.test.ts` | Mock Provider 端到端验收 |
| `docs/reports/phase-3-report.md` | 本报告 |

## 6. 依赖清单与许可确认

引入前 `npm view <pkg> license`：

| 包 | 版本 | 许可证 | 位置 |
| --- | --- | --- | --- |
| `pino` | 10.3.1 | MIT | `@flwc/server` |
| `socket.io` | 4.8.1 | MIT | `@flwc/server` |
| `socket.io-client` | 4.8.1 | MIT | `@flwc/server` devDependency（集成测试） |

未新增其它运行时依赖。`emberplus-connection@0.3.1` 仍为 MIT（Phase 2 已确认）。

## 7. 关键决策与偏离

- 覆盖率排除：`dump-tree.ts`、`verify-ember.ts`（原有 CLI）、`tree-helpers.ts` / `fake-ember-client.ts`（仅测试夹具）、`main.ts`（进程入口）。门槛未降低。
- 控制写入成功后本地更新 Store，避免依赖 Provider 对同连接 subscribe 的 echo。
- Mock Provider `close()` 不能稳定触发客户端 `disconnected`；断线检测单测用 FakeClient，集成用 PUT 到空端口。
- 无偏离架构事件名、逻辑通道模型与 REST 路径。不实现 views API（Phase 5）。
- 未改 CI 流水线结构。

## 8. 遗留问题与移交事项

- 本 dump 仍无 `sub` / `mixm` / `mtx` 根。TreeMapper 已按模式编写，其它 show 需真机再确认实例 identifier 是否同为 `${kind}N`。
- Ember 参数仍无单位字段；dB / LUFS / dBTP 仍是约定。
- 建议用户真机验收后，若发现总线 identifier 与模式不符，回写 `docs/fairlight-ember.md`（本次未改该文档）。
- 用户需完成本地真机验收（第 4 节）并确认远端 GitHub Actions 全绿。

## 9. 提交记录

分支：`cursor/phase-3-backend-491d`

```
a8ca66c docs: add Phase 3 execution report
7dd3a36 test(server): cover mixer lifecycle and control round-trips
58d9a78 feat(server): add EmberService, TreeMapper, and mixer backend
366d1df feat(shared): add mixer, control, and config contracts
e3aac23 docs: require English PR title and body
```
