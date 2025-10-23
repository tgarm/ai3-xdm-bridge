import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'path';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(), 
    nodePolyfills({ buffer: true, global: true, crypto: true }),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],  
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      mangle: false,
      compress: true,
      keep_fnames: true,
      keep_classnames: true,
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src")
    }
  },
  server: {
    proxy: {
      '/subscan': {
        target: 'https://autonomys.api.subscan.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/subscan/, ''),
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.error('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Proxying request:', req.method, req.url);
          });
        }
      }
    }
  }
})