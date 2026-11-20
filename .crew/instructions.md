# Notes for Crew workers on this machine

- In a worker worktree `node_modules` is shared read-only, so `npx vite build` fails with EPERM
  writing `node_modules/.vite-temp`. Build with `npx vite build --configLoader native`.
- Headless Chrome inside the Codex sandbox needs `--no-sandbox --disable-gpu-sandbox`.
