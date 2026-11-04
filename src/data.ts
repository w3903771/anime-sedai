// 数据按国别拆包、按需加载（构建见 vite-plugin-anime-data.ts）。
// - 年份跨度(meta)很小，打进主包，UI 在数据到达前就能确定年份范围；
// - 各国别数据是独立的带 hash chunk，首次访问才下载，之后走浏览器缓存；
// - 模块加载时立即开始拉取「上次选中的国别」，首屏空闲后再预取其余国别，切换即时。
import { useEffect, useState } from "react"
import spans from "virtual:anime-data/meta"
import { COUNTRIES, DEFAULT_COUNTRY, type AnimeItem, type CountryData } from "../anime-data"

export const COUNTRY_SPANS = spans as Record<string, [number, number]>

type Packed = Record<string, ([string] | [string, string] | [string, string, string])[]>

// 必须写成字面量 import()，Vite 才能为每个国别生成独立 chunk
const loaders: Record<string, () => Promise<{ default: Packed }>> = {
  日本: () => import("virtual:anime-data/jp"),
  全部: () => import("virtual:anime-data/all"),
  欧美: () => import("virtual:anime-data/west"),
  中国: () => import("virtual:anime-data/cn"),
  美国: () => import("virtual:anime-data/us"),
}

// 紧凑格式 [zh, ja?, en?] 还原为 AnimeItem（规则见构建插件 pack）
const unpack = (p: Packed): CountryData => {
  const out: CountryData = {}
  for (const [year, list] of Object.entries(p)) {
    out[year] = list.map(([zh, ja, en]): AnimeItem => {
      const titleJa = ja || zh
      return { titleZh: zh, titleJa, titleEn: en ?? titleJa }
    })
  }
  return out
}

const cache = new Map<string, Promise<CountryData>>()
const ready = new Map<string, CountryData>()

export function loadCountry(country: string): Promise<CountryData> {
  let p = cache.get(country)
  if (!p) {
    const load = loaders[country] ?? loaders[DEFAULT_COUNTRY]!
    p = load().then((m) => {
      const d = unpack(m.default)
      ready.set(country, d)
      return d
    })
    // 失败不缓存，下次切换可重试
    p.catch(() => cache.delete(country))
    cache.set(country, p)
  }
  return p
}

// 读取持久化的国别（与 usePersistState("selectedCountry") 同一个 key），尽早开始下载
const initialCountry = (() => {
  try {
    const v = JSON.parse(localStorage.getItem("selectedCountry") ?? "null")
    return typeof v === "string" && v in loaders ? v : DEFAULT_COUNTRY
  } catch {
    return DEFAULT_COUNTRY
  }
})()
loadCountry(initialCountry).then(() => {
  const idle = (cb: () => void) =>
    "requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500)
  idle(() => COUNTRIES.forEach((c) => loadCountry(c).catch(() => {})))
})

// 已缓存的国别同步返回，切换无闪烁；加载失败时给出 retry（chunk 失败不缓存，可重拉）
export function useCountryData(country: string) {
  const [, force] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const data = ready.get(country)
  useEffect(() => {
    if (ready.has(country)) return
    let alive = true
    setFailed(null)
    loadCountry(country).then(
      () => alive && force((n) => n + 1),
      (err) => {
        console.error(`加载 ${country} 数据失败`, err)
        if (alive) setFailed(country)
      }
    )
    return () => {
      alive = false
    }
  }, [country, attempt])
  return {
    data: data ?? EMPTY,
    loading: !data && failed !== country,
    error: !data && failed === country,
    retry: () => setAttempt((n) => n + 1),
  }
}

const EMPTY: CountryData = {}
