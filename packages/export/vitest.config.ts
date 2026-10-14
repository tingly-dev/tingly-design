import { defineConfig } from 'vitest/config';
// mediabunny is inlined so a test can reset its memo of what the browser can encode
export default defineConfig({ test: { environment: 'node', server: { deps: { inline: ['mediabunny'] } } } });
