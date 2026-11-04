import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import animeData from "./vite-plugin-anime-data";

export default defineConfig({
  // 数据按国别拆成独立 chunk 按需加载，见 vite-plugin-anime-data.ts
  plugins: [tailwindcss(), react(), animeData()],
});
