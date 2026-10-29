import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createBurnCheckedInstruction } from '@solana/spl-token';
import { createHmac } from 'node:crypto';

export const SOL = LAMPORTS_PER_SOL;
export const RESERVE = Math.round(0.01 * SOL);        // kept in every derived wallet for gas + rent
export const MIN_RECYCLE = Math.round(0.01 * SOL);    // smallest amount worth a claim/buy cycle
export const LAUNCH_OVERHEAD = 0.05;                  // SOL for pump.fun account rent + fees; unused part is refunded
export const SELF_SHARE = 0.9;                        // 90% buys back the coin that earned the fees
export const MAIN_SHARE = 0.1;                        // 10% goes to the ▲ treasury
export const PRIORITY_FEE = Number(process.env.PRIORITY_FEE || 0.0005);
export const BURN = process.env.BURN_BUYBACKS !== 'false';

export const connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

function masterSecret() {
  const s = process.env.MASTER_SECRET;
  if (!s || s.length < 32) throw new Error('MASTER_SECRET is missing or shorter than 32 characters.');
  return s;
}

export function deriveKeypair(label) {
  return Keypair.fromSeed(createHmac('sha256', masterSecret()).update(label).digest());
}
export const launchWallet = (mint) => deriveKeypair(`launch:${new PublicKey(mint).toBase58()}`);
export const treasuryWallet = () => deriveKeypair('treasury');

// SOL the launcher sends: first buy + slippage + PumpPortal's 0.5% + account rent.
export function fundLamports(amount, slippage) {
  return Math.ceil((amount * (1 + slippage / 100) * 1.006 + LAUNCH_OVERHEAD) * SOL);
}

export async function portalTx(body) {
  const r = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`PumpPortal ${body.action} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
}

export async function waitFor(sig, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { value: [s] } = await connection.getSignatureStatuses([sig]);
    if (s?.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return sig;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for ${sig}`);
}

export async function sendSigned(tx) {
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, preflightCommitment: 'confirmed' });
  return waitFor(sig);
}

export async function sendIxs(signer, ixs) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(signer);
  return sendSigned(tx);
}

// Returns null if the mint doesn't exist on-chain yet. Works for SPL Token and Token-2022.
export async function tokenHolding(owner, mint) {
  const mintPk = new PublicKey(mint);
  const info = await connection.getAccountInfo(mintPk);
  if (!info) return null;
  const programId = info.owner;
  const ata = getAssociatedTokenAddressSync(mintPk, owner, true, programId);
  let amount = 0n;
  let decimals = 6;
  try {
    const b = await connection.getTokenAccountBalance(ata);
    amount = BigInt(b.value.amount);
    decimals = b.value.decimals;
  } catch { /* no token account yet */ }
  return { mint: mintPk, programId, ata, amount, decimals };
}

export async function burnAll(signer, mint) {
  const h = await tokenHolding(signer.publicKey, mint);
  if (!h || h.amount === 0n) return null;
  return sendIxs(signer, [createBurnCheckedInstruction(h.ata, h.mint, signer.publicKey, h.amount, h.decimals, [], h.programId)]);
}

// The wallet that paid for the oldest transaction touching `address` (the launcher who funded it).
// Read from the chain so nobody can claim someone else's launch by calling the API first.
export async function funderOf(address) {
  let before;
  let oldest;
  for (let i = 0; i < 5; i++) {
    const page = await connection.getSignaturesForAddress(address, { before, limit: 1000 });
    if (!page.length) break;
    oldest = page[page.length - 1].signature;
    before = oldest;
    if (page.length < 1000) break;
  }
  if (!oldest) return null;
  const tx = await connection.getTransaction(oldest, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  const m = tx?.transaction?.message;
  const keys = m?.staticAccountKeys || m?.accountKeys;
  return keys?.[0] ? new PublicKey(keys[0]) : null;
}

export function readJson(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
}
