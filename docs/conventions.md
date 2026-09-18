# 项目规范

## 目录结构

```
apps/
  server/            Fastify 后端
    src/
      ember/         EmberService、TreeMapper、Mock 相关类型
      state/         MixerStateStore、MeterHub
      api/           REST 路由
      ws/            socket.io 网关
      config/        配置加载与持久化、环境变量种子值
      tools/         命令行工具(树 dump、Ember 校验、soak、Mock Provider)与它们的纯函数
    tests/           集成测试
  web/               React 前端
    src/
      components/    通用组件(推子、电平表、开关等)
      features/      按功能组织(mixer、settings、loudness)
      store/         zustand stores
      lib/           socket 客户端、工具
    tests/           集成测试
packages/
  shared/            前后端共享类型与 zod 消息契约
  test-utils/        Mock Ember+ Provider 等测试夹具
scripts/             Shell 脚本(`docker-smoke.sh`)
docs/                项目文档(中文)
data/                运行时配置(JSON,不入库)
start.cmd            控制台启动脚本(Windows,CRLF)
start.sh             控制台启动脚本(macOS / Linux,可执行位)
.env.example         `.env` 的模板(`.env` 本身不入库,由启动脚本经 Node `--env-file` 读取)
Dockerfile           多阶段镜像(base → build / deps → runtime)
.dockerignore        构建上下文排除
docker-compose.yml   拉取 GHCR 镜像、命名卷
```

## 语言与许可

- 代码、注释、提交信息、PR 标题与正文、日志文案:**英文**
- 前端固定 UI 文本:**英文**;仅设备或应用在运行时带入的动态文本(如通道名称)可保留原文
- Agent 文档(AGENTS.md、CLAUDE.md、docs/)与 Agent 对话:**简体中文**
- 新增依赖必须 MIT 或 MIT 兼容许可(项目将 MIT 开源);引入前确认 license 字段

## TypeScript

- 全部包开启 `strict`,禁止 `any`(确需时用 `unknown` + 收窄)
- 共享 `tsconfig.base.json`,各包继承
- 跨包只通过 `packages/shared` 的导出通信,禁止深层相对路径引用其它包源码

## 命名

- 文件:kebab-case(`tree-mapper.ts`);React 组件文件 PascalCase(`Fader.tsx`)
- 类型/接口/组件:PascalCase;变量/函数:camelCase;常量:UPPER_SNAKE_CASE
- socket.io 事件名:`domain:action` 小写(如 `mixer:snapshot`、`mixer:patch`、`meters:frame`、`control:set-level`)
- REST 路由:`/api/v1/...`,资源名复数(`/api/v1/views`),kebab-case

## 错误处理

- 后端:错误分层——协议错误(Ember 连接/超时)、校验错误(zod 拒绝)、业务错误(通道不存在);REST 统一错误响应 `{ error: { code, message } }`;socket.io 控制命令以 ack 回执返回成功/失败
- 所有边界输入(REST body、socket 消息、Ember 收到的值)经 zod 校验后才进入业务层
- 禁止吞错:catch 后必须记日志或向上抛出

## 测试

- 框架:Vitest;前端组件测试用 React Testing Library
- 布局:单元测试与被测代码同目录(`*.test.ts` / `*.test.tsx`);集成测试放各包 `tests/`
- 覆盖率门槛(v8,写入各包 vitest 配置,CI 强制):`apps/*` 行/分支/函数 ≥ 80%;`packages/shared` ≥ 90%
- 自动化测试一律使用 `packages/test-utils` 的 Mock Ember+ Provider,**禁止连接真实 Fairlight**
- 长时间运行用 soak 工具:`pnpm --filter @flwc/server run soak`(默认 60 分钟,自建 Mock 栈)。附着模式 `--url <地址>` 对已有实例**只读**——不发任何控制事件,只翻页与读 DOM,因此可以对着真实台子跑
- 真实 Fairlight 仅用于各阶段人工验收,且只允许动 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子,禁止删改通道
- 每个功能模块必须覆盖其边界场景,最低清单:
  - 后端:Ember 断线/重连/超时、树变化(通道增删)、非法控制命令(越界 level、未知通道)、配置文件损坏/缺失、并发写入
  - 前端:WS 断线重连 UI 态、view 引用已删除通道、推子拖动与远端更新冲突、空 view/空配置、电平值越界钳制

## Git

- 提交信息:Conventional Commits(`feat:`、`fix:`、`docs:`、`test:`、`refactor:`、`chore:`),英文
- PR 标题与正文:英文
- 不提交 `data/`、`node_modules/`、构建产物(`dist/`、`*.tsbuildinfo`)、覆盖率报告、`soak-reports/`、`.env*`、`docker-compose.override.yml`
- 换行符由 `.gitattributes` 统一:默认与 `*.sh` 为 LF,`*.cmd` / `*.bat` 为 CRLF(cmd.exe 对 LF 文件里的 `goto` 与括号块处理不可靠)
- `start.sh` 与 `scripts/*.sh` 带可执行位入库(`git update-index --chmod=+x`)

## 文档维护

- 文档只描述项目当前状态,不保留历史决策变更记录
- 例外:踩坑记录写入 `docs/fairlight-ember.md` 的踩坑章节,避免后续 Agent 重复踩坑
