// Scheduled: deliver any unfinished launches, recycle creator fees, then buy ▲ from the treasury.
import { redis, hgetall, withLock } from '../lib/store.js';
import { deliver, recycle, recycleTreasury } from '../lib/recycle.js';

const BATCH = Number(process.env.CRON_BATCH || 10);

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  const results = [];
  try {
    const total = Number(await redis('LLEN', 'launches'));
    let cursor = Number((await redis('GET', 'cursor')) || 0);
    if (cursor >= total) cursor = 0;
    const batch = total ? await redis('LRANGE', 'launches', cursor, cursor + BATCH - 1) : [];

    for (const mint of batch) {
      try {
        results.push(await withLock(mint, async () => {
          const rec = await hgetall(`launch:${mint}`);
          if (rec.delivered !== '1') {
            try { await deliver(mint); } catch (e) { return { mint, waiting: e.message }; }
          }
          return recycle(mint);
        }));
      } catch (e) {
        results.push({ mint, error: e.message });
      }
    }
    await redis('SET', 'cursor', cursor + batch.length);

    let treasury;
    try { treasury = await withLock('treasury', recycleTreasury); } catch (e) { treasury = { error: e.message }; }

    return res.status(200).json({ processed: batch.length, of: total, results, treasury });
  } catch (e) {
    return res.status(500).json({ error: e.message, results });
  }
}
