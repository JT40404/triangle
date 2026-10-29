// Step 2: build the create transaction with this coin's fee wallet as creator, and register the launch.
import { PublicKey } from '@solana/web3.js';
import { connection, launchWallet, fundLamports, funderOf, portalTx, PRIORITY_FEE, readJson } from '../lib/solana.js';
import { redis } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const { mint, name, symbol, uri, amount, slippage } = readJson(req);
    const mintPk = new PublicKey(mint);
    if (!uri || !name || !symbol) return res.status(400).json({ error: 'Missing coin details.' });
    if (await connection.getAccountInfo(mintPk)) return res.status(409).json({ error: 'This coin already exists.' });

    const amt = Math.max(0, Number(amount) || 0);
    const slip = Math.min(50, Math.max(1, Number(slippage) || 10));
    const lw = launchWallet(mint);
    const bal = await connection.getBalance(lw.publicKey);
    if (bal < fundLamports(amt, slip)) return res.status(402).json({ error: 'The launch payment hasn\u2019t arrived yet. Wait a few seconds and try again.' });

    const owner = await funderOf(lw.publicKey);
    if (!owner) return res.status(400).json({ error: 'Could not find who paid for this launch.' });

    const tx = await portalTx({
      publicKey: lw.publicKey.toBase58(),
      action: 'create',
      tokenMetadata: { name: String(name).slice(0, 32), symbol: String(symbol).slice(0, 10), uri },
      mint: mintPk.toBase58(),
      denominatedInSol: 'true',
      amount: amt,
      slippage: slip,
      priorityFee: PRIORITY_FEE,
      pool: 'pump'
    });
    tx.sign([lw]); // the mint co-signs in the browser

    const key = `launch:${mintPk.toBase58()}`;
    if ((await redis('HSETNX', key, 'owner', owner.toBase58())) === 1) await redis('RPUSH', 'launches', mintPk.toBase58());
    await redis('HSET', key, 'name', name, 'symbol', symbol, 'createdAt', Date.now(), 'feeWallet', lw.publicKey.toBase58());

    return res.status(200).json({ tx: Buffer.from(tx.serialize()).toString('base64') });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Could not build the launch.' });
  }
}
