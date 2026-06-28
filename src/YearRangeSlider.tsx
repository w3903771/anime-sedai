import { useI18n } from "./i18n-context"

type Props = {
  years: string[] // 升序年份
  start: string
  end: string
  onChange: (start: string, end: string) => void
}

// 无第三方依赖的双拇指年份区间滑块。两个原生 range input 叠放，
// input 本体 pointer-events-none，仅拇指可交互；中间填充段用应用强调色。
export const YearRangeSlider = ({ years, start, end, onChange }: Props) => {
  const { t } = useI18n()

  if (years.length === 0) return null

  const max = years.length - 1
  const clampIdx = (i: number) => Math.min(max, Math.max(0, i))
  const startIdx = clampIdx(years.indexOf(start) === -1 ? 0 : years.indexOf(start))
  const endIdx = clampIdx(years.indexOf(end) === -1 ? max : years.indexOf(end))

  const pct = (i: number) => (max === 0 ? 0 : (i / max) * 100)

  const setStart = (i: number) => {
    const next = Math.min(clampIdx(i), endIdx)
    onChange(years[next] ?? start, years[endIdx] ?? end)
  }
  const setEnd = (i: number) => {
    const next = Math.max(clampIdx(i), startIdx)
    onChange(years[startIdx] ?? start, years[next] ?? end)
  }

  // 两拇指叠放时，靠右端的起始拇指需要更高层级才能抓取
  const startOnTop = startIdx >= max - 1

  const thumb =
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none " +
    "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full " +
    "[&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white " +
    "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none " +
    "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full " +
    "[&::-moz-range-thumb]:bg-red-500 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white " +
    "[&::-moz-range-thumb]:shadow [&::-moz-range-thumb]:cursor-pointer"

  const inputBase =
    "absolute left-0 top-1/2 -translate-y-1/2 w-full h-4 m-0 bg-transparent appearance-none pointer-events-none " +
    thumb

  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-sm font-medium text-gray-700 w-10 text-right tabular-nums">
        {years[startIdx]}
      </span>

      <div className="relative flex-1 h-6">
        {/* 轨道 */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1.5 rounded-full bg-gray-200" />
        {/* 选中区间填充 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-red-500"
          style={{ left: `${pct(startIdx)}%`, right: `${100 - pct(endIdx)}%` }}
        />
        <input
          type="range"
          min={0}
          max={max}
          value={startIdx}
          aria-label={t("startYear")}
          onChange={(e) => setStart(Number(e.currentTarget.value))}
          className={inputBase}
          style={{ zIndex: startOnTop ? 5 : 3 }}
        />
        <input
          type="range"
          min={0}
          max={max}
          value={endIdx}
          aria-label={t("endYear")}
          onChange={(e) => setEnd(Number(e.currentTarget.value))}
          className={inputBase}
          style={{ zIndex: 4 }}
        />
      </div>

      <span className="text-sm font-medium text-gray-700 w-10 tabular-nums">
        {years[endIdx]}
      </span>
    </div>
  )
}
