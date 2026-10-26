import { DestroyRef, Injectable, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { ApiError, ClinicApi, type PendingCommand } from '../../portal/api';

@Injectable({ providedIn: 'root' })
export class ClinicStore {
  readonly user = signal<User | null>(null);
  readonly initializing = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly pending = signal<PendingCommand | null>(null);
  readonly revision = signal(0);
  readonly updated = signal('');
  readonly sessionLocked = signal(false);
  readonly recovering = signal(false);
  readonly switchingIdentity = signal(false);
  readonly recoveryError = signal('');
  readonly callbackWindow = !!window.opener && new URLSearchParams(location.search).has('state');
  readonly name = computed(() => String(this.user()?.profile.preferred_username || 'Personal'));
  readonly role = computed(() => this.has('ADMIN') ? 'Administración' : this.has('MEDICO') ? 'Médico' : this.has('RECEPCION') ? 'Recepción' : this.has('FARMACIA') ? 'Farmacia' : 'Auditoría');
  readonly blocked = computed(() => this.sessionLocked() || this.switchingIdentity() || this.busy() || !!this.pending());
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private context = 0;
  private authenticationAttempt = 0;
  private activeCommandKey: string | null = null;
  private recoveryAbort: AbortController | null = null;
  private readonly auth = new UserManager({
    authority: 'http://localhost:8180/realms/clinic-dev', client_id: 'clinic-portal',
    redirect_uri: 'http://localhost:4180/', post_logout_redirect_uri: 'http://localhost:4180/',
    popup_redirect_uri: 'http://localhost:4180/',
    response_type: 'code', scope: 'openid profile', automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60, silentRequestTimeoutInSeconds: 15,
    maxSilentRenewTimeoutRetries: 0, validateSubOnSilentRenew: true,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }), loadUserInfo: false,
  });
  // Every portal request passes the same gate, including reads made by existing components.
  readonly api = { request: <T>(path: string, command?: PendingCommand) => this.request<T>(path, command) };
  constructor() {
    const removeExpired = this.auth.events.addAccessTokenExpired(() => this.lockSession());
    const removeRenewError = this.auth.events.addSilentRenewError(() => this.lockSession());
    const removeSignedOut = this.auth.events.addUserSignedOut(() => this.lockSession());
    const removeLoaded = this.auth.events.addUserLoaded(async user => {
      // Popup/initial callbacks are accepted explicitly below. A late renew must not unlock a 401.
      if (this.initializing() || this.recovering() || this.sessionLocked() || !this.user()) return;
      if (this.sameAccess(this.user()!, user) && !user.expired) this.user.set(user);
      else {
        try { await this.acceptUser(user); }
        catch { this.lockSession(); }
      }
    });
    const checkExpiry = () => { if (this.user()?.expired) this.lockSession(); };
    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    inject(DestroyRef).onDestroy(() => {
      removeExpired(); removeRenewError(); removeSignedOut(); removeLoaded();
      window.removeEventListener('focus', checkExpiry); document.removeEventListener('visibilitychange', checkExpiry);
      this.auth.stopSilentRenew(); this.recoveryAbort?.abort();
    });
    void this.initialize();
  }
  has(...roles: string[]) {
    const assigned = this.user()?.profile['roles'];
    return Array.isArray(assigned) && roles.some(role => assigned.includes(role));
  }
  private async initialize() {
    try {
      if (this.callbackWindow) {
        // Exact registered redirect URI, no new URI permissions. The opener validates state/PKCE.
        await this.auth.signinPopupCallback();
        return;
      }
      if (new URLSearchParams(location.search).has('state')) {
        const user = await this.auth.signinRedirectCallback();
        this.user.set(user);
        const requested = (user.state as { returnTo?: string } | undefined)?.returnTo;
        const route = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/inicio';
        history.replaceState({}, '', '/#' + route);
        await this.router.navigateByUrl(route, { replaceUrl: true });
      }
      await this.auth.clearStaleState();
      if (this.user()) this.restorePending(this.user()!.profile.sub);
    } catch { this.error.set('No pudimos completar el acceso. Vuelve a iniciar sesión.'); }
    finally { this.initializing.set(false); }
  }
  async login() {
    if (this.sessionLocked()) { await this.reauthenticate(); return; }
    try { await this.auth.signinRedirect({ state: { returnTo: this.router.url } }); }
    catch { this.error.set('El servicio de identidad no está disponible. Intenta nuevamente.'); }
  }
  async logout() {
    const user = this.user();
    this.authenticationAttempt++; this.context++; this.recoveryAbort?.abort(); this.recoveryAbort = null;
    this.auth.stopSilentRenew(); this.activeCommandKey = null; this.busy.set(false);
    this.user.set(null); this.pending.set(null); this.message.set('');
    this.sessionLocked.set(false); this.recovering.set(false); this.recoveryError.set('');
    try { await this.auth.signoutRedirect({ id_token_hint: user?.id_token }); }
    catch { await this.auth.removeUser(); this.error.set('Acceso local cerrado. No se pudo cerrar la sesión del proveedor de identidad.'); }
  }
  refresh() { if (!this.sessionLocked() && this.user()) this.revision.update(n => n + 1); }
  private pendingKey(subject: string) { return 'clinic-private-pending:' + encodeURIComponent(subject); }
  private restorePending(subject: string) {
    this.pending.set(null);
    try {
      let raw = sessionStorage.getItem(this.pendingKey(subject));
      // Only submitted commands are persisted. Unsubmitted forms and tokens never enter storage.
      const legacy = sessionStorage.getItem('clinic-private-pending');
      if (!raw && legacy && JSON.parse(legacy).subject === subject) {
        sessionStorage.setItem(this.pendingKey(subject), legacy);
        sessionStorage.removeItem('clinic-private-pending'); raw = legacy;
      }
      if (raw) {
        const command = JSON.parse(raw) as PendingCommand;
        if (command.subject === subject) this.pending.set(command);
      }
    } catch { this.error.set('No pudimos leer la recuperación de operaciones de esta cuenta. Conservamos el almacenamiento existente; no se enviará ninguna operación automáticamente.'); }
  }
  private lockSession() {
    if (!this.user() || this.sessionLocked()) return;
    this.context++;
    this.sessionLocked.set(true); this.auth.stopSilentRenew(); this.message.set('');
    this.recoveryError.set('');
  }
  private sameAccess(left: User, right: User) {
    const roles = (user: User) => {
      const value = user.profile['roles'];
      return JSON.stringify(Array.isArray(value) ? value.filter(role => typeof role === 'string').sort() : []);
    };
    return left.profile.sub === right.profile.sub && left.profile.iss === right.profile.iss && roles(left) === roles(right);
  }
  private async acceptUser(user: User) {
    if (user.expired || !user.profile.sub) { this.lockSession(); throw new Error('La sesión no está vigente.'); }
    this.error.set('');
    const previous = this.user();
    if (previous && !this.sameAccess(previous, user)) {
      this.context++; this.switchingIdentity.set(true); this.sessionLocked.set(true);
      this.pending.set(null); this.activeCommandKey = null; this.busy.set(false);
      this.user.set(null); this.error.set(''); this.message.set(''); this.updated.set('');
      // Render a real teardown before a new principal can see a router outlet or native dialog.
      try {
        await new Promise<void>(resolve => afterNextRender(() => resolve(), {injector:this.injector}));
        await this.router.navigateByUrl('/inicio', {replaceUrl:true});
      } catch {
        // The old outlet has already been destroyed. Fail closed instead of exposing either account.
        this.auth.stopSilentRenew();
        await this.auth.removeUser();
        this.sessionLocked.set(false); this.switchingIdentity.set(false);
        this.error.set('La cuenta o sus permisos cambiaron. Se descartó el formulario anterior; vuelve a iniciar sesión para continuar.');
        return;
      }
      this.user.set(user);
      // A role change does not rehydrate the previous command. A different account sees only its own.
      if (previous.profile.sub !== user.profile.sub) this.restorePending(user.profile.sub);
      this.message.set('La cuenta o sus permisos cambiaron. Se descartó el formulario anterior para proteger la información.');
      this.switchingIdentity.set(false);
    } else {
      // No context increment: a routine renewal must not invalidate an already submitted command.
      this.user.set(user);
    }
    this.sessionLocked.set(false); this.recoveryError.set('');
    this.auth.startSilentRenew();
  }
  async reauthenticate() {
    if (!this.sessionLocked() || this.recovering() || !this.user()) return;
    const attempt = ++this.authenticationAttempt;
    this.recovering.set(true); this.recoveryError.set('');
    this.recoveryAbort = new AbortController();
    try {
      // Must originate from an explicit click so browsers can open the popup. No automatic resend.
      const user = await this.auth.signinPopup({prompt:'login', popupAbortOnClose:true, popupSignal:this.recoveryAbort.signal});
      if (attempt !== this.authenticationAttempt) return;
      await this.acceptUser(user);
    } catch {
      if (attempt === this.authenticationAttempt) this.recoveryError.set('No se completó el acceso. Permite la ventana emergente y vuelve a intentarlo. Tu formulario sigue en memoria.');
    } finally {
      if (attempt === this.authenticationAttempt) { this.recovering.set(false); this.recoveryAbort = null; }
    }
  }
  private async request<T>(path: string, command?: PendingCommand): Promise<T> {
    const user = this.user();
    if (user?.expired) this.lockSession();
    if (!user || this.sessionLocked() || this.switchingIdentity()) {
      throw new ApiError(401, 'SESSION_LOCKED', 'Reautentícate para continuar.');
    }
    if (command && command.subject !== user.profile.sub) throw new ApiError(403, 'COMMAND_SUBJECT_MISMATCH', 'Esta operación pertenece a otra cuenta.');
    const context = this.context;
    // Snapshot credentials for this request; never borrow the credentials of a later account.
    const client = new ClinicApi(() => user.access_token);
    try {
      const result = await client.request<T>(path, command);
      if (context !== this.context || this.sessionLocked()) throw new ApiError(409, 'SESSION_CONTEXT_CHANGED', 'La sesión cambió durante la solicitud.');
      return result;
    } catch (error) {
      if (context !== this.context) throw new ApiError(409, 'SESSION_CONTEXT_CHANGED', 'La sesión cambió durante la solicitud.');
      if (error instanceof ApiError && error.status === 401) this.lockSession();
      throw error;
    }
  }
  confirmedRead() { if (!this.sessionLocked()) this.updated.set(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })); }
  async submit<T = { id: string }>(path: string, body: unknown): Promise<T | null> {
    if (this.user()?.expired) this.lockSession();
    if (this.blocked() || !this.user()) return null;
    const command = { subject: this.user()!.profile.sub, path, body: structuredClone(body), key: crypto.randomUUID() };
    try { sessionStorage.setItem(this.pendingKey(command.subject), JSON.stringify(command)); }
    catch { this.error.set('Habilita el almacenamiento de sesión para conservar una clave de reintento segura.'); return null; }
    this.pending.set(command);
    return this.retry<T>();
  }
  async retry<T = { id: string }>(): Promise<T | null> {
    if (this.user()?.expired) this.lockSession();
    const command = this.pending();
    if (!command || this.sessionLocked() || this.switchingIdentity() || this.busy() || command.subject !== this.user()?.profile.sub) return null;
    this.activeCommandKey = command.key;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      const result = await this.api.request<T>(command.path, command);
      if (this.user()?.profile.sub !== command.subject || this.pending()?.key !== command.key) return null;
      this.pending.set(null); sessionStorage.removeItem(this.pendingKey(command.subject));
      this.message.set('Operación confirmada por el servidor.'); this.refresh();
      return result;
    } catch (error) {
      if (this.activeCommandKey !== command.key) return null;
      if (error instanceof ApiError && error.code !== 'SESSION_CONTEXT_CHANGED' && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
        this.pending.set(null); sessionStorage.removeItem(this.pendingKey(command.subject));
      }
      this.report(error); return null;
    } finally { if (this.activeCommandKey === command.key) { this.activeCommandKey = null; this.busy.set(false); } }
  }
  report(error: unknown) {
    if (error instanceof ApiError && error.code === 'SESSION_CONTEXT_CHANGED') return;
    if (error instanceof ApiError && error.status === 401) { this.lockSession(); return; }
    this.error.set(error instanceof ApiError ? `${error.message} (${error.code})` : 'No pudimos obtener respuesta del servidor. Comprueba la conexión y reintenta.');
  }
}
