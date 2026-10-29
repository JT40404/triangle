import { redis, hgetall } from '../lib/store.js';
import { treasuryWallet } from '../lib/solana.js';

export default async function handler(req, res) {
  try {
    const [s, launches] = await Promise.all([hgetall('stats'), redis('LLEN', 'launches')]);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      launches: Number(launches) || 0,
      buybackSol: (Number(s.buybackLamports) || 0) / 1e9,
      toMainSol: (Number(s.mainLamports) || 0) / 1e9,
      mainBoughtSol: (Number(s.mainBoughtLamports) || 0) / 1e9,
      mainToken: process.env.MAIN_TOKEN_CA || null,
      treasury: treasuryWallet().publicKey.toBase58(),
      burn: process.env.BURN_BUYBACKS !== 'false'
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
