# Phase 4 执行报告 — 前端混音页 MVP

## 1. 结果总览

Phase 4 云端范围已全部完成。前端已接入 socket.io 与 zustand,实现快照/增量/电平帧状态管理、分区混音页、推子、ON、电平表、响度复位、断线降级与重连恢复。ON 位于窄推子上方;电平表使用固定渐变裁剪并在连续两帧 0dB 后整条红色警告;通道默认跨类型流式换行,可通过持久化的 `TYPE ROWS` 开关强制分类换行。类型采用 Input Green、Main Red、Sub Teal、Aux Navy、Mix Minus Lime、Matrix Purple accent;MTR/LVL 使用对齐的带框读数 dock,LVL 可输入精确值;`CONTROL LOCK` 提供持久化的 UNLOCKED/FADERS/ALL 三档。所有页面固定使用深色主题且不提供主题切换,固定 UI 文本使用英文,组件具备克制动效与 reduced-motion 降级。自动化测试、覆盖率、全量质量门和 Mock Ember+ Provider 浏览器冒烟均通过;真实 Fairlight 验收按云端边界移交用户。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| 组件与集成测试覆盖 Phase 4 边界场景 | 通过 | `pnpm --filter @flwc/web test`:15 files / 53 tests passed。覆盖推子映射、越界、键盘/指针、精确输入提交/取消/非法值/ack 回滚、三档控制锁与持久化、六类默认色、pending 冲突、ON/mute 反转与失败回滚、meter 固定渐变裁剪/峰值保持/连续 0dB 削波、patch 改名/增删、frame 合并、断线禁用与重连快照恢复、reset 二次确认、混合/分类布局与 localStorage、固定深色基线及 presence 清理。 |
| 固定深色主题与合理组件动效 | 通过 | 浏览器冒烟确认页面始终使用深色 token,无主题切换入口;ON、推子、按钮、状态提示、条带增删均有 140–200ms 短动效,峰值保持 1500ms,`prefers-reduced-motion` 将非必要动画缩短。 |
| 对本地真实 Fairlight 手动验收 | 移交用户 | 云端未连接真实设备。可直接执行的安全验收清单见第 4 节。 |
| 覆盖率达标 | 通过 | `apps/web`:语句 95.26%(463/486)、分支 90.94%(211/232)、函数 98.13%(158/161)、行 94.96%(434/457),四项均高于 80%。未改 `packages/shared`。 |
| 全量质量门 | 通过 | 串行 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿。全仓测试:shared 24、test-utils 19、web 53、server 85,合计 181 项通过。 |
| Mock Provider 端到端冒烟 | 通过 | 全量树 dump Mock 以 80ms 推送 meter/loudness;`pnpm dev` 页面显示 9 INPUTS + 1 MAIN + 10 AUX。安全 Mock `127.0.0.1:9104` 验证类型 accent、自然折行行距与标题间隔、ON/meter/fader 对齐、带框 MTR/LVL 长读数、BASS 精确输入 -12.3dB 后恢复原值、FADERS/ALL/UNLOCKED 直接切换和刷新持久化;此前正常渐变裁剪 → 整条红色削波 → 电平回落恢复、推子/ON/reset 往返与断线恢复冒烟继续通过。 |
| 远端 CI | 通过 | GitHub Actions 在界面优化报告提交 `fbef4f2` 上全部 3 项检查通过,无失败。 |

## 3. 实现摘要

- **socket 与状态层**:`lib/socket.ts` 使用同源 Socket.IO,Vite 将 `/socket.io` 代理至后端。所有事件名、schema、payload 与 ack 使用 `@flwc/shared`;非法下行数据拒绝入库并显示非阻断提示。`mixerStore` 负责快照整体替换、patch upsert/remove 合成及 socket/Ember 双连接态;`meterStore` 以快照播种并增量合并可丢帧的 meter frame。
- **重连恢复**:socket 断开或 Ember 非 `connected` 时统一禁用控制并冻结表值。重连后的 `mixer:snapshot` 替换全部通道并清理 pending,避免旧乐观状态残留。
- **推子与精确输入**:-100…+10 dB 分段线性行程,+10/0/-10/-20/-40/-60/-∞ 主刻度;推子帽由 2.7rem 收窄到 2.05rem,条带宽度为 9.25rem。支持轨道点击、指针拖动、方向键 1dB、PageUp/PageDown 10dB、Home/End。LVL 读数点击后变为 0.1dB step 输入,Enter/合法失焦提交、Escape 取消,空值/非数字/越界不发送。拖动与精确输入均沿用本地乐观值、ack 收敛和失败回滚。
- **ON 开关**:位于每个通道推子正上方。展示层严格使用 `on = !muted`,状态源保持 `muted`;乐观更新后发送 `control:set-on`,失败恢复基线并提示错误。
- **电平表**:显示范围 -60…0dB,越界仅在展示层钳制;前景使用全高固定渐变和 `clip-path` 揭示,因此只有达到 -18/-6dB 阈值时才露出黄/红区,不会把三色压缩到任意当前高度。连续两次 frame entry 均为 0dB(含钳制为 0 的正越界值)后整条显示红色削波警告,下一次低于 0dB 时解除。峰值保持 1500ms 后回到当前读数。每个 meter 叶子只订阅自己的 meter/clipping selector,响度区单独订阅 loudness,高频帧不经过混音页组件树。
- **响度区**:显示 integrated LUFS(-100…18)与 true-peak dBTP(-60…0)。reset 首次点击进入 3 秒 `CONFIRM RESET`,第二次才发送命令,ack 结果使用非阻断提示。
- **读数与对齐**:meter 从 ON 顶部开始,推子轨道取消内部上下 margin,其底部与 meter 底部对齐。MTR/LVL 使用同高、带边框、tabular number 的双行 dock,标签/数值/单位各占固定网格位置,`-12.3 dB` 等长值不再裁剪。
- **通道分区与布局**:按 `channel/main/sub/aux/mixm/mtx` 固定顺序渲染,空分区不出现。默认使用跨类型 flex 流并以 0.9rem 行距自然折行,第二类起标题列增加 0.85rem 左侧间隔;标题列与该类首通道组成不可拆分 lead,避免标题孤立在上一行。某类型不足一行时后续类型进入剩余空间。`TYPE ROWS` 开启后每类以全宽标题强制从新行开始,设置保存于 `localStorage` 键 `flwc.layout.typeRows`。通道删除保留 180ms exit presence 后卸载,新增使用短淡入/位移,不整页闪烁。
- **类型颜色**:统一 palette 映射为 Input Green、Main Red、Sub Teal、Aux Navy、Mix Minus Lime、Matrix Purple,应用于标题、条带顶边、名称短线和轻背景 tint,meter 信号色保持独立。每个 section 通过 `--channel-accent` 注入颜色,为 Phase 5 的 view 单通道 palette 覆盖保留入口。
- **控制锁**:`CONTROL LOCK` 可直接选择 UNLOCKED/FADERS/ALL,保存于 `flwc.controls.lockMode.v1`。FADERS 禁用拖动、键盘和 LVL 输入但保留 ON;ALL 同时禁用 ON;meter、响度与 reset 不受影响。断线与 exiting 禁用优先于锁档。
- **固定深色主题与动效**:全局 `color-scheme: dark`,不读取浅色偏好、不维护主题状态、不提供切换入口。视觉采用暖石墨机架、琥珀状态灯、Barlow Condensed 与 IBM Plex Mono 本地字体。通用动效为 140–200ms,拖动禁用补间以保持跟手,meter 使用 45–60ms 线性反馈;reduced-motion 将非必要动画降至 1ms。
- **界面语言**:除 Fairlight/应用运行时带入的通道名称等动态文本外,全部固定 UI 文本使用英文;约束已同步至项目规则、规范、架构和阶段提示词。

## 4. 真机验收操作清单(移交用户)

开发机连接真实 Fairlight Live 时,只允许拖动 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的推子,并在测试后复原。不得切换任何真机 ON/mute,不得改动其它通道或参数,不得删改通道。响度 reset 仅在用户明确接受当前响度统计归零时执行。

1. 在仓库根目录运行 `pnpm install`,再运行 `pnpm dev`。
2. 用 REST 配置真实 Ember host/port,等待 `GET /api/v1/connection` 返回 `connected`。
3. 只通过 `http://localhost:5173` 打开页面(不要使用 `127.0.0.1:5173`)。
4. 确认顶部显示 `MIXER ONLINE`;页面按 INPUTS/MAIN/AUX 等实际存在类型分区,名称与 Fairlight 一致且不显示 Ember 编号。
5. 对照 Fairlight 软件观察各通道 meter、integrated LUFS 与 true-peak dBTP,确认读数和变化方向一致。
6. 记录上述四个允许通道之一的原始推子值,小幅拖动或键盘微调,确认页面本地回显流畅且 Fairlight 值一致,随后精确恢复原值。
7. **不要在真机测试 ON/mute。**
8. 如明确接受响度归零,点击 RESET 后确认首次仅出现 `CONFIRM RESET`,第二次才复位;否则跳过该步骤。
9. 可在不写入参数的前提下短暂断开网络或停止后端,确认控件禁用和 meter 停走;恢复后确认新快照自动恢复。

## 5. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `apps/web/src/lib/socket.ts` | Socket.IO 连接、共享 schema 校验、事件绑定与控制 ack |
| `apps/web/src/lib/fader-scale.ts` | 推子行程映射、钳制、步进与格式化纯函数 |
| `apps/web/src/store/mixer-store.ts` | 快照/patch、连接态、pending 与乐观回滚 |
| `apps/web/src/store/meter-store.ts` | 高频 meter/loudness 增量状态与连续 0dB 削波检测 |
| `apps/web/src/components/Fader.tsx` | 指针、轨道与键盘可访问推子 |
| `apps/web/src/components/Meter.tsx` | 分段竖表、读数与峰值保持 |
| `apps/web/src/components/OnButton.tsx` | Yamaha 风格 ON 控件 |
| `apps/web/src/features/mixer/` | 通道条、分区页面、增删 presence 与持久化分类换行开关 |
| `apps/web/src/features/mixer/channel-colors.ts` | Fairlight 六类默认 palette 与类型映射 |
| `apps/web/src/features/mixer/ControlLock.tsx` | 三档控制锁和 localStorage 偏好 |
| `apps/web/src/features/loudness/LoudnessPanel.tsx` | 响度读数与二次确认 reset |
| `apps/web/src/styles.css` | 固定深色设计 token、工业调音台布局与动效 |
| `apps/web/src/**/*.test.*` | 纯函数、store 与组件单元测试 |
| `apps/web/tests/mixer.integration.test.tsx` | fake socket 端到端前端状态与控制集成测试 |
| `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/project.mdc`、`docs/` 规范 | 固定 UI 文本使用英文等项目开发要求 |

## 6. 依赖清单与许可确认

引入前通过 `npm view <pkg> version license` 核验:

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `socket.io-client` | 4.8.3 | MIT | 实时前后端通信 |
| `zustand` | 5.0.15 | MIT | mixer/meter 状态管理 |
| `@fontsource/barlow-condensed` | 5.3.0 | OFL-1.1(MIT 项目兼容) | 本地打包窄体界面字体 |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1(MIT 项目兼容) | 本地打包工程读数字体 |
| `@flwc/shared` | workspace | 项目内包 | 共享事件与数据契约 |

未引入 UI 组件库。字体仅导入 latin 子集,中文通道名使用系统中文字体回退。

## 7. 关键决策与偏离

- 服务端结构变化当前发送新 snapshot,但 shared schema 已定义 `removedIds`;前端同时实现并测试 snapshot 整体替换与 patch 增删兼容。
- `meters:frame` 是增量脏集合而非完整表,meterStore 按 id 合并,不替换未出现在当前帧的读数。
- 采用 zustand 叶子 selector 而非订阅回调直接写 DOM;每帧仅对应 meter/loudness 叶子重渲,不会触发混音页或通道列表重渲,保持 React 声明式可测试性。
- 未修改 `packages/shared`。meter 与响度展示量程来自已确认的 `docs/fairlight-ember.md`,且仅用于 UI 钳制。
- Fairlight 类型默认色集中在前端 palette,当前不扩展 socket/shared 模型;Phase 5 在 view 通道配置中增加 palette 选择并通过 `--channel-accent` 覆盖类型默认值。
- 无覆盖率排除项,未降低门槛。未修改后端、REST API 或 CI 结构。

## 8. 遗留问题与移交事项

- 用户需按第 4 节完成真实 Fairlight 验收;云端结果不能替代真机读数与手感确认。
- 当前 show 没有 `sub`/`mixm`/`mtx`;前端已按共享 kind 支持,仍需在包含这些总线的真实 show 上确认名称和密度。
- Phase 5 继续实现 views 与配置页,新页面必须复用固定深色 token且不得添加主题切换。
- Phase 6 继续做触屏专项、细节视觉打磨与长时间性能验证;固定深色策略和基础动效已在本阶段完成。

## 9. 提交记录

分支:`cursor/phase-4-frontend-192a`

```text
154ecac test(web): keep type headers attached to channels
28dab07 fix(web): keep type headers with first channels
302df72 test(web): cover exact levels and control locks
5ca4bf8 docs: plan per-view channel colors
7e56073 feat(web): polish channel controls and locking
eb5ee61 docs: record refined Phase 4 CI result
fbef4f2 docs: report Phase 4 interface refinements
73b51c1 test(web): isolate application entrypoint mount
87b72f9 test(web): cover meter clipping and layout preference
6f7f4fc docs: require English frontend interface text
987b30e feat(web): refine channel layout and meter feedback
74d28e4 docs: record Phase 4 CI result
3684d2a docs: add Phase 4 execution report
bf6254c fix(web): polish local visual assets
d93d8a6 test(web): cover mixer controls and realtime recovery
6f4a750 fix(web): align realtime UI with React lint rules
0e16abf feat(web): add realtime mixer control surface
d9ed102 chore(web): establish Phase 4 frontend baseline
```
