// 合并式抓取脚本，供「初始化」「月更」「按国别重抓」共用。
//
//   bun run scripts/update-data.ts --init            # 全量重建：5 国 × 1960..今年
//   bun run scripts/update-data.ts --year=2026       # 月更：指定年 × 5 国，合并覆盖该年
//   bun run scripts/update-data.ts --country=中国     # 重抓某国全年份，合并进现有数据
//   bun run scripts/update-data.ts                   # 等价于 --year=<今年>
//
// 口径：bgm「TV 动画」。日本按 sort=trends(热度)，其余按 sort=rank(评分排名)。
// 中国额外抓 web(网络动画，国创主力)，与 tv 合并、按评分一块排序、不区分类型。
// URL：/anime/browser/{地区}/{类型}/airtime/{年}/?sort=xxx（"全部"无地区段）。
// 标题：bgm 无独立英文标题，titleEn/titleJa 回退原文(.grey)；scripts/curated-titles.json
// 里若有该中文名的人工精翻则沿用（标题增强，跨重跑稳定）。
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
type Curated = Map<string, { en: string; ja: string }>

const DATA_PATH = path.join(import.meta.dir, "..", "anime-data.json")
const CURATED_PATH = path.join(import.meta.dir, "curated-titles.json")
const MIN_YEAR = 1960
const CURRENT_YEAR = new Date().getFullYear()
const PER_YEAR = 24 // 存每格 Top-24（bgm 第 1 页上限），供前端自定义 Top-K(最多 24)
const DELAY_MS = 400
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

// 数据/显示用国别名 → bgm 实际 URL 地区标签（当前 5 国均一致，保留以便将来扩展港台等）
const BGM_TAG: Record<string, string> = { 中国香港: "香港", 中国台湾: "台湾" }

// 各国别抓取的 bgm 类型段。默认仅 tv；中国额外含 web，与 tv 合并排名。
const COUNTRY_TYPES: Record<string, string[]> = { 中国: ["tv", "web"] }
const typesFor = (c: string) => COUNTRY_TYPES[c] ?? ["tv"]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i)

function parseArgs() {
  const argv = process.argv.slice(2)
  const init = argv.includes("--init")
  const yearArg = argv.find((a) => a.startsWith("--year="))?.split("=")[1]
  const country = argv.find((a) => a.startsWith("--country="))?.split("=")[1]
  return { init, year: yearArg ? Number(yearArg) : undefined, country }
}

function readExisting(): Data {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"))
  } catch {
    return {}
  }
}

// 从稳定快照加载 中文名 -> 人工精翻 查找表（标题增强）
function loadTitleMap(): Curated {
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

// 抓单个 (国别, 类型, 年份) 的第一页（≤24 条）。null = 抓取/解析失败（重试后仍失败）。
async function fetchOne(
  country: string,
  type: string,
  year: number,
  sort: string,
  titleMap: Curated
): Promise<AnimeItem[] | null> {
  const tag = BGM_TAG[country] ?? country
  const region = country === ALL_COUNTRY ? "" : `/${encodeURIComponent(tag)}`
  const url = `https://bgm.tv/anime/browser${region}/${type}/airtime/${year}/?sort=${sort}`

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
      return items
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  ✗ ${country}/${type}/${year} 抓取失败: ${err}`)
        return null
      }
      await sleep(DELAY_MS * 3)
    }
  }
  return null
}

// 抓一个 (国别, 年份) 切片：单类型保持 bgm 原序；多类型(中国 tv+web)合并后按评分降序。
// null = 该国别所有类型都抓取失败 → 调用方据此「不覆盖」原数据。
async function fetchSlice(
  country: string,
  year: number,
  titleMap: Curated
): Promise<AnimeItem[] | null> {
  const types = typesFor(country)
  const sort = getCountrySort(country)
  const lists: AnimeItem[][] = []
  let anyOk = false
  for (const type of types) {
    const items = await fetchOne(country, type, year, sort, titleMap)
    if (items !== null) {
      anyOk = true
      lists.push(items)
    }
    if (types.length > 1) await sleep(DELAY_MS) // 多类型间礼貌延时
  }
  if (!anyOk) return null
  if (types.length === 1) return lists[0]!.slice(0, PER_YEAR) // 单类型保持原序

  // 多类型：按中文名去重(留高分)，按评分降序「一块排」，取前 PER_YEAR
  const byTitle = new Map<string, AnimeItem>()
  for (const it of lists.flat()) {
    const ex = byTitle.get(it.titleZh)
    if (!ex || it.score > ex.score) byTitle.set(it.titleZh, it)
  }
  return [...byTitle.values()].sort((a, b) => b.score - a.score).slice(0, PER_YEAR)
}

async function main() {
  const { init, year, country } = parseArgs()
  const existing = readExisting()
  const titleMap = loadTitleMap()
  console.log(`标题增强表：${titleMap.size} 条人工精翻可复用`)

  const countries = country ? [country] : [...COUNTRIES]
  // 年份：显式 --year 优先；否则 全量/按国别 跑全年，月更跑当年
  const years =
    year !== undefined
      ? [year]
      : init || country
      ? range(MIN_YEAR, CURRENT_YEAR)
      : [CURRENT_YEAR]
  // 仅「全量 --init(不限国别)」从空开始；其余都在现有数据上合并
  const fromScratch = init && !country
  const data: Data = fromScratch ? {} : existing

  console.log(
    `模式: ${fromScratch ? "全量重建" : "合并覆盖"} | 年份: ${years[0]}–${years.at(-1)} | 国别: ${countries.join(",")}`
  )

  let fetched = 0
  let nonEmpty = 0
  let failed = 0

  const save = () =>
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8")

  for (const c of countries) {
    data[c] ||= {}
    for (const y of years) {
      const key = String(y)
      const items = await fetchSlice(c, y, titleMap)
      if (items === null) {
        failed++
        await sleep(DELAY_MS)
        continue // 不覆盖
      }
      if (items.length > 0) {
        data[c][key] = items
        nonEmpty++
        console.log(`  ✓ ${c}/${y}: ${items.length} 条`)
      } else if (!fromScratch) {
        // 合并模式下，该年现在没数据 → 清掉旧切片
        delete data[c][key]
      }
      fetched++
      await sleep(DELAY_MS)
    }
    save() // 每完成一个国别就落盘，避免中途中断丢失进度
    console.log(`== ${c} 完成，已落盘 ==`)
  }

  save()
  console.log(
    `完成：请求 ${fetched} 格，非空 ${nonEmpty}，失败 ${failed}。→ ${DATA_PATH}`
  )
}

await main()
