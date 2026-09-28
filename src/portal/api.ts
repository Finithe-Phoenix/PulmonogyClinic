export interface Product { id: string; sku: string; name: string; category: string; unit: string; minimumStock: number }
export interface Supplier { id: string; reference: string; name: string }
export interface OrderSummary { id: string; reference: string; supplierId: string; status: string; totalCents: number; receivedCents: number; pendingCents: number }
export interface OrderLine { id: string; productId: string; productName: string; ordered: number; received: number; unitCostCents: number }
export interface Order extends OrderSummary { lines: OrderLine[]; cancellationReason: string | null }
export interface Lot { id: string; productId: string; batch: string; expiresOn: string | null; quantity: number; quarantined: boolean }
export interface Audit { id: number; action: string; actor: string; entityId: string; reason: string; createdAt: string }
export interface Receipt { id: string; reference: string; orderId: string; batch: string; quantity: number; actor: string }
export interface PendingCommand { subject: string; path: string; body: unknown; key: string }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export class ClinicApi {
  constructor(private token: () => string | undefined) {}
  async request<T>(path: string, command?: PendingCommand): Promise<T> {
    const token = this.token();
    if (!token) throw new ApiError(401, 'SESSION_REQUIRED', 'Inicia sesión para continuar.');
    const response = await fetch('/api/v1/' + path, {
      method: command ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(command ? { 'Content-Type': 'application/json', 'Idempotency-Key': command.key } : {}) },
      body: command ? JSON.stringify(command.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new ApiError(response.status, problem.code || `HTTP_${response.status}`,
        response.status === 401 ? 'La sesión venció. Vuelve a iniciar sesión.' : response.status === 403 ? 'Tu rol no permite esta operación.' : problem.detail || 'No se pudo completar la operación.');
    }
    return response.json();
  }
  async list<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    // Traverse all pages; never silently present the first 50 rows as the full stock.
    for (let offset = 0; offset <= 1000000; offset += 100) {
      const page = await this.request<{ items: T[] }>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
      items.push(...page.items);
      if (page.items.length < 100) return items;
    }
    throw new Error('El listado excede el límite; se requiere un filtro.');
  }
}
