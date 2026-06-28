import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    // 数据(anime-data.json)按需求内联打包，主包偏大属预期(gzip≈150KB)，放宽告警阈值
    chunkSizeWarningLimit: 800,
  },
});
