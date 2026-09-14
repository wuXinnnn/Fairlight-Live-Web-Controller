# Phase 6.4 执行报告 — 触屏审计

## 1. 结果总览

| 项 | 状态 |
| --- | --- |
| 1. 全局防误触样式与 `dvh` | 完成 |
| 2. `:hover` 包进 `@media (hover: hover)` 与样式回归测试 | 完成 |
| 3. 推子 pointerId 过滤与多推子并行 | 完成 |
| 4. 手指翻页不从 ON 按钮起手 | 完成 |
| 5. Screen Wake Lock:原生路径 + 静音视频降级 | 完成 |
| 6. Fullscreen:hook 与页头按钮 | 完成 |
| 7. Web app manifest 与 meta | 完成 |
| 8. 文档 | 完成 |
| 浏览器冒烟(Playwright + 合成电平服务) | 完成,28/28 通过,见第 5 节 |
| 评审后修订(Bugbot 1 条 finding) | 完成,见第 10 节 |
| 真机验收(平板与手机) | **移交用户**,清单见第 6 节;常亮已验收并两次修订(第 14、15 节),全屏键按反馈移位(第 16 节) |

本批次全程在用户开发机上执行。质量门(串行,全部实际跑过):

```
pnpm lint (eslint . && prettier --check .)          成功
pnpm typecheck (server + web)                        0 error
pnpm test (shared 44 / test-utils 22 / server 143 / web 487)   全绿
pnpm --filter @flwc/web build                        成功
git diff origin/main -- pnpm-lock.yaml               无改动
```

覆盖率(`apps/web`,门槛 80%,未调整、未新增排除项):

| 指标 | 改动前(6.3 收尾) | 改动后 |
| --- | --- | --- |
| Statements | 96.94% | **96.91%** |
| Branches | 92.38% | **92.38%** |
| Functions | 99.15% | **98.92%** |
| Lines | 96.90% | **96.88%** |

用例数 450 → 487(净增 37:本体 29、评审后 1、真机验收后 7),测试文件 56 → 60。本批次新增的四个文件覆盖率:`use-wake-lock.ts` 93.1% / 分支 82.6%、`wake-media.ts` 94.64% / 分支 88.23%、`use-fullscreen.ts` 95.65% / 分支 92.3%、`styles.test.ts`(测试文件本身不计入)。Statements、Functions 与 Lines 各降约 0.03 个百分点,是新增文件里几条只在真实浏览器才走到的分支(`release()` 被拒、`play()` 在没有元素时早退、`doc.body === null`)拉下的,离门槛仍有 16 个百分点余量。

`apps/server`、`packages/shared`、`packages/test-utils` 本批次一行未改。

## 2. 验收标准逐条核对

对照提示词「验收自查」八条:

**1. 全局样式:四条防误触规则、可编辑控件的恢复、`vh` 清零 —— 通过。**
`styles.css` 顶部新增 `html, body { overscroll-behavior: none }` 与 `body { touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none }`;`-webkit-tap-highlight-color: transparent` 从 `button` 扩到 `button, [role='slider'], label, select, input, a`。`vh` 六处全改 `dvh`(含提示词漏列的一处,见第 8 节),改后 `grep -n "vh\b" apps/web/src/styles.css` 只剩 7 行 `dvh`。浏览器实测(第 5 节):`body` 的 `touch-action` 为 `manipulation`、`user-select` 为 `none`,`html` 与 `body` 的 `overscroll-behavior` 都是 `none`,推子精确输入框的 `user-select` 为 `text`,`.mixer-shell` 的高度等于 `window.innerHeight`。**下拉刷新、双击缩放、长按菜单、文字选中在真机上的实际表现移交用户。**

**2. `:hover` 全在 `(hover: hover)` 内、合写选择器拆分后视觉不变 —— 通过。**
25 处 `:hover`、22 个规则块全部包进媒体查询(数字与提示词的「26 条」不符,见第 8 节),7 个合写块拆开。`styles.test.ts` 按花括号深度扫描后断言无一遗漏。冒烟两组对照:触摸上下文(`hasTouch: true, isMobile: true`,Chromium 报 `(hover: none)` 与 `(pointer: coarse)`)下 hover ON 按钮前后边框都是 `rgb(166, 125, 45)`;桌面上下文下由 `rgb(166, 125, 45)` 变为 `rgb(104, 110, 123)`。两张截图在会话临时目录(`hover-touch-context.png` / `hover-desktop-context.png`),肉眼对照也确认触摸那张九个 ON 按钮边框一致、桌面那张第一个明显变色。

**3. 多指:第二根手指不劫持、不触发回 0、不 commit;两个推子并行各自 commit;拖动类计数 —— 通过。**
`Fader.test.tsx` 新增五例(两种双击形态各一次、两推子并行与拖动类、拖动中卸载、快速按放后仍能起拖),`mixer-multitouch.integration.test.tsx` 新增两例。两条回归锁都做过「先破坏再验证」:把 pointerId 清理移到 `dragging` 判断之后,「starts a new drag after a press and release too quick for React to have rendered」变红;把拖动类改回逐组件加减,「takes two fingers on two faders at once」变红。浏览器实测:CDP `Input.dispatchTouchEvent` 双指同时拖两个推子,IN-01 由 −20 到 −11.1、IN-02 由 −19 到 −27.2,各走各的方向,页码不变。**真机双手推两路移交用户。**

**4. ON 不起手:从 ON 上拖不翻页、`touchend` 不被拦 —— 通过。**
`mixer-touch.integration.test.tsx` 由 8 例增到 9 例,新增用例断言从 ON 上拖过阈值后页码不变、`touchend` 返回 `true`(没被 `preventDefault`,因为这不是翻页手势)。既有三条安全性质用例(单指判定、滚到底再翻、翻页后不误按)未动且仍绿。同样做过破坏验证:移除 `[data-swipe="none"]` 排除后该用例变红。

**5. Wake Lock:两条路径的申请、释放、重申请与拒绝分支 —— 通过,且媒体路径在真实浏览器里实测到了。**
`use-wake-lock.test.tsx` 十一例覆盖原生路径(拿到→系统收回→回到可见重申请、被拒后仍在下次可见时再试且只警告一次、`enabled` 变假时 `release()`)与媒体路径(挂载即自己播、隐藏时暂停、回到可见自己恢复、引擎拒绝自动播时手势兜底、在途播放被暂停追上时不宣告 `active`、`play()` 被拒→`denied` 且只警告一次、`timeupdate` 回绕、卸载移除元素、**台子离线时不持有、回来时无人触碰自动恢复**),外加 `unsupported` 分支。集成用例断言 jsdom 下 `video.wake-media` 在场且 `muted`、`.mixer-shell[data-wake-lock]` 自行变 `active`,切到配置页后视频被移除;另一例走完「Ember 掉线→放手→Ember 回来→自动恢复」。这一节的用例在第 15 节按新需求改写过。

浏览器实测把两条路径都走到了:`http://127.0.0.1:3100`(安全上下文)下 `navigator.wakeLock` 是 object、`data-wake-lock` 为 `active`、页面上没有任何 video;`http://192.168.50.115:3100`(同一个服务的局域网地址,**不是**安全上下文,与平板的处境相同)下 `navigator.wakeLock` 为 `undefined`,静音视频在文档内、两个 source、状态 `idle` 且暂停,点一下页头之后状态变 `active`、`paused` 变 `false`。**这证明了降级路径在真实 Chrome 的非安全源下确实接管并开始播放;但「屏幕是否真的不熄」只有平板知道,移交用户**(操作步骤见第 6 节)。

   **这一段记的是交付时的行为**:当时视频要等一次手势才播。真机验收之后,元素几何与触发时机都改了(第 14、15 节),冒烟也按新行为重跑过——最新结果见第 15.3 节。

**6. Fullscreen:支持/不支持/拒绝三种;按钮只在支持时渲染 —— 通过。**(交付时按钮在页头、不在安全区;用户验收后按要求移到了安全区底部,见第 16 节)
`use-fullscreen.test.tsx` 四例(不支持时不渲染也不报错、进出全屏、被别的路径退出时跟随、被拒时只警告一次且状态不变),集成用例覆盖 jsdom 无 `fullscreenEnabled` 时页头没有按钮、装上假实现后按钮出现并可来回切换。安全区体检用例(`mixer-pages.integration.test.tsx` 里 `within(rail).getAllByRole('button')`)未动且仍绿——交付时按钮在页头;移进安全区之后它仍未改,另有一条新用例覆盖带全屏键的名单(第 16.3 节)。浏览器实测:按钮存在,点击后 `document.fullscreenElement` 非空,再点回到非全屏。**真机移交用户,iPhone Safari 预期没有这个按钮。**

**7. manifest:构建产物里有 manifest 与图标,可取到 —— 通过。**
`pnpm --filter @flwc/web build` 后 `dist/` 里有 `manifest.webmanifest`(455 B)、`icon-192.png`(964 B)、`icon-512.png`(3175 B)。浏览器里 `fetch('/manifest.webmanifest')` 返回 200、`content-type: application/manifest+json`、`display: "fullscreen"`。viewport meta 一字未改。**安装行为移交用户,并注明 `http` 下不会真正安装。**

**8. 全量质量门 —— 通过。** 见第 1 节。远端 CI 与 Bugbot 见第 10 节。

## 3. 实现摘要

**3.1 全局防误触与 `dvh`。** 四条规则加在 `styles.css` 顶部的全局区,推子轨道、安全区、`.page-rail__track` 与拖动把手既有的 `touch-action: none` 与 `.mixer-page` 的 `overscroll-behavior: contain` 都保留(后代更严格即以后代为准)。恢复选中的一条规则把可编辑控件与错误文案写在一起。`vh → dvh` 共六处:`body`、`.connection-dialog`、`.settings-shell` 两处、`.settings-empty` 的 `12vh`、窄屏 `.channel-checklist` 的 `60vh`;`.mixer-shell` 在 6.3 已是 `100dvh`。`calc(100vw - 2rem)` 一处保留——横向视口不随地址栏变化。

**3.2 `:hover` 与样式回归测试。** 22 个规则块就近包裹,媒体查询紧贴原规则位置,没有集中到文件末尾。7 个与状态合写的选择器拆成两条,状态那一半留在查询外、声明块原样复制,层叠上两份声明完全相同因此视觉不变;`.fader__cap:hover` 拆出的 `.fader.is-dragging .fader__cap` 留在原位,仍紧邻它下面的 `transition: none`。`:active` 与 `:focus-visible` 一条没动。

`src/styles.test.ts` 是这批 CSS 唯一可能有的回归锁(jsdom 既不解析样式表也不算样式)。扫描器按字符走一遍源文件,四类东西跳过而不当结构读:注释(文件里有两处注释提到 hover)、字符串(`content: '{'` 不能开块)、圆括号内的一切(`:has(select:enabled)`、`calc()`、媒体特性)、然后才是花括号栈。`:hover` 的归属在**扫到字面量那一刻**读当前块栈,而不是假设 hover 只出现在 prelude 里。`vh` 的正则用后行断言排除 `dvh` 与标识符里的数字,且在去掉注释的文本上跑。扫描器自身另有一组内联夹具的自测,覆盖嵌套查询、注释里的 `:hover`、字符串里的 `{ :hover }`、`:has()` 与 `@media (hover: none)` ——最后这条确保不是所有 hover 媒体特性都算通行证。

**3.3 推子 pointerId。** 新增 `activePointerIdRef`。`handlePointerDown` 在 `preventDefault()` 之后、**双击判定之前**挡掉不是当前手指的按下——这个顺序是必须的,否则第二根手指落在 500 ms 窗口内就会被当成双击直接把通道推到 0 dB。`handlePointerMove` 与 `finishPointer` 同样按 id 过滤。既有六条输入路径(指针拖帽、双击回 0、键盘步进、精确输入、滚轮、pending 与远端冲突)的行为一字未改。

`finishPointer` 里清理指针 id 的位置是一处**对提示词字面写法的有意偏离**,理由见第 8 节。

`fader-cap-dragging` 改成模块级计数,加减仍挂在既有的 `useEffect([dragging])` 上(body 里 `beginCapDrag()`、cleanup 里 `endCapDrag()`),由 React 保证配对;计数带 `Math.max(0, …)` 保险。没有为它加 `afterEach` 复位:RTL 的 `cleanup` 每例都会卸载,effect 的 cleanup 必跑,计数自平衡。

**3.4 ON 不起手。** 新增约定属性 `data-swipe="none"`,目前只标在 ON 按钮上;`handleTouchStart` 的排除条件变成 `closest('[data-wheel="level"], [data-swipe="none"]')`。`touchstart` 与 `touchmove` 都是 passive、都不 `preventDefault`,这条改动与 passive 无关。电平表、名称头、读数、分区标题栏、间隙与安全区照旧可以起手。

**3.5 Wake Lock 的两条路径,各在什么条件下生效。**

- **原生路径**:`env.wakeLock` 存在时走,即**安全上下文**(`https://`,或 `http://localhost` / `http://127.0.0.1`)。`enabled` 且文档可见时 `request('screen')`,拿到 sentinel 即 `active`;sentinel 的 `release` 事件(系统收回、切后台、省电模式)回 `idle`;`visibilitychange` 回到 `visible` 时重新申请——**被拒过也会再试**,平板从锁屏回来常常就给了。`request` 被拒 → `denied` 且 `console.warn` 一次,不重试、不提示。
- **媒体降级路径**:`navigator.wakeLock` 为 `undefined` 时走,即平板走 `http://<局域网 IP>` 的实际情况。混音页挂载即把铺满视口的透明静音循环视频放进 `body` 并**立即开始播**——静音媒体不受自动播放策略约束,而平板是自己亮屏的,不能等人来碰(见第 15 节);`document` 上的 `pointerdown` / `keydown` 仍挂着作为引擎拒绝时的兜底。页面隐藏 `pause()` 回 `idle`,回到可见自己再试一次。`play()` 被拒 → `denied` 且 `console.warn` 一次,下一次交互再试。
- 两条路径都只在**台子在线时**才持有:`socketConnected && emberStatus === 'connected'`(见第 15 节)。两条都**静默**:屏幕上没有任何提示,失败只在 console 留一行,与偏好 hook 的先例一致。状态写在 `.mixer-shell` 的 `data-wake-lock` 上只供测试与冒烟读。
- `unsupported` 只在两条路都不通时出现(没有原生 API,且文档没有浏览上下文)。提示词给的两条路径都到不了这个值,定义是本批次补的,见第 8 节。

视频落在 `body` 而不是混音页外壳内(用户确认),元素必须在布局里且有几何——`display: none` 的视频不会被当作可见。素材摘自 nosleep.js 0.12.0 的 `src/media.js`,两个 data-URI(webm 7459 B、mp4 5026 B),文件头注明来源、版本与 MIT 许可链接。**两个素材都带一条数字静音的音频轨**,不出声靠的是 `muted`——本报告先前写的「无音频轨」是错的,见第 14.5 节。

**3.6 Fullscreen。** `supported` 要求 `fullscreenEnabled === true` 且 `requestFullscreen` 是函数,不做 `webkit` 前缀回退,因此 iPhone Safari 上按钮根本不渲染。`active` 由 `fullscreenchange` 维护,读 `fullscreenElement` 时按 `!== null && !== undefined` 判断(jsdom 与部分引擎给的是 `undefined`)。两个 promise 被拒都只 `console.warn` 一次并保持原状态。交付时按钮在页头 `CONFIGURE VIEWS` 之后;**用户验收后移到了安全区底部、与翻页键同等大小**,见第 16 节。

**3.7 manifest 与图标。** `display: fullscreen`、`background_color` 与 `theme_color` 都是 `#111318`、不锁定朝向。两个 PNG 由一个放在临时目录的纯 Node 脚本生成(`zlib` 手写 PNG 编码,不装任何依赖),脚本不进仓库;要点见第 7 节。`index.html` 加 manifest link、`mobile-web-app-capable`、三个 apple meta 与 apple-touch-icon,viewport 不变。

## 4. 数值初值清单

本批次新增一个数值常量(提示词预期为零):

| 名称 | 值 | 含义 | 文件 |
| --- | --- | --- | --- |
| `WAKE_MEDIA_REWIND_AT_S` | `0.5` | 秒。常亮降级视频的播放位置超过这个数就手动回到 0——nosleep.js 发现极短的循环视频在部分设备上 `loop` 不可靠,这个数照搬它 | `apps/web/src/lib/wake-media.ts` |

`page-layout.ts`、`page-wheel.ts`、`fader-wheel.ts`、`wheel-gesture.ts`、`dnd-config.ts` 里的常量一个没动;推子帽、ON 按钮、翻页键的尺寸维持现状。

## 5. 浏览器冒烟

**实测环境**:Windows 11,本机已装的 Chrome(经 `playwright-core` 驱动,`chromium.launch({ channel: 'chrome' })`,**没有下载浏览器**)。被测的是 `pnpm --filter @flwc/web build` 的**生产构建**,由一个只在会话临时目录里存在的合成服务托管(Node + `apps/server/node_modules` 里现成的 `socket.io`,监听 3100,发 40 通道快照与每 50 ms 一帧 `meters:frame`,另答前端启动会打的两个 REST)。**全程没有启动 `apps/server`、没有连真实 Fairlight**;本机当时跑着连真机的 `pnpm dev`(3000 / 5173),实测用的是 3100,结束后已确认 3100 释放、3000 与 5173 未被碰过。

提示词说本机 rAF 约 360 fps、帧间隔类指标没有区分度,本批次因此不做性能预算,没有量。

28 项检查全部通过:

| # | 检查 | 结果 |
| --- | --- | --- |
| 1–2 | 触摸上下文报 `(hover: none)` 与 `(pointer: coarse)` | 是 / 是 |
| 3–4 | `body` 的 `touch-action` / `user-select` | `manipulation` / `none` |
| 5–6 | `html` 与 `body` 的 `overscroll-behavior` | `none` / `none` |
| 7 | 推子精确输入框的 `user-select` | `text` |
| 8 | `.mixer-shell` 高度 == `window.innerHeight` | 是 |
| 9 | 安全源:`data-wake-lock` 且页面上无 video | `active` / 无 |
| 10 | 局域网源:`typeof navigator.wakeLock` | `undefined` |
| 11 | 局域网源:视频在场、`muted`、两个 source、状态 `idle` 且暂停 | 全部符合(交付时行为,见第 15.3 节的重跑) |
| 12 | 局域网源:触摸一下之后 | `active`,`paused === false`(交付时行为,现已改为自行播放) |
| 13 | 触摸上下文里 hover ON 按钮 | 边框不变(`rgb(166, 125, 45)` → 同值) |
| 14–15 | 桌面上下文报 hover,且 hover 改变边框 | 是;`rgb(166, 125, 45)` → `rgb(104, 110, 123)` |
| 16–17 | 安全源上原生锁与 `navigator.wakeLock` 类型 | `active` / `object` |
| 18–21 | `FULLSCREEN` 按钮存在、点击后 `document.fullscreenElement` 非空、文案变 `EXIT FULLSCREEN`、再点回到非全屏 | 全部符合 |
| 22–24 | `/manifest.webmanifest` 的状态码、媒体类型、`display` | 200 / `application/manifest+json` / `fullscreen` |
| 25–26 | CDP 双指同时拖两个推子 | IN-01 −20 → −11.1(上推)、IN-02 −19 → −27.2(下拉),各走各的 |
| 27 | 期间页码 | `1 / 5` 不变 |

**一项测不出来、如实记下**:`-webkit-touch-callout` 是 Safari 的属性,Chrome 既不实现也不在 `getComputedStyle` 里报告它,冒烟里读到的是空字符串。这条声明是给 Safari 的,由 `styles.test.ts` 按源文本锁住,浏览器端只能记录不能断言。长按菜单的实际行为要在真机上看。

多指那两项用 CDP `Input.dispatchTouchEvent` 做成了,提示词允许「做不了写明」——做得了。

## 6. 真机验收操作清单(移交用户)

**安全约束**(照抄 6.3 报告第 5 节):本批次改的是触屏输入方式与两项渐进增强,不会改动 Fairlight 任何参数;验收过程中不要操作混音页推子;如确需操作,**只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原**;不得切 ON/mute、不得动其它通道、不得删改任何通道。**多指验收只在这四个推子上做,做完把它们的电平复原到验收前的值。** 下面凡是要按 ON 的地方,**一律不要真的按**——只看有没有被误触发,如果误按了立刻按回去并记下来。

启动:仓库根目录 `pnpm install --frozen-lockfile` → `pnpm dev`(server 3000 + web 5173)→ 平板与手机在同一局域网里打开 `http://<开发机 IP>:5173`,确认页头 `MIXER ONLINE`。

### 平板

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 在通道条区从上往下拖到底,继续下拉 | **不出现下拉刷新**,页面不整体回弹 |
| 2 | 在任意位置快速双击(通道名、间隙、页头空白) | **不缩放** |
| 3 | 长按通道名称、长按页头文字 | **不弹出系统菜单**,不出现选中高亮 |
| 4 | 从通道名上拖动一小段 | **不选中文字** |
| 5 | 两指捏合 | **仍然可以缩放**(本批次有意保留) |
| 6 | 双手同时推 MIC-REVERB 与 BASS 的推子 | 两条各跟各的手,数值互不影响;**测完复原** |
| 7 | 一根手指按住 BASS 推子帽不放,另一根手指也落在**同一个帽子**上并拖动 | 第二根手指**什么都不做**:值不跳、不回到 0 dB;抬起第二根手指时第一根仍在拖;**测完复原** |
| 8 | 同上,但第二根手指在同一个帽子上**快速点两下** | **不回到 0 dB** |
| 9 | 从右侧安全区的空白轨道上下滑动 | 翻页,一次手势可以连翻 |
| 10 | 从某个通道的 **ON 按钮**上按下并向上拖过一指宽 | **不翻页**;松手后 ON **没有被按下** |
| 11 | 从电平表、通道名、读数、分区标题栏、通道条之间的间隙上滑动 | 照常翻页 |
| 12 | 在推子轨道上滑动 | 只动推子,不翻页;**只在那四个推子上试,测完复原** |
| 13 | 翻页翻到一半松手,手指落在下一页某个 ON 上 | ON **不被按下** |
| 14 | 通道条区滚到底之后继续同方向滑动 | 先滚到底、再翻页。**注意**:本批次关掉了 `overscroll-behavior`,滚到底之后不再有橡皮筋回弹,手感与 6.3 不同;请确认「滚到底再翻页」这一步是否还顺手 |
| 15 | 点**右下角**安全区底部的全屏键 | 进入全屏(浏览器地址栏消失),图标变为退出;再点或按返回键退出 |
| 16 | 全屏状态下切到 `CONFIGURE VIEWS` 再回来 | 仍是全屏(全屏是文档级状态) |
| 17 | **常亮**:把平板的息屏时间设成最短(如 15 秒或 30 秒),打开混音页,**不要碰屏幕**,放着不动 | 屏幕**不熄**。视频自己会播,不需要任何手势 |
| 18 | **台子离线时应当放手**:常亮着的时候把跑服务的电脑关掉(或停掉 `pnpm dev`) | 页面进入断线态,常亮**随即停止**,平板按自己的熄屏计时睡过去 |
| 19 | **台子回来时应当自己接管**:重新开机、起 `pnpm dev`,平板在充电所以会自己亮屏 | **不要碰平板**。socket 重连、Ember 接上之后,常亮应当自己恢复,屏幕从此不再熄 |
| 20 | 常亮验收完成后 | 把息屏时间改回原值 |
| 21 | 长按混音页地址栏图标「添加到主屏幕」 | 会得到一个书签。**`http` 不是安全上下文,所以不会真正安装成应用**(打开后仍带浏览器边框),这是预期的,不是缺陷 |
| 22 | 横屏与竖屏各走一遍 1–14 | 行为一致 |

### 手机

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 重复平板的 1–5(下拉刷新、双击缩放、长按菜单、文字选中、捏合) | 同上 |
| 2 | 单手拇指推 BASS 推子,另一只手的手指同时落在同一个帽子上 | 第二根手指无效;**测完复原** |
| 3 | 从 ON 上滑动 | 不翻页、不误按 |
| 4 | 从安全区滑动翻页 | 正常;窄屏下安全区仍应可达 |
| 5 | **iPhone Safari**:看安全区底部 | **没有全屏键**——iOS 没有元素全屏,它有意不渲染。若看到了,那是缺陷 |
| 6 | **Android Chrome**:安全区底部的全屏键 | 与平板一致 |
| 7 | 常亮 | 与平板 17 相同(手机同样走降级路径) |
| 8 | 竖屏下把页面滚到底再继续滑 | 与平板 14 相同 |

## 7. 交付物清单

新增:

- `apps/web/src/styles.test.ts` —— CSS 源文本回归锁(扫描器 + 6 例断言 + 2 例扫描器自测)
- `apps/web/src/lib/wake-media.ts` —— 静音视频控制器与两个 data-URI 素材
- `apps/web/src/features/mixer/use-wake-lock.ts` + `use-wake-lock.test.tsx` —— 常亮两条路径
- `apps/web/src/lib/use-fullscreen.ts` + `use-fullscreen.test.tsx` —— 全屏
- `apps/web/tests/mixer-multitouch.integration.test.tsx` —— 多指集成
- `apps/web/public/manifest.webmanifest`、`icon-192.png`、`icon-512.png`

改动:`styles.css`(全局规则、`dvh`、22 个 hover 块、`.wake-media`)、`Fader.tsx`、`Fader.test.tsx`、`OnButton.tsx`、`MixerPage.tsx`、`vitest.setup.ts`、`index.html`、`mixer-touch.integration.test.tsx`、`mixer.integration.test.tsx`、`docs/architecture.md`。

**图标生成脚本的要点**(脚本本身不进仓库,放在会话临时目录):纯 Node,只用 `zlib` 与 `fs`,手写 PNG 的 IHDR / IDAT / IEND 与 CRC32。画面沿用 `index.html` 里内联 SVG favicon 的几何,在 32 单位网格上放大到目标尺寸:底色 `#111318`、圆角半径 4/32 边长;三段推子 `#efa928`,分别是 `x 8..24 y 9..12`、`x 11..21 y 15..18`、`x 14..18 y 21..24`。每像素 4×4 超采样,圆角与色块边缘因此有抗锯齿;输出 8 位 RGBA、非隔行。

## 8. 关键决策与偏离

**8.1 `finishPointer` 里清理指针 id 的位置——对提示词字面写法的有意偏离,且是本批次最要紧的一处。**
提示词第 3 节说 `finishPointer` 在 `pointerId` 不符时忽略、「拖动结束时清空」。既有代码的第一句是 `if (!dragging) return;`,而 `dragging` 是 state:按下与松开落在同一个 React 批次里时(真机上极快的点触、合成的 pointer 序列),`finishPointer` 会从这里早退,清空那一句永远轮不到执行。于是 `activePointerIdRef` 卡在那个 pointerId 上,**这个推子此后的每一次按下都会被当成「第二根手指」拒掉,整场演出都推不动它**,而且没有任何路径能把它清回去。所以指针 id 在 `dragging` 判断**之前**清掉,其余逻辑一字未动。这是语句顺序的调整,不是行为改写。回归锁是 `Fader.test.tsx` 的「starts a new drag after a press and release too quick for React to have rendered」,已验证把清理移回后面它就变红。

**8.2 `:hover` 实际是 25 处、22 个规则块,不是提示词写的 26 条。**
提示词第 18 节列出的行号清单本身是对的(25 项),只有「26」这个数字不对。按清单执行,拆分后规则块由 22 变 29(22 个 hover 块进媒体查询 + 7 个合写块复制出的状态半边留在外面)。`styles.test.ts` 断言 hover 站点数 ≥25,以免扫描器哪天静默匹配为空、让下面每条断言都因为错误的理由通过。

**8.3 `styles.css:2007` 的 `margin: 12vh auto` 提示词没有列出。**
提示词第 1 节只列了 4 处 `100vh` 与 1 处 `60vh`,但它同时给了硬指标「改完全仓 grep 里不应再有 `vh` 单位」。按硬指标把 `.settings-empty` 的 `12vh` 一并改成 `12dvh`,共改六处。`L346` 的 `calc(100vw - 2rem)` 保留:横向视口不随地址栏变化,`vw` 不在本批次范围。

**8.4 视频降级元素挂在 `body`,不是混音页外壳内(已与用户确认)。**
`createWakeMediaController` 只拿到 `document`;让 `lib/` 去 `querySelector` 一个 feature 层的类名是反向依赖。`.mixer-shell` 又是 React 管着每个子节点的 grid,往里塞外来节点要靠 `position: fixed` 一定生效才不打乱布局。挂在 `body` 上还让集成用例「切到配置页后视频被移除」验证的是我们自己的 `destroy()` 清理有没有跑,而不是 React 顺手卸载——那正是这条断言该锁住的东西。

**8.5 `user-select: none` 之外额外恢复了错误文案的选中(已与用户确认)。**
提示词只恢复 `input, textarea, [contenteditable]`,那样 CONNECTION 面板的错误信息、Ember `lastError`、配置页的 missing-warning 都会变成不可复制,报障时没法把文案发出来。额外给 `.connection-dialog__error`、`.connection-dialog__field-error`、`.empty-console__error`、`.panel-empty__error`、`.missing-warning` 加 `user-select: text`,`styles.test.ts` 一并锁住。

**8.6 `WakeLockStatus` 的 `unsupported` 是补定义的。**
提示词给了四个状态值,但它描述的两条路径都产生不了 `unsupported`(没有原生 API 就走媒体降级,而媒体降级总是可用的),那会是一个永远走不到的死分支。定义补成「没有原生 API **且** 媒体控制器自报不支持」,判据是 `doc.defaultView !== null`——没有浏览上下文的文档播不了媒体,这是真命题,也给了测试一个不需要任何 mock 的入口(`document.implementation.createHTMLDocument()`)。

**8.7 媒体路径由手势触发时,`active` 是同步乐观置位的。**
如果在 `play()` 的 `.then()` 里置位,这个 setState 会落在微任务里,而混音页的现存集成用例只要派发过 `pointerdown` 就会触发它,`act()` 早已关闭 → 满屏 act 告警。手势里 `play()` 几乎必然成功,所以同步说 `active`,只在被拒时改成 `denied`。第 15 节加入的自动播放走的是另一条:它不乐观置位,状态跟着 promise 走,并且要 `media.playing` 仍为真才宣告 `active`。

**8.8 `use-wake-lock` 的两处状态改成渲染期派生,不在 effect 里同步 setState。**
初版在 effect body 里对 `unsupported` 与 `!enabled` 直接 `setStatus`,被 `react-hooks/set-state-in-effect` 挡下——它说得对,那是白白多一次渲染。这两个值本来就是参数的函数,改成返回前算;effect 内部只保留一个表示「此刻持有什么」的 state。

**8.9 `data-wake-lock` 从 `idle` 变 `active` 会带来一次整桌重渲染。**
触发点通常就是操作员第一次按下某个推子。推子的拖动状态在 ref 与局部 state 里、key 稳定,不会重挂,所以没有功能风险;这里如实记下。

**8.10 `overscroll-behavior: none` 会去掉滚到底之后的橡皮筋。**
6.3 的「通道条区滚到底再翻页」在手感上依赖那点回弹反馈。功能没变(逻辑仍然是先滚到底、再累计翻页行程),但手感会变,已列入真机验收清单第 14 条。

## 9. 被改写的既有用例清单

**本批次交付时没有既有用例被改写断言意图**(真机验收后因需求变更改写了 3 条本批次自己写的用例,见第 15.4 节)。两处非断言的调整:

1. `Fader.test.tsx` 的 `renderFader` 拆成 `faderProps()` + `renderFader()`,以便一次渲染两个推子。既有 19 例一字未改,全部仍绿。
2. `mixer-touch.integration.test.tsx` 既有 8 例未动,只在中间插入一条新用例。

## 10. 评审后的修订

Cursor Bugbot 在首次推送后给出 **1 条 finding**,成立,已修。

**10.1 `Wake playback flag desyncs after interrupt`(Medium)—— 成立,已修。**

- **finding**:`wake-media.ts` 的 `start()` 在 `await video.play()` **之后**才把 `playing` 置真,中间没有检查这段时间里是否跑过 `stop()` 或 `destroy()`;而 hook 的 `startPlayback` 把 `media.playing` 同时当作「在途」与「已持有」来读。窗口期内发生一次可见性变化或卸载,就会留下 `playing === true` 而视频实际已暂停,此后每一次手势都会被 `media.playing` 挡掉、不再调 `start()`,降级路径从此不再常亮。
- **判断**:成立,而且是真机上很容易撞到的时序——手指触屏触发 `play()`,在它落地之前平板进了锁屏。屏幕会在「一切看起来正常」的情况下熄掉。
- **复现用例**(先写,确认变红):`use-wake-lock.test.tsx` 的 `plays again after being hidden while play() was still in flight`——把 `HTMLMediaElement.prototype.play` 换成一个手动控制的 promise,在 resolve 之前切到 `hidden`,再 resolve,然后回到 `visible` 并再次 `pointerdown`,断言 `play()` 被第二次调用且状态最终为 `active`。修复前这条红在「第二次调用」上。
- **改法**:控制器加一个 `playGeneration` 计数。`start()` 在发起前 `+1` 并记下当时的代号,`await` 之后代号不一致就直接返回、**不**置 `playing`;`stop()` 与 `destroy()` 各自 `+1`,因此任何一次暂停或拆除都会作废在途的那次播放。`playing` 于是只在「这次 start 一路跑完且期间没被打断」时才为真。
- **回归锁**:上面那条用例;`wake-media.ts` 语句覆盖率由 93.87% 升到 94.64%、分支由 86.66% 升到 88.23%。

处理完之后又等了一轮,没有新的 finding。

## 11. 依赖清单

**无新增依赖,`pnpm-lock.yaml` 无改动**(`git diff origin/main -- pnpm-lock.yaml` 为空)。

三样东西用到了但没进仓库:

| 东西 | 用途 | 去向 |
| --- | --- | --- |
| nosleep.js 0.12.0 的 `src/media.js` | 摘取两个 data-URI 媒体字符串 | 会话临时目录 `npm pack` 解开,**字符串**复制进 `wake-media.ts` 并注明来源与 MIT 许可;包本身不是依赖 |
| `playwright-core` | 驱动本机已装的 Chrome 做冒烟 | 只装在会话临时目录的 `package.json` 里 |
| `socket.io` | 合成电平服务 | 复用 `apps/server/node_modules` 里现成的,没另装 |

## 12. 遗留问题与移交事项

1. **真机验收全部移交用户**,清单见第 6 节。本会话没有任何触屏设备,所有触屏手感只能由用户确认;冒烟里的「触摸上下文」是 Chromium 模拟的,不能代替真机。
2. **常亮已在平板上验收通过**(见第 14、15 节)。修好的是这台平板上这个 Chrome 版本的行为——面积门槛是 Chrome 的实现细节,没有文档,版本更新可能再次改变。真正的兜底仍然只有回到本节第 6 条的诊断办法重测一轮。
3. **`-webkit-touch-callout` 在 Chrome 里测不到**,长按菜单的实际行为要在真机(尤其 iOS Safari)上看。
4. **`overscroll-behavior: none` 之后「滚到底再翻页」的手感变化**需要用户确认,见 8.10。
5. **PWA 安装在 `http` 下不会真正发生**,manifest 与 meta 已就位,但本项目是本地部署、不打算引入 HTTPS,所以这一条实际上不会生效——留着无害,也不必为它做什么。平板顶部状态栏的进一步隐藏方案(APK 封装、adb 之类)按提示词不在本批次。
6. **6.3 的触控板翻页复测仍未完成**,与本批次无关,继续挂在 6.3 名下。
7. **安全约束原样继续生效**:真机验收只允许动 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原,不得切 ON/mute、不得动其它通道、不得删改任何通道。

## 13. 提交记录

| 提交 | 内容 |
| --- | --- |
| `03c12e0` | `style(web): make the stylesheet fit a desk reached by finger` —— 四条全局规则、`dvh`、22 个 hover 块进媒体查询、7 个合写选择器拆开、`styles.test.ts` |
| `4ab8a82` | `fix(web): give each fader cap to one finger at a time` —— pointerId 过滤、清理顺序、拖动类计数 |
| `bc3f542` | `fix(web): never start a page turn on the ON button` —— `data-swipe="none"` 约定与排除条件 |
| `6ab2486` | `feat(web): hold the screen awake while the mixer is open` —— 两条路径、媒体控制器、jsdom stub |
| `6ea0bda` | `feat(web): put a full screen button in the mixer header` —— hook 与页头按钮 |
| `5716d76` | `feat(web): add the web app manifest and the icons that go with it` —— manifest、两个 PNG、apple meta |
| 评审后 | `fix(web): do not record a wake video as playing if it was stopped first` —— Bugbot 10.1 |

文档与报告另起一次提交。全部按 Conventional Commits,英文。

## 14. 真机验收后的修订:常亮在平板上不生效

PR 开出后用户在安卓平板上验收,**视频降级路径没有生效**:刷新页面、点过屏幕之后,到了系统熄屏时间屏幕照样变暗。这一节记录查因、实测与改法。

### 14.1 现象与最初的误判

用户报告:开了开发者选项的「充电时不锁定屏幕」,所以不锁屏,但到默认熄屏时间仍然**变暗**。变暗就是 screen timeout 在走,说明锁根本没拿到。

我最初的猜测是「1×1 px + `opacity: 0` 过不了 Chrome 的可见性判定」。**这个猜测只对了一半**,而且如果照它直接改,会改错方向——见下面 F 与 I 的对比。

### 14.2 诊断办法

写了一个只在会话临时目录里的探针页(Node 静态服务,3200 端口,监听全部网卡,不碰仓库、不碰 3000/5173),把同样的两个素材按不同形状挂上去,一次测一个,页面实时显示 `paused`、`currentTime`、`readyState`、元素矩形、IntersectionObserver 的相交比例、`muted`/`volume` 与页面可见性,并有一个从点下按钮起算的计时器。用户把熄屏时间调到最短,逐个形状放置观察。

### 14.3 实测结果(目标平板,Android Chrome)

| 形状 | 配置 | 结果 |
| --- | --- | --- |
| A | 1×1 px,`opacity: 0`,muted | **熄屏**(复现了缺陷) |
| F | 160 px 方块,`opacity: 1`,muted,**肉眼可见** | **熄屏** |
| I | 铺满视口,`opacity: 1`,muted | **常亮** |
| J | 铺满视口,`opacity: 0`,muted | **常亮** |
| G | 1×1 px,`opacity: 0`,**不 muted**,音量 1 | **常亮** |
| H | 1×1 px,`opacity: 0`,不 muted,**音量 0** | 熄屏 |
| W | 原生 `navigator.wakeLock` | 不可用(`secure context: NO`,API 不存在) |

所有形状的视频都确实在播(`paused` 为 false、`currentTime` 在 0–0.5 之间跳动),所以这不是播放失败,是拿不到锁。

三条结论:

1. **F 是决定性的**。一个明明白白看得见、正在播放的视频拿不到锁——所以问题**不是**「元素被藏起来了」。我最初的猜测到此被推翻。
2. **I 与 F 只差尺寸**,I 拿得到锁。所以 Chrome 对静音视频有一个**可见面积门槛**:160 px 方块不够,铺满视口够。
3. **J 与 I 只差 `opacity`**,J 同样拿得到锁。所以 Chrome **不看 `opacity`**,只按几何判可见性(与 IntersectionObserver 同一套)。满屏 + 全透明因此两全:拿得到锁,又完全不影响界面。
4. G 与 H 的对比给出另一条路:不静音的媒体在**任何尺寸**都能拿到锁,但**音量必须大于 0**——H 把音量归零就失效。

### 14.4 改法

`.wake-media` 由「左下角 1×1 px」改为**铺满视口、`opacity: 0`、`pointer-events: none`、`z-index: 40`**(现有最大 `z-index` 是 `.notice` 的 30,所以这张透明布在所有 UI 之上,与实测形状的层叠位置一致;`pointer-events: none` 保证它不吞掉任何一次触摸)。`use-wake-lock.ts` 与 `wake-media.ts` 的逻辑一行未改——问题自始至终只在那几行 CSS 里。

`styles.test.ts` 新增一条回归锁,断言 `.wake-media` 是 `100%` × `100%` 的 `position: fixed`、带 `pointer-events: none`、且不是 `display: none` 或 `visibility: hidden`。这条几何是拿真机换来的,而全网的示例写法都是「一个像素的小方块」;没有这条锁,谁顺手把它改回去,屏幕就会在演出中途熄掉,而其余 480 个用例一个都不会发现。

**没有采纳 G 那条路**(不静音播放)。它要求浏览器持续输出音频流才有效,会去抢 Android 的 audio focus、可能压低或打断别的应用的声音,通知栏还可能挂一个媒体会话。在一台演出现场的控制平板上,这个代价不该为「屏幕别熄」而付。这是一次有意的取舍,不是遗漏。

### 14.5 一处必须更正的错误陈述

本报告第 3.5 节、`docs/architecture.md`、`wake-media.ts` 的文件头注释,以及提交 `6ab2486` 的提交信息里,都写了素材「**没有音频轨**」。**这是错的。**

解码核实(Chrome 的 `OfflineAudioContext.decodeAudioData`,两个素材各一次):

| 素材 | 声道 | 采样率 | 时长 | 峰值采样 | 峰值 |
| --- | --- | --- | --- | --- | --- |
| webm (Vorbis) | 2 | 48000 Hz | 1.057 s | 0 | −∞ dBFS |
| mp4 (AAC) | 2 | 48000 Hz | 1.057 s | 0 | −∞ dBFS |

两个素材**都带一条音频轨**,内容是**数字静音**(每一个解码采样都是 0)。nosleep.js 依赖的正是这条「听得见但是空的」轨道——那也正是 G 形状能生效的原因。

所以「浏览器绝不出声」这个保证,实际上只由 `muted` + `defaultMuted` 这一道守着,而不是我先前声称的「素材无音频轨」那一道。素材本身的静音是第二道防线,不是第一道。源码注释、架构文档与本报告都已改正;提交 `6ab2486` 的信息无法在不打乱评审历史的情况下修改,这里明确记下它那一句是错的。

### 14.6 仍然移交用户

- 这次修好的是**这台平板上这个 Chrome 版本**的行为。面积门槛是 Chrome 的实现细节,没有文档,任何一次版本更新都可能再次改变。视频这条路是这个项目唯一的路:本地部署不引入 HTTPS,所以安全上下文与原生 Wake Lock API 不在考虑之内。哪天它再次失效,重新跑一遍 14.2 的诊断办法即可。
- **用户已复测通过**:常亮生效,且满屏透明视频没有影响任何触摸操作(推子、ON、翻页、安全区滑动照常)。

## 15. 常亮跟随台子的在线状态

第 14 节把常亮修到生效之后,用户提出了使用场景带来的第二个要求:平板是**接在跑服务的那台电脑上充电**的,所以

> 电脑关机 → Fairlight 离线 → 平板可以休眠;电脑开机 → 平板充电自动亮屏 → Fairlight 重连 → 常亮再次接管。

原先 `useWakeLock(true)` 是写死的:只要混音页开着就一直点着屏幕,电脑关了平板也整夜亮着。

### 15.1 判据

```ts
const deskOnline = socketConnected && emberStatus === 'connected';
const wakeLockStatus = useWakeLock(deskOnline);
```

两个条件都取自 `mixerStore` 里**已有**的字段,没有新增状态。用两个而不是一个是有意的:电脑关机时后端进程先没,**socket 会先断**,不必等 Ember 的超时——常亮当场放手,平板立刻开始走自己的熄屏计时。反过来开机时,socket 重连与 Ember 接上都到位才重新点亮。`reconnecting` 这类中间态一律不算在线,宁可让屏幕暗一会儿,也不要在台子其实没回来的时候空点着。

### 15.2 一个必须同时解决的问题:没有人会来碰平板

原实现按提示词第 5 节写成「只在用户第一次交互之后开始播放」。在新场景里这条直接把需求堵死:电脑开机后**平板是自己亮的,身边没有人**,永远等不到那次 `pointerdown`,常亮也就永远恢复不了。

改法的依据是一条平台事实:**静音媒体不受自动播放策略约束**,`muted` 的视频不需要任何手势就能 `play()`。所以视频现在在 `enabled` 成立时自己开始播;`pointerdown` / `keydown` 两个监听**保留**,作为某些引擎仍然拒绝自动播放时的兜底,`visibilitychange` 回到可见时也自己再试一次。这一条是对提示词原定「触发时机由用户决定」的**有意偏离**,理由就是上面这个场景——旧的时机会让新需求无法实现。

顺带修掉了同一处的一个时序缺陷(与第 10.1 节 Bugbot 那条同源,只是换到了 hook 这一层):自动播放的 promise 落地时原本无条件宣告 `active`,哪怕这期间页面已经隐藏、视频已被 `stop()`。现在要 `media.playing` 仍为真才宣告——那个标志由控制器的 `playGeneration` 守着。回归锁是 `plays again after being hidden while play() was still in flight`,改动前它确实变红。

### 15.3 浏览器实测

用 Playwright 驱动本机 Chrome,对着生产构建、走**局域网地址**(非安全上下文,与平板一致),合成服务加了几个开关用来扮演关机与开机。**全程没有向页面发过任何手势**——这正是要验证的事。7 项全通过:

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1 | 该源上的 `navigator.wakeLock` | `undefined`(与平板一致,走视频路) |
| 2 | 页面加载后,未触碰任何地方 | `data-wake-lock` 为 `active`,视频在场且 `paused === false` |
| 3 | Ember 掉线 | 变 `idle`,视频元素被移除 |
| 4 | Ember 回来(仍未触碰) | 自己变回 `active`,视频重新在场并播放 |
| 5 | 整个后端断开(传输层断,等同关机) | 变 `idle`,视频被移除 |
| 6 | 后端回来、socket 自动重连(仍未触碰) | 自己变回 `active` |
| 7 | 用 CDP 双指拖推子 | −20 → −11.1,**满屏透明视频没有挡住触摸** |

第 5 步有个坑值得记:最初用服务端的 `socket.disconnect()` 模拟关机,客户端收到的是 `io server disconnect`,socket.io **按设计不会自动重连**,于是第 6 步失败了。真实的关机是传输层在客户端脚下断掉,那种情况客户端会自己重连。改用 `io.engine.close()` 之后 6 与 7 都通过。**这是模拟方式的错,不是产品缺陷**——但如果当时不查清楚就去改产品代码,就会修错东西。

第 7 步之前也失败过一次,原因是第 6 步没恢复、断线态下推子本来就被禁用,是连带结果而非透明布挡住了触摸。

### 15.4 第二轮 Bugbot:把暂停读成了拒绝

自动播放这一版推上去之后,Bugbot 又给出一条 finding,**成立,已修**。

- **finding** `Aborted play marks wake lock denied`(Medium):新的自动播放路径把每一次 `play()` 被拒都当成真正的拒绝。而**暂停一个正在启动的视频,按规范就会让那个 pending 的 `play()` 以 `AbortError` 被拒**。于是页面每隐藏一次,状态就错报一次 `denied`,还把 `warnOnce` 仅有的一次额度花掉;这个拒绝甚至可能在后来的一次 start 已经开始之后才落地,覆盖掉正确的状态。
- **判断**:成立。平板每被瞥开一眼、每次锁屏都会撞上,而且它吃掉的那一次警告额度,本该留给真正的拒绝。第 14 节加的 `playGeneration` 只护住了 resolve 那一侧,reject 这一侧漏了。
- **复现用例**(先写,确认变红):`does not read a pause as a refusal`——让 `play()` 返回一个手动控制的 promise,在隐藏页面之后才以 `AbortError` 拒绝它,断言状态仍是 `idle`、`console.warn` 一次都没有;随后让一次**真正的**拒绝发生,断言这时才变 `denied` 并且警告额度还在。修复前它红在第一个断言(`denied` ≠ `idle`)。
- **改法**:修在控制器里,因为只有它知道自己那次播放是否已被作废。`start()` 用 `try/catch` 包住 `await video.play()`:代号已经变了就**静默返回**(那个拒绝是暂停本身),代号没变才把错误原样抛给 hook。
- **回归锁**:上面那条用例;`wake-media.ts` 语句覆盖率随之升到 95% 一带。

### 15.5 被改写的既有用例

本节改写了 **3 条**本批次自己写的用例,因为它们断言的正是「等手势」这条已被需求推翻的语义:

| 用例 | 改法 |
| --- | --- |
| `waits for a gesture, gives up the screen when hidden and waits again` | 改名为 `starts on its own, gives up the screen when hidden and comes back unprompted`,断言挂载即播、隐藏即停、回到可见自己恢复 |
| `plays again after being hidden while play() was still in flight` | 去掉手动触发的 `pointerDown`,改由自动播放发起;断言不变 |
| `takes a refused play quietly` | 补一条:兜底手势再被拒时,`console.warn` 仍然只有一次 |
| 集成 `keeps the screen awake through the video fallback…` | 去掉「点击后才 active」,改为挂载后自行变 `active` |

新增 5 条:引擎拒绝自动播放时手势兜底、台子离线不持有且回来自动恢复(单测)、Ember 掉线与回归的完整往返(集成)、在途播放被暂停追上时不宣告 `active`、以及 15.4 的「暂停不是拒绝」。

用例数 481 → **485**,`apps/web` 覆盖率 Statements 96.9% 一带,门槛 80% 未动。

### 15.6 文档口径的调整

用户明确了两件事,文档按此改口径:

- **不做 HTTPS**,这是本地部署的项目;
- **`chrome://flags` 的做法用户自己知道**,不落进文档、也不进计划。

所以架构文档、本报告第 6 节的验收清单、第 12 节遗留事项与第 14.6 节里所有「开 Chrome 标志」「把 HTTPS 提前做掉」的建议全部删除。保留的只是一条**事实**:Wake Lock API 只在安全上下文暴露,平板走 `http` 因此永远走视频那条路——它解释了降级路径为什么存在,不是建议。第 6 节的常亮验收条目相应改写为「不碰屏幕即应常亮」「关掉电脑应当放手」「开机后应当自己接管」三条。

## 16. 全屏键移进安全区

用户在平板上用下来的第二条反馈:页头那个 `FULLSCREEN` 文字按钮**太小了**,要求把它放到**右下角、与翻页按钮同等大小**。

### 16.1 这动了一条本批次立的约定

提示词第 6 节与「硬性约束」都写着:安全区「**也不放 Fullscreen 按钮**(它只放翻页控件,6.3 的约定)」。本节把它放进去了,是**用户明确要求**的变更。

之所以认为这不是在拆安全区的台:那条约定背后真正的底线是「**安全区里不得有任何影响声音的控件**」——它是「可以随便碰的表面」这个性质的前提。全屏切换只动浏览器自己的边框,碰不到任何通道,而且完全可逆。底线没有被动,被动的是「只放翻页控件」这句更紧的措辞。`docs/development-plan.md` 的 6.4 交付物里那句「安全区不放它」因此与现状不符,按约定该文件只由用户改,这里标出。

### 16.2 做法

- 键放在滑动轨道 `[data-swipe-surface]` **之后**,而轨道是 `flex: 1`——于是它自然落在安全区的最底部,也就是屏幕右下角。
- 直接复用 `page-rail__step` 类,**没有新增任何 CSS**:尺寸、边框、内陷高光、按下质感与两个翻页键完全一致。浏览器实测两者都是 **53 × 42 px**。
- 图标是四角括号(进入)与向内四角(退出),`strokeWidth` 与翻页箭头同为 2.4。
- **状态由 `aria-label` 表达,不用 `aria-pressed`**(`Enter full screen` / `Exit full screen`)。安全区的体检用例原本断言「区内没有任何带 `aria-pressed` 的按钮」,理由是带按下态的按钮只可能是通道控件;沿用这条比破例更好,而且对读屏器来说,标签直接说出下一步动作反而更清楚。
- 页头那个文字按钮同时**撤掉**,不留两个入口。

### 16.3 新的安全性质与回归锁

这个键坐在拇指滑动翻页的落点上,所以多了一条必须成立的性质:**从它上面滑动翻页,不得把桌子切进全屏**。

6.3 已有的机制正好覆盖:手指从安全区任何地方(包括这个键)都能起手翻页——它没有标 `data-swipe="none"`,那会白白挖掉一块可滑动面积——而翻过页的手势在 `touchend` 上 `preventDefault`,松手处的控件因此不会被按。

新增两条集成用例:

| 用例 | 锁住什么 |
| --- | --- |
| `does not open full screen with a swipe that came to rest on its key`(`mixer-touch`) | 从该键上拖过阈值:页码变了、`requestFullscreen` **一次都没被调用**、`touchend` 被拦下;而一次没翻页的轻点仍然是轻点 |
| `keeps the full screen key to the browser chrome and out of the sound`(`mixer-pages`) | 装上全屏 API 之后,安全区的按钮名单恰好是四个、**没有一个带 `aria-pressed`**、区内仍然没有 slider 或 switch |

既有的 `keeps every control that could change the sound out of the rail` 一字未改:jsdom 没有 `fullscreenEnabled`,那条用例里这个键本就不渲染,它锁的仍是原来的三个控件。

### 16.4 浏览器实测

生产构建 + 触摸上下文,9 项全通过:键在安全区内、是区内最后一个控件、与翻页键**同宽同高**、位于安全区底部、安全区贴着视口右缘;用**手指轻点**能进全屏、键随即改为提供退出、再点退出。截图见会话临时目录 `rail-fullscreen.png`。

用例数 485 → **487**。
