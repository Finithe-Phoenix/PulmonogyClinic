import { ChangeDetectionStrategy, Component, Injector, computed, inject, input, resource, runInInjectionContext, signal, type OnInit } from '@angular/core';
import { FormField, disabled, form, maxLength, pattern, required, submit, validate } from '@angular/forms/signals';
import { IconComponent } from '../icon';
import { ClinicStore } from './clinic-store';
import { DataPage, today } from './data-page';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { equipmentDate, equipmentStatuses, equipmentStatusLabel, validEquipmentDate, type EquipmentAsset, type EquipmentMaintenance, type EquipmentStatus } from './equipment-api';

const equipmentReaders = ['ADMIN', 'RECEPCION', 'MEDICO', 'FARMACIA', 'AUDITOR'];
const emptyAsset = () => ({ reference: '', name: '', location: '', serialNumber: '' });
const emptyMaintenance = () => ({ performedOn: today(), nextDueOn: '', description: '', technician: '' });

// A child gives each selected asset its own bounded history and DestroyRef lifetime.
@Component({
  selector: 'clinic-equipment-history',
  imports: [Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="subheading">Historial de mantenimiento</h3>
    <ul class="compact-list" [attr.aria-busy]="page.loading()">
      @for (entry of page.items(); track entry.id) {
        <li>
          <span><strong>{{date(entry.performedOn)}}</strong><small>{{entry.description}}</small>
            <small>Responsable: {{entry.technician}}</small></span>
          <span><small>Próxima intervención</small>{{date(entry.nextDueOn)}}</span>
        </li>
      } @empty {
        <li class="empty-state">{{page.loading() ? 'Consultando intervenciones…' : page.failed() ? 'No pudimos consultar el historial.' : 'Aún no hay intervenciones registradas para este equipo.'}}</li>
      }
    </ul>
    @if (page.failed()) { <button type="button" (click)="store.refresh()">Reintentar historial</button> }
    <clinic-pager [page]="page" />
  `,
})
export class EquipmentHistory implements OnInit {
  readonly assetId = input.required<string>();
  readonly store = inject(ClinicStore);
  readonly date = equipmentDate;
  private readonly injector = inject(Injector);
  page!: DataPage<EquipmentMaintenance>;
  ngOnInit() {
    this.page = runInInjectionContext(this.injector, () =>
      new DataPage<EquipmentMaintenance>('equipment/assets/' + this.assetId() + '/maintenance', 10, equipmentReaders));
  }
}

@Component({
  selector: 'equipment',
  imports: [FormField, IconComponent, Dialog, Pager, EquipmentHistory],
  templateUrl: './equipment.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Equipment {
  readonly store = inject(ClinicStore);
  readonly assets = new DataPage<EquipmentAsset>('equipment/assets', 25, equipmentReaders);
  readonly modal = signal<'create' | 'detail' | null>(null);
  readonly operation = signal<'status' | 'maintenance' | null>(null);
  readonly selected = signal<EquipmentAsset | null>(null);
  readonly editingVersion = signal(0);
  readonly statuses = equipmentStatuses;
  readonly statusLabel = equipmentStatusLabel;
  readonly date = equipmentDate;

  readonly detail = resource({
    params: () => {
      const asset = this.selected();
      const subject = this.store.user()?.profile.sub;
      const revision = this.store.revision();
      return asset && subject ? { id: asset.id, subject, revision } : undefined;
    },
    loader: async ({ params, abortSignal }) => {
      try {
        // ClinicApi owns authentication and its timeout; resource discards obsolete results.
        const asset = await this.store.api.request<EquipmentAsset>('equipment/assets/' + params.id);
        if (!abortSignal.aborted && params.subject === this.store.user()?.profile.sub) this.store.confirmedRead();
        return asset;
      } catch (error) {
        if (!abortSignal.aborted && params.subject === this.store.user()?.profile.sub) this.store.report(error);
        throw error;
      }
    },
  });
  readonly current = computed(() => this.detail.hasValue() ? this.detail.value() : this.selected());
  readonly editBlocked = computed(() => this.store.blocked() || !this.store.has('ADMIN') || this.detail.isLoading() || !this.detail.hasValue());
  readonly changedSinceEdit = computed(() => !!this.operation() && !!this.current() && this.current()!.version !== this.editingVersion());

  readonly filterModel = signal({ q: '', status: '' });
  readonly filters = form(this.filterModel, path => { maxLength(path.q, 160); });
  readonly assetModel = signal(emptyAsset());
  readonly assetForm = form(this.assetModel, path => {
    disabled(path, () => this.store.blocked() || !this.store.has('ADMIN'));
    required(path.reference, { message: 'Escribe una referencia interna.' });
    pattern(path.reference, /\S/, { message: 'La referencia no puede estar vacía.' });
    maxLength(path.reference, 80);
    required(path.name, { message: 'Escribe el nombre del equipo.' });
    pattern(path.name, /\S/, { message: 'El nombre no puede estar vacío.' });
    maxLength(path.name, 160);
    required(path.location, { message: 'Indica dónde está el equipo.' });
    pattern(path.location, /\S/, { message: 'La ubicación no puede estar vacía.' });
    maxLength(path.location, 160);
    maxLength(path.serialNumber, 120);
  });
  readonly statusModel = signal<{ status: EquipmentStatus; reason: string }>({ status: 'MAINTENANCE', reason: '' });
  readonly statusForm = form(this.statusModel, path => {
    disabled(path, () => this.editBlocked());
    required(path.status);
    validate(path.status, ({ value }) => value() === this.current()?.status
      ? { kind: 'sameStatus', message: 'Selecciona una disponibilidad distinta de la actual.' } : undefined);
    required(path.reason, { message: 'Explica el motivo del cambio.' });
    pattern(path.reason, /\S/, { message: 'El motivo no puede estar vacío.' });
    maxLength(path.reason, 160);
  });
  readonly maintenanceModel = signal(emptyMaintenance());
  readonly maintenanceForm = form(this.maintenanceModel, path => {
    disabled(path, () => this.editBlocked());
    required(path.performedOn, { message: 'Indica cuándo se realizó la intervención.' });
    validate(path.performedOn, ({ value }) => value() && (!validEquipmentDate(value()) || value() < '1900-01-01' || value() > today())
      ? { kind: 'date', message: 'Usa una fecha válida desde 1900 hasta hoy.' } : undefined);
    validate(path.nextDueOn, ({ value, valueOf }) => value() && (!validEquipmentDate(value()) || value() <= valueOf(path.performedOn))
      ? { kind: 'date', message: 'La próxima intervención debe ser posterior a la realizada.' } : undefined);
    required(path.description, { message: 'Describe la intervención realizada.' });
    pattern(path.description, /\S/, { message: 'La descripción no puede estar vacía.' });
    maxLength(path.description, 1000);
    required(path.technician, { message: 'Indica quién realizó la intervención.' });
    pattern(path.technician, /\S/, { message: 'El responsable no puede estar vacío.' });
    maxLength(path.technician, 160);
  });

  applyFilters() {
    void submit(this.filters, async () => {
      const { q, status } = this.filterModel();
      const params: Record<string, string> = { q };
      if (status) params['status'] = status;
      this.assets.filter(params);
    });
  }
  clearFilters() {
    this.filters().reset({ q: '', status: '' });
    this.assets.filter({});
  }
  openCreate() {
    this.store.error.set(''); this.selected.set(null); this.operation.set(null);
    this.assetForm().reset(emptyAsset()); this.modal.set('create');
  }
  openAsset(asset: EquipmentAsset) {
    this.store.error.set(''); this.selected.set(asset); this.operation.set(null); this.modal.set('detail');
  }
  closeDialog() {
    this.modal.set(null); this.operation.set(null); this.selected.set(null);
  }
  beginOperation(operation: 'status' | 'maintenance') {
    const asset = this.current();
    if (!asset || this.editBlocked()) return;
    this.store.error.set(''); this.editingVersion.set(asset.version);
    if (operation === 'status') this.statusForm().reset({ status: asset.status === 'AVAILABLE' ? 'MAINTENANCE' : 'AVAILABLE', reason: '' });
    else this.maintenanceForm().reset(emptyMaintenance());
    this.operation.set(operation);
  }
  acknowledgeCurrentVersion() {
    const asset = this.current();
    if (asset && !this.editBlocked()) { this.editingVersion.set(asset.version); this.store.error.set(''); }
  }
  saveAsset() {
    void submit(this.assetForm, async () => {
      if (this.store.blocked() || !this.store.has('ADMIN')) return;
      const model = this.assetModel();
      const created = await this.store.submit<EquipmentAsset>('equipment/assets', { ...model, serialNumber: model.serialNumber.trim() || null });
      if (created) this.openAsset(created);
    });
  }
  saveStatus() {
    void submit(this.statusForm, async () => {
      const asset = this.current();
      if (!asset || this.editBlocked() || this.changedSinceEdit()) return;
      const result = await this.store.submit<EquipmentAsset>('equipment/assets/' + asset.id + '/status',
        { ...this.statusModel(), expectedVersion: this.editingVersion() });
      if (result) this.operation.set(null);
      else if (!this.store.pending()) this.detail.reload();
    });
  }
  saveMaintenance() {
    void submit(this.maintenanceForm, async () => {
      const asset = this.current();
      if (!asset || this.editBlocked() || this.changedSinceEdit()) return;
      const model = this.maintenanceModel();
      const result = await this.store.submit<EquipmentMaintenance>('equipment/assets/' + asset.id + '/maintenance',
        { ...model, nextDueOn: model.nextDueOn || null, expectedVersion: this.editingVersion() });
      if (result) this.operation.set(null);
      else if (!this.store.pending()) this.detail.reload();
    });
  }
  overdue(date: string | null) { return !!date && date < today(); }
  dueLabel(date: string | null) { return !date ? 'Sin programar' : date === today() ? 'Programado para hoy' : this.overdue(date) ? 'Revisión pendiente' : this.date(date); }
}
