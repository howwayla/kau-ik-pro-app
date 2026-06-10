// vite.config.ts

import path from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        base: env.VITE_BASE ?? '/',
        // shioaji app upload flattens nested paths — emit a flat bundle
        build: { assetsDir: '' },
        // react-draggable (react-grid-layout dep) reads process.env at runtime
        define: { 'process.env': {} },
        plugins: [vanillaExtractPlugin(), react()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            proxy: {
                '/api': 'http://localhost:8080',
            },
        },
    };
});
