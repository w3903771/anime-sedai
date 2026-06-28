import type { Language } from "./src/i18n"
import rawData from "./anime-data.json"

export type AnimeItem = {
  titleZh: string
  titleEn: string
  titleJa: string
  score: number
}

// 国别维度：country(bgm 中文地区名) -> year -> 动画列表
export type Data = {
  [country: string]: {
    [year: string]: AnimeItem[]
  }
}

const data = rawData as Data

// 国别清单（key = bgm 中文地区标签）。"全部" 排首位且为默认，
// 对应 bgm 不带地区过滤的全地区热度榜。
export const ALL_COUNTRY = "全部"

// 国别清单（日本为默认）。仅保留在 bgm「TV 动画」下确有数据的国别
//（英国/俄罗斯/韩国/港台等过于稀疏或为空，已剔除）。
export const COUNTRIES = ["日本", ALL_COUNTRY, "欧美", "中国", "美国"] as const

export type Country = (typeof COUNTRIES)[number]

export const DEFAULT_COUNTRY = "日本"

// 排序口径：日本用 trends(热度，"历年关注最多"，可复用原作者人工精翻)；
// 其余地区 trends 几乎无数据，只能用 rank(评分排名)。页面需向用户说明这一差异。
export type SortBy = "trends" | "rank"
export const getCountrySort = (country: string): SortBy =>
  country === "日本" ? "trends" : "rank"

// 每个国别默认的「每年数量」(Top-K)。中国含 web，条目更多，默认放宽到 20。
export const getDefaultTopK = (country: string): number =>
  country === "中国" ? 20 : 12

// 取所有国别年份的并集并升序排序，保证年份范围 UI 与选中国别无关、保持稳定。
export const getAllYears = (d: Data = data): string[] => {
  const years = new Set<string>()
  for (const country of Object.keys(d)) {
    for (const year of Object.keys(d[country] || {})) {
      years.add(year)
    }
  }
  return [...years].sort((a, b) => Number(a) - Number(b))
}

// 根据语言获取动画标题（拼接字段名 titleZh / titleEn / titleJa）
export const getAnimeTitle = (anime: AnimeItem, language: Language): string => {
  return anime[
    ("title" +
      language.charAt(0).toUpperCase() +
      language.slice(1)) as keyof AnimeItem
  ] as string
}

export default data
