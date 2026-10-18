# agnes-media

Agnes Media Studio —— DSH 的 AI 生图 / 生视频工作台（v2）。

## 特性

### 界面：三个入口，一套组件

| 入口 | 位置 | 用途 |
|---|---|---|
| 侧栏面板 | `sidebar.panellist` + `main` | 常驻工作台页面，与「插件」「定时任务」并列 |
| 会话头按钮 | `conversation.session.header.utilities` | 在对话里一键拉起抽屉，不打断当前上下文 |
| 浮层抽屉 | `shell.overlay` | 从右侧滑出，遮罩 + Esc 关闭；**完全不触碰输入框与发送按钮** |

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
| `pageEnabled` | `true` | 侧栏工作台入口的**初始**值（详情页开关会覆盖） |
| `drawerEnabled` | `true` | 会话内抽屉入口的**初始**值（详情页开关会覆盖） |

两个入口开关在**插件详情页**（设置 → 插件 → Agnes Media Studio）里控制，
写入 `~/.dsh/agnes-media/entries.json`，刷新和重启后保持。

`cordis.patch.yml` 里这两个值只是初始值；一旦用户在详情页动过开关，就以存储的
偏好为准。patch 显式设为 `false` 时仍然优先（管理员可以钉死某个入口）。

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
    ├── index.tsx        # 入口：四个席位 + 抽屉状态 + 开关同步
    ├── studio.tsx       # 工作台 UI（页面与抽屉共用）
    ├── entries.tsx      # 插件详情页的入口开关
    ├── api.ts           # 宿主桥
    ├── upload.ts        # 本地图片 → data URI（缩放 / 格式 / 上限）
    ├── styles.ts        # 主题 token 样式
    └── locales.ts       # 中英文
```

## 开发

```bash
npm install              # 拉取开发依赖（esbuild / typescript / react 等）
npm run typecheck        # tsc --noEmit
npm run build            # esbuild → lib/host.js + lib/client.js
npm test                 # tools/verify.mjs（134 项）+ tools/upload-check.mjs（17 项）
node tools/live-check.mjs --key sk-...   # 真实网关联调（含视频出片）
```

> `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools` 是 **peerDependencies**，
> 由 DSH 宿主提供。开发时若要在仓库内直接跑测试，需让它们可解析
> （例如 `npm install` 后手动链接宿主内的对应包）。

## 设计要点（踩过的坑）

1. **不劫持发送按钮。** 前代插件在 `window` 捕获阶段拦点击并 `stopImmediatePropagation()`，把 React 合成事件一起掐死。本插件不注册任何 `window` 级 click/keydown，也不取消事件。
2. **图片的 `response_format` 必须在 `extra_body` 里**，放顶层无效；图生图的参考图同理走 `extra_body.image`。
3. **视频轮询只有 `/agnesapi?video_id=…&model_name=…` 是文档契约**；`/v1/videos/{id}` 虽可用但状态词不同（`queued` vs `pending`），双契约探测只会制造混乱，v2 起只走一条。
4. **`size` 只能是 `720P`**，`seconds` 4–12 字符串，`mode` 必填且与媒体字段互斥 —— 全部在**建任务前**校验，失败不产生费用。
5. **不要把 API key 发给 CDN**：下载只对 `agnes-ai.cn` / `agnes-ai.com` 附带 `Authorization`。
6. **任务状态归宿主所有**：客户端只轮询宿主，不做本地任务状态机，所以刷新/关面板不会丢进度。

## License

MIT
