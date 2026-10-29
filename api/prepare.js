// Step 1: build the one payment the launcher signs (their wallet → this coin's fee wallet).
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { connection, launchWallet, fundLamports, readJson } from '../lib/solana.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const { owner, mint, amount, slippage } = readJson(req);
    const ownerPk = new PublicKey(owner);
    const lw = launchWallet(mint);
    const amt = Math.max(0, Number(amount) || 0);
    const slip = Math.min(50, Math.max(1, Number(slippage) || 10));
    const lamports = fundLamports(amt, slip);

    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: ownerPk, toPubkey: lw.publicKey, lamports }));
    tx.feePayer = ownerPk;
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

    return res.status(200).json({
      feeWallet: lw.publicKey.toBase58(),
      lamports,
      tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Could not prepare the payment.' });
  }
}
