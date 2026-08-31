# Phase 2 执行报告 — Ember+ 树发现

## 1. 结果总览

Phase 2 已在本机完成：dump 脚本、真机完整树存档、`docs/fairlight-ember.md` 回写、基于 dump 的 Mock Ember+ Provider 与集成测试、对允许通道 Anagram-Dry 的推子写入/复原均已落地。本机串行 lint → typecheck → test → build 全绿。本 dump 的 show 没有 `sub` / `mixm` / `mtx` 根节点，已如实记录，不猜测。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| dump 覆盖全部所需节点 | 通过（存在的类型）/ 移交（缺失总线类型） | 完整 dump `docs/tree-dumps/fairlight-live-2026-08-31.json`（196316 字节）。`channel`（9）、`main`（1）、`aux`（10）均有 level/mute/name/meter；`system/loudness` 有 integrated、true-peak、reset。本 show **无** `sub` / `mixm` / `mtx` 根。6 个 `sends/aux` getDirectory 超时，不影响所需节点。 |
| 所用节点的类型、范围、单位已写入文档 | 通过 | 已回写 `docs/fairlight-ember.md`。Ember 元数据无 `format`；单位按约定/先前 Viewer 记录为 dB / LUFS / dBTP。 |
| Mock Provider 能被客户端连接、订阅、写入 | 通过 | `packages/test-utils` 19 tests passed。集成测试覆盖 expand、`pushParameter` 订阅、`setValue`、`invoke(reset)`、以及从入库 dump 读取 BASS/main/aux/loudness。 |
| 实测未改动不允许的通道、未删改通道 | 通过 | 仅写 `channel/channel5/level`（Anagram-Dry）-100 → -99 → -100。只读复读确认仍为 -100。未写 mute，未碰其它通道。 |
| Phase 1 质量门仍全绿 | 通过 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 串行全绿。覆盖率：shared 100%（门槛 90%）；test-utils 语句/行 94.02%、分支 91.58%、函数 100%（门槛 90%）；server 语句 92.3%、分支 87.43%、函数 100%、行 92.15%（门槛 80%）；web 100%（门槛 80%）。 |

本机串行命令结果：

```
pnpm lint        # eslint . && prettier --check .  通过
pnpm typecheck   # 四个包 tsc --noEmit 通过
pnpm test        # shared 3 + test-utils 19 + web 3 + server 35
pnpm build       # shared / test-utils / web / server 通过
```

## 3. 真机操作记录

连接：`127.0.0.1:9000`（用户确认本机 Ember+）。

### 订阅验证（只读）

命令：`pnpm --filter @flwc/server verify-ember -- --host 127.0.0.1 --port 9000 --timeout-ms 8000 --subscribe-ms 8000`

| 路径 | 样本数 | 平均间隔 | 样例值 |
| --- | --- | --- | --- |
| `system/loudness/integrated` | 8 | 1007.4 ms | -26, -26, -26, -26, -26 |
| `channel/channel1/meter` | 89 | 84.7 ms | -56.1, -57, -56.3, -60, -59 |

### 写入验证

用户确认后执行：通道 **Anagram-Dry**，`channel/channel5/level`（number path `1.5.1`），+1 dB 后复原。

| 步骤 | 值 | 时间 (UTC) |
| --- | --- | --- |
| 原值 | -100 | 2026-08-31T14:18:41.489Z |
| 写入并读回 | -99 | 2026-08-31T14:18:41.490Z |
| 复原并读回 | -100 | 2026-08-31T14:18:41.490Z |

之后只读再展开确认 `Anagram-Dry` level 仍为 **-100**（min -100，max 10）。

**声明：未触碰任何其它通道或参数（包括四个允许通道的 mute）。未删改任何通道。**

## 4. 树结构发现摘要

- 根：`system`(number **0**)、`channel`、`main`、`aux`、`monitor`、`talkback`、`afv`、`cueplayer`
- 输入：`channel/channelN/{level,mute,name,meter}`，实例 channel1–9
- Main：`main/main1/{level,mute,name,meter}`
- Aux：`aux/auxN/{level,mute,name,meter}`，aux1–10
- 响度：`system/loudness/{reset,integrated,true-peak}`
- 推子 REAL -100…10 READ_WRITE；meter REAL -60…0 READ；integrated REAL -100…18 READ；true-peak REAL -60…0 READ
- 与预期不符（已写入踩坑）：根索引从 0 起；无 format/单位；部分 `sends/aux` getDirectory 挂起；本 show 无 sub/mixm/mtx；`disconnect` 常因 ECONNRESET 挂起

## 5. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `apps/server/src/tools/dump-tree.ts` | 真机树 dump CLI（覆盖率排除） |
| `apps/server/src/tools/verify-ember.ts` | 真机订阅/允许名单写入 CLI（覆盖率排除） |
| `apps/server/src/tools/*.ts` | 序列化、容错展开、CLI 解析、允许通道、树查找 |
| `docs/tree-dumps/fairlight-live-2026-08-31.json` | 完整真机 dump |
| `docs/fairlight-ember.md` | 实测路径/类型/范围回写与踩坑 |
| `packages/test-utils/src/mock-ember-provider.ts` | Mock Ember+ Provider |
| `packages/test-utils/src/dump-to-ember-tree.ts` | dump JSON → EmberServer 树 |
| `packages/test-utils/tests/mock-ember-provider.integration.test.ts` | 真实 EmberClient 连 Mock 的验收测试 |
| `docs/reports/phase-2-report.md` | 本报告 |

## 6. 依赖清单与许可确认

引入前 `npm view emberplus-connection license` = **MIT**，版本 **0.3.1**。

| 包 | 版本 | 许可证 | 位置 |
| --- | --- | --- | --- |
| `emberplus-connection` | 0.3.1 | MIT | `@flwc/server`、`@flwc/test-utils` |
| `@types/node` | ^22.20.1 | MIT | `@flwc/test-utils` devDependency（server 已有） |

传递依赖（`emberplus-connection`）：`debug` MIT、`eventemitter3` MIT、`long` MIT、`smart-buffer` MIT、`tslib` 0BSD（MIT 兼容）、`asn1` 来自 git `evs-broadcast/node-asn1`（Joyent/asn1 系 MIT）。pnpm 11 默认拦截 exotic 传递依赖，已在 `pnpm-workspace.yaml` 设 `blockExoticSubdeps: false` 以便安装官方 Sofie 包。

## 7. 关键决策与偏离

- 覆盖率排除：`apps/server/src/tools/dump-tree.ts`、`verify-ember.ts`（仅连接/CLI）。门槛未降低。
- 展开跳过 identifier `sends`（verify）；dump 仍尝试展开，失败记错后继续。
- disconnect 2s 超时后 `discard()`，避免 ECONNRESET 挂死进程。
- Mock 禁止绑定 9000；测试用 `127.0.0.1` 临时端口。
- 完整 dump 仅 196KB，未另存精简版。
- `docs/prompts/phase-2.md` 不纳入本阶段交付。

## 8. 遗留问题与移交事项

- 本 show 无 sub/mixm/mtx：其它配置需运行时再发现。
- Ember 参数无单位字段：dB/LUFS/dBTP 仍是约定，不是树元数据。
- 若干 `sends/aux` 无法展开：总线发送子树不完整，混音页不需要。
- `EmberClient.disconnect()` 在未完成请求后常挂起：工具已规避，Phase 3 EmberService 需同样处理。
- 未推送 GitHub（由用户完成）。

## 9. 提交记录

```
cf201a2 docs: add Phase 2 execution report
4b55fc3 test(test-utils): cover Mock Provider connect, subscribe, write, and invoke
eda59c4 feat(test-utils): add Mock Ember+ Provider from dump JSON
7e9aa19 docs: record confirmed Ember+ node paths from the live dump
7220792 docs: archive Fairlight Live Ember+ tree dump
887dc62 feat(server): add Ember+ tree dump and live verify tools
e9709fe chore: add emberplus-connection for Ember+ client and server
```
