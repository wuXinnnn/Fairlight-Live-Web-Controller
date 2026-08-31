# Fairlight Live Ember+ 参考

## 基本事实

- Fairlight Live 在 Show settings 中开启 Ember+(Glow/S101)后暴露一个 Ember+ Provider,端口在设置中配置,并通过 Bonjour(`_ember._tcp`)广播
- **Ember+ 是自描述协议,没有官方路径文档**。树结构、节点类型、取值范围只能通过连接 Provider 在运行时获取
- 树随混音器配置动态变化:增删通道/总线会实时反映到树中(这是 view 失配处理的依据)
- 订阅电平类参数最快约 50ms 更新一次

## 唯一开发依据:本地 dump 的实际树

开发所有协议层代码前,必须先用树 dump 脚本(Phase 2 交付)连接本地 Fairlight Live,取得完整树快照,存档到 `docs/tree-dumps/`。所有路径、类型、范围、单位以 dump 结果为准,并回写本文档。

### 已实测确认的节点(本地 Ember+ Viewer)

| 节点 | 说明 |
| --- | --- |
| `system/loudness/integrated` | 集成响度读数,单位 LUFS,只读 |
| `system/loudness/true-peak` | 真峰值读数,单位 dBTP,只读 |
| `system/loudness/reset` | 重置响度表(function) |

### 待 Phase 2 dump 确认的节点

以下为预期存在的能力(命名参考 OSC 表,实际路径待确认):

- 输入通道:level(dB)、mute(Boolean)、name(String)、meter(dB,只读)
- 各类总线(main / sub / aux / mixm / mtx):level、mute、name、meter

确认后将实际路径模式、类型、范围、单位补充到上表。

## 一致性约定(以 dump 核实为准)

- mute:`true` = 静音;本项目 UI 的 ON 开关为其取反显示
- 推子 level 单位为 dB;电平表与响度各有独立量程,以节点元数据为准
- 索引从 1 开始

## 本地测试安全约束

开发机连接的是**真实运行中的 Fairlight Live**:

- 只允许改动 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的推子
- 禁止删改任何通道,禁止改动其它通道的任何参数(包括 mute)
- 写入测试后应将推子复原到测试前的值
- 自动化测试一律使用 `packages/test-utils` 的 Mock Ember+ Provider,禁止连接真实设备

## 踩坑记录

> 本章节是文档中唯一保留历史教训的地方,目的是避免后续 Agent 重复踩坑。

1. **官方手册附录的路径表不适用于 Ember+**。Fairlight Live 手册附录中的参数路径表(如 `monitor/monitor1/meters/true-peak`、`system/reset-loudness`)面向 OSC 协议,与 Ember+ 实际树不一致——实测响度位于 `system/loudness` 下。勿以手册为编码依据,一切以本地 dump 为准。
