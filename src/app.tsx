import { useMemo, useRef, useEffect, useState } from "react"
import animeData, {
  getAnimeTitle,
  COUNTRIES,
  DEFAULT_COUNTRY,
  getCountrySort,
  getDefaultTopK,
} from "../anime-data"
import { domToBlob } from "modern-screenshot"
import { toast } from "sonner"
import { usePersistState } from "./hooks"
import { useI18n } from "./i18n-context"
import { LanguageToggle } from "./LanguageToggle"
import { YearRangeSlider } from "./YearRangeSlider"
import { getCountryName } from "./i18n"

type YearRange = "5" | "10" | "15" | "all" | "custom"

const yearRangeOptions: YearRange[] = ["5", "10", "15", "all", "custom"]
// 默认("全部年份"预设)只展示 2006 起；更早(上世纪)年份仅在「自定义」滑块下、按所选国别可用范围暴露
const DEFAULT_MIN_YEAR = 2006

// 升序整数年份区间 → 字符串数组
const rangeYears = (lo: number, hi: number): string[] =>
  lo > hi ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i))

// 默认国别(日本)的初始自定义区间(全幅)
const DEFAULT_YEAR_KEYS = Object.keys(animeData[DEFAULT_COUNTRY] ?? {}).sort(
  (a, b) => Number(a) - Number(b)
)
const DEFAULT_RANGE = {
  start: DEFAULT_YEAR_KEYS[0] ?? String(DEFAULT_MIN_YEAR),
  end: DEFAULT_YEAR_KEYS[DEFAULT_YEAR_KEYS.length - 1] ?? String(DEFAULT_MIN_YEAR),
}

export const App = () => {
  const { t, language } = useI18n()
  const [selectedAnime, setSelectedAnime] = usePersistState<string[]>(
    "selectedAnime",
    []
  )
  const [yearRange, setYearRange] = usePersistState<YearRange>(
    "yearRange",
    "all"
  )
  const [selectedCountry, setSelectedCountry] = usePersistState<string>(
    "selectedCountry",
    DEFAULT_COUNTRY
  )
  const [customRange, setCustomRange] = usePersistState<{
    start: string
    end: string
  }>("customRange", DEFAULT_RANGE)
  // 每年显示的动画数量（Top-K，1..24，数据每格最多存 24 条；默认随国别，中国为 20）
  const [topK, setTopK] = usePersistState<number>(
    "topK",
    getDefaultTopK(DEFAULT_COUNTRY)
  )

  // 单元格宽度随 Top-K 自适应：K 越大格子越窄，整体宽度收敛在约 1300px 内
  const cellW = Math.max(48, Math.min(116, Math.round(1300 / (topK + 1))))
  // 字号与最大行数随格宽自适应：越窄→字越小、行数越多，尽量用满纵向空间、显示更全
  const cellTier =
    cellW < 52
      ? { font: "text-[10px]", clamp: "line-clamp-6" }
      : cellW < 72
      ? { font: "text-xs", clamp: "line-clamp-5" }
      : { font: "text-sm", clamp: "line-clamp-4" }

  // 当前选中国别的 年份->列表 映射（稳定引用，供下游 memo 依赖）
  const countryData = useMemo(
    () => animeData[selectedCountry] ?? {},
    [selectedCountry]
  )

  // 该国别的连续年份范围（最早..最晚有数据的年）——滑块与"全部"预设据此而定
  const { countryMin, countryMax, countryYears } = useMemo(() => {
    const keys = Object.keys(countryData).map(Number)
    if (keys.length === 0) {
      return {
        countryMin: DEFAULT_MIN_YEAR,
        countryMax: DEFAULT_MIN_YEAR,
        countryYears: [] as string[],
      }
    }
    const min = Math.min(...keys)
    const max = Math.max(...keys)
    return { countryMin: min, countryMax: max, countryYears: rangeYears(min, max) }
  }, [countryData])

  // 真正切换国别时：自定义区间重置为该国别全幅；每年数量重置为该国别默认(中国 20)
  const prevCountry = useRef(selectedCountry)
  useEffect(() => {
    if (prevCountry.current !== selectedCountry) {
      prevCountry.current = selectedCountry
      setCustomRange({ start: String(countryMin), end: String(countryMax) })
      setTopK(getDefaultTopK(selectedCountry))
    }
  }, [selectedCountry, countryMin, countryMax, setCustomRange, setTopK])

  const visibleYears = useMemo(() => {
    let lo: number
    let hi: number
    if (yearRange === "custom") {
      lo = Math.min(Number(customRange.start), Number(customRange.end))
      hi = Math.max(Number(customRange.start), Number(customRange.end))
    } else if (yearRange === "all") {
      lo = Math.max(DEFAULT_MIN_YEAR, countryMin) // 默认从 2006 起
      hi = countryMax
    } else {
      hi = countryMax
      lo = hi - Number(yearRange) + 1 // 近 N 年
    }
    // 收敛到该国别可用范围
    lo = Math.max(lo, countryMin)
    hi = Math.min(hi, countryMax)
    return rangeYears(lo, hi)
  }, [yearRange, customRange, countryMin, countryMax])

  // 选择以「年份|中文名」为唯一键：同名不同年(如猎人1999/2011)互相独立，
  // 且单年内标题唯一 → 无重复键，计数(已看/总数)始终一致。
  const visibleAnimeKeys = useMemo(() => {
    return visibleYears.flatMap((year) => {
      const items = countryData[year] || []
      return items.slice(0, topK).map((item) => `${year}|${getAnimeTitle(item, "zh")}`)
    })
  }, [visibleYears, countryData, topK])

  const visibleAnimeKeySet = useMemo(() => {
    return new Set(visibleAnimeKeys)
  }, [visibleAnimeKeys])

  const selectedVisibleAnimeCount = selectedAnime.filter((title) => {
    return visibleAnimeKeySet.has(title)
  }).length

  const getYearRangeLabel = (option: YearRange) => {
    switch (option) {
      case "5":
        return t("last5Years")
      case "10":
        return t("last10Years")
      case "15":
        return t("last15Years")
      case "all":
        return t("allYears")
      case "custom":
        return t("customRange")
    }
  }

  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = t("title")
  }, [language, t])

  const imageToBlob = async () => {
    if (!wrapper.current) return

    const blob = await domToBlob(wrapper.current, {
      scale: 2,
      filter(el) {
        if (el instanceof HTMLElement && el.classList.contains("remove")) {
          return false
        }
        return true
      },
    })

    return blob
  }

  const copyImage = async () => {
    const blob = await imageToBlob()

    if (!blob) return

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ])
  }

  const downloadImage = async () => {
    if (!wrapper.current) return

    const blob = await imageToBlob()

    if (!blob) return

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = "anime-sedai.png"
    a.click()

    URL.revokeObjectURL(url)
  }

  const totalAnime = visibleAnimeKeys.length

  // 悬停 ~0.7s 后，对「被截断」的标题在原位上方浮出完整标题（fixed 定位，绕过网格滚动裁剪）
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(
    null
  )
  const tipTimer = useRef<number | undefined>(undefined)
  const showTipFor = (el: HTMLElement, text: string) => {
    window.clearTimeout(tipTimer.current)
    const span = el.querySelector("span")
    if (!span || span.scrollHeight <= span.clientHeight + 1) return // 未截断则不提示
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top
    tipTimer.current = window.setTimeout(() => setTip({ text, x, y }), 700)
  }
  const hideTip = () => {
    window.clearTimeout(tipTimer.current)
    setTip(null)
  }

  // 重置显示设定为默认（不动已选的"看过"记录）
  const resetSettings = () => {
    setSelectedCountry(DEFAULT_COUNTRY)
    setYearRange("all")
    setTopK(getDefaultTopK(DEFAULT_COUNTRY))
    setCustomRange(DEFAULT_RANGE)
  }

  return (
    <>
      <div className="flex flex-col gap-4 pb-10 pt-2 min-h-screen bg-zinc-50 text-zinc-800">
        <div className="p-4 flex flex-col md:items-center">
          <div className="flex w-full flex-col gap-2 mb-4 md:flex-row md:items-center md:justify-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t("country")}:</span>
              <select
                className="border border-zinc-200 rounded px-2 py-1 text-sm bg-white shadow-sm hover:border-zinc-300 transition-colors"
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.currentTarget.value)
                }}
              >
                {COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {getCountryName(country, language)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t("yearRange")}:</span>
              <select
                className="border border-zinc-200 rounded px-2 py-1 text-sm bg-white shadow-sm hover:border-zinc-300 transition-colors"
                value={yearRange}
                onChange={(e) => {
                  setYearRange(e.currentTarget.value as YearRange)
                }}
              >
                {yearRangeOptions.map((option) => (
                  <option key={option} value={option}>
                    {getYearRangeLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t("topK")}:</span>
              <input
                type="number"
                min={1}
                max={24}
                value={topK}
                title="1 - 24"
                onChange={(e) => {
                  const v = Number(e.currentTarget.value)
                  setTopK(Number.isFinite(v) ? Math.max(1, Math.min(24, v)) : 12)
                }}
                className="border border-zinc-200 rounded px-2 py-1 text-sm bg-white shadow-sm w-16 hover:border-zinc-300 transition-colors"
              />
              <span className="text-xs text-gray-400">1–24</span>
            </div>
            <LanguageToggle />
            <button
              type="button"
              onClick={resetSettings}
              title={t("reset")}
              className="border border-zinc-200 bg-white rounded px-3 py-1 text-sm text-gray-600 shadow-sm hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
            >
              {t("reset")}
            </button>
          </div>
          {yearRange === "custom" && (
            <div className="flex w-full max-w-screen-sm mx-auto items-center mb-4 px-2">
              <YearRangeSlider
                years={countryYears}
                start={customRange.start}
                end={customRange.end}
                onChange={(start, end) => setCustomRange({ start, end })}
              />
            </div>
          )}
          {/* 排序口径说明：日本按热度，其余地区按评分排名 */}
          <div className="mb-3 text-xs text-gray-500 text-center">
            {getCountrySort(selectedCountry) === "trends"
              ? t("sortTrends")
              : t("sortRank")}
          </div>
          <div className="w-full overflow-x-auto">
            <div
              className="flex flex-col border border-b-0 bg-white w-fit mx-auto rounded-xl overflow-hidden shadow-sm"
              ref={wrapper}
            >
              <div className="border-b justify-between items-center p-2.5 text-lg font-bold flex gap-3 bg-zinc-50/60">
                <h1 className="tracking-tight">
                  {t("title")}
                  <span className="remove"> - {t("subtitle")}</span>
                  <span className="ml-2 text-zinc-400 font-medium">
                    {t("website")}
                  </span>
                </h1>
                <span className="shrink-0 whitespace-nowrap text-base font-medium text-zinc-500">
                  {t("watchedCount", {
                    count: selectedVisibleAnimeCount,
                    total: totalAnime,
                  })}
                </span>
              </div>
              {visibleYears.map((year) => {
                const items = countryData[year] || []
                return (
                  <div key={year} className="flex border-b">
                    <div
                      className="bg-red-500 shrink-0 text-white flex items-center font-bold justify-center p-1 border-black h-16 md:h-20"
                      style={{ width: cellW }}
                    >
                      <span
                        className={`${
                          cellW < 56 ? "text-xs" : "text-sm md:text-base"
                        } text-center`}
                      >
                        {year}
                      </span>
                    </div>
                    <div className="flex shrink-0">
                      {items.slice(0, topK).map((item) => {
                        const animeKey = `${year}|${getAnimeTitle(item, "zh")}`
                        const displayTitle = getAnimeTitle(item, language)
                        const isSelected = selectedAnime.includes(animeKey)
                        return (
                          <button
                            key={animeKey}
                            style={{ width: cellW }}
                            className={`
                              h-16 md:h-20
                              border-l break-words text-center shrink-0 inline-flex items-center
                              p-0.5 overflow-hidden justify-center cursor-pointer
                              ${cellTier.font}
                              ${
                                isSelected
                                  ? "bg-green-500"
                                  : "hover:bg-zinc-100"
                              }
                              transition-colors duration-200
                            `}
                            onMouseEnter={(e) =>
                              showTipFor(e.currentTarget, displayTitle)
                            }
                            onMouseLeave={hideTip}
                            onClick={() => {
                              hideTip()
                              setSelectedAnime((prev) => {
                                if (isSelected) {
                                  return prev.filter(
                                    (title) => title !== animeKey
                                  )
                                }
                                return [...prev, animeKey]
                              })
                            }}
                          >
                            <span
                              className={`leading-tight w-full ${cellTier.clamp}`}
                            >
                              {displayTitle}
                            </span>
                          </button>
                        )
                      })}
                      {Array.from(
                        { length: Math.max(0, topK - items.length) },
                        (_, index) => (
                          <div
                            key={`empty-${index}`}
                            className="h-16 md:h-20 border-l bg-gray-50"
                            style={{ width: cellW }}
                          />
                        )
                      )}
                      <div className="w-0 h-16 md:h-20 border-r" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-center">
          <button
            type="button"
            className="border border-zinc-200 bg-white rounded-md px-4 py-2 inline-flex shadow-sm hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
            onClick={() => {
              setSelectedAnime((prev) => {
                const hiddenSelectedAnime = prev.filter((title) => {
                  return !visibleAnimeKeySet.has(title)
                })

                return [...hiddenSelectedAnime, ...visibleAnimeKeys]
              })
            }}
          >
            {t("selectAll")}
          </button>

          {selectedVisibleAnimeCount > 0 && (
            <button
              type="button"
              className="border border-zinc-200 bg-white rounded-md px-4 py-2 inline-flex shadow-sm hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
              onClick={() => {
                setSelectedAnime((prev) => {
                  return prev.filter((title) => !visibleAnimeKeySet.has(title))
                })
              }}
            >
              {t("clear")}
            </button>
          )}

          <button
            type="button"
            className="border border-zinc-200 bg-white rounded-md px-4 py-2 inline-flex shadow-sm hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
            onClick={() => {
              toast.promise(copyImage(), {
                success: t("copySuccess"),
                loading: t("copying"),
                error(error) {
                  return t("copyFailed", {
                    error:
                      error instanceof Error
                        ? error.message
                        : t("unknownError"),
                  })
                },
              })
            }}
          >
            {t("copyImage")}
          </button>

          <button
            type="button"
            className="border border-zinc-200 bg-white rounded-md px-4 py-2 inline-flex shadow-sm hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
            onClick={() => {
              toast.promise(downloadImage(), {
                success: t("downloadSuccess"),
                loading: t("downloading"),
                error(error) {
                  return t("downloadFailed", {
                    error:
                      error instanceof Error
                        ? error.message
                        : t("unknownError"),
                  })
                },
              })
            }}
          >
            {t("downloadImage")}
          </button>
        </div>

        <div className="mt-2 text-center">
          {t("footer")}
          <a
            href={
              language === "zh"
                ? "https://x.com/localhost_4173"
                : "https://x.com/localhost_5173"
            }
            target="_blank"
            className="underline"
          >
            {language === "zh" ? "低空飞行" : "egoist"}
          </a>
          {t("madeBy")}
          <a
            href="https://github.com/egoist/anime-sedai"
            target="_blank"
            className="underline"
          >
            {t("viewCode")}
          </a>
          {", "}
          <a
            href="https://anime-sedai.egoist.dev/"
            target="_blank"
            className="underline"
          >
            {t("viewOriginalSite")}
          </a>
        </div>

        <div className="text-center text-base font-bold text-gray-800">
          {t("forkBy")}
          <a href="https://ttzg.site" target="_blank" className="underline">
            ttzg.site
          </a>
          {t("forkBySuffix")}
          <a
            href="https://github.com/w3903771/anime-sedai"
            target="_blank"
            className="underline"
          >
            {t("viewCode")}
          </a>
        </div>
      </div>

      {tip && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full -mt-1.5 max-w-[16rem] rounded-lg bg-zinc-900/95 px-2.5 py-1.5 text-sm leading-snug text-white text-center shadow-lg"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </>
  )
}
