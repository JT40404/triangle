// Broadcasts a fully signed transaction through your RPC (set RPC_URL in Vercel).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  try {
    const { tx } = req.body || {};
    if (!tx) return res.status(400).json({ error: 'Missing signed transaction.' });
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sendTransaction',
        params: [tx, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 }]
      })
    });
    const json = await r.json();
    if (json.error) return res.status(400).json({ error: json.error.message || 'RPC rejected the transaction.' });
    return res.status(200).json({ signature: json.result });
  } catch (e) {
    return res.status(500).json({ error: 'Could not reach the RPC.', detail: String(e.message || e) });
  }
}
