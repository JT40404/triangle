// Step 3: send the launcher their first-buy tokens and refund unused SOL.
import { readJson } from '../lib/solana.js';
import { withLock } from '../lib/store.js';
import { deliver } from '../lib/recycle.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const { mint } = readJson(req);
    const out = await withLock(mint, () => deliver(mint));
    return res.status(200).json(out);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
