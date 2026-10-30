# Electron entry point fix

Added `electron/main.cjs` required by `package.json` and `electron-builder`.

## Build
Run `npm run desktop:build` in Windows PowerShell. The Next.js `output: "standalone"` configuration already exists in `next.config.ts`.

## Runtime
The packaged app starts its bundled Next.js standalone server using Electron in Node mode, bound to `127.0.0.1` on an available local port. It then opens the Electron window. In development, start `npm run dev` before `npm run desktop:dev`.

## Caution
This fixes the missing entry file, but the Windows installer and runtime have not been tested here. Test offline startup, app restart and local storage persistence, printing and Supabase backups before using with real shop data.
