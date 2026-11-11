import type { Db } from '../db/index.js';
import { postLedgerEntries, type LedgerEntryInput } from '../db/repositories.js';

export class LedgerImbalanceError extends Error {
  constructor(txGroup: string, detail: string) {
    super(`Unbalanced ledger transaction ${txGroup}: ${detail}`);
    this.name = 'LedgerImbalanceError';
  }
}

/**
 * Double-entry journals must balance per asset. Each trade posts through a
 * CLEARING account so the WETH and USDG legs stay independently balanced.
 */
export function assertBalanced(db: Db, txGroup: string): void {
  const rows = db
    .prepare(
      `SELECT asset_id, SUM(CASE WHEN direction = 'DEBIT' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END) AS delta
       FROM ledger_entries WHERE tx_group = ? GROUP BY asset_id`,
    )
    .all(txGroup) as { asset_id: string; delta: number | bigint }[];
  const unbalanced = rows.filter((row) => BigInt(row.delta) !== 0n);
  if (unbalanced.length > 0) {
    throw new LedgerImbalanceError(txGroup, unbalanced.map((row) => `${row.asset_id}=${row.delta}`).join(', '));
  }
}

export type BuyPosting = {
  readonly fillId: string;
  readonly amountInUsdg: string;
  readonly amountOutWeth: string;
  readonly feeUsdg: string;
};

export function postBuy(db: Db, posting: BuyPosting): void {
  const entries: LedgerEntryInput[] = [
    { txGroup: posting.fillId, account: 'POSITION', assetId: 'WETH', direction: 'DEBIT', amount: posting.amountOutWeth, businessKey: `${posting.fillId}:position:weth` },
    { txGroup: posting.fillId, account: 'CLEARING', assetId: 'WETH', direction: 'CREDIT', amount: posting.amountOutWeth, businessKey: `${posting.fillId}:clearing:weth` },
    { txGroup: posting.fillId, account: 'CLEARING', assetId: 'USDG', direction: 'DEBIT', amount: posting.amountInUsdg, businessKey: `${posting.fillId}:clearing:usdg` },
    { txGroup: posting.fillId, account: 'CASH', assetId: 'USDG', direction: 'CREDIT', amount: posting.amountInUsdg, businessKey: `${posting.fillId}:cash:purchase` },
    { txGroup: posting.fillId, account: 'FEE_EXPENSE', assetId: 'USDG', direction: 'DEBIT', amount: posting.feeUsdg, businessKey: `${posting.fillId}:fee:expense` },
    { txGroup: posting.fillId, account: 'CASH', assetId: 'USDG', direction: 'CREDIT', amount: posting.feeUsdg, businessKey: `${posting.fillId}:cash:fee` },
  ];
  postLedgerEntries(db, entries);
  assertBalanced(db, posting.fillId);
}

export type SellPosting = {
  readonly fillId: string;
  readonly amountInWeth: string;
  readonly amountOutUsdg: string;
  readonly feeUsdg: string;
  readonly realizedPnlUsdg: string;
};

export function postSell(db: Db, posting: SellPosting): void {
  const entries: LedgerEntryInput[] = [
    { txGroup: posting.fillId, account: 'CASH', assetId: 'USDG', direction: 'DEBIT', amount: posting.amountOutUsdg, businessKey: `${posting.fillId}:cash:sale` },
    { txGroup: posting.fillId, account: 'CLEARING', assetId: 'USDG', direction: 'CREDIT', amount: posting.amountOutUsdg, businessKey: `${posting.fillId}:clearing:usdg` },
    { txGroup: posting.fillId, account: 'CLEARING', assetId: 'WETH', direction: 'DEBIT', amount: posting.amountInWeth, businessKey: `${posting.fillId}:clearing:weth` },
    { txGroup: posting.fillId, account: 'POSITION', assetId: 'WETH', direction: 'CREDIT', amount: posting.amountInWeth, businessKey: `${posting.fillId}:position:weth` },
    { txGroup: posting.fillId, account: 'FEE_EXPENSE', assetId: 'USDG', direction: 'DEBIT', amount: posting.feeUsdg, businessKey: `${posting.fillId}:fee:expense` },
    { txGroup: posting.fillId, account: 'CASH', assetId: 'USDG', direction: 'CREDIT', amount: posting.feeUsdg, businessKey: `${posting.fillId}:cash:fee` },
  ];
  const pnl = BigInt(posting.realizedPnlUsdg);
  if (pnl !== 0n) {
    const absolute = pnl < 0n ? -pnl : pnl;
    entries.push(
      pnl > 0n
        ? { txGroup: posting.fillId, account: 'REALIZED', assetId: 'USDG', direction: 'CREDIT', amount: absolute.toString(), businessKey: `${posting.fillId}:realized:gain` }
        : { txGroup: posting.fillId, account: 'REALIZED', assetId: 'USDG', direction: 'DEBIT', amount: absolute.toString(), businessKey: `${posting.fillId}:realized:loss` },
    );
    entries.push(
      pnl > 0n
        ? { txGroup: posting.fillId, account: 'EQUITY', assetId: 'USDG', direction: 'DEBIT', amount: absolute.toString(), businessKey: `${posting.fillId}:equity:gain` }
        : { txGroup: posting.fillId, account: 'EQUITY', assetId: 'USDG', direction: 'CREDIT', amount: absolute.toString(), businessKey: `${posting.fillId}:equity:loss` },
    );
  }
  postLedgerEntries(db, entries);
  assertBalanced(db, posting.fillId);
}