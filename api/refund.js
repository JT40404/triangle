// If the coin never got created, return the payment to whoever sent it (read from the chain).
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { connection, launchWallet, funderOf, sendIxs, readJson } from '../lib/solana.js';
import { withLock } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const { mint } = readJson(req);
    const out = await withLock(mint, async () => {
      if (await connection.getAccountInfo(new PublicKey(mint))) throw new Error('This coin was created, so there is nothing to refund.');
      const lw = launchWallet(mint);
      const bal = await connection.getBalance(lw.publicKey);
      if (bal <= 5000) throw new Error('Nothing to refund.');
      const owner = await funderOf(lw.publicKey);
      if (!owner) throw new Error('Could not find who paid.');
      const sig = await sendIxs(lw, [SystemProgram.transfer({ fromPubkey: lw.publicKey, toPubkey: owner, lamports: bal - 5000 })]);
      return { sig, lamports: bal - 5000 };
    });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
