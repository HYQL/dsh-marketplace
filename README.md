# dsh-marketplace

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合。

## 收录插件

| 插件 | 版本 | 说明 |
|---|---|---|
| [agnes-media](./agnes-media) | 2.0.0 | Agnes Media Studio — AI 生图 / 生视频工作台。侧栏页面 + 会话浮层双入口（详情页可分别开关），宿主侧任务队列（刷新/重启不丢、可续跑）。支持文生图 / 图生图 / 多图合成、文生视频 / 首尾帧 / 参考素材 / 一步流图生视频，5 个 Agent 工具。 |

## 安装

### 方式一：本地目录安装（推荐）

```bash
# 进入 profile 目录（按实际 profile 名替换 desktop）
cd ~/.dsh/profiles/desktop

# 安装本仓库中的插件
npm install /path/to/dsh-marketplace/agnes-media
```

然后在 profile 的 `package.json` 里把插件加入 bundles：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "agnes-media"
      ]
    }
  }
}
```

最后**重启 DSH**（宿主半改动需要重启才生效；只改客户端刷新页面即可）。

### 方式二：git 克隆

```bash
git clone https://github.com/HYQL/dsh-marketplace.git
cd dsh-marketplace/agnes-media
npm install
npm run build      # 若 lib/ 已随仓库提供则可跳过
```

## 各插件的文档

每个插件子目录下都有自己的 `README.md`（技术说明）与 `USAGE.md`（使用手册）。

## 环境要求

- Node.js 20+
- DeepSeek Harness 0.2.x
- 各插件的 API Key（见对应插件文档）

## License

各插件目录下的 `LICENSE` 为准。本仓库的组织文件（含本 README）以 MIT 发布。
