# Phase 5 执行报告 — Views 配置

## 1. 结果总览

Phase 5 云端范围已全部完成。共享层新增向后兼容的 View 通道颜色与 REST 契约;后端提供持久化 views CRUD;前端新增与 Phase 4 同一工业深色视觉系统的配置工作台、View 切换、顺序投影、颜色覆盖与失配占位。自动化测试、覆盖率、全量质量门、远端 CI 以及 Mock Ember+ Provider 浏览器端到端冒烟均通过。云端未连接真实 Fairlight,真机手动验收按边界移交用户。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| views CRUD 与持久化 | 通过 | `apps/server/src/api/views.test.ts` 覆盖创建、列表、更新、删除、服务端 UUID、404、非法名称/颜色/结构 400、并发创建、持久化往返、旧数据兼容及损坏/缺失配置恢复。 |
| 颜色配置与默认回退 | 通过 | shared 校验六个 palette key 且 `color` 可选;web 单元与集成测试覆盖六类默认色、自定义覆盖、清除回退和非法 key 拒绝。 |
| 失配、树变化与主动清理 | 通过 | web 集成测试覆盖引用缺失后的 `lastKnownName` 占位、正常通道继续可控、patch 移除后延迟切换为占位、二次确认清理只移除失效引用并保持有效顺序;首个已连接快照到达前保持等待态且禁止清理,避免把尚未加载的树误判为全量失配。 |
| 空 View、空配置、激活态与排序 | 通过 | 零 View 时 `All Channels` 正常显示;零通道 View 显示独立空态;激活 id 写入 `localStorage`,无效或已删除 id 回退全部通道;View 模式严格按持久化引用顺序平铺。 |
| 覆盖率达标 | 通过 | `packages/shared`:语句/分支/函数/行 100%;`apps/server`:语句 93.57%、分支 83.68%、函数 97.01%、行 93.60%;`apps/web`:语句 95.14%、分支 89.34%、函数 97.24%、行 94.85%。 |
| 全量质量门 | 通过 | 串行执行 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿。shared 26、test-utils 19、server 92、web 76,共 213 项测试通过;Vite 生产构建成功。 |
| Mock Provider 端到端冒烟 | 通过 | Mock Provider 安全运行于 `127.0.0.1:9100`,`GET /api/v1/connection` 返回 `connected`;浏览器完成 Recovery Test 失配占位与二次确认清理、创建 Broadcast Desk、勾选 BASS/MIC-REVERB、排序、配色、改名 Live Desk、保存并返回主页切换。最终仅按 BASS/MIC-REVERB 顺序显示红/青条带。全过程未触碰 ON 或推子。证据:`/opt/cursor/artifacts/phase5_views_configuration_walkthrough.mp4`。 |
| 远端 CI | 通过 | 功能提交 `74f63eb` 对应 PR checks 共 2 项均成功;最终报告提交继续使用同一流水线确认。 |
| 本地真实 Fairlight 手动验收 | 移交用户 | 云端无真机访问能力。操作清单见第 4 节。 |

首次加入配置页后,web 覆盖率曾为行 78.45%/分支 67.78%,随后补齐真实用户流程集成测试达到上述最终数字。首次全量 lint 发现 effect 内同步派生编辑态,已重构为渲染期派生状态;最终质量门无警告、无失败。

## 3. 实现摘要

- **共享模型**:`CHANNEL_PALETTE_KEYS` 与 `channelPaletteKeySchema` 是 palette key 唯一权威;`ViewChannelRef.color` 为可选字段,不提升配置版本,旧配置可直接加载。`viewWriteBodySchema` 与 `viewsListResponseSchema` 供 server/web 共用。
- **REST CRUD**:`GET/POST /api/v1/views` 与 `PUT/DELETE /api/v1/views/:id` 全部经 shared zod schema 校验。id 使用 Node `crypto.randomUUID()`,未知 id 返回 `NOT_FOUND`,非法负载返回 `VALIDATION`;服务端不检查通道当前是否存在,也不自动清理、改名或同步 `lastKnownName`。
- **持久化**:复用 Phase 3 `ConfigStore.update()`,与 Ember endpoint 共存于 `data/config.json`,保持串行更新和临时文件 rename 原子写入。
- **viewStore**:封装列表加载与 CRUD 状态,保存错误可见;激活 View 仅作为浏览器偏好保存于 `flwc.views.activeId.v1`,不会写入后端配置。
- **配置工作台**:支持创建、重命名、二次确认删除;从实时 `mixerStore` 勾选通道;使用上移/下移调整顺序;按通道设置六色 palette 或恢复 AUTO。Available Channels 始终以类型默认色标识,Channel Order 初始使用类型默认色并在配置后即时切换为 View 覆盖色。失配项显示最后已知名称,二次确认后才清理。保存失败不会静默丢弃本地编辑。
- **混音页切换**:始终提供 `All Channels`。全部通道模式保留 Phase 4 类型分区和 `TYPE ROWS`;View 模式隐藏 `TYPE ROWS`,严格按 View 引用顺序平铺,推子、ON、meter、控制锁行为不变。
- **失配占位**:缺失引用使用同尺寸条带、`lastKnownName`、`MISSING` 与 `CHANNEL REFERENCE UNAVAILABLE`,不渲染 ON、推子或 meter。`channelInventoryLoaded` 仅由已连接快照首次置为有效:首次加载前显示等待态;获得有效清单后,空的非 connected handshake/重连快照只更新 Ember 状态,不替换已缓存通道表或电平种子,控制与清理仍由连接状态门控。随后到达的已连接快照仍是权威清单,树 patch/snapshot 删除或恢复通道时占位与真实条带即时收敛;前端不自动写 View。
- **视觉一致性**:配置工作台和新控件继续复用 Phase 4 的石墨 surface、琥珀交互、Barlow Condensed/IBM Plex Mono、锐利边框、短动效与 reduced-motion。单通道颜色继续通过 `--channel-accent` 注入,meter 信号色不受 View palette 影响。未引入浅色主题、第二套 token、UI 库或拖拽库。

## 4. 真机验收操作清单(移交用户)

开发机连接真实 Fairlight Live 时,只允许拖动 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的推子并在测试后复原。不得切换任何 ON/mute,不得操作其它通道或参数,不得删改任何真机通道。

1. 在仓库根目录运行 `pnpm install`,再运行 `pnpm dev`。
2. 通过既有 connection REST 配置真实 Ember host/port,等待 `GET /api/v1/connection` 返回 `connected`。
3. 仅用 `http://localhost:5173` 打开前端。
4. 确认默认 `All Channels` 显示当前完整通道树。点击 `CONFIGURE VIEWS`,创建一个测试 View。
5. 仅勾选应用内 View 引用,例如 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry;调整顺序与 palette、改名并保存。此类操作只写应用配置,不写 Fairlight,可放心操作。
6. 返回主页切换测试 View,确认只显示所选通道、顺序与颜色正确、切换无整页闪烁;View 模式不显示 `TYPE ROWS`。
7. 刷新页面,确认激活 View 恢复;删除激活 View 后确认自动回退 `All Channels`。
8. 如需确认现有推子行为未回归,只能选上述四个允许通道之一,记录原值、小幅移动后立即精确复原。不得点击 ON。
9. **失配验收必须使用 Mock Provider 或已有的自然失配配置。不得为制造 MISSING 状态而删除、改名、重排或断开真实 Fairlight 通道。** 在 Mock 环境删除/替换快照通道后,确认占位显示最后已知名称,其它条带仍正常;在配置页二次确认清理后只移除失效引用。

## 5. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `packages/shared/src/config.ts` | palette key、可选通道颜色与向后兼容 View 模型 |
| `packages/shared/src/views.ts` | views REST 共享请求/响应 schema |
| `apps/server/src/api/views.ts` | views CRUD 路由、校验和统一错误响应 |
| `apps/server/src/runtime.ts` | 原子化 views 列表/创建/更新/删除能力 |
| `apps/server/src/api/views.test.ts` | CRUD、持久化、恢复、并发与错误边界测试 |
| `apps/web/src/lib/views-api.ts` | 浏览器 views REST client 与响应校验 |
| `apps/web/src/store/view-store.ts` | views 状态、错误与激活偏好持久化 |
| `apps/web/src/features/settings/SettingsPage.tsx` | View 配置工作台 |
| `apps/web/src/features/mixer/ViewSelector.tsx` | 主页 View 切换控件 |
| `apps/web/src/features/mixer/MissingChannelStrip.tsx` | 无交互失配占位条带 |
| `apps/web/src/features/mixer/MixerPage.tsx` | All/View 两种布局和顺序投影 |
| `apps/web/src/features/mixer/channel-colors.ts` | shared palette key 到 CSS 色值及默认回退 |
| `apps/web/src/styles.css` | 复用 Phase 4 token 的配置页、选择器与占位样式 |
| `apps/web/src/store/view-store.test.ts`、`apps/web/src/lib/views-api.test.ts` | 前端状态与 REST 单元测试 |
| `apps/web/tests/views.integration.test.tsx` | View 用户流程、排序、配色、失配、清理与空态集成测试 |
| `/opt/cursor/artifacts/phase5_views_configuration_walkthrough.mp4` | Mock Provider 浏览器端到端演示 |

## 6. 依赖清单与许可确认

本阶段未新增 npm 依赖,继续使用项目既有 MIT/MIT 兼容依赖。排序使用上移/下移按钮自绘,页面切换不引入路由库,视觉控件不引入 UI 组件库。

## 7. 关键决策与偏离

- `docs/development-plan.md` 的“Ember 路径”按 Phase 5 提示词和架构原则实现为逻辑 `channelId`(例如 `channel/3`),View 与 REST 不接触原始 Ember 路径。
- View 模式严格按引用数组顺序平铺,因此不按类型分区;`TYPE ROWS` 仅适用于 `All Channels`,在 View 模式隐藏。
- `lastKnownName` 只在用户勾选当前快照通道并保存时写入;后端和实时 patch 不自动修改 View。
- 通道失配必须先由 Ember 已连接后的快照建立依据;初始空快照不具备清理权限。有效清单在 Ember/Socket 短暂断开及重连期间保留,包括服务端在 handshake 中再次发送的空非 connected 快照;避免把缓存通道误判为失配,或在 Ember 尚未给出新树时解锁清理。连接不在线时仍禁用控制与清理。
- 没有覆盖率排除项,未降低任何门槛;未修改 Ember 层、socket 契约、CI 结构或 Phase 5 无关文档。

## 8. 遗留问题与移交事项

- 用户需按第 4 节完成真实 Fairlight 的 View 切换流畅度验收;云端 Mock 结果不能替代真机网络与实际 show 验证。
- Phase 6 继续负责触屏专项、深度视觉细节和长时间性能验证。
- 当前无已知 Phase 5 功能缺口。

## 9. 提交记录

分支:`cursor/phase5-views-config-b83a`。以下记录截至本报告落盘前,不包含承载报告本身的提交。

```text
74f63eb fix: stabilize view channel presence
ab9234b refactor: derive active view editor state
54466ae fix: keep active view edits during store updates
8aff946 test: use accessible channel checkbox names
8388de8 test: verify sequential channel selection
8e9014d fix: synchronize new view drafts
c39b9fe fix: preserve batched view channel edits
d2dfb64 feat: add mixer view projection
ddf3843 feat: add views configuration workspace
fb789e2 feat: add persisted views API
4fee998 feat: add view palette contracts
```
