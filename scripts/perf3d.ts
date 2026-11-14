/**
 * Frame-time measurement for the 3D view (R3D-29): opens the showcase and the 200-unit brawl in a real browser at
 * 1920x1080 on the High preset and samples requestAnimationFrame deltas collected in the page for about 15 seconds each.
 * Reports average, p95 and p99 frame time and the frame rate, plus the renderer's own figures (draws, triangles, CPU
 * time, live particles and debris) at the end of each run.
 *
 *   npm run perf3d                          starts its own dev server
 *   PERF_URL=http://localhost:5197 npm run perf3d   uses a running server
 *   PERF_QUALITY=low measures the Low preset; PERF_EXTRA="&dbg=..." adds URL parameters
 *   PERF_SECONDS=15 PERF_SCENARIOS=showcase,brawl,pan-showcase,pan-brawl PERF_GL=swiftshader PERF_HEADED=1   tune a run
 *
 * PERF_HEADED=1 opens the window off-screen (--window-position=-32000,-32000), so it never pops up on the desktop.
 * It uses the machine's real GPU by default; set PERF_GL=swiftshader to force the software renderer (slow, only to check
 * that the script works). The numbers are only meaningful on the hardware the target is measured on (Intel iGPU).
 */
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

const SECONDS = Number(process.env.PERF_SECONDS ?? 15);
const SCENARIOS = (process.env.PERF_SCENARIOS ?? 'showcase,brawl,pan-showcase,pan-brawl').split(',');
const PORT = 5198;

interface Result {
  frames: number;
  avg: number;
  p95: number;
  p99: number;
  fps: number;
  over25: number;
  max: number;
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
  const args: string[] = process.env.PERF_GL === 'swiftshader' ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  if (process.env.PERF_NOVSYNC === '1') args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  if (process.env.PERF_HEADED === '1') args.push('--window-position=-32000,-32000');
  // Measuring never plays the game's sound on the machine running it.
  args.push('--mute-audio');
  const browser = await chromium.launch({ args, headless: process.env.PERF_HEADED !== '1' });
  try {
    for (const name of SCENARIOS) {
      // "pan-<scenario>" holds a pan key down while sampling (PERF-3): the camera goes right, back left, down, back up, 1.5 s each way (900 px/s), so it stays near the fight.
      const pan = name.startsWith('pan-');
      const scenario = pan ? name.slice(4) : name;
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      if (process.env.PERF_QUALITY === 'low') await page.addInitScript("localStorage.setItem('shardfall.settings.v3', JSON.stringify({ quality: 'low' }))");
      page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
      await page.goto(`${base}/?faction=human&scenario=${scenario}&seed=1&renderer=3d&flyin=0${process.env.PERF_EXTRA ?? ""}`);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 120_000 });
      // Let the fight start and the first shaders settle, then sample.
      await page.waitForTimeout(3000);
      // The sampler is plain source text: tsx would otherwise inject helpers that do not exist in the page.
      let panning = pan;
      const driver = (async () => {
        const legs = ['d', 'a', 's', 'w'];
        for (let i = 0; panning; i++) {
          const k = legs[i % 4]!;
          await page.keyboard.down(k);
          await page.waitForTimeout(1500);
          await page.keyboard.up(k);
        }
      })();
      const r = (await page.evaluate(`(async () => {
        const deltas = [];
        const stamps = [];
        const gp = [];
        const iv = setInterval(() => { const g = window.__shardfall.renderStats().gpuMs; if (g) gp.push(g); }, 100);
        await new Promise((done) => {
          let last = performance.now();
          const t0 = last;
          const tick = (now) => {
            deltas.push(now - last);
            stamps.push(now - t0);
            last = now;
            if (now - t0 < ${SECONDS * 1000}) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        clearInterval(iv);
        const gpuAvg = gp.reduce((a, b) => a + b, 0) / Math.max(1, gp.length);
        const sorted = deltas.slice().sort((a, b) => a - b);
        const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] || 0;
        // After the first second: frames over 25 ms and the longest frame (PERF-3).
        let over25 = 0;
        let max = 0;
        deltas.forEach((d, i) => { if (stamps[i] >= 1000) { if (d > 25) over25++; if (d > max) max = d; } });
        const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
        return { frames: deltas.length, avg, p95: at(0.95), p99: at(0.99), over25, max, fps: 1000 / avg, stats: { ...window.__shardfall.renderStats(), gpuAvg } };
      })()`)) as Result;
      if (process.env.PERF_SHOT) await page.screenshot({ path: `${process.env.PERF_SHOT}-${name}.png` });
      panning = false;
      await driver;
      console.log(`${name.padEnd(13)} frames ${r.frames}  avg ${r.avg.toFixed(1)} ms  p95 ${r.p95.toFixed(1)} ms  p99 ${r.p99.toFixed(1)} ms  max ${r.max.toFixed(1)} ms  >25ms ${r.over25}  fps ${r.fps.toFixed(1)}  ${JSON.stringify(r.stats)}`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (server?.pid) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true }).on('error', () => server?.kill());
  }
}

void main();
