# anime-sedai（动画世代 · 扩展版）

一个纯前端的「动画世代墙」：点选你看过的动画，生成可分享的成绩单图片。数据来自 [bgm.tv](https://bgm.tv)。

> 本仓库 fork 自 [egoist/anime-sedai](https://github.com/egoist/anime-sedai)，感谢原作者 **EGOIST**。
> 扩展与维护：**ttzg** · 主站 [https://ttzg.site](https://ttzg.site) 。遵循 MIT 协议（保留原作者版权）。

## 相比原版新增

- **国别筛选**：新增「日本 / 全部 / 欧美 / 中国 / 美国」（**默认日本**）。
  - **排序口径不同（页面有说明）**：bgm 的「热度(trends)」几乎只有日本有数据，故 **日本按热度排序**（沿用原版「历年关注最多」语义，并复用原作者人工精翻标题）；**其余地区按评分排名(rank)** 排序——因为这些地区的热度数据极稀缺，只有排名榜才有内容。
  - 仅保留确有数据的地区；英国/韩国/港台/俄/苏/捷/马来等在 bgm「TV 动画」下过于稀疏或为空，已剔除。
- **年份**：默认展示 **2006–2026**；「自定义」区间可**回溯到上世纪**，且**按所选国别的实际数据跨度自适应**（日本热度数据约 1995 起；全部/欧美/美国按排名可至 1960；中国 1979 起）。
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

数据固化在 `anime-data.json`（`{ 国别: { 年份: 动画[] } }`，每格存 Top-12），由 `anime-data.ts` 内联导入打包。

抓取脚本 `scripts/update-data.ts`（基于 cheerio 解析 bgm 列表页；日本用 `sort=trends`，其余地区用 `sort=rank`）：

```bash
# 首次/全量重建：5 国 × 1960..今年
bun run data:init

# 月度更新：当前年 × 5 国，覆盖该年切片
bun run data:update
```

bgm 每条目仅提供中文译名与原文标题，无独立英文标题，故英/日标题回退为原文标题；
`scripts/curated-titles.json` 保存了原作者对约 400 部番的人工精翻，抓取时按中文名匹配复用（标题增强）。

## 自动更新

`.github/workflows/update-data.yml` 每月 1 号自动重抓「当年 × 5 国」数据，就地修改 `anime-data.json` 并自动提交。也可在 Actions 页手动触发。

## 部署（GitHub Pages）

`.github/workflows/deploy.yml` 在「推送到 main」「月度数据更新完成后」「手动触发」时，构建并部署到 GitHub Pages（自定义域名 `anime-sedai.ttzg.site`，`public/CNAME` 提供）。

首次启用需要：

1. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**；
2. 在 自定义域名 的 DNS 添加一条 `CNAME` 记录：`anime-sedai` → `<你的GitHub用户名>.github.io`；
3. 在 **Settings → Pages → Custom domain** 填入 自定义域名 并勾选 Enforce HTTPS。
