/**
 * Frame-time measurement for the 3D view (R3D-29): opens the showcase and the 200-unit brawl in a real browser at
 * 1920x1080 on the High preset and samples requestAnimationFrame deltas collected in the page for about 15 seconds each.
 * Reports average, p95 and p99 frame time and the frame rate, plus the renderer's own figures (draws, triangles, CPU
 * time, live particles and debris) at the end of each run.
 *
 *   npm run perf3d                          starts its own dev server
 *   PERF_URL=http://localhost:5197 npm run perf3d   uses a running server
 *   PERF_SECONDS=15 PERF_SCENARIOS=showcase,brawl PERF_GL=swiftshader PERF_HEADED=1   tune a run
 *
 * It uses the machine's real GPU by default; set PERF_GL=swiftshader to force the software renderer (slow, only to check
 * that the script works). The numbers are only meaningful on the hardware the target is measured on (Intel iGPU).
 */
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

const SECONDS = Number(process.env.PERF_SECONDS ?? 15);
const SCENARIOS = (process.env.PERF_SCENARIOS ?? 'showcase,brawl').split(',');
const PORT = 5198;

interface Result {
  frames: number;
  avg: number;
  p95: number;
  p99: number;
  fps: number;
  stats: unknown;
}

async function serverUp(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let base = process.env.PERF_URL;
  let server: ChildProcess | null = null;
  if (!base) {
    base = `http://localhost:${PORT}`;
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: true });
    for (let i = 0; i < 60 && !(await serverUp(base)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  const args = process.env.PERF_GL === 'swiftshader' ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const browser = await chromium.launch({ args, headless: process.env.PERF_HEADED !== '1' });
  try {
    for (const scenario of SCENARIOS) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`${base}/?faction=human&scenario=${scenario}&seed=1&renderer=3d&flyin=0`);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 120_000 });
      // Let the fight start and the first shaders settle, then sample.
      await page.waitForTimeout(3000);
      // The sampler is plain source text: tsx would otherwise inject helpers that do not exist in the page.
      const r = (await page.evaluate(`(async () => {
        const deltas = [];
        await new Promise((done) => {
          let last = performance.now();
          const t0 = last;
          const tick = (now) => {
            deltas.push(now - last);
            last = now;
            if (now - t0 < ${SECONDS * 1000}) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        const sorted = deltas.slice().sort((a, b) => a - b);
        const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] || 0;
        const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
        return { frames: deltas.length, avg, p95: at(0.95), p99: at(0.99), fps: 1000 / avg, stats: window.__shardfall.renderStats() };
      })()`)) as Result;
      console.log(`${scenario.padEnd(9)} frames ${r.frames}  avg ${r.avg.toFixed(1)} ms  p95 ${r.p95.toFixed(1)} ms  p99 ${r.p99.toFixed(1)} ms  fps ${r.fps.toFixed(1)}  ${JSON.stringify(r.stats)}`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (server?.pid) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true }).on('error', () => server?.kill());
  }
}

void main();
