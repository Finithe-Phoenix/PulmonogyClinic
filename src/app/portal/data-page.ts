import { DestroyRef, effect, inject, signal } from '@angular/core';
import { ClinicStore } from './clinic-store';

/** A bounded server page. Stale requests cannot overwrite the active query. */
export class DataPage<T> {
  readonly items = signal<T[]>([]);
  readonly offset = signal(0);
  readonly query = signal('');
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly more = signal(false);
  private readonly store = inject(ClinicStore);
  private readonly requested = signal(0);
  private sequence = 0;
  private disposed = false;
  constructor(readonly path: string, readonly size = 25, roles: string[] = []) {
    inject(DestroyRef).onDestroy(() => { this.disposed = true; this.sequence++; });
    effect(() => {
      this.store.revision();
      this.requested();
      const subject = this.store.user()?.profile.sub;
      const offset = this.offset(), query = this.query();
      if (subject && (!roles.length || this.store.has(...roles))) void this.load(subject, offset, query);
      else this.items.set([]);
    });
  }
  private async load(subject: string, offset: number, query: string) {
    const ticket = ++this.sequence;
    this.loading.set(true); this.failed.set(false); this.items.set([]); this.more.set(false);
    try {
      const separator = this.path.includes('?') ? '&' : '?';
      const result = await this.store.api.request<{items: T[]}>(`${this.path}${separator}limit=${this.size + 1}&offset=${offset}${query ? '&' + query : ''}`);
      if (this.disposed || ticket !== this.sequence || subject !== this.store.user()?.profile.sub) return;
      this.items.set(result.items.slice(0, this.size)); this.more.set(result.items.length > this.size); this.store.confirmedRead();
    } catch (error) {
      if (this.disposed || ticket !== this.sequence || subject !== this.store.user()?.profile.sub) return;
      this.failed.set(true); this.items.set([]); this.more.set(false); this.store.report(error);
    } finally { if (ticket === this.sequence) this.loading.set(false); }
  }
  filter(params: Record<string, string | boolean>) {
    this.offset.set(0);
    this.query.set(new URLSearchParams(Object.entries(params).map(([k,v]) => [k,String(v)])).toString());
    // Searching again is an explicit retry even when offset and text are unchanged.
    this.requested.update(value => value + 1);
  }
  next() { if (!this.loading() && this.more()) this.offset.update(n => n + this.size); }
  previous() { if (!this.loading()) this.offset.update(n => Math.max(0, n - this.size)); }
}

export const money = (cents: number) => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}).format(cents / 100);
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Mexico_City'}).format(new Date());
export const statusLabel = (status: string) => ({PENDING:'Pendiente', PARTIAL:'Recepción parcial', RECEIVED:'Recibida', CANCELLED:'Cancelada', RECEIPT:'Entrada', ISSUE:'Salida', DISPOSAL:'Baja'} as Record<string,string>)[status] || status;

/** Decimal input to integer cents; no floating-point financial arithmetic. */
export function toCents(value: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents > 0 && cents <= 100000000 ? cents : null;
}
