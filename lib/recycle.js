import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from '@solana/spl-token';
import {
  connection, launchWallet, treasuryWallet, tokenHolding, sendIxs, sendSigned, portalTx, burnAll,
  RESERVE, MIN_RECYCLE, MAIN_SHARE, PRIORITY_FEE, BURN, SOL
} from './solana.js';
import { redis, hgetall } from './store.js';

const ATA_RENT = 2_100_000;

// Hand the launcher their first-buy tokens and refund unused funding. Runs once per launch.
export async function deliver(mint) {
  const key = `launch:${mint}`;
  const rec = await hgetall(key);
  if (!rec.owner) throw new Error('Unknown launch.');
  if (rec.delivered === '1') return { already: true };

  const lw = launchWallet(mint);
  const h = await tokenHolding(lw.publicKey, mint);
  if (!h) throw new Error('The coin is not live yet.');

  const owner = new PublicKey(rec.owner);
  const ixs = [];
  if (h.amount > 0n) {
    const ownerAta = getAssociatedTokenAddressSync(h.mint, owner, false, h.programId);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(lw.publicKey, ownerAta, owner, h.mint, h.programId),
      createTransferCheckedInstruction(h.ata, h.mint, ownerAta, lw.publicKey, h.amount, h.decimals, [], h.programId)
    );
  }
  // Creator fees sit in pump.fun's vault until claimed, so this balance is only leftover funding.
  const bal = await connection.getBalance(lw.publicKey);
  const refund = bal - RESERVE - (ixs.length ? ATA_RENT : 0) - 10_000;
  if (refund > 0) ixs.push(SystemProgram.transfer({ fromPubkey: lw.publicKey, toPubkey: owner, lamports: refund }));

  const sig = ixs.length ? await sendIxs(lw, ixs) : null;
  await redis('HSET', key, 'delivered', '1', 'deliveredAt', Date.now(), 'deliverSig', sig || '');
  return { sig, tokens: h.amount.toString(), refundLamports: Math.max(refund, 0) };
}

// Claim this coin's creator fees, buy it back with 90%, send 10% to the ▲ treasury.
export async function recycle(mint) {
  const lw = launchWallet(mint);
  const pk = lw.publicKey.toBase58();

  try {
    const claim = await portalTx({ publicKey: pk, action: 'collectCreatorFee', priorityFee: PRIORITY_FEE });
    claim.sign([lw]);
    await sendSigned(claim);
  } catch { /* nothing to claim this round */ }

  const available = (await connection.getBalance(lw.publicKey)) - RESERVE;
  if (available < MIN_RECYCLE) return { mint, skipped: 'below minimum' };

  const toMain = Math.floor(available * MAIN_SHARE);
  const toSelf = available - toMain;

  await sendIxs(lw, [SystemProgram.transfer({ fromPubkey: lw.publicKey, toPubkey: treasuryWallet().publicKey, lamports: toMain })]);

  // 3% held back for PumpPortal's 0.5%, priority fee and slippage; it rolls into the next round.
  const buy = await portalTx({
    publicKey: pk, action: 'buy', mint, amount: Number(((toSelf * 0.97) / SOL).toFixed(6)),
    denominatedInSol: 'true', slippage: 15, priorityFee: PRIORITY_FEE, pool: 'auto'
  });
  buy.sign([lw]);
  const buySig = await sendSigned(buy);
  const burnSig = BURN ? await burnAll(lw, mint) : null;

  await Promise.all([
    redis('HINCRBY', `launch:${mint}`, 'buybackLamports', toSelf),
    redis('HINCRBY', `launch:${mint}`, 'mainLamports', toMain),
    redis('HINCRBY', 'stats', 'buybackLamports', toSelf),
    redis('HINCRBY', 'stats', 'mainLamports', toMain)
  ]);
  return { mint, toSelf, toMain, buySig, burnSig };
}

// Once MAIN_TOKEN_CA is set, spend the treasury on ▲.
export async function recycleTreasury() {
  const ca = process.env.MAIN_TOKEN_CA;
  const t = treasuryWallet();
  const available = (await connection.getBalance(t.publicKey)) - RESERVE;
  if (!ca) return { treasury: 'waiting for MAIN_TOKEN_CA', heldLamports: Math.max(available + RESERVE, 0) };
  if (available < MIN_RECYCLE) return { treasury: 'below minimum' };

  const buy = await portalTx({
    publicKey: t.publicKey.toBase58(), action: 'buy', mint: ca, amount: Number(((available * 0.97) / SOL).toFixed(6)),
    denominatedInSol: 'true', slippage: 15, priorityFee: PRIORITY_FEE, pool: 'auto'
  });
  buy.sign([t]);
  const buySig = await sendSigned(buy);
  const burnSig = BURN ? await burnAll(t, ca) : null;
  await redis('HINCRBY', 'stats', 'mainBoughtLamports', available);
  return { treasury: 'bought', lamports: available, buySig, burnSig };
}
