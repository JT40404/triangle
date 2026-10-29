import { connection } from '../lib/solana.js';

export default async function handler(req, res) {
  try {
    const sig = String(req.query.sig || '');
    const { value: [s] } = await connection.getSignatureStatuses([sig], { searchTransactionHistory: false });
    return res.status(200).json({ status: s?.confirmationStatus || 'pending', err: s?.err || null });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
