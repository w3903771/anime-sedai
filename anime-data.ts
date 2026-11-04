// 国别 / 排序 / Top-K 等配置。只放常量与纯函数、不引入数据本体，
// 供前端、抓取脚本(scripts/update-data.ts)与构建插件(vite-plugin-anime-data.ts)共用。
// 数据按国别拆包、按需加载，见 src/data.ts。
import type { Language } from "./src/i18n"

export type AnimeItem = {
  titleZh: string
  titleEn: string
  titleJa: string
}

// 单个国别的数据：year -> 动画列表
export type CountryData = {
  [year: string]: AnimeItem[]
}

// 国别清单（key = bgm 中文地区标签）。"全部" 对应不带地区过滤的全部 TV 动画。
export const ALL_COUNTRY = "全部"

// 国别清单（日本为默认）。仅保留在 bgm「TV 动画」下确有数据的国别
//（英国/俄罗斯/韩国/港台等过于稀疏或为空，已剔除）。
export const COUNTRIES = ["日本", ALL_COUNTRY, "欧美", "中国", "美国"] as const

export type Country = (typeof COUNTRIES)[number]

export const DEFAULT_COUNTRY = "日本"

// 国别 → 数据 chunk 名（构建产物文件名用 ASCII）
export const COUNTRY_SLUG: Record<Country, string> = {
  日本: "jp",
  全部: "all",
  欧美: "west",
  中国: "cn",
  美国: "us",
}

// 排序口径（与 scripts/update-data.ts 的 RULES 保持一致）：日本按收藏总数(collect)；
// 其余地区按评分排名(rank)。页面需向用户说明这一差异。
export type SortBy = "collect" | "rank"
export const getCountrySort = (country: string): SortBy =>
  country === "日本" ? "collect" : "rank"

// 「每年数量」(Top-K) 上限：数据每格最多存 30 条（抓取脚本 PER_YEAR 同此值）
export const MAX_TOPK = 30
// 所有国别默认都用最大值（每格尽量多显示）
export const getDefaultTopK = (_country: string): number => MAX_TOPK

// 根据语言获取动画标题（拼接字段名 titleZh / titleEn / titleJa）
export const getAnimeTitle = (anime: AnimeItem, language: Language): string => {
  return anime[
    ("title" +
      language.charAt(0).toUpperCase() +
      language.slice(1)) as keyof AnimeItem
  ] as string
}
