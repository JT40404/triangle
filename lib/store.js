// Tiny Upstash Redis REST client (no dependency). Vercel's Upstash integration sets KV_REST_API_*.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export async function redis(...cmd) {
  if (!URL_ || !TOKEN) throw new Error('Redis is not configured. Connect Upstash in Vercel → Storage.');
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd.map(String))
  });
  const j = await r.json();
  if (j.error) throw new Error(`Redis: ${j.error}`);
  return j.result;
}

export async function hgetall(key) {
  const flat = (await redis('HGETALL', key)) || [];
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}

// Simple mutex so the cron and a user request never move the same wallet's funds at once.
export async function withLock(name, fn) {
  const ok = await redis('SET', `lock:${name}`, '1', 'NX', 'EX', '240');
  if (ok !== 'OK') throw new Error('This launch is busy. Try again in a minute.');
  try { return await fn(); } finally { await redis('DEL', `lock:${name}`); }
}
