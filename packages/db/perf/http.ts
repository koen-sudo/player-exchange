/**
 * HTTP timings of the public market pages against a running web server
 * (docs/09 "Marktquery onder 750 ms p95"). Usage:
 *   BASE_URL=http://localhost:3100 node packages/db/perf/http.ts
 */
const base = process.env.BASE_URL ?? "http://localhost:3000";
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!);
};
async function measure(path: string, n = 50, concurrency = 1) {
  for (let i = 0; i < 3; i++) await (await fetch(base + path)).text();
  const xs: number[] = [];
  let status = 0;
  const one = async () => {
    const t0 = performance.now();
    const r = await fetch(base + path);
    await r.text();
    status = r.status;
    xs.push(performance.now() - t0);
  };
  for (let i = 0; i < n; i += concurrency) await Promise.all(Array.from({ length: concurrency }, one));
  return { path, status, concurrency, n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: pct(xs, 100) };
}
const first = (await (await fetch(`${base}/api/v1/players?limit=1`)).json()).data.items[0].id;
const out = [
  await measure("/api/v1/players"),
  await measure("/api/v1/players?q=vis"),
  await measure("/markt"),
  await measure("/markt?q=vis"),
  await measure(`/spelers/${first}`),
  await measure("/markt", 50, 10),
];
console.log(JSON.stringify(out, null, 2));
