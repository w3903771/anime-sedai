/// <reference types="vite/client" />

// vite-plugin-anime-data.ts 提供的虚拟模块
declare module "virtual:anime-data/meta" {
  const spans: Record<string, [number, number]>
  export default spans
}
declare module "virtual:anime-data/*" {
  const data: Record<string, ([string] | [string, string] | [string, string, string])[]>
  export default data
}
