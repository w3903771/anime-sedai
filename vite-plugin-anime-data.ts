// 把 anime-data.json 按国别拆成独立的 JS chunk，前端按需加载：
//   virtual:anime-data/meta    → 各国别年份跨度 { 国别: [最早, 最晚] }（很小，打进主包）
//   virtual:anime-data/<slug>  → 单个国别的紧凑数据（独立 chunk，文件名带 hash）
// 紧凑格式：每条 [zh, ja?, en?]，ja 与 zh 相同则省略，en 与 ja 相同则省略；不含前端未用的 score。
// 构建时为默认国别 chunk 注入 <link rel="modulepreload">，让数据与主包并行下载。
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"
import { COUNTRIES, COUNTRY_SLUG, DEFAULT_COUNTRY } from "./anime-data.ts"

const DATA_PATH = fileURLToPath(new URL("./anime-data.json", import.meta.url))
const PREFIX = "virtual:anime-data/"
const RESOLVED = "\0" + PREFIX

type Item = { titleZh: string; titleEn: string; titleJa: string }
const pack = (x: Item) => {
  const ja = x.titleJa === x.titleZh ? "" : x.titleJa
  if (x.titleEn !== x.titleJa) return [x.titleZh, ja, x.titleEn]
  return ja ? [x.titleZh, ja] : [x.titleZh]
}

// 大对象用 JSON.parse('...') 比对象字面量解析更快（V8 官方建议）
const jsonModule = (v: unknown) => `export default JSON.parse(${JSON.stringify(JSON.stringify(v))})`

export default function animeData(): Plugin {
  const bySlug = Object.fromEntries(COUNTRIES.map((c) => [COUNTRY_SLUG[c], c]))
  return {
    name: "anime-data",
    resolveId(id) {
      if (id.startsWith(PREFIX)) return "\0" + id
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return
      this.addWatchFile(DATA_PATH)
      const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) as Record<string, Record<string, Item[]>>
      const key = id.slice(RESOLVED.length)
      if (key === "meta") {
        const spans: Record<string, [number, number]> = {}
        for (const c of COUNTRIES) {
          const years = Object.keys(data[c] ?? {}).map(Number)
          if (years.length) spans[c] = [Math.min(...years), Math.max(...years)]
        }
        return jsonModule(spans)
      }
      const country = bySlug[key]
      if (!country) this.error(`未知国别 slug: ${key}`)
      const packed = Object.fromEntries(Object.entries(data[country] ?? {}).map(([y, list]) => [y, list.map(pack)]))
      return jsonModule(packed)
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!ctx.bundle) return // 仅构建时
        const target = RESOLVED + COUNTRY_SLUG[DEFAULT_COUNTRY]
        const chunk = Object.values(ctx.bundle).find((c) => c.type === "chunk" && c.facadeModuleId === target)
        if (!chunk) return
        return [{ tag: "link", attrs: { rel: "modulepreload", crossorigin: "", href: "/" + chunk.fileName }, injectTo: "head" }]
      },
    },
  }
}
