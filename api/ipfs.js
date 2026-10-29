// Uploads the coin image + metadata to pump.fun's IPFS endpoint.
// Proxied server-side because the endpoint doesn't allow browser CORS.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const { image, filename, name, symbol, description, twitter, telegram, website } = req.body || {};
    if (!image || !name || !symbol) return res.status(400).json({ error: 'Name, ticker and image are required.' });

    const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(image);
    if (!match) return res.status(400).json({ error: 'Image must be a PNG, JPG, GIF or WEBP.' });
    const bytes = Buffer.from(match[2], 'base64');

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: match[1] }), filename || 'coin.png');
    form.append('name', String(name).slice(0, 32));
    form.append('symbol', String(symbol).slice(0, 10));
    form.append('description', String(description || ''));
    if (twitter) form.append('twitter', String(twitter));
    if (telegram) form.append('telegram', String(telegram));
    if (website) form.append('website', String(website));
    form.append('showName', 'true');

    const r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: form });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Metadata upload failed (${r.status}).`, detail: text.slice(0, 300) });
    const json = JSON.parse(text);
    return res.status(200).json({ metadataUri: json.metadataUri, metadata: json.metadata });
  } catch (e) {
    return res.status(500).json({ error: 'Metadata upload failed.', detail: String(e.message || e) });
  }
}
