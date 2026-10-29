# ▲ — pump.fun launcher with fee recycling

## What happens on each launch
1. The launcher approves **one payment** (first buy + launch costs) into a fee wallet made just for their coin.
2. That fee wallet creates the coin on pump.fun, so it is the coin's **creator** and receives its creator fees.
3. The launcher gets their first-buy tokens and any unused SOL back.
4. A scheduled job (`/api/cron`) claims each coin's creator fees and:
   - spends **90%** buying back that coin (burned when `BURN_BUYBACKS=true`)
   - sends **10%** to the ▲ treasury, which buys (and burns) ▲ once `MAIN_TOKEN_CA` is set.

Fee rates are fixed by pump.fun, not per launch, so every coin already earns the maximum creator fee available.

Fee wallets aren't stored anywhere: each is derived from `MASTER_SECRET` + the coin's address. Redis only keeps the list of coins and running totals.

## Deploy
1. Push to GitHub and import into Vercel (preset **Other**, no build command).
2. **Storage → Create → Upstash Redis**, connect it to the project (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. **Settings → Environment Variables**: `RPC_URL`, `MASTER_SECRET`, `CRON_SECRET` (see `.env.example`).
4. Redeploy.

## Going live with ▲
1. Launch ▲ (through this site or anywhere).
2. Add `MAIN_TOKEN_CA=<the contract address>` in Vercel and redeploy.
3. The next cron run spends everything accumulated in the treasury on ▲.

## Scheduling
`vercel.json` runs the cron once a day, which is all Vercel's Hobby plan allows. On Pro, change the schedule to something like `*/15 * * * *`. On Hobby you can instead call it from any external scheduler (e.g. cron-job.org):
```
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-site>/api/cron
```
Each run handles `CRON_BATCH` coins (default 10) and rotates through the list.

## Security
- `MASTER_SECRET` controls every fee wallet and the treasury. Store it in a password manager. Never commit it.
- Every fee wallet keeps 0.01 SOL for gas; recycling starts once 0.01 SOL of fees has built up.
- Payouts and refunds always go to the wallet that paid for the launch, read from the chain.
