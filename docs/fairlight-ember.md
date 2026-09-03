# Fairlight Live Ember+ 参考

## 基本事实

- Fairlight Live 在 Show settings 中开启 Ember+(Glow/S101)后暴露一个 Ember+ Provider,端口在设置中配置,并通过 Bonjour(`_ember._tcp`)广播
- **Ember+ 是自描述协议,没有官方路径文档**。树结构、节点类型、取值范围只能通过连接 Provider 在运行时获取
- 树随混音器配置动态变化:增删通道/总线会实时反映到树中(这是 view 失配处理的依据)
- 订阅电平类参数最快约 50ms 更新一次
- S101 keepalive:`emberplus-connection@0.3.1` 在 TCP 连上后自动每 10 s 发送 KeepAliveRequest、自动应答 Provider 的请求,并在 500 ms 内收不到 KeepAliveResponse 时关闭 socket(表现为 `disconnected`,由 `EmberService` 退避重连)。间隔与应答窗口是库内部常量,没有公开配置项。真机若周期性(约每 10 s)出现 `ember socket disconnected`,应先怀疑 500 ms 应答窗口过紧,而不是网络

## 唯一开发依据:本地 dump 的实际树

完整树快照:`docs/tree-dumps/fairlight-live-2026-08-31.json`(本机 `127.0.0.1:9000`,约 196KB)。所有路径、类型、范围、单位以 dump 为准。

本机当前 show 的根节点:`system`(number **0**)、`channel`、`main`、`aux`、`monitor`、`talkback`、`afv`、`cueplayer`。**没有** `sub` / `mixm` / `mtx` 根节点——这些总线类型在本 dump 的混音器配置中不存在,不是 dump 失败。

### 已实测确认的节点

路径为 identifier path(以 `/` 分隔)。通道/总线实例的 identifier 是 `channelN` / `mainN` / `auxN`(从 1 起),显示名在节点 `description` 与子参数 `name` 上。

| 节点 | 路径模式 | 类型 | 范围 | 单位 | 访问 |
| --- | --- | --- | --- | --- | --- |
| 输入通道推子 | `channel/channelN/level` | Parameter REAL | -100 … 10 | 元数据无 format;按调音台约定为 dB | READ_WRITE |
| 输入通道 mute | `channel/channelN/mute` | Parameter BOOLEAN | — | `true` = 静音 | READ_WRITE |
| 输入通道名称 | `channel/channelN/name` | Parameter STRING | — | — | READ_WRITE |
| 输入通道电平表 | `channel/channelN/meter` | Parameter REAL | -60 … 0 | 元数据无 format;按调音台约定为 dB | READ |
| Main 推子 | `main/mainN/level` | Parameter REAL | -100 … 10 | dB(约定) | READ_WRITE |
| Main mute | `main/mainN/mute` | Parameter BOOLEAN | — | `true` = 静音 | READ_WRITE |
| Main 名称 | `main/mainN/name` | Parameter STRING | — | — | READ_WRITE |
| Main 电平表 | `main/mainN/meter` | Parameter REAL | -60 … 0 | dB(约定) | READ |
| Aux 推子 | `aux/auxN/level` | Parameter REAL | -100 … 10 | dB(约定) | READ_WRITE |
| Aux mute | `aux/auxN/mute` | Parameter BOOLEAN | — | `true` = 静音 | READ_WRITE |
| Aux 名称 | `aux/auxN/name` | Parameter STRING | — | — | READ_WRITE |
| Aux 电平表 | `aux/auxN/meter` | Parameter REAL | -60 … 0 | dB(约定) | READ |
| 集成响度 | `system/loudness/integrated` | Parameter REAL | -100 … 18 | 元数据无 format;先前 Viewer 确认为 LUFS | READ |
| 真峰值 | `system/loudness/true-peak` | Parameter REAL | -60 … 0 | 元数据无 format;先前 Viewer 确认为 dBTP | READ |
| 响度复位 | `system/loudness/reset` | Function | — | — | invoke |

本 dump 实测实例(名称来自 `name` 参数):

- 输入:`channel1` MIC、`channel2` MIC-REVERB、`channel3` BASS、`channel4` Anagram-Wet、`channel5` Anagram-Dry、`channel6` PC、`channel7` MUSIC、`channel8` Voice-Chat、`channel9` SPDIF
- Main:`main1` Main
- Aux:`aux1`–`aux10`(FX-Reverb、Mic+Music-Out、PC-OUT、MIC总线、Mic+Music总线、Spdif-PC-BUS、Anagram-Bus、SPDIF-OUT、HEADSET、VC-OUT)

`sub` / `mixm` / `mtx` 的 level/mute/name/meter:**本 dump 中无对应根节点**。其它 show 若创建了这些总线,应按同样的 `{kind}/{kind}N/{param}` 模式在运行时发现,不得硬编码本机清单。

### 允许写入的推子(开发机安全约束)

仅下列输入通道的 `level`:`channel/channel2` MIC-REVERB、`channel/channel3` BASS、`channel/channel4` Anagram-Wet、`channel/channel5` Anagram-Dry。

## 一致性约定(以 dump 核实为准)

- mute:`true` = 静音;本项目 UI 的 ON 开关为其取反显示
- 推子 level 与电平表在 Ember 元数据中**没有** `format`/`factor`;推子量程 -100…10,电平表量程 -60…0
- **根节点 number 从 0 起**(`system` = 0);通道/总线实例 identifier 从 1 起(`channel1`)
- 显示名以 `name` 参数为准,不要用 Ember number 当用户可见编号
- **通道没有稳定 ID**:在通道之间插入或调整次序会让 `channelN` identifier 重新编号。View 引用以「类型 + `name`」匹配,由 identifier 派生的逻辑 id 只用于同名裁决,不能当作跨重排的键

## 本地测试安全约束

开发机连接的是**真实运行中的 Fairlight Live**:

- 只允许改动 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的推子
- 禁止删改任何通道,禁止改动其它通道的任何参数(包括 mute)
- 写入测试后应将推子复原到测试前的值
- 自动化测试一律使用 `packages/test-utils` 的 Mock Ember+ Provider,禁止连接真实设备

## 踩坑记录

> 本章节是文档中唯一保留历史教训的地方,目的是避免后续 Agent 重复踩坑。

1. **官方手册附录的路径表不适用于 Ember+**。Fairlight Live 手册附录中的参数路径表(如 `monitor/monitor1/meters/true-peak`、`system/reset-loudness`)面向 OSC 协议,与 Ember+ 实际树不一致——实测响度位于 `system/loudness` 下。勿以手册为编码依据,一切以本地 dump 为准。
2. **根索引从 0 开始**。`system` 的 Ember number 是 `0`,不是 1。`emberplus-connection` 的部分内部逻辑用 `if (node.number)` 判断,遇到 0 会当假值;查找节点应同时用 identifier。
3. **Ember 参数不带单位字符串**。level/meter/integrated/true-peak 均无 `format`。单位(dB / LUFS / dBTP)来自 Fairlight 软件与先前 Viewer 观察,不是树元数据。
4. **部分 `sends/aux` 的 getDirectory 会挂起**。本机 dump 时 `main/main1/sends/aux` 与若干 `aux/auxN/sends/aux` 在 15s 内无响应。这些是总线发送子树,不是混音页所需节点。后续展开可跳过 identifier 为 `sends` 的节点;dump 脚本已对失败节点记错并继续。
5. **disconnect 可能挂起**。dump 完成后 `EmberClient.disconnect()` 曾因未完成的 getDirectory 请求或 `ECONNRESET` 不返回。工具脚本对 disconnect 做 2s 超时后 `discard()`。
6. **本 show 没有 sub / mixm / mtx**。不得把「当前 dump 没有」写成「Fairlight 永远没有」;TreeMapper 必须按运行时树发现。
7. **`system/loudness/reset` 会执行但不回 InvocationResult**。2026-09-02 直连 `127.0.0.1:9000` 实测:`client.invoke` 立即 `sentOk: true`,28ms 内 `integrated` 变为 `-100` 且后续响度继续更新,但 `request.response` 至少 8s 无 `InvocationResult`。库同时报 `decode root elements: Unexpected BER context tag '96'`。接线与节点路径正确,不要把缺回包当成未发送。`EmberService.invoke` 以发送成功为准并忽略悬挂的 InvocationResult,避免 5s 超时导致前端 toast `The mixer did not respond.`。
8. **通道增删不会自动进 Store**。`getDirectory` 会在协议层订阅目录变化,`emberplus-connection` 会把新子节点合并进本地树,但**不会删除**已消失的子节点;删除在 Fairlight 侧通常表现为条带 `isOnline === false`。只订阅 level/mute/name 时名称能实时更新,通道清单不会变。必须监听总线根与条带节点,debounce 后重新 expand + `TreeMapper.sync`,并把离线条带当作已移除。
9. **对已展开的根再 GetDirectory 会丢掉子树**。Provider 根目录响应通常只含根节点 contents、不含 children;`emberplus-connection` 会用该响应整体替换 `tree[number]`。连接后只对已有总线根/条带 `subscribe`,不要再对根做 GetDirectory。
10. **全新通道可能先以空壳出现**。Fairlight 新建条带时,本地树里常先出现 `channelN` 且 `children` 为空对象或缺 level/mute/name;`expandEmberTree` 若只在 `children === undefined` 时 GetDirectory,会永远跳过该条带。`emberplus-connection` 只有在 `node.children === undefined` 时才会把 GetDirectory 的子节点挂上去,空对象 `{}` 会挡住后续合并。删除/重加走的是已有节点 `isOnline` 翻转,子树还在,所以看起来“删除正常、新建不显示”。只对条带级空 children 清成 undefined 再 GetDirectory;若仍缺参数,再做一次延迟 refresh。
11. **编号目录更新不会插入新子节点**。`emberplus-connection` 的 `_updateTree` 在父子两侧都已有 `children` 时只按 number 更新已有孩子;新条带会走到 `_updateTree(child, undefined)` 并抛错,更新整包丢掉。Mock Provider 用 Qualified 路径插入,所以自动化测试能看到新增;Fairlight 有时发编号目录更新,有时根本不推目录变更。连接后给客户端打补丁先插入缺失孩子;不要对已展开的总线根再 GetDirectory(Fairlight 只回 contents,库会等到 HasChildren 超时)。另开短时只读探测连接拉 mixer 总线清单,把缺失条带 stub 接到主连接上再展开。Fairlight 推来的新孩子经常只有 number、没有 identifier,且 `children` 为空对象 `{}`;补丁插入后 `listMixerStripRefs` 认不出它,直接 attach 也会因槽位被占而跳过。探测发现新条带时要换掉这类幽灵节点再 GetDirectory。Fairlight 对第二路 Ember 连接很紧,探测必须串行、在飞的不排队,且不能把主连接当探测连接 disconnect。
