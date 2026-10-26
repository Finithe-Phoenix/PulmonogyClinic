import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IconComponent } from '../icon';
import { ClinicStore } from './clinic-store';
import { DataPage, money } from './data-page';
import { Dialog } from './dialog';
import { Pager } from './pager';
import {
  CASH_AMOUNT_PATTERN, CASH_MAX_CENTS, cashDifferenceLabel, cashMethodLabel, cashStatusLabel,
  toCashCents, type CashMethod, type CashPage, type CashPayment, type CashShift,
} from './cash-api';

@Component({ selector: 'clinic-cash', imports: [FormsModule, RouterLink, IconComponent, Dialog, Pager], templateUrl: './cash.html' })
export class Cash {
  readonly store = inject(ClinicStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly rows = new DataPage<CashShift>('cash/shifts', 25, ['ADMIN', 'RECEPCION', 'AUDITOR']);
  // The active register must remain known when the history pager moves to older shifts.
  readonly currentRows = new DataPage<CashShift>('cash/shifts', 1, ['ADMIN', 'RECEPCION', 'AUDITOR']);
  readonly detailId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly selected = signal<CashShift | null>(null);
  readonly detailLoading = signal(false);
  readonly detailFailed = signal(false);
  readonly payments = signal<CashPayment[]>([]);
  readonly paymentsLoading = signal(false);
  readonly paymentsFailed = signal(false);
  readonly paymentsOffset = signal(0);
  readonly paymentsMore = signal(false);
  readonly paymentPageSize = 25;
  readonly dialog = signal<'open' | 'pay' | 'reverse' | 'close' | null>(null);
  readonly reversing = signal<CashPayment | null>(null);
  readonly canWrite = computed(() => this.store.has('ADMIN', 'RECEPCION'));
  readonly canReverse = computed(() => this.store.has('ADMIN'));
  readonly isOpen = computed(() => this.selected()?.status === 'OPEN');
  readonly visibleOpen = computed(() => this.currentRows.items().find(shift => shift.status === 'OPEN'));
  readonly money = money;
  readonly methodLabel = cashMethodLabel;
  readonly statusLabel = cashStatusLabel;
  readonly differenceLabel = cashDifferenceLabel;
  readonly amountPattern = CASH_AMOUNT_PATTERN;
  opening = { reference: '', amount: '0.00' };
  payment = { reference: '', amount: '', method: 'CASH' as CashMethod, operationReference: '' };
  closing = { amount: '', reason: '', acknowledged: false };
  reversalReason = '';
  private detailTicket = 0;
  private paymentTicket = 0;
  private disposed = false;
  private readonly awaitingConfirmation = signal<{ revision: number } | null>(null);

  constructor() {
    const routeSubscription = this.route.paramMap.subscribe(params => {
      this.detailId.set(params.get('id')); this.selected.set(null); this.payments.set([]);
      this.paymentsOffset.set(0); this.dialog.set(null); this.detailTicket++; this.paymentTicket++;
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true; this.detailTicket++; this.paymentTicket++; routeSubscription.unsubscribe();
    });
    effect(() => {
      this.store.revision();
      const id = this.detailId(), subject = this.store.user()?.profile.sub;
      if (id && subject && this.store.has('ADMIN', 'RECEPCION', 'AUDITOR')) void this.loadShift(id, subject);
      else { this.detailTicket++; this.selected.set(null); this.detailLoading.set(false); }
    });
    effect(() => {
      this.store.revision();
      const id = this.detailId(), offset = this.paymentsOffset(), subject = this.store.user()?.profile.sub;
      if (id && subject && this.store.has('ADMIN', 'RECEPCION', 'AUDITOR')) void this.loadPayments(id, subject, offset);
      else { this.paymentTicket++; this.payments.set([]); this.paymentsLoading.set(false); this.paymentsMore.set(false); }
    });
    effect(() => {
      const awaiting = this.awaitingConfirmation(), revision = this.store.revision();
      // A successful retry in the shared dialog refreshes state and dismisses the old form.
      // This prevents submitting the same visible payment as a new command after recovery.
      if (awaiting && !this.store.pending() && !this.store.busy()) {
        if (this.store.error()) this.awaitingConfirmation.set(null);
        else if (revision > awaiting.revision) {
          this.dialog.set(null); this.awaitingConfirmation.set(null); this.paymentsOffset.set(0);
        }
      }
    });
  }
  private async loadShift(id: string, subject: string) {
    const ticket = ++this.detailTicket; this.detailLoading.set(true); this.detailFailed.set(false);
    try {
      const shift = await this.store.api.request<CashShift>('cash/shifts/' + id);
      if (this.disposed || ticket !== this.detailTicket || subject !== this.store.user()?.profile.sub) return;
      this.selected.set(shift); this.store.confirmedRead();
    } catch (error) {
      if (this.disposed || ticket !== this.detailTicket) return;
      this.detailFailed.set(true); this.selected.set(null); this.store.report(error);
    } finally { if (ticket === this.detailTicket) this.detailLoading.set(false); }
  }
  private async loadPayments(id: string, subject: string, offset: number) {
    const ticket = ++this.paymentTicket; this.paymentsLoading.set(true); this.paymentsFailed.set(false);
    try {
      const result = await this.store.api.request<CashPage<CashPayment>>(`cash/shifts/${id}/payments?limit=${this.paymentPageSize + 1}&offset=${offset}`);
      if (this.disposed || ticket !== this.paymentTicket || subject !== this.store.user()?.profile.sub) return;
      this.payments.set(result.items.slice(0, this.paymentPageSize)); this.paymentsMore.set(result.items.length > this.paymentPageSize); this.store.confirmedRead();
    } catch (error) {
      if (this.disposed || ticket !== this.paymentTicket) return;
      this.payments.set([]); this.paymentsFailed.set(true); this.paymentsMore.set(false); this.store.report(error);
    } finally { if (ticket === this.paymentTicket) this.paymentsLoading.set(false); }
  }
  date(value: string | null): string {
    return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(value)) : '—';
  }
  beginOpen() {
    if (!this.canWrite() || this.store.blocked() || this.currentRows.loading() || this.currentRows.failed() || this.visibleOpen()) return;
    this.opening = { reference: '', amount: '0.00' }; this.store.error.set(''); this.dialog.set('open');
  }
  beginPayment() {
    if (!this.canWrite() || !this.isOpen() || this.detailLoading() || this.store.blocked()) return;
    this.payment = { reference: '', amount: '', method: 'CASH', operationReference: '' }; this.store.error.set(''); this.dialog.set('pay');
  }
  beginReverse(payment: CashPayment) {
    if (!this.canReverse() || !this.isOpen() || payment.reversed || this.detailLoading() || this.store.blocked()) return;
    this.reversing.set(payment); this.reversalReason = ''; this.store.error.set(''); this.dialog.set('reverse');
  }
  beginClose() {
    if (!this.canWrite() || !this.isOpen() || this.detailLoading() || this.store.blocked()) return;
    this.closing = { amount: '', reason: '', acknowledged: false }; this.store.error.set(''); this.dialog.set('close');
  }
  closeDifference(): number | null {
    const cents = toCashCents(this.closing.amount), shift = this.selected();
    return cents === null || !shift ? null : cents - shift.expectedCashCents;
  }
  async openShift() {
    if (!this.canWrite() || this.store.blocked()) return;
    const cents = toCashCents(this.opening.amount);
    if (cents === null) { this.invalidAmount(); return; }
    if (!this.opening.reference.trim()) { this.store.error.set('Escribe una referencia para identificar este turno.'); return; }
    const result = await this.submitCash<CashShift>('cash/shifts', { reference: this.opening.reference.trim(), openingFloatCents: cents });
    if (result) { this.dialog.set(null); await this.router.navigate(['/caja', result.id]); }
  }
  async recordPayment() {
    const shift = this.selected();
    if (!shift || shift.status !== 'OPEN' || !this.canWrite() || this.detailLoading() || this.store.blocked()) return;
    const cents = toCashCents(this.payment.amount);
    if (cents === null || cents === 0) { this.invalidAmount(true); return; }
    if (!this.payment.reference.trim()) { this.store.error.set('Escribe una referencia única para el cobro.'); return; }
    const total = shift.openingFloatCents + shift.cashTotalCents + shift.cardTotalCents + shift.transferTotalCents;
    if (cents > CASH_MAX_CENTS - total) { this.store.error.set('El cobro supera el límite de importe del turno.'); return; }
    const result = await this.submitCash<CashPayment>(`cash/shifts/${shift.id}/payments`, {
      reference: this.payment.reference.trim(), amountCents: cents, method: this.payment.method,
      operationReference: this.payment.operationReference.trim() || null,
    });
    if (result) { this.dialog.set(null); this.paymentsOffset.set(0); }
  }
  async reversePayment() {
    const payment = this.reversing(), shift = this.selected();
    if (!payment || payment.reversed || !shift || shift.status !== 'OPEN' || !this.canReverse() || this.detailLoading() || this.store.blocked()) return;
    if (!this.reversalReason.trim()) { this.store.error.set('Explica por qué se revierte este cobro.'); return; }
    const result = await this.submitCash<CashPayment>(`cash/payments/${payment.id}/reverse`, { reason: this.reversalReason.trim() });
    if (result) { this.dialog.set(null); this.reversing.set(null); }
  }
  async closeShift() {
    const shift = this.selected();
    if (!shift || shift.status !== 'OPEN' || !this.canWrite() || this.detailLoading() || this.store.blocked()) return;
    const cents = toCashCents(this.closing.amount);
    if (cents === null) { this.invalidAmount(); return; }
    if (!this.closing.reason.trim() || !this.closing.acknowledged) { this.store.error.set('Registra el motivo y confirma que revisaste el conteo antes de cerrar.'); return; }
    const result = await this.submitCash<CashShift>(`cash/shifts/${shift.id}/close`, { countedCashCents: cents, reason: this.closing.reason.trim() });
    if (result) { this.selected.set(result); this.dialog.set(null); }
  }
  previousPayments() { if (!this.paymentsLoading()) this.paymentsOffset.update(value => Math.max(0, value - this.paymentPageSize)); }
  nextPayments() { if (!this.paymentsLoading() && this.paymentsMore()) this.paymentsOffset.update(value => value + this.paymentPageSize); }
  private async submitCash<T>(path: string, body: unknown): Promise<T | null> {
    this.awaitingConfirmation.set({ revision: this.store.revision() });
    const result = await this.store.submit<T>(path, body);
    if (result !== null || !this.store.pending()) this.awaitingConfirmation.set(null);
    return result;
  }
  private invalidAmount(positive = false) {
    this.store.error.set(`Escribe un importe ${positive ? 'mayor que cero' : 'igual o mayor que cero'} en pesos, con hasta dos decimales y sin separadores de miles. Máximo: $90,000,000,000.00.`);
  }
}
