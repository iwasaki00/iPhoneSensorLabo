import { defineConfig } from 'vite';
export default defineConfig({ base: './', worker: { format: 'es' }, build: { rollupOptions: { input: { main: 'index.html', cards: 'ar-cards.html', playground: 'ar-playground.html' } } } });
