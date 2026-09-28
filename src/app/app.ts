import { Component, computed, HostListener, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "./icon";
import {
  DEMO_DATE,
  addVisit,
  appendAddendum,
  cashTotal,
  closeNote,
  dispense,
  eligibleFEFO,
  isExpired,
  isCalendarDate,
  postPayment,
  receive,
  toCSV,
  addSupplier,
  createPurchase,
  cancelPurchase,
  receivePurchase,
  purchaseStatus,
  purchaseTotal,
  restoreDemoState,
  requireQuantity,
} from "./domain";
import type { ClinicalNote, DemoState, Lot, VisitStatus, PurchaseDraft, PurchaseOrder } from "./domain";
import { seed } from "./seed";

const STORAGE = "pulmonogy.demo.v1";
const emptyNote = (patientId: string): ClinicalNote => ({
  id: crypto.randomUUID(),
  patientId,
  date: DEMO_DATE,
  reason: "",
  history: "",
  assessment: "",
  plan: "",
  status: "Borrador",
  addenda: [],
});
const freshForm = () => ({
  name: "",
  birth: "1990-01-01",
  tag: "Primera visita",
  patientId: "DEMO-001",
  date: DEMO_DATE,
  time: "12:20",
  service: "Primera consulta",
  reference: "",
  lotId: "LOT-01",
  quantity: 1,
  reason: "",
  amount: 1000,
  method: "Efectivo" as "Efectivo" | "Tarjeta" | "Transferencia",
  kind: "Salida" as "Salida" | "Entrada",
  text: "",
  supplierId: "SUP-001",
  sku: "MED-DEMO-01",
  unitCost: 200,
  expectedDate: "2026-10-02",
  lineId: "",
  batch: "",
  expires: "2027-09-30",
  quarantined: false,
});

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: "./app.html",
})
export class AppComponent {
  readonly date = DEMO_DATE;
  readonly doctoralia =
    "https://www.doctoralia.com.mx/perfil/marco-antonio-de-nova-macedo";
  readonly nav = [
    { id: "resumen", label: "Resumen", icon: "grid" },
    { id: "recepcion", label: "Recepción", icon: "calendar" },
    { id: "pacientes", label: "Pacientes", icon: "users" },
    { id: "consultas", label: "Consultas", icon: "file" },
    { id: "inventario", label: "Inventario", icon: "box" },
    { id: "compras", label: "Compras", icon: "cart" },
    { id: "equipos", label: "Equipos", icon: "pulse" },
    { id: "caja", label: "Caja", icon: "wallet" },
    { id: "proyecto", label: "Plan del proyecto", icon: "route" },
  ];
  readonly services = [
    {
      icon: "lungs",
      title: "Consulta de neumología",
      text: "Una valoración especializada para conocer tu salud respiratoria.",
      detail:
        "En esta propuesta, la primera visita reúne antecedentes, síntomas y estudios previos. La duración y preparación se confirmarán con el consultorio.",
    },
    {
      icon: "pulse",
      title: "Estudios respiratorios",
      text: "Información para comprender cómo funcionan tus pulmones.",
      detail:
        "El perfil público incluye espirometría y caminata de seis minutos. La indicación, disponibilidad y preparación deben confirmarse con el médico.",
    },
    {
      icon: "shield",
      title: "Seguimiento y cuidado",
      text: "Acompañamiento para dar continuidad a tu atención.",
      detail:
        "Espacio para seguimiento y revisión de estudios. Los tratamientos y la frecuencia de las visitas los determina el profesional durante la consulta.",
    },
  ];
  readonly milestones = [
    {
      phase: "01",
      title: "Sitio y experiencia",
      detail: "Sitio adaptable, servicios, ubicación y enlace a Doctoralia.",
      state: "Demo disponible",
      done: true,
    },
    {
      phase: "02",
      title: "Operación del consultorio",
      detail: "Pacientes, recepción, consultas de ejemplo y caja.",
      state: "Flujos de demostración",
      done: true,
    },
    {
      phase: "03",
      title: "Farmacia y equipos",
      detail: "Compras, recepción parcial, lotes, caducidades y equipos.",
      state: "Flujos de demostración",
      done: true,
    },
    {
      phase: "04",
      title: "Sistema privado",
      detail: "Backend, base de datos, autenticación y permisos en servidor.",
      state: "Siguiente entrega",
      done: false,
    },
    {
      phase: "05",
      title: "Validación clínica",
      detail: "Elección del sistema clínico, firma, trazabilidad y migración.",
      state: "Requiere validación",
      done: false,
    },
    {
      phase: "06",
      title: "Piloto real",
      detail: "Capacitación, pruebas de recuperación y aceptación del equipo.",
      state: "Pendiente",
      done: false,
    },
  ];
  storageUnavailable = signal(false);
  state = signal<DemoState>(this.load());
  page = signal("inicio");
  mobileMenu = false;
  query = "";
  statusFilter = "Todas";
  inventoryFilter = "Todos";
  agendaDate = DEMO_DATE;
  selectedPatient = "DEMO-002";
  selectedNoteId = "";
  note = emptyNote("DEMO-002");
  modal = "";
  modalTitle = "";
  form = freshForm();
  error = "";
  toast = signal("");
  serviceDetail = "";
  paymentId = "";
  cashCount: number | null = null;
  cashResult: string | null = null;
  purchaseFilter = "Todas";
  purchaseId = "";
  purchaseDraftLines: PurchaseDraft["lines"] = [];
  readonly productCatalog = computed(() => [...new Map(this.state().lots.map(l => [l.sku, l])).values()]);
  readonly pendingPurchases = computed(() => this.state().purchases.filter(p => !p.cancelled && purchaseStatus(p) !== "Recibida"));
  readonly pendingPurchaseValue = computed(() => this.pendingPurchases().reduce((total, order) => total + purchaseTotal(order, true), 0));
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  readonly title = computed(
    () => this.nav.find((n) => n.id === this.page())?.label || "Inicio",
  );
  readonly todayVisits = computed(() =>
    this.state()
      .visits.filter((v) => v.date === this.date)
      .sort((a, b) => a.time.localeCompare(b.time)),
  );
  readonly waiting = computed(
    () => this.todayVisits().filter((v) => v.status === "En espera").length,
  );
  readonly collected = computed(() =>
    this.state()
      .payments.filter((p) => p.date === this.date && !p.reversed)
      .reduce((n, p) => n + p.amountCents, 0),
  );
  readonly alerts = computed(() =>
    this.state().lots.filter((l) => this.lotStatus(l) !== "Disponible"),
  );
  readonly availableValue = computed(() =>
    this.state()
      .lots.filter((l) => !isExpired(l, this.date) && !l.quarantined)
      .reduce((v, l) => v + l.quantity * l.priceCents, 0),
  );
  constructor() {
    this.onHash();
  }
  @HostListener("window:hashchange") onHash() {
    const id = location.hash.replace("#/panel/", "");
    this.page.set(this.nav.some((n) => n.id === id) ? id : "inicio");
    this.mobileMenu = false;
    this.query = "";
    window.scrollTo({ top: 0 });
  }
  navigate(id: string) {
    location.hash = id === "inicio" ? "/" : "/panel/" + id;
  }
  scroll(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }
  money(cents: number) {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(cents / 100);
  }
  patientName(id: string) {
    return this.state().patients.find((p) => p.id === id)?.name || id;
  }
  initials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
  }
  patients() {
    const q = this.query.trim().toLocaleLowerCase("es-MX");
    return this.state().patients.filter((p) =>
      [p.name, p.id, p.tag].join(" ").toLocaleLowerCase("es-MX").includes(q),
    );
  }
  visits() {
    const q = this.query.toLowerCase();
    return this.state()
      .visits.filter(
        (v) =>
          v.date === this.agendaDate &&
          (this.statusFilter === "Todas" || v.status === this.statusFilter) &&
          (this.patientName(v.patientId) + " " + v.id)
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => a.time.localeCompare(b.time));
  }
  inventory() {
    const q = this.query.toLowerCase();
    return this.state().lots.filter(
      (l) =>
        [l.product, l.sku, l.batch].join(" ").toLowerCase().includes(q) &&
        (this.inventoryFilter === "Todos" ||
          l.category === this.inventoryFilter ||
          (this.inventoryFilter === "Alertas" &&
            this.lotStatus(l) !== "Disponible")),
    );
  }
  lotStatus(l: Lot) {
    if (l.quarantined) return "Cuarentena";
    if (isExpired(l, this.date)) return "Caducado";
    if (l.quantity <= l.minimum) return "Stock bajo";
    if ((Date.parse(l.expires) - Date.parse(this.date)) / 86400000 <= 30)
      return "Por vencer";
    return "Disponible";
  }
  pill(value: string) {
    return ["Caducado", "Cancelada"].includes(value)
      ? "danger"
      : [
            "En espera",
            "Stock bajo",
            "Por vencer",
            "Cuarentena",
            "En mantenimiento",
            "Borrador",
            "Pendiente",
            "Parcial",
          ].includes(value)
        ? "warning"
        : ["En consulta", "Confirmada"].includes(value)
          ? "blue"
          : "green";
  }
  setVisitStatus(id: string, status: VisitStatus) {
    this.save({
      ...this.state(),
      visits: this.state().visits.map((v) =>
        v.id === id ? { ...v, status } : v,
      ),
    });
    this.notify("Estado actualizado en la demo.");
  }
  openPatient(id: string) {
    this.selectedPatient = id;
    this.selectedNoteId = "";
    this.loadNote();
    this.navigate("consultas");
  }
  loadNote() {
    const notes = this.state().notes.filter(
      (n) => n.patientId === this.selectedPatient,
    );
    const existing =
      notes.find((n) => n.id === this.selectedNoteId) || notes.at(-1);
    this.note = existing
      ? structuredClone(existing)
      : emptyNote(this.selectedPatient);
    this.selectedNoteId = this.note.id;
    this.error = "";
  }
  newNote() {
    this.note = emptyNote(this.selectedPatient);
    this.selectedNoteId = this.note.id;
    this.error = "";
  }
  patientNotes() {
    return this.state().notes.filter(
      (n) => n.patientId === this.selectedPatient,
    );
  }
  saveNote(close = false) {
    try {
      if (
        this.state().notes.some(
          (n) => n.id === this.note.id && n.status === "Cerrada",
        )
      )
        throw new Error(
          "La nota cerrada conserva su contenido. Usa una adenda.",
        );
      if (
        ![
          this.note.reason,
          this.note.history,
          this.note.assessment,
          this.note.plan,
        ].some((x) => x.trim())
      )
        throw new Error("Escribe al menos un apartado.");
      const note = close ? closeNote(this.note) : structuredClone(this.note);
      this.persistNote(note);
      this.error = "";
      this.notify(
        close
          ? "Nota de ejemplo cerrada. No constituye firma clínica."
          : "Borrador guardado en este navegador.",
      );
    } catch (e) {
      this.error = this.message(e);
    }
  }
  persistNote(note: ClinicalNote) {
    const exists = this.state().notes.some((n) => n.id === note.id);
    this.save({
      ...this.state(),
      notes: exists
        ? this.state().notes.map((n) => (n.id === note.id ? note : n))
        : [...this.state().notes, note],
    });
    this.note = structuredClone(note);
  }
  openModal(kind: string, context = "") {
    this.modal = kind;
    this.error = "";
    this.form = freshForm();
    this.form.patientId = this.selectedPatient;
    this.form.reference =
      "DEMO-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    this.modalTitle =
      (
        {
          patient: "Paciente de demostración",
          visit: "Simular cita",
          movement: "Movimiento de inventario",
          payment: "Registrar cobro de ejemplo",
          reset: "Restablecer la demo",
          addendum: "Agregar adenda de ejemplo",
          reverse: "Reversar cobro",
          privacy: "Acerca de esta demostración",
          service: context,
          supplier: "Proveedor de demostración",
          purchase: "Nueva orden de compra",
          receipt: "Recibir mercancía de ejemplo",
          cancelPurchase: "Cancelar saldo pendiente",
        } as Record<string, string>
      )[kind] || kind;
    if (kind === "movement") this.form.lotId = context;
    if (kind === "reverse") this.paymentId = context;
    if (kind === "purchase") {
      this.purchaseDraftLines = [];
      this.form.supplierId = this.state().suppliers[0]?.id || "";
      this.form.reference = "OC-" + this.form.reference;
    }
    if (kind === "receipt" || kind === "cancelPurchase") this.purchaseId = context;
    if (kind === "receipt") {
      this.form.lineId = this.selectedPurchase()?.lines.find(l => l.received < l.ordered)?.id || "";
      this.form.reference = "REC-" + this.form.reference;
      this.form.batch = "LOTE-DEMO-" + crypto.randomUUID().slice(0, 6).toUpperCase();
    }
    setTimeout(() =>
      document.querySelector<HTMLDialogElement>("#modal")?.showModal(),
    );
  }
  closeModal() {
    document.querySelector<HTMLDialogElement>("#modal")?.close();
    this.modal = "";
    this.error = "";
  }
  modalClosed() {
    this.modal = "";
    this.error = "";
  }
  selectedLot() {
    return this.state().lots.find((l) => l.id === this.form.lotId);
  }
  suggestedLot() {
    const lot = this.selectedLot();
    return lot
      ? eligibleFEFO(this.state().lots, lot.sku, this.date)[0]?.batch ||
          "Ningún lote apto"
      : "";
  }
  supplierName(id: string) {
    return this.state().suppliers.find(s => s.id === id)?.name || id;
  }
  orderReference(id: string) { return this.state().purchases.find(p => p.id === id)?.reference || id; }
  productName(sku: string) {
    return this.productCatalog().find(p => p.sku === sku)?.product || sku;
  }
  orderStatus(order: PurchaseOrder) { return purchaseStatus(order); }
  orderTotal(order: PurchaseOrder) { return purchaseTotal(order); }
  selectedPurchase() { return this.state().purchases.find(p => p.id === this.purchaseId); }
  selectedPurchaseLine() { return this.selectedPurchase()?.lines.find(l => l.id === this.form.lineId); }
  orders() {
    const q = this.query.trim().toLocaleLowerCase("es-MX");
    return this.state().purchases.filter(p =>
      (this.purchaseFilter === "Todas" || purchaseStatus(p) === this.purchaseFilter) &&
      [p.reference, this.supplierName(p.supplierId), ...p.lines.map(l => l.product)].join(" ").toLocaleLowerCase("es-MX").includes(q));
  }
  addPurchaseLine() {
    try {
      const quantity = Number(this.form.quantity);
      const cents = Number(this.form.unitCost) * 100;
      requireQuantity(quantity);
      if (!Number.isFinite(cents) || Math.abs(cents - Math.round(cents)) > 0.000001)
        throw new Error("Usa un costo con hasta dos decimales.");
      requireQuantity(Math.round(cents));
      if (!this.productCatalog().some(p => p.sku === this.form.sku)) throw new Error("Selecciona un producto.");
      if (this.purchaseDraftLines.some(l => l.sku === this.form.sku))
        throw new Error("El producto ya está agregado. Quita la partida para cambiar su cantidad.");
      this.purchaseDraftLines = [...this.purchaseDraftLines, { id: crypto.randomUUID(), sku: this.form.sku, ordered: quantity, unitCostCents: Math.round(cents) }];
      this.error = "";
    } catch(e) { this.error = this.message(e); }
  }
  removePurchaseLine(id: string) { this.purchaseDraftLines = this.purchaseDraftLines.filter(l => l.id !== id); }
  draftPurchaseTotal() { return this.purchaseDraftLines.reduce((sum, l) => sum + l.ordered * l.unitCostCents, 0); }
  exportPurchases() {
    this.download("compras-ficticias.csv", toCSV([
      ["Orden", "Proveedor ficticio", "SKU", "Producto", "Pedido", "Recibido", "Costo unitario (centavos MXN)", "Entrega esperada", "Estado"],
      ...this.state().purchases.flatMap(p => p.lines.map(l => [p.reference, this.supplierName(p.supplierId), l.sku, l.product, l.ordered, l.received, l.unitCostCents, p.expectedDate, purchaseStatus(p)])),
    ]), "text/csv;charset=utf-8");
  }
  submit() {
    try {
      const s = this.state(),
        f = this.form,
        id = crypto.randomUUID();
      switch (this.modal) {
        case "supplier":
          this.save(addSupplier(s, { id, reference: f.reference, name: f.name.trim() ? f.name.trim() + " · Demo" : "" }));
          break;
        case "purchase":
          this.save(createPurchase(s, { id, reference: f.reference, supplierId: f.supplierId,
            date: this.date, expectedDate: f.expectedDate, lines: this.purchaseDraftLines }));
          break;
        case "receipt":
          this.save(receivePurchase(s, { id, reference: f.reference, purchaseId: this.purchaseId,
            lineId: f.lineId, date: this.date, batch: f.batch, expires: f.expires,
            quantity: Number(f.quantity), quarantined: f.quarantined, newLotId: "LOT-" + id }));
          break;
        case "cancelPurchase":
          this.save(cancelPurchase(s, this.purchaseId, f.reason));
          break;
        case "patient": {
          if (!f.name.trim()) throw new Error("Escribe un nombre ficticio.");
          if (!isCalendarDate(f.birth) || f.birth > this.date)
            throw new Error("Revisa la fecha de nacimiento.");
          if (
            s.patients.some(
              (p) =>
                p.name === f.name.trim() + " · Demo" && p.birth === f.birth,
            )
          )
            throw new Error(
              "Ya existe este paciente de ejemplo con la misma fecha.",
            );
          this.save({
            ...s,
            patients: [
              ...s.patients,
              {
                id: "DEMO-" + id.slice(0, 8).toUpperCase(),
                name: f.name.trim() + " · Demo",
                birth: f.birth,
                phone: "Sin teléfono real",
                tag: f.tag,
              },
            ],
          });
          break;
        }
        case "visit": {
          if (!s.patients.some((p) => p.id === f.patientId))
            throw new Error("Selecciona un paciente.");
          this.save({
            ...s,
            visits: addVisit(s.visits, {
              id,
              patientId: f.patientId,
              date: f.date,
              time: f.time,
              service: f.service,
              status: "Confirmada",
              externalRef: "Simulada · sin envío a Doctoralia",
            }),
          });
          this.agendaDate = f.date;
          break;
        }
        case "movement": {
          if (!f.reason.trim()) throw new Error("Escribe un motivo.");
          const lots =
            f.kind === "Salida"
              ? dispense(s.lots, f.lotId, Number(f.quantity), this.date)
              : receive(s.lots, f.lotId, Number(f.quantity));
          this.save({
            ...s,
            lots,
            movements: [
              {
                id,
                lotId: f.lotId,
                quantity: Number(f.quantity),
                kind: f.kind,
                reason: f.reason.trim(),
                date: this.date,
              },
              ...s.movements,
            ],
          });
          break;
        }
        case "payment": {
          const cents = Number(f.amount) * 100;
          if (Math.abs(cents - Math.round(cents)) > 0.000001)
            throw new Error("Usa hasta dos decimales.");
          if (!f.reason.trim())
            throw new Error("Escribe el concepto del cobro.");
          this.save({
            ...s,
            payments: postPayment(s.payments, {
              id,
              reference: f.reference.trim(),
              patientId: f.patientId,
              concept: f.reason.trim(),
              amountCents: Math.round(cents),
              method: f.method,
              date: this.date,
              reversed: false,
            }),
          });
          this.cashResult = null;
          break;
        }
        case "reverse": {
          if (!f.reason.trim()) throw new Error("El motivo es obligatorio.");
          this.save({
            ...s,
            payments: s.payments.map((p) =>
              p.id === this.paymentId
                ? { ...p, reversed: true, reversalReason: f.reason.trim() }
                : p,
            ),
          });
          this.cashResult = null;
          break;
        }
        case "addendum": {
          this.persistNote(
            appendAddendum(this.note, f.text, new Date().toISOString()),
          );
          break;
        }
        case "reset":
          this.save(seed());
          this.note = emptyNote("DEMO-002");
          this.selectedPatient = "DEMO-002";
          this.selectedNoteId = "";
          this.agendaDate = this.date;
          this.cashCount = null;
          this.cashResult = null;
          break;
      }
      this.closeModal();
      this.notify("Cambio guardado únicamente en esta demo.");
    } catch (e) {
      this.error = this.message(e);
    }
  }
  toggleEquipment(id: string) {
    this.save({
      ...this.state(),
      equipment: this.state().equipment.map((e) =>
        e.id === id
          ? {
              ...e,
              status:
                e.status === "Disponible" ? "En mantenimiento" : "Disponible",
            }
          : e,
      ),
    });
    this.notify("Estado de equipo actualizado.");
  }
  reconcile() {
    const cents = Number(this.cashCount) * 100;
    if (
      this.cashCount === null ||
      !Number.isSafeInteger(Math.round(cents)) ||
      cents < 0 ||
      Math.abs(cents - Math.round(cents)) > 0.000001
    ) {
      this.cashResult = "Escribe un importe válido con hasta dos decimales.";
      return;
    }
    const diff =
      Math.round(cents) - cashTotal(this.state().payments, this.date);
    this.cashResult =
      diff === 0
        ? "Caja conciliada: sin diferencia."
        : "Diferencia por revisar: " + this.money(diff) + ".";
  }
  expectedCash() {
    return cashTotal(this.state().payments, this.date);
  }
  exportInventory() {
    this.download(
      "inventario-ficticio.csv",
      toCSV([
        ["Producto ficticio", "SKU", "Lote", "Caducidad", "Unidades", "Estado"],
        ...this.state().lots.map((l) => [
          l.product,
          l.sku,
          l.batch,
          l.expires,
          l.quantity,
          this.lotStatus(l),
        ]),
      ]),
      "text/csv;charset=utf-8",
    );
  }
  exportNote() {
    this.download(
      "expediente-ficticio-" + this.selectedPatient + ".json",
      JSON.stringify(
        {
          notice: "DEMO. Datos ficticios. Sin validez clínica.",
          patient: this.state().patients.find(
            (p) => p.id === this.selectedPatient,
          ),
          notes: this.patientNotes(),
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  exportCash() {
    this.download(
      "caja-ficticia.csv",
      toCSV([
        ["Referencia", "Concepto", "Centavos MXN", "Método", "Fecha", "Estado"],
        ...this.state().payments.map((p) => [
          p.reference,
          p.concept,
          p.amountCents,
          p.method,
          p.date,
          p.reversed ? "Reversado" : "Registrado",
        ]),
      ]),
      "text/csv;charset=utf-8",
    );
  }
  private download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notify("Exportación de datos ficticios generada.");
  }
  private load(): DemoState {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
      return restoreDemoState(saved, seed());
    } catch {}
    return seed();
  }
  private save(state: DemoState) {
    this.state.set(state);
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state));
      this.storageUnavailable.set(false);
    } catch {
      this.storageUnavailable.set(true);
    }
  }
  private message(e: unknown) {
    return e instanceof Error ? e.message : "No se pudo completar la acción.";
  }
  private notify(text: string) {
    clearTimeout(this.toastTimer);
    this.toast.set(this.storageUnavailable()
      ? "Modo temporal: los cambios se pierden al recargar."
      : text);
    this.toastTimer = setTimeout(() => this.toast.set(""), 5000);
  }
}
