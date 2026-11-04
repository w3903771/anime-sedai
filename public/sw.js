// Service Worker：弥补 GitHub Pages 不能自定义缓存头（所有文件一律 max-age=600）的问题。
//
// - /assets/*（Vite 产物，文件名带内容 hash，内容永不变）→ 缓存优先：回访零网络请求
// - 页面导航（index.html）→ 网络优先，3 秒超时或离线时回退缓存：部署后在线用户立刻拿到新版本
// - 跨域请求（统计上报、计数器等）→ 不拦截
//
// 旧版本资源：assets 缓存只保留最近 MAX_ASSETS 个文件（按写入顺序淘汰）。
// 改动本文件的缓存策略时递增 VERSION，activate 时会清掉旧版本缓存。
const VERSION = "v1"
const ASSETS = `assets-${VERSION}`
const PAGES = `pages-${VERSION}`
const MAX_ASSETS = 40
const NAV_TIMEOUT_MS = 3000

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSETS, PAGES])
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key)
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req))
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req))
  }
})

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    await cache.put(req, res.clone())
    trim(cache)
  }
  return res
}

async function trim(cache) {
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k)
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES)
  const network = fetch(req).then(async (res) => {
    if (res.ok) await cache.put("/", res.clone()) // 单页站：所有导航共用一份 HTML
    return res
  })
  network.catch(() => {}) // 超时后网络才失败时，避免未处理的 rejection
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS))
  try {
    const res = await Promise.race([network, timeout])
    if (res) return res
  } catch {
    // 网络失败，走缓存
  }
  const cached = await cache.match("/")
  // 超时但有缓存 → 先给缓存（后台请求仍会更新缓存）；无缓存 → 继续等网络
  return cached ?? network
}
