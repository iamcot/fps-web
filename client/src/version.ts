declare const __APP_VERSION__: string   // vite.config.ts: version trong package.json gốc

// Vitest không chạy qua vite.config nên không có define
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
