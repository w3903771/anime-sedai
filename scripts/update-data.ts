// 数据抓取脚本（bgm 官方 API），供「全量重建」「月更」「按国别/年份重抓」共用。
//
//   bun run scripts/update-data.ts                   # 月更：当年(东八区)；1 月额外定稿上一年
//   bun run scripts/update-data.ts --year=2025       # 指定年份（可逗号分隔多个）
//   bun run scripts/update-data.ts --country=中国     # 重抓某国 1960..今年，合并进现有数据
//   bun run scripts/update-data.ts --init            # 全量重建：5 国 × 1960..今年
//
// 数据源：GET https://api.bgm.tv/v0/subjects?type=2&cat={1 TV|5 WEB}&year=Y（分页，每页 50）。
// bgm 网页列表页已被 Cloudflare 挑战 / 登录墙拦截，故改走官方 API。
// 每个年份只拉一次「全量 TV(+WEB)」，再在本地按 meta_tags 分拣到各国别、各自排序取 Top-PER_YEAR：
//   日本 = 含「日本」标签，按收藏总数降序
//   全部 = 全部 TV，按评分排名
//   欧美/美国 = 含对应标签，按评分排名
//   中国 = TV+WEB 中含「中国」标签，按评分降序（不区分类型）
// 标题：API 只有中文名(name_cn)与原名(name)，titleEn/titleJa 回退原名；
// scripts/curated-titles.json 里若有该中文名的人工精翻则沿用（标题增强，跨重跑稳定）。
//
// 写入流程（原子性）：先把本次所需数据全部下载到内存/缓存，任何请求失败即中止且不碰数据文件；
// 全部成功后才与原数据合并 → 写 .tmp 并校验 → 原文件备份为 .bak → rename 替换 → 删除 .bak。
// 若上次运行在替换途中中断（残留 .bak），启动时先用 .bak 还原。
import fs from "node:fs"
import path from "node:path"
import { COUNTRIES, ALL_COUNTRY, MAX_TOPK } from "../anime-data.ts"

type AnimeItem = {
  titleZh: string
  titleEn: string
  titleJa: string
  score: number
}
type Data = Record<string, Record<string, AnimeItem[]>>
type Curated = Map<string, { en: string; ja: string }>

// API 条目的精简形态（只保留排序与展示所需字段，也是缓存的存储格式）
type Subject = {
  id: number
  name: string
  nameCn: string
  score: number
  rank: number // 0 = 未上榜（评分人数不足）
  collect: number // 收藏总数 = 想看+看过+在看+搁置+抛弃
  tags: string[] // 去重后的 meta_tags
}
type Cat = "tv" | "web"

const ROOT = path.join(import.meta.dir, "..")
const DATA_PATH = path.join(ROOT, "anime-data.json")
const TMP_PATH = DATA_PATH + ".tmp"
const BAK_PATH = DATA_PATH + ".bak"
const CURATED_PATH = path.join(import.meta.dir, "curated-titles.json")
const CACHE_DIR = path.join(ROOT, ".cache", "bgm-api")

const API = process.env.BGM_API || "https://api.bgm.tv/v0/subjects" // 可覆盖，便于测试失败路径
// bgm API 要求 UA 标明应用与联系方式：https://github.com/bangumi/api/blob/master/docs-raw/user%20agent.md
const UA = "w3903771/anime-sedai (https://github.com/w3903771/anime-sedai)"
const CAT_ID: Record<Cat, number> = { tv: 1, web: 5 }
const PAGE_SIZE = 50 // API 上限
const PER_YEAR = MAX_TOPK // 每格存 Top-30，供前端自定义 Top-K
const MIN_YEAR = 1960
const DELAY_MS = 300
const MAX_TRIES = 4
const CONCURRENCY = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i)

// ---------- 国别规则 ----------

const byRank = (a: Subject, b: Subject) =>
  (a.rank || Infinity) - (b.rank || Infinity) || b.score - a.score || b.collect - a.collect || a.id - b.id
const byCollect = (a: Subject, b: Subject) => b.collect - a.collect || byRank(a, b)
const byScore = (a: Subject, b: Subject) => b.score - a.score || byRank(a, b)
const tagged = (t: string) => (s: Subject) => s.tags.includes(t)
// 已上榜（有 bgm 排名）。按评分/排名排序的国别只收上榜条目，与原网页 rank 榜口径一致，
// 否则少数人打高分的冷门条目会冲到前排、评分为 0 的条目会填满稀疏地区。
// 日本按收藏数排，保留未上榜条目（当年新番常未上榜，但收藏已很高）。
const ranked = (t?: string) => (s: Subject) => s.rank > 0 && (!t || s.tags.includes(t))

type Rule = { cats: Cat[]; match: (s: Subject) => boolean; sort: (a: Subject, b: Subject) => number }
const RULES: Record<string, Rule> = {
  日本: { cats: ["tv"], match: tagged("日本"), sort: byCollect },
  [ALL_COUNTRY]: { cats: ["tv"], match: ranked(), sort: byRank },
  欧美: { cats: ["tv"], match: ranked("欧美"), sort: byRank },
  中国: { cats: ["tv", "web"], match: ranked("中国"), sort: byScore },
  美国: { cats: ["tv"], match: ranked("美国"), sort: byRank },
}

// ---------- 参数与时间 ----------

// 以东八区日期为准（Actions 在 UTC 每月 1 号 00:00 触发，对应北京时间 08:00）
function nowCN() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1]
  const init = argv.includes("--init")
  const years = get("year")?.split(",").map(Number)
  if (years?.some((y) => !Number.isInteger(y) || y < MIN_YEAR)) throw new Error(`非法 --year: ${get("year")}`)
  const country = get("country")
  if (country && !RULES[country]) throw new Error(`未知国别: ${country}，可选 ${Object.keys(RULES).join(",")}`)
  return { init, years, country }
}

// ---------- 抓取 ----------

class FatalHttp extends Error {}

async function getJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } })
      // 4xx（除 429）重试无意义，直接失败
      if (res.status >= 400 && res.status < 500 && res.status !== 429)
        throw new FatalHttp(`HTTP ${res.status} ${url}`)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.json()
    } catch (err) {
      if (err instanceof FatalHttp || attempt >= MAX_TRIES) throw err
      const wait = DELAY_MS * 4 ** attempt // 1.2s, 4.8s, 19.2s
      console.warn(`  … ${err}，${wait}ms 后重试(${attempt}/${MAX_TRIES - 1})`)
      await sleep(wait)
    }
  }
}

function slim(s: any): Subject {
  const c = s.collection ?? {}
  return {
    id: s.id,
    name: String(s.name ?? "").trim(),
    nameCn: String(s.name_cn ?? "").trim(),
    score: Number(s.rating?.score) || 0,
    rank: Number(s.rating?.rank) || 0,
    collect: (c.wish || 0) + (c.collect || 0) + (c.doing || 0) + (c.on_hold || 0) + (c.dropped || 0),
    tags: [...new Set<string>(s.meta_tags ?? [])],
  }
}

// 拉取某 (类型, 年份) 的全部条目。分页之间若数据变动（API 首页缓存 24h、其余页 1h），
// 可能出现重复/遗漏：按 id 去重，并核对总数，偏差过大则整组重拉。
async function fetchAll(cat: Cat, year: number): Promise<Subject[]> {
  for (let round = 1; round <= 3; round++) {
    const byId = new Map<number, Subject>()
    let total = 0
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const j = await getJson(
        `${API}?type=2&cat=${CAT_ID[cat]}&year=${year}&sort=date&limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (typeof j?.total !== "number" || !Array.isArray(j?.data)) throw new Error(`响应结构异常: ${JSON.stringify(j).slice(0, 200)}`)
      total = j.total
      for (const s of j.data) byId.set(s.id, slim(s))
      if (j.data.length === 0 || offset + PAGE_SIZE >= total) break
      await sleep(DELAY_MS)
    }
    const gap = Math.abs(total - byId.size)
    if (gap <= Math.max(2, Math.ceil(total * 0.01))) {
      if (gap) console.warn(`  ! ${cat}/${year}: 拿到 ${byId.size}，总数 ${total}（分页抖动，可接受）`)
      return [...byId.values()]
    }
    console.warn(`  ! ${cat}/${year}: 拿到 ${byId.size} ≠ 总数 ${total}，第 ${round} 轮重拉`)
    await sleep(DELAY_MS * 5)
  }
  throw new Error(`${cat}/${year}: 多次分页结果与总数不一致`)
}

// 断点续抓缓存：仅多年份任务启用；整轮成功写盘后删除
function cached(useCache: boolean, cat: Cat, year: number, load: () => Promise<Subject[]>) {
  if (!useCache) return load()
  const file = path.join(CACHE_DIR, `${cat}-${year}.json`)
  if (fs.existsSync(file)) return Promise.resolve(JSON.parse(fs.readFileSync(file, "utf-8")) as Subject[])
  return load().then((list) => {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(list))
    return list
  })
}

// ---------- 组装 ----------

function loadTitleMap(): Curated {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(CURATED_PATH, "utf-8"))))
  } catch {
    return new Map()
  }
}

function buildSlice(rule: Rule, pool: Record<Cat, Subject[]>, titleMap: Curated): AnimeItem[] {
  const byId = new Map<number, Subject>()
  for (const cat of rule.cats) for (const s of pool[cat]) if (rule.match(s)) byId.set(s.id, s)
  return [...byId.values()]
    .sort(rule.sort)
    .slice(0, PER_YEAR)
    .map((s) => {
      const titleZh = s.nameCn || s.name
      const curated = titleMap.get(titleZh)
      return {
        titleZh,
        titleEn: curated?.en || s.name || titleZh,
        titleJa: curated?.ja || s.name || titleZh,
        score: s.score,
      }
    })
}

// ---------- 原子写入 ----------

function recoverInterrupted() {
  fs.rmSync(TMP_PATH, { force: true })
  if (fs.existsSync(BAK_PATH)) {
    console.warn(`! 发现上次中断残留的备份，先还原：${BAK_PATH} → ${DATA_PATH}`)
    fs.renameSync(BAK_PATH, DATA_PATH)
  }
}

function readExisting(): Data {
  if (!fs.existsSync(DATA_PATH)) return {}
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) // 解析失败直接抛出，绝不当作空数据覆盖
}

function validate(d: Data) {
  for (const [c, years] of Object.entries(d)) {
    if (!years || typeof years !== "object") throw new Error(`校验失败：${c} 不是对象`)
    for (const [y, list] of Object.entries(years)) {
      if (!/^\d{4}$/.test(y) || !Array.isArray(list) || list.length === 0 || list.length > PER_YEAR)
        throw new Error(`校验失败：${c}/${y}`)
      for (const it of list)
        if (!it.titleZh || !it.titleEn || !it.titleJa || typeof it.score !== "number")
          throw new Error(`校验失败：${c}/${y} 条目 ${JSON.stringify(it)}`)
    }
  }
}

// 先备份再替换：.tmp 写好并校验 → 原文件复制为 .bak → rename(.tmp→原文件，同盘原子) → 删 .bak
function commit(d: Data) {
  validate(d)
  const text = JSON.stringify(d, null, 2) + "\n"
  fs.writeFileSync(TMP_PATH, text, "utf-8")
  validate(JSON.parse(fs.readFileSync(TMP_PATH, "utf-8")))
  const hadOld = fs.existsSync(DATA_PATH)
  if (hadOld) fs.copyFileSync(DATA_PATH, BAK_PATH)
  try {
    fs.renameSync(TMP_PATH, DATA_PATH)
  } catch (err) {
    // rename 失败时原文件未被触碰，清理中间文件即可
    fs.rmSync(TMP_PATH, { force: true })
    fs.rmSync(BAK_PATH, { force: true })
    throw err
  }
  fs.rmSync(BAK_PATH, { force: true })
}

// 国别按 COUNTRIES 顺序输出（年份键为整数形态，JS 自动升序），保证 diff 稳定
function ordered(d: Data): Data {
  const out: Data = {}
  for (const c of [...COUNTRIES, ...Object.keys(d)]) if (d[c] && !out[c]) out[c] = d[c]
  return out
}

// ---------- 主流程 ----------

async function main() {
  recoverInterrupted()
  const { init, years: yearArg, country } = parseArgs()
  const { year: thisYear, month } = nowCN()
  const existing = readExisting()
  const titleMap = loadTitleMap()

  const countries = country ? [country] : [...COUNTRIES]
  // 年份：显式 --year 优先；全量/按国别跑全部年份；月更跑当年，1 月额外定稿上一年
  //（上一年 12 月开播的新番与年末评分，只有跨年后这一次能补上）
  const years =
    yearArg ??
    (init || country ? range(MIN_YEAR, thisYear) : month === 1 ? [thisYear - 1, thisYear] : [thisYear])
  const fromScratch = init && !country
  const useCache = years.length > 1
  const cats = [...new Set(countries.flatMap((c) => RULES[c]!.cats))]

  console.log(`标题增强表：${titleMap.size} 条人工精翻可复用`)
  console.log(
    `模式: ${fromScratch ? "全量重建" : "增量合并"} | 年份: ${years.length > 3 ? `${years[0]}–${years.at(-1)}` : years.join(",")} | 国别: ${countries.join(",")} | 每格 ${PER_YEAR}`
  )

  // 1) 下载：全部成功才进入合并；中途失败直接抛出，数据文件保持原样。
  // API 单请求约 3s，多年份任务按年份 CONCURRENCY 路并发（每路内部仍串行 + 礼貌延时）
  const pools = new Map<number, Record<Cat, Subject[]>>()
  const queue = [...years]
  const worker = async () => {
    for (let y; (y = queue.shift()) !== undefined; ) {
      const pool = { tv: [], web: [] } as Record<Cat, Subject[]>
      for (const cat of cats) {
        pool[cat] = await cached(useCache, cat, y, () => fetchAll(cat, y))
        await sleep(DELAY_MS)
      }
      pools.set(y, pool)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, years.length) }, worker))

  const fresh: Record<string, Record<string, AnimeItem[]>> = {}
  for (const y of years) {
    const pool = pools.get(y)!
    const counts: string[] = []
    for (const c of countries) {
      const items = buildSlice(RULES[c]!, pool, titleMap)
      ;(fresh[c] ||= {})[y] = items
      counts.push(`${c}${items.length}`)
    }
    console.log(`  ✓ ${y}: tv ${pool.tv.length}${cats.includes("web") ? ` / web ${pool.web.length}` : ""} → ${counts.join(" ")}`)
  }

  // 2) 合并：只替换本次涉及的 (国别, 年份) 切片，其余原样保留
  const next: Data = fromScratch ? {} : structuredClone(existing)
  const changes: string[] = []
  for (const c of countries) {
    next[c] ||= {}
    for (const y of years) {
      const key = String(y)
      const items = fresh[c]![key]!
      const old = existing[c]?.[key]
      if (items.length === 0) {
        // 当前年份/定稿年份突然变空：极可能是 API 异常而非真实数据，保留旧值
        if (old?.length && !fromScratch && years.length <= 2) {
          console.warn(`  ! ${c}/${y}: 新数据为空但原有 ${old.length} 条，保留旧数据`)
          continue
        }
        delete next[c][key]
      } else {
        next[c][key] = items
      }
      if (JSON.stringify(old ?? []) !== JSON.stringify(items)) {
        const oldSet = new Set((old ?? []).map((x) => x.titleZh))
        const newSet = new Set(items.map((x) => x.titleZh))
        const add = items.filter((x) => !oldSet.has(x.titleZh)).length
        const del = (old ?? []).filter((x) => !newSet.has(x.titleZh)).length
        changes.push(`${c}/${y}(+${add} -${del})`)
      }
    }
    if (Object.keys(next[c]).length === 0) delete next[c]
  }

  // 全部 TV 都为空时整体中止，避免把一个坏响应写成"数据被清空"
  if (years.every((y) => (fresh[ALL_COUNTRY]?.[y]?.length ?? 1) === 0))
    throw new Error("所有年份的「全部」都为空，疑似 API 异常，中止写入")

  // 3) 写入
  if (changes.length === 0) {
    console.log("数据无变化。")
  } else {
    commit(ordered(next))
    console.log(`已写入 ${DATA_PATH}，变更 ${changes.length} 格：${changes.slice(0, 40).join(" ")}${changes.length > 40 ? " …" : ""}`)
  }
  if (useCache) fs.rmSync(CACHE_DIR, { recursive: true, force: true })
}

try {
  await main()
} catch (err) {
  console.error(`✗ 更新失败，数据文件未改动：${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
