/**
 * The server entry in the repository (`pnpm dev`, `pnpm start`), configured by the
 * environment like the bundle's `node server.mjs` (docs/en/embedding.md). The bundle's
 * server.mjs runs `tingly-design serve` (cli.ts), which starts the server the same way.
 */
import { runServer } from './serve';

await runServer({
  port: Number(process.env.PORT ?? 8787),
  // DC_HOST: the address to listen on; loopback unless you mean to share the editor on your network
  host: process.env.DC_HOST?.trim() || '127.0.0.1',
});
