# Fairlight Live Ember+ 参考

## 基本事实

- Fairlight Live 在 Show settings 中开启 Ember+(Glow/S101)后暴露一个 Ember+ Provider,端口在设置中配置,并通过 Bonjour(`_ember._tcp`)广播
- **Ember+ 是自描述协议,没有官方路径文档**。树结构、节点类型、取值范围只能通过连接 Provider 在运行时获取
- 树随混音器配置动态变化:增删通道/总线会实时反映到树中(这是 view 失配处理的依据)
- 订阅电平类参数最快约 50ms 更新一次

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
