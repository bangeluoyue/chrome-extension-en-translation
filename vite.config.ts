import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Chrome 扩展多入口构建：popup / result / settings 为 HTML 页面入口，
// background / content 为独立脚本入口。
export default defineConfig({
  // 使用相对路径，避免 Chrome 扩展页面加载资源时出现绝对路径解析问题。
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve('popup.html'),
        result: resolve('result.html'),
        settings: resolve('settings.html'),
        background: resolve('src/background/index.ts'),
        content: resolve('src/content/index.ts'),
      },
      output: {
        // background / content 输出为固定文件名，匹配 manifest 引用；
        // 其余页面入口产物带 hash 输出到 assets 目录。
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'background' || chunkInfo.name === 'content'
            ? '[name].js'
            : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
