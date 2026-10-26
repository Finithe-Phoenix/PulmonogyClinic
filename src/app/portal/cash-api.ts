export type CashMethod = 'CASH' | 'CARD' | 'TRANSFER';
export type CashStatus = 'OPEN' | 'CLOSED';
export interface CashShift {
  id: string; reference: string; status: CashStatus; currency: 'MXN';
  openingFloatCents: number; cashTotalCents: number; cardTotalCents: number; transferTotalCents: number;
  expectedCashCents: number; countedCashCents: number | null; differenceCents: number | null;
  openedAt: string; openedBy: string; closedAt: string | null; closedBy: string | null; closureReason: string | null;
}
export interface CashPayment {
  id: string; shiftId: string; reference: string; amountCents: number; method: CashMethod;
  operationReference: string | null; createdAt: string; actor: string; reversed: boolean;
  reversedAt: string | null; reversedBy: string | null; reversalReason: string | null;
}
export interface CashPage<T> { items: T[]; limit: number; offset: number; }
export const CASH_MAX_CENTS = 9_000_000_000_000;
export const CASH_AMOUNT_PATTERN = '[0-9]{1,11}([.,][0-9]{1,2})?';

/** Decimal text to exact cents. No floating point decimal arithmetic or rounding. */
export function toCashCents(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,11}(?:[.,]\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split(/[.,]/);
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(CASH_MAX_CENTS) ? Number(cents) : null;
}
export const cashMethodLabel = (method: CashMethod) => ({ CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' })[method];
export const cashStatusLabel = (status: CashStatus) => status === 'OPEN' ? 'Abierto' : 'Cerrado';
export const cashDifferenceLabel = (difference: number | null) => difference === null ? 'Pendiente de cierre' : difference === 0 ? 'Conciliado' : difference < 0 ? 'Faltante' : 'Sobrante';
