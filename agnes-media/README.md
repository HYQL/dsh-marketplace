# agnes-media

Agnes Media Studio —— DSH 的 AI 生图 / 生视频工作台（v2）。

## 特性

### 界面：三个入口，一套组件

| 入口 | 位置 | 用途 |
|---|---|---|
| 侧栏面板 | `sidebar.panellist` + `main` | 常驻工作台页面，与「插件」「定时任务」并列 |
| 会话头按钮 | `conversation.session.header.utilities` | 在对话里一键拉起抽屉，不打断当前上下文 |
| 浮层抽屉 | `shell.overlay` | 从右侧滑出，遮罩 + Esc 关闭；**完全不触碰输入框与发送按钮** |
| 入口开关 | `plugins.bundle.config` | 「插件」页里 **Agnes Media Studio** 那一页的描述下方（key = 页面自己的包名 `agnes-media`）；同一组件也挂在行页（`<包名>#<行 id>`）上，这样「包含的组件」里那一行的配置按钮不会打开空白页 |

三个入口渲染同一个 `Studio` 组件，因此永远不会各自跑偏。

### 能力

- **图片**：文生图、图生图、多图合成（参考图走 `extra_body.image`），1K–4K × 8 种宽高比，面板实时显示 `size × ratio` 的实际像素
- **视频**：文生视频 / 首尾帧（keyframe）/ 参考素材（reference，图 ≤5、音频 ≤3）/ **提示词一步流**（先生成关键帧再让它动起来，无需自备公共素材 URL）
- **宿主侧任务队列**：生成任务跑在宿主进程，关面板、刷新页面、甚至重启 DSH 都不丢；中断的任务保留 `videoId`，可「继续」而**不重新建任务**
- **免费额度友好**：429 按 6s → 15s → 30s 退避重试；仍失败时任务自动排队重试（15s → 45s → 90s，最多 3 次），面板显示倒计时
- **历史与复用**：历史落盘在宿主，卡片可打开 / 复制提示词 / 复用参数 / 发送到对话 / 重试 / 删除
- **5 个 Agent 工具**：`agnes_media_image` / `agnes_media_video` / `agnes_media_task` / `agnes_media_models` / `agnes_media_history`

### 与对话的双向联动

这是本插件与"一个独立生图页面"的区别所在：

| 方向 | 机制 | 你能做什么 |
|---|---|---|
| **对话 → 面板** | 工具调用结束后，结果自动写入面板同一个任务库，标记「来自对话」 | 对话里让 AI 生成的图/视频，在面板里直接看到、复制提示词、**复用参数**、再发回对话 —— 不用重新生成（也不重复计费） |
| **面板 → 对话** | 有会话绑定时，卡片上的「发送到对话」把结果（含图片 markdown / 视频链接 / 本地路径）发进当前对话 | 在面板调好图，一句话交给 AI 继续加工（配文、做视频、分析） |
| **面板 → Agent** | `agnes_media_history` 工具让 Agent 直接读取面板历史 | 直接说「把刚才那张熊猫做成视频」，AI 自己查到 URL 当首帧，不用你复述 |

面板侧的历史来源判定：抽屉打开时用会话作用域子槽拿到的精确会话；页面版则从 `sessions.list` 的主视图快照解析当前会话。两者都拿不到时不显示「发送到对话」，而不是假装可用。

### 界面细节

- 只用 `--dsw-alias-*` 主题 token 取色，其余颜色由 `color-mix` 派生 → 明暗主题自动跟随，无需第二套规则
- 宽高比选择器带比例缩略框；尺寸/时长用 chip，模式用 segmented 控件
- 抽屉从右侧滑入（`prefers-reduced-motion` 下无动画），键盘焦点环、`aria-*`、`role="dialog"` 齐备

## 使用

1. 侧栏点 **Agnes 媒体** 进入工作台，或在任意会话头部点 ✨ 打开抽屉
2. 选择「图片 / 视频」，输入提示词
3. 调参数（高级里有随机种子与反向提示词）
4. `Ctrl/⌘ + Enter` 或点「生成」（该快捷键提示挂在生成按钮的 tooltip 上，不占页脚）
5. 结果出现在历史里；有会话绑定时可「发送到对话」

## 配置

`cordis.patch.yml`：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `site` | `cn` | `cn`（api.agnes-ai.cn）/ `intl`（apihub.agnes-ai.com） |
| `apiKey` | `null` | 留空则依次查 DSH 凭据服务 → 环境变量 → `~/.dsh/.credentials.yaml` 的 `refs` |
| `imageModel` / `videoModel` | `agnes-image-2.5-flash` / `agnes-video-2.5-flash` | 模型名 |
| `imageDefaults` | `1K` / `1:1` / `n:1` | 图片默认参数 |
| `videoDefaults` | `16:9` / `5s` / `720P` | 视频默认参数（Flash 仅 720P） |
| `requestTimeoutMs` | `120000` | 单次请求超时 |
| `pollIntervalMs` / `pollTimeoutMs` | `5000` / `600000` | 视频轮询间隔与总超时 |
| `maxRetries` / `retryBackoffMs` | `2` / `1000` | HTTP 重试（429 另有独立退避梯度） |
| `downloadDir` | `null` | 生成文件落盘目录（null = 仅返回 URL） |
| `keepDownloads` | `200` | 落盘目录保留文件数 |
| `storeDir` | `null` | 任务库目录，默认 `~/.dsh/agnes-media` |
| `maxHistory` | `60` | 任务库保留条数 |
| `autoInsert` | `true` | 有会话绑定时是否提供「发送到对话」 |
| `pageEnabled` | 不设 | 侧栏工作台入口的**钉死值**：不写 = 由详情页开关（`entries.json`）决定；写 `false` 可禁止用户打开 |
| `drawerEnabled` | 不设 | 会话内抽屉入口的**钉死值**，规则同上 |

两个入口开关在**插件详情页**（「插件」页 → **Agnes Media Studio**）控制，写入
`~/.dsh/agnes-media/entries.json`，刷新和重启后保持。

那一页就是本包自己的 bundle 页：`cordis.patch.yml` 把插件行作为一个 bundle 插入，
profile 的 `dsh.profile.bundles` 也选中了 `agnes-media`，于是插件页给了它一个真正的
`PackageDetail`（图标、描述、插件行）。开关挂在 `plugins.bundle.config` 上，key 用的
就是**页面自己的包名** `agnes-media`；同时也覆盖行页（`<包名>#<行 id>`），这样
「包含的组件」里那个配置按钮不会打开空白页。

> 早期版本另外带了一个伴生组合包 `@local/agnes-media-bundle` 来"制造"一个页面。
> 它没有任何行，只是多出一个空页面，开关也从不需要它，**已移除**：本包自己就是
> bundle，页面本来就有。

> 踩过的坑（两次，都是同一个原因：没有读清楚 shell 的注册契约）：
>
> 1. `plugins.detail.section` 只有在「插件页自己拥有详情页主体」时才渲染；
>    `sidebar.footer.action` 虽然能显示，却把插件设置放进了导航栏。
> 2. **注册必须走 `slots.inject`，不能直接 `register`**。shell 对未声明的槽位
>    直接抛 `slot "…" is not declared (a parent entry's children table must
>    declare it)`，而 `plugins.bundle.config` 是「插件」页挂载时才声明的 ——
>    比插件激活晚。直接 `register` 的异常被 `apply` 的兜底 catch 吞掉，页面照常
>    渲染描述、插件行、来源信息，**唯独没有配置区，且一句日志都不打**。这就是
>    「重启后开关不见了」。同一个错误也潜伏在抽屉的 `agnes-media.workspace` 上。
>
> 还有一条容易误判：重复注册同一个 keyed key **是抛错**，不是后者覆盖前者
> （`keyed slot "…" already has an entry for key "…"`）。所以单元不会被「抢走」，
> 只会「没注册上」。`tools/seat-probe.mjs` 用这套真实语义复现并守护它。

`resolveConfig` 永远返回完整对象，而它会整个交给 `applyPatch`；所以这两个键的
**默认值必须是 `null` 而不是 `true`** —— 否则每次启动都会把入口钉成开启，覆盖用户
存下的关闭状态（这就是"关掉侧栏工作台后刷新，详情页整页消失"的原因）。

关掉某个入口后，它对应的 slot 注册会被完全移除（不只是隐藏），不留 DOM 和监听器。
**关掉抽屉后「发送到对话」仍然可用** —— 会话通道由那个 session 作用域的头部
注册提供，与按钮是否可见无关。

## 结构

```
src/
├── host.ts              # 宿主：5 个工具 + 任务队列 + /agnes-media-studio/api 路由
├── config.ts            # 配置解析（容忍旧字段、钳制非法值）
├── types.ts
├── agnes/
│   ├── registry.ts      # 凭据解析（凭据服务 / env / .credentials.yaml refs）
│   ├── http.ts          # 超时 + 重试 + 429 退避 + 双错误信封归一
│   ├── image.ts         # 图片生成（extra_body 组装）
│   ├── video.ts         # 视频生成 + 模式校验 + /agnesapi 轮询
│   ├── models.ts        # 模型发现
│   ├── download.ts      # 落盘 + 清理（仅对 Agnes 域附带 token）
│   ├── jobs.ts          # 原子写入的持久任务库
│   └── prefs.ts         # 入口开关的持久化（详情页那两个开关）
└── client/
    ├── index.tsx        # 入口：席位注册 + 抽屉状态 + 开关同步
    ├── studio.tsx       # 工作台 UI（页面与抽屉共用）
    ├── seats.ts         # 入口开关挂在哪几个 bundle 页 + 注册契约
    ├── entries.tsx      # 插件详情页的入口开关
    ├── entry-state.ts   # 两个开关的共享 store（同步通知，非轮询）
    ├── api.ts           # 宿主桥
    ├── upload.ts        # 本地图片 → data URI（缩放 / 格式 / 上限）
    ├── styles.ts        # 主题 token 样式
    └── locales.ts       # 中英文
```

## 开发

```bash
npm install
npm run typecheck     # tsc --noEmit（stub 与真实 slot 契约一致，应零错误）
npm run build         # esbuild → lib/host.js + lib/client.js
npm test              # tools/verify.mjs + tools/upload-check.mjs
node tools/seat-probe.mjs   # 用真实槽位语义复现「开关消失」
node tools/route-probe.mjs  # 宿主 HTTP 桥（webServer 晚于插件就绪）
node tools/live-check.mjs --key sk-...   # 真实网关联调（含视频出片）
```

## 设计要点（踩过的坑）

1. **不劫持发送按钮。** 前代插件在 `window` 捕获阶段拦点击并 `stopImmediatePropagation()`，把 React 合成事件一起掐死。本插件不注册任何 `window` 级 click/keydown，也不取消事件。
2. **图片的 `response_format` 必须在 `extra_body` 里**，放顶层无效；图生图的参考图同理走 `extra_body.image`。
3. **视频轮询只有 `/agnesapi?video_id=…&model_name=…` 是文档契约**；`/v1/videos/{id}` 虽可用但状态词不同（`queued` vs `pending`），双契约探测只会制造混乱，v2 起只走一条。
4. **`size` 只能是 `720P`**，`seconds` 4–12 字符串，`mode` 必填且与媒体字段互斥 —— 全部在**建任务前**校验，失败不产生费用。
5. **不要把 API key 发给 CDN**：下载只对 `agnes-ai.cn` / `agnes-ai.com` 附带 `Authorization`。
6. **任务状态归宿主所有**：客户端只轮询宿主，不做本地任务状态机，所以刷新/关面板不会丢进度。
7. **`plugins.detail.section` 不是"插件自己的配置区"**：插件页只会为它拥有的主体（bundle 页 / 行页 / 官方插件页）渲染这个席位。由 `cordis.patch.yml` 直接 `insert` 的条目没有 bundle，注册在里面等于写进一个没人渲染的列表 —— 注册成功、页面上没有。插件要把设置放进「插件」页，就让它成为一个 bundle 的页面内容，配置挂 `plugins.bundle.config`；`sidebar.footer.action` 只适合导航类操作。**并且必须经 `slots.inject` 注册**：槽位在页面挂载时才声明，早于它的 `register` 会抛错并被吞掉（见上文「踩过的坑」）。
8. **HTTP 桥必须等 `ctx.webServer`**：Web 服务在 profile 条目之后才就绪，加载时直接取 `ctx.webServer` 会拿到 `undefined` 并静默不注册 —— 面板上的开关于是变成「HTTP 404」且灰掉。`registerPrefixRoute` 会在服务缺失时轮询（上限 30s）再挂载。
9. **宿主各阶段互不牵连**：`apply()` 原先整段一个 try/catch，`tools` 注册抛错（本机就有一个 schema 不兼容）会连带跳过存储、偏好和 HTTP 桥。现在每个阶段各自 `stage()`，失败只记一条日志。
10. **查状态别信接口**：`/agnes-media-studio/api/*` 在浏览器里对每个请求回 404，旧版本命令行/脚本也同样被挡，所以验证只靠插槽检查与进程内 route-probe（`tools/route-probe.mjs`）。

## License

MIT
