import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import basicSsl from '@vitejs/plugin-basic-ssl';

// 浏览器只在 HTTPS（安全上下文）下开放陀螺仪 API，
// 因此开发服务器默认启用自签证书；用 `HTTPS=0 npm run dev` 可退回纯 HTTP。
const httpsEnabled = process.env.HTTPS !== '0';

export default defineConfig({
  // 相对路径产物：保证 dist/ 可被 file:// 或 Wallpaper Engine 的内嵌浏览器直接加载
  base: './',
  plugins: [vue(), ...(httpsEnabled ? [basicSsl()] : [])],
  server: {
    host: true, // 监听 0.0.0.0，方便手机通过局域网 IP 访问
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
