# CLAUDE.md

项目说明、技术栈、目录结构与全部约束见 [AGENTS.md](AGENTS.md),两份文件内容保持一致,以 AGENTS.md 为准。

最重要的三条(违反会造成真实损失):

1. 开发机连接真实 Fairlight Live:只允许动 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子,禁止删改任何通道;自动化测试只用 Mock Provider。
2. Ember+ 树以运行时实际结构为准,官方手册路径表面向 OSC,勿作为编码依据(见 `docs/fairlight-ember.md`)。
3. 代码、注释、提交信息用英文;Agent 文档与对话用简体中文。
