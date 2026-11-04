// 页脚访客回显：读取自建 GoatCounter 的公开计数器（stats.ttzg.site/counter/<path>.json）。
// - 本站上报的 path 是 "/anime" + location.pathname（见 index.html），首页即 "/anime/"；
// - 口径与看板一致：GoatCounter 2.x 只统计/展示「访问」(visit) —— 同一会话(IP+UA，8 小时)
//   对同一 path 只计一次，不存原始 PV（见 /help/sessions 与 CHANGELOG）；
//   「累计」是历次访问之和，同一个人隔天再来会再计一次，不等于独立访客数；
// - 统计站 free_waf 的 drop_abroad = false（海外可访问，见 ttzgsite analytics-stack.md 2.3）；
//   万一请求失败（网络、WAF 误拦等），整个组件不显示，不打扰页面；
// - 服务端对计数器有约 30 分钟缓存，数字不是实时的。
// 视觉参考萌萌计数器(Moe-Counter)「一位数字一张彩色卡片」的形式，纯 CSS 自绘，不引用第三方素材。
import { useEffect, useState } from "react"
import { useI18n } from "./i18n-context"

const ENDPOINT = "https://stats.ttzg.site/counter/"
const PATH = "/anime/"

// 东八区今天（统计站时区为 Asia/Shanghai）
const todayCN = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

async function fetchCount(query = ""): Promise<number> {
  // path 原样拼接（含前导 /），即 /counter//anime/.json
  const res = await fetch(`${ENDPOINT}${PATH}.json${query}`)
  if (res.status === 404) return 0 // 该区间还没有访客
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as { count?: string }
  const n = Number(String(j.count ?? "0").replace(/[^\d]/g, ""))
  if (!Number.isFinite(n)) throw new Error("bad count")
  return n
}

// 数字从 0 滚到目标值（尊重「减少动态效果」系统设置）
function useCountUp(target: number | null, ms = 900) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (target === null) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3)))) // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

// 每位数字一张卡片，按位循环取色（粉/橙/黄/绿/蓝/紫，像番剧角色应援色）
const PALETTE = ["#f472b6", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"]

function Digits({ value, width }: { value: number; width: number }) {
  const s = String(value).padStart(width, "0")
  return (
    <span className="inline-flex gap-[3px]" aria-hidden>
      {[...s].map((d, i) => {
        const c = PALETTE[i % PALETTE.length]
        return (
          <span
            key={i}
            className="inline-flex h-7 w-5 items-center justify-center rounded-md bg-white text-base font-black tabular-nums leading-none"
            style={{
              color: c,
              boxShadow: `0 2px 0 ${c}, 0 0 0 1px ${c}55`,
              transform: `rotate(${i % 2 ? 3 : -3}deg)`,
            }}
          >
            {d}
          </span>
        )
      })}
    </span>
  )
}

export function VisitCounter() {
  const { t } = useI18n()
  const [counts, setCounts] = useState<{ today: number; total: number } | null>(null)

  useEffect(() => {
    let alive = true
    // 不抢首屏：空闲时再请求
    const run = () =>
      Promise.all([fetchCount(`?start=${todayCN()}`), fetchCount()])
        .then(([today, total]) => alive && setCounts({ today, total }))
        .catch(() => {}) // 拿不到就不显示
    const idle = typeof requestIdleCallback === "function"
    const id = idle ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500)
    return () => {
      alive = false
      if (idle) cancelIdleCallback(id as number)
      else clearTimeout(id)
    }
  }, [])

  const today = useCountUp(counts?.today ?? null)
  const total = useCountUp(counts?.total ?? null)
  if (!counts) return null

  // 位数按最终值定，滚动过程中卡片数量不跳
  const width = Math.max(3, String(counts.total).length)

  return (
    <div className="flex justify-center px-4">
      <div
        className="group relative inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl px-5 py-2.5 text-sm text-zinc-600"
        style={{
          background:
            "linear-gradient(#fff, #fff) padding-box, linear-gradient(120deg, #f9a8d4, #fde68a, #a5f3fc, #c4b5fd) border-box",
          border: "2px solid transparent",
        }}
        title={t("visitHint")}
        role="status"
        aria-label={`${t("visitToday")} ${counts.today} · ${t("visitTotal")} ${counts.total}`}
      >
        <span className="pointer-events-none absolute -top-2.5 -left-1.5 rotate-[-12deg] text-lg text-pink-400 transition-transform duration-500 group-hover:rotate-[24deg]">
          ✦
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="font-medium">{t("visitToday")}</span>
          <Digits value={today} width={width} />
        </span>
        <span className="hidden text-pink-300 sm:inline">♡</span>
        <span className="inline-flex items-center gap-2">
          <span className="font-medium">{t("visitTotal")}</span>
          <Digits value={total} width={width} />
        </span>
        <span className="pointer-events-none absolute -right-1.5 -bottom-2.5 rotate-[12deg] text-sm text-sky-400 transition-transform duration-500 group-hover:rotate-[-24deg]">
          ✧
        </span>
      </div>
    </div>
  )
}
