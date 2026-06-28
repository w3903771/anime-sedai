// 合并式抓取脚本，供「初始化」和「GitHub Action 月更」共用。
//
//   bun run scripts/update-data.ts --init            # 全量重建：5 国 × 1960..今年，按 rank 抓取
//   bun run scripts/update-data.ts --year=2026       # 月更：指定年 × 5 国，强制覆盖该年切片
//   bun run scripts/update-data.ts                   # 等价于 --year=<今年>
//
// 口径：bgm「TV 动画」。日本按 sort=trends(热度，"历年关注最多")，其余地区 trends 几乎无数据，
// 按 sort=rank(评分排名)。URL 形如 /anime/browser/{地区}/tv/airtime/{年}/?sort=xxx（全部无地区段）。
// 标题：bgm 无独立英文标题，titleEn/titleJa 回退为原文(.grey)；若 scripts/curated-titles.json
// 里已有该中文名的人工精翻，则沿用之（标题增强，跨重跑稳定）。
import { load } from "cheerio"
import fs from "node:fs"
import path from "node:path"
import { COUNTRIES, ALL_COUNTRY, getCountrySort } from "../anime-data.ts"

type AnimeItem = {
  titleZh: string
  titleEn: string
  titleJa: string
  score: number
}
type Data = Record<string, Record<string, AnimeItem[]>>

const DATA_PATH = path.join(import.meta.dir, "..", "anime-data.json")
const MIN_YEAR = 1960
const CURRENT_YEAR = new Date().getFullYear()
const PER_YEAR = 24 // 存每格 Top-24（bgm 第 1 页上限），供前端自定义 Top-K(最多 24)
const DELAY_MS = 400
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

// 数据/显示用国别名 → bgm 实际 URL 地区标签（当前 5 国均一致，保留以便将来扩展港台等）
const BGM_TAG: Record<string, string> = { 中国香港: "香港", 中国台湾: "台湾" }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i)

function parseArgs() {
  const argv = process.argv.slice(2)
  const init = argv.includes("--init")
  const yearArg = argv.find((a) => a.startsWith("--year="))
  const year = yearArg ? Number(yearArg.split("=")[1]) : CURRENT_YEAR
  return { init, year }
}

const CURATED_PATH = path.join(import.meta.dir, "curated-titles.json")

function readExisting(): Data {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"))
  } catch {
    return {}
  }
}

// 从稳定快照 scripts/curated-titles.json 加载 中文名 -> 人工精翻 查找表（标题增强）。
// 用独立快照而非读 anime-data.json，避免重跑时被已覆盖的回退标题污染。
function loadTitleMap(): Map<string, { en: string; ja: string }> {
  try {
    const obj = JSON.parse(fs.readFileSync(CURATED_PATH, "utf-8")) as Record<
      string,
      { en: string; ja: string }
    >
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

// 返回 null 表示抓取/解析失败（重试后仍失败）→ 调用方据此「不覆盖」原数据。
async function fetchSlice(
  country: string,
  year: number,
  titleMap: Map<string, { en: string; ja: string }>
): Promise<AnimeItem[] | null> {
  const tag = BGM_TAG[country] ?? country
  const region = country === ALL_COUNTRY ? "" : `/${encodeURIComponent(tag)}`
  const sort = getCountrySort(country) // 日本=trends，其余=rank
  const url = `https://bgm.tv/anime/browser${region}/tv/airtime/${year}/?sort=${sort}`

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const $ = load(await res.text())
      const items: AnimeItem[] = []
      $(".item").each((_, el) => {
        const titleZh = $(el).find("h3 a.l").first().text().trim()
        const original = $(el).find("h3 small.grey").first().text().trim()
        const score = Number($(el).find(".rateInfo .fade").first().text().trim()) || 0
        if (!titleZh) return
        const curated = titleMap.get(titleZh)
        items.push({
          titleZh,
          titleEn: curated?.en || original || titleZh,
          titleJa: curated?.ja || original || titleZh,
          score,
        })
      })
      return items.slice(0, PER_YEAR)
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  ✗ ${country}/${year} 抓取失败，保留原数据: ${err}`)
        return null
      }
      await sleep(DELAY_MS * 3)
    }
  }
  return null
}

async function main() {
  const { init, year } = parseArgs()
  const existing = readExisting()
  const titleMap = loadTitleMap()
  console.log(`标题增强表：${titleMap.size} 条人工精翻可复用`)

  // init 全量重建从空开始；月更在现有数据上覆盖目标年切片
  const data: Data = init ? {} : existing
  const years = init ? range(MIN_YEAR, CURRENT_YEAR) : [year]
  console.log(
    `模式: ${init ? "init(全量重建)" : "update(覆盖目标年)"} | 年份: ${years[0]}–${years.at(-1)} | 国别: ${COUNTRIES.join(",")}`
  )

  let fetched = 0
  let nonEmpty = 0
  let failed = 0

  const save = () =>
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8")

  for (const country of COUNTRIES) {
    data[country] ||= {}
    for (const y of years) {
      const key = String(y)
      const items = await fetchSlice(country, y, titleMap)
      if (items === null) {
        failed++
        await sleep(DELAY_MS)
        continue // 不覆盖
      }
      if (items.length > 0) {
        data[country][key] = items
        nonEmpty++
        console.log(`  ✓ ${country}/${y}: ${items.length} 条`)
      } else {
        // 空切片：init 时不写入（保持紧凑）；月更时清空该年（可能此前有、现在没了）
        if (!init) delete data[country][key]
      }
      fetched++
      await sleep(DELAY_MS)
    }
    save() // 每完成一个国别就落盘，避免中途中断丢失进度
    console.log(`== ${country} 完成，已落盘 ==`)
  }

  save()
  console.log(
    `完成：请求 ${fetched} 格，非空 ${nonEmpty}，失败 ${failed}。→ ${DATA_PATH}`
  )
}

await main()
