import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [react()], server: { port: Number(process.env.WEB_PORT ?? 5175), strictPort: true, proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:3001' } } });
