# anime-sedai（动画世代 · 扩展版）

一个纯前端的「动画世代墙」：点选你看过的动画，生成可分享的成绩单图片。数据来自 [bgm.tv](https://bgm.tv)。

> 本仓库 fork 自 [egoist/anime-sedai](https://github.com/egoist/anime-sedai)，感谢原作者 **EGOIST**。
> 扩展与维护：**ttzg** · 主站 [https://ttzg.site](https://ttzg.site) 。遵循 MIT 协议（保留原作者版权）。

## 相比原版新增

- **国别筛选**：新增「日本 / 全部 / 欧美 / 中国 / 美国」（**默认日本**）。
  - **排序口径不同（页面有说明）**：**日本按收藏总数排序**（想看+看过+在看+搁置+抛弃，复用原作者人工精翻标题）；**其余地区按评分排名(rank)** 排序；中国合并 TV 与 WEB（网络动画）按评分排序。
  - 仅保留确有数据的地区；英国/韩国/港台/俄/苏/捷/马来等在 bgm「TV 动画」下过于稀疏或为空，已剔除。
- **年份**：默认展示 **2006–2026**；「自定义」区间可**回溯到上世纪**，且**按所选国别的实际数据跨度自适应**（日本/全部/欧美/美国可至 1960；中国 1979 起）。
- **自定义年份区间**：年份范围选「自定义」后出现风格一致的双滑块。
- **移除**原版的 AI「锐评」提示词与 ChatWise 入口。
- 三语界面（中 / English / 日本語）。

## 开发

安装依赖：

```bash
bun install
```

本地运行：

```bash
bun dev
```

构建 / 类型检查：

```bash
bun run build
bun run typecheck
```

## 数据

数据固化在 `anime-data.json`（`{ 国别: { 年份: 动画[] } }`，每格存 Top-30），由 `anime-data.ts` 内联导入打包。

抓取脚本 `scripts/update-data.ts` 走 **bgm 官方 API**（`GET https://api.bgm.tv/v0/subjects`）。bgm 网页列表页已被 Cloudflare 挑战 / 登录墙拦截，HTML 抓取不再可用。
每个年份只拉一次全量 TV（中国另加 WEB），在本地按条目的 `meta_tags`（日本/中国/欧美/美国）分拣到各国别，再各自排序取前 30：

```bash
# 全量重建：5 国 × 1960..今年（约 15 分钟；支持断点续抓，缓存在 .cache/bgm-api/）
bun run data:init

# 增量更新：当年（东八区）× 5 国，只替换这些切片；1 月额外定稿上一年
bun run data:update

# 指定年份 / 指定国别
bun run data:update --year=2025,2026
bun run data:update --country=中国
```

写入是原子的：先下载完所有数据，任何请求失败即以 exit 1 退出、不碰数据文件；全部成功后合并 → 写 `.tmp` 并校验 → 原文件备份为 `.bak` → 替换 → 删除 `.bak`。若上次在替换途中中断，下次启动会先用 `.bak` 还原。

bgm 每条目仅提供中文译名与原文标题，无独立英文标题，故英/日标题回退为原文标题；
`scripts/curated-titles.json` 保存了原作者对约 400 部番的人工精翻，抓取时按中文名匹配复用（标题增强）。

## 自动更新

`.github/workflows/update-data.yml` 每月 1 号（UTC 00:00）自动增量更新「当年 × 5 国」，有变化则自动提交。也可在 Actions 页手动触发，并可填写年份。
抓取失败时工作流会标红（GitHub 会邮件通知），部署工作流只在数据更新成功后才跟进。

## 部署（GitHub Pages）

`.github/workflows/deploy.yml` 在「推送到 main」「月度数据更新完成后」「手动触发」时，构建并部署到 GitHub Pages（自定义域名 `anime-sedai.ttzg.site`，`public/CNAME` 提供）。

首次启用需要：

1. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**；
2. 在 自定义域名 的 DNS 添加一条 `CNAME` 记录：`anime-sedai` → `<你的GitHub用户名>.github.io`；
3. 在 **Settings → Pages → Custom domain** 填入 自定义域名 并勾选 Enforce HTTPS。
