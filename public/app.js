(() => {
  const { Keypair, Transaction, VersionedTransaction } = window.solanaWeb3;
  const $ = (id) => document.getElementById(id);
  const MAX_IMAGE = 2.5 * 1024 * 1024;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.addEventListener('load', () => setTimeout(() => $('loading').classList.add('done'), 500));

  // ---------- live fee stats ----------
  fetch('/api/stats').then((r) => r.json()).then((s) => {
    if (s.error) return;
    const sol = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
    $('sLaunches').textContent = s.launches.toLocaleString();
    $('sBuyback').textContent = sol(s.buybackSol);
    $('sMain').textContent = sol(s.toMainSol);
    $('burnNote').hidden = !s.burn;
    $('mainNote').innerHTML = s.mainToken
      ? `▲ contract: <a href="https://pump.fun/coin/${s.mainToken}" target="_blank" rel="noopener">${s.mainToken}</a>`
      : `▲ isn\u2019t live yet. Its 10% share is held in the treasury (<a href="https://solscan.io/account/${s.treasury}" target="_blank" rel="noopener">view</a>) until it is.`;
  }).catch(() => {});

  // ---------- wallet ----------
  let wallet = null;
  let owner = null;
  function findProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solflare?.isSolflare) return window.solflare;
    if (window.backpack?.solana) return window.backpack.solana;
    return window.solana || null;
  }
  const short = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`;
  function renderWallet() {
    $('connectBtn').textContent = owner ? short(owner) : 'Connect wallet';
    $('launchBtn').textContent = owner ? 'Launch coin' : 'Connect wallet to launch';
  }
  async function connect() {
    wallet = findProvider();
    if (!wallet) { setStatus('No Solana wallet found. Install Phantom, Solflare or Backpack, then reload this page.', 'bad'); return false; }
    try {
      const r = await wallet.connect();
      owner = (r?.publicKey || wallet.publicKey).toString();
      renderWallet(); setStatus('');
      return true;
    } catch { setStatus('Wallet connection was cancelled.', 'bad'); return false; }
  }
  $('connectBtn').addEventListener('click', async () => {
    if (owner && wallet?.disconnect) { await wallet.disconnect(); owner = null; renderWallet(); return; }
    connect();
  });

  // ---------- form ----------
  const counter = (inputId, outId, max) => {
    const el = $(inputId);
    const update = () => { $(outId).textContent = `${el.value.length}/${max}`; };
    el.addEventListener('input', update); update();
  };
  counter('name', 'nameCount', 32);
  counter('symbol', 'symCount', 10);
  $('symbol').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/\s/g, ''); });

  let imageFile = null;
  function setImage(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return setStatus('Use a PNG, JPG, GIF or WEBP image.', 'bad');
    if (file.size > MAX_IMAGE) return setStatus('That image is over 2.5 MB. Pick a smaller one.', 'bad');
    imageFile = file;
    $('preview').src = URL.createObjectURL(file);
    $('preview').hidden = false; $('dropHint').hidden = true;
    setStatus('');
  }
  $('image').addEventListener('change', (e) => setImage(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => setImage(e.dataTransfer.files[0]));

  function setStatus(html, kind) {
    const s = $('status');
    s.innerHTML = html;
    s.className = 'status' + (kind ? ` is-${kind}` : '');
  }

  const toDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Could not read the image.'));
    r.readAsDataURL(file);
  });
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bytesToB64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(json.error || `Request to ${path} failed (${r.status}).`); e.status = r.status; throw e; }
    return json;
  }
  async function confirm(sig) {
    for (let i = 0; i < 40; i++) {
      const j = await fetch(`/api/status?sig=${sig}`).then((r) => r.json()).catch(() => ({}));
      if (j.err) throw new Error('The transaction failed on-chain.');
      if (j.status === 'confirmed' || j.status === 'finalized') return;
      await sleep(1500);
    }
    throw new Error('Still waiting for Solana to confirm. Check your wallet history before trying again.');
  }

  // ---------- launch ----------
  $('launchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!owner && !(await connect())) return;

    const name = $('name').value.trim();
    const symbol = $('symbol').value.trim();
    if (!name) { setStatus('Give your coin a name.', 'bad'); return $('name').focus(); }
    if (!symbol) { setStatus('Give your coin a ticker.', 'bad'); return $('symbol').focus(); }
    if (!imageFile) return setStatus('Add a picture for your coin.', 'bad');

    const amount = Number($('amount').value) || 0;
    const slippage = Number($('slippage').value) || 10;
    const btn = $('launchBtn');
    btn.disabled = true;
    const mint = Keypair.generate();
    const mintAddr = mint.publicKey.toBase58();
    let funded = false;

    try {
      setStatus('Uploading picture and details…');
      const { metadataUri } = await post('/api/ipfs', {
        image: await toDataURL(imageFile), filename: imageFile.name, name, symbol,
        description: $('description').value.trim(),
        twitter: $('twitter').value.trim(), telegram: $('telegram').value.trim(), website: $('website').value.trim()
      });

      const prep = await post('/api/prepare', { owner, mint: mintAddr, amount, slippage });
      setStatus(`Approve the launch payment of ${(prep.lamports / 1e9).toFixed(4)} SOL in your wallet…`);
      const payment = await wallet.signTransaction(Transaction.from(b64ToBytes(prep.tx)));
      const { signature: paySig } = await post('/api/send', { tx: bytesToB64(payment.serialize()) });
      setStatus('Waiting for your payment to confirm…');
      await confirm(paySig);
      funded = true;

      setStatus('Creating your coin…');
      let built;
      for (let i = 0; i < 6; i++) {
        try { built = await post('/api/launch', { mint: mintAddr, name, symbol, uri: metadataUri, amount, slippage }); break; }
        catch (err) { if (err.status !== 402 || i === 5) throw err; await sleep(2000); }
      }
      const createTx = VersionedTransaction.deserialize(b64ToBytes(built.tx));
      createTx.sign([mint]);
      const { signature: createSig } = await post('/api/send', { tx: bytesToB64(createTx.serialize()) });
      await confirm(createSig);
      funded = false; // the coin exists now; no refund path from here

      setStatus('Sending your tokens and any unused SOL back…');
      await post('/api/finalize', { mint: mintAddr }).catch(() => {}); // the scheduled job retries if this misses

      setStatus(
        `Launched. <a href="https://pump.fun/coin/${mintAddr}" target="_blank" rel="noopener">View ${symbol} on pump.fun</a> · ` +
        `<a href="https://solscan.io/tx/${createSig}" target="_blank" rel="noopener">See transaction</a>`, 'ok'
      );
    } catch (err) {
      let msg = /reject|cancel|denied/i.test(err.message) ? 'You declined in your wallet. Nothing was launched.' : err.message;
      if (funded) {
        try { await post('/api/refund', { mint: mintAddr }); msg += ' Your payment has been refunded.'; }
        catch (r) { msg += ` Refund didn\u2019t go through (${r.message}). Keep this address to recover it: ${mintAddr}`; }
      }
      setStatus(msg, 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  const p = findProvider();
  if (p?.connect) p.connect({ onlyIfTrusted: true }).then((r) => { wallet = p; owner = (r?.publicKey || p.publicKey).toString(); renderWallet(); }).catch(() => {});
})();
