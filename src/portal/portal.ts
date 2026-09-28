import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { ApiError, ClinicApi, type Product, type Supplier, type OrderSummary, type Order, type Lot, type Audit, type Receipt, type PendingCommand } from './api';

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './portal.html' })
export class PortalComponent {
  readonly user = signal<User | null>(null);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly products = signal<Product[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly orders = signal<OrderSummary[]>([]);
  readonly lots = signal<Lot[]>([]);
  readonly events = signal<Audit[]>([]);
  readonly receipts = signal<Receipt[]>([]);
  readonly selected = signal<Order | null>(null);
  readonly pending = signal<PendingCommand | null>(null);
  readonly updated = signal('');
  readonly auth = new UserManager({
    authority: 'http://localhost:8180/realms/clinic-dev', client_id: 'clinic-portal',
    redirect_uri: 'http://localhost:4180/', post_logout_redirect_uri: 'http://localhost:4180/',
    response_type: 'code', scope: 'openid profile', automaticSilentRenew: false,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    loadUserInfo: false,
  });
  readonly api = new ClinicApi(() => this.user()?.access_token);
  product = { sku: '', name: '', category: 'INSUMOS', unit: 'pieza', minimumStock: 0 };
  supplier = { reference: '', name: '' };
  order = { reference: '', supplierId: '', expectedOn: new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Mexico_City'}).format(new Date()), lines: [{ productId: '', quantity: 10, unitCostCents: 1000 }] };
  receipt = { reference: '', lineId: '', quantity: 1, batch: '', expiresOn: '', quarantined: false };
  cancellationReason = '';
  constructor() {
    this.auth.events.addAccessTokenExpired(() => { this.user.set(null); this.clearData(); this.error.set('Sesión vencida. Inicia sesión para continuar.'); });
    void this.initialize();
  }
  has(...roles: string[]) { const assigned = this.user()?.profile['roles']; return Array.isArray(assigned) && roles.some(r => assigned.includes(r)); }
  async initialize() {
    try {
      if (new URLSearchParams(location.search).has('state')) {
        try { this.user.set(await this.auth.signinRedirectCallback()); }
        finally { history.replaceState({}, '', '/'); }
      }
      await this.auth.clearStaleState();
      if (this.user()) {
        const raw = sessionStorage.getItem('clinic-private-pending');
        if (raw) { const pending = JSON.parse(raw); if (pending.subject === this.user()!.profile.sub) this.pending.set(pending); }
        await this.refresh();
      }
    } catch { this.error.set('No se pudo completar el acceso. Comprueba la identidad local y vuelve a iniciar sesión.'); }
  }
  async login() { try { await this.auth.signinRedirect(); } catch { this.error.set('El proveedor de identidad no está disponible.'); } }
  async logout() {
    const user = this.user();
    this.user.set(null); this.clearData(); this.pending.set(null);
    // Keep an uncertain command scoped to its original subject for recovery after login.
    try { await this.auth.signoutRedirect({ id_token_hint: user?.id_token }); }
    catch { await this.auth.removeUser(); this.error.set('Acceso local cerrado. No se pudo cerrar la sesión del proveedor.'); }
  }
  clearData() { this.products.set([]); this.suppliers.set([]); this.orders.set([]); this.lots.set([]); this.events.set([]); this.receipts.set([]); this.selected.set(null); this.updated.set(''); }
  async refresh() {
    if (!this.has('ADMIN', 'FARMACIA', 'AUDITOR')) return;
    this.busy.set(true);
    try { await this.load(); }
    catch (e) { this.report(e); }
    finally { this.busy.set(false); }
  }
  private async load() {
    const subject = this.user()?.profile.sub;
    const [products, suppliers, orders, lots, receipts, events] = await Promise.all([
      this.api.list<Product>('inventory/products'), this.api.list<Supplier>('purchasing/suppliers'),
      this.api.list<OrderSummary>('purchasing/orders'), this.api.list<Lot>('inventory/lots'),
      this.api.list<Receipt>('purchasing/receipts'), this.has('ADMIN', 'AUDITOR') ? this.api.list<Audit>('audit/events') : Promise.resolve([]),
    ]);
    if (!subject || this.user()?.profile.sub !== subject) return;
    this.products.set(products); this.suppliers.set(suppliers); this.orders.set(orders); this.lots.set(lots); this.receipts.set(receipts); this.events.set(events);
    if (this.selected()) await this.select(this.selected()!.id);
    this.updated.set(new Date().toLocaleTimeString('es-MX'));
  }
  async select(id: string) {
    try {
      const order = await this.api.request<Order>('purchasing/orders/' + id);
      this.selected.set(order);
      this.receipt.lineId = order.lines.find(l => l.received < l.ordered)?.id || '';
    } catch (e) { this.report(e); }
  }
  async submit(path: string, body: unknown) {
    if (this.busy() || this.pending() || !this.user()) return;
    const pending = { subject: this.user()!.profile.sub, path, body: structuredClone(body), key: crypto.randomUUID() };
    try { sessionStorage.setItem('clinic-private-pending', JSON.stringify(pending)); }
    catch { this.error.set('El navegador impide conservar la clave de reintento. Habilita el almacenamiento de sesión antes de registrar.'); return; }
    this.pending.set(pending);
    await this.retry();
  }
  async retry() {
    const pending = this.pending();
    if (!pending || this.busy() || pending.subject !== this.user()?.profile.sub) return;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      const result = await this.api.request<{id: string}>(pending.path, pending);
      this.pending.set(null); sessionStorage.removeItem('clinic-private-pending');
      this.message.set('Operación confirmada por el servidor.');
      if (pending.path === 'purchasing/orders') await this.select(result.id);
      try { await this.load(); }
      catch { this.error.set('Operación confirmada; no se pudieron actualizar los listados. Pulsa Actualizar.'); }
    } catch (e) {
      // A network/5xx failure may have committed: preserve the exact command and UUID.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) {
        this.pending.set(null); sessionStorage.removeItem('clinic-private-pending');
      }
      this.report(e);
    } finally { this.busy.set(false); }
  }
  report(e: unknown) {
    this.error.set(e instanceof ApiError ? `${e.message} (${e.code})` : 'No se obtuvo confirmación del servidor. Conservamos la operación para reintentar con la misma clave.');
    if (e instanceof ApiError && e.status === 401) { this.user.set(null); this.clearData(); }
  }
  receive() { const order = this.selected(); if (order) void this.submit(`purchasing/orders/${order.id}/receipts`, { ...this.receipt, expiresOn: this.receipt.expiresOn || null }); }
  cancel() { const order = this.selected(); if (order) void this.submit(`purchasing/orders/${order.id}/cancel`, { reason: this.cancellationReason }); }
  productName(id: string) { return this.products().find(p => p.id === id)?.name || id; }
  money(cents: number) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100); }
}
