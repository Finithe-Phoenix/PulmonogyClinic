import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClinicStore } from './clinic-store';
import { DataPage } from './data-page';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { IconComponent } from '../icon';
import { type Appointment, type DuplicateCandidate, type Page, type Patient, appointmentLabel, birthDateLabel, mexicoDateTime, mexicoLocal, operationRoles } from './operations-api';

@Component({
  selector: 'clinic-patients',
  imports: [FormsModule, Dialog, Pager, IconComponent],
  templateUrl: './patients.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Patients {
  readonly store = inject(ClinicStore);
  readonly rows = new DataPage<Patient>('operations/patients', 25, operationRoles);
  readonly detail = signal<Patient | null>(null);
  readonly detailLoading = signal(false);
  readonly history = signal<Appointment[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal('');
  readonly historyOffset = signal(0);
  readonly historyMore = signal(false);
  readonly formMode = signal<'new' | 'edit' | null>(null);
  readonly formError = signal('');
  readonly conflictRequired = signal(false);
  readonly conflictLoading = signal(false);
  readonly conflict = signal<Patient | null>(null);
  readonly duplicates = signal<DuplicateCandidate[]>([]);
  readonly duplicateChecking = signal(false);
  readonly duplicateChecked = signal(false);
  readonly duplicateMore = signal(false);
  readonly duplicateOffset = signal(0);
  readonly duplicateRequired = signal(false);
  readonly awaitingCommand = signal('');
  readonly confirmationRecovered = computed(() => !!this.awaitingCommand() && !this.store.pending() && !this.store.busy() && !!this.store.message());
  readonly dateLabel = birthDateLabel;
  readonly dateTime = mexicoDateTime;
  readonly stateLabel = appointmentLabel;
  readonly maxBirthDate = mexicoLocal().slice(0, 10);
  search = '';
  draft = this.emptyDraft();
  private detailSequence = 0;
  private candidateSequence = 0;
  private historySequence = 0;
  private conflictSequence = 0;
  private destroyed = false;
  constructor() { inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.detailSequence++; this.candidateSequence++; this.historySequence++; }); }
  private emptyDraft() { return { reference: '', fullName: '', birthDate: '', phone: '', email: '', duplicateReviewed: false, synthetic: false }; }
  newPatient() { this.detail.set(null); this.draft = this.emptyDraft(); this.resetForm('new'); }
  editPatient() {
    const patient = this.detail();
    if (!patient) return;
    this.draft = { reference: patient.reference, fullName: patient.fullName, birthDate: patient.birthDate, phone: patient.phone || '', email: patient.email || '', duplicateReviewed: false, synthetic: false };
    this.resetForm('edit');
  }
  private resetForm(mode: 'new' | 'edit') { this.detailSequence++; this.historySequence++; this.clearConflict(); this.awaitingCommand.set(''); this.formError.set(''); this.identityChanged(); this.formMode.set(mode); }
  identityChanged() { this.candidateSequence++; this.duplicateChecking.set(false); this.duplicates.set([]); this.duplicateChecked.set(false); this.duplicateRequired.set(false); this.duplicateOffset.set(0); this.duplicateMore.set(false); this.draft.duplicateReviewed = false; }
  close() { this.formMode.set(null); this.detail.set(null); this.detailSequence++; this.historySequence++; this.identityChanged(); this.clearConflict(); }
  private contextActive(ticket: number, subject: string | undefined) { return !this.destroyed && ticket === this.detailSequence && !!subject && subject === this.store.user()?.profile.sub; }
  private clearConflict() { this.conflictSequence++; this.conflictRequired.set(false); this.conflictLoading.set(false); this.conflict.set(null); }
  async show(patient: Patient) {
    const ticket = ++this.detailSequence, subject = this.store.user()?.profile.sub;
    this.identityChanged(); this.clearConflict();
    this.awaitingCommand.set(''); this.formMode.set(null); this.detail.set(patient); this.detailLoading.set(true); this.history.set([]); this.historyOffset.set(0);
    try {
      const refreshed = await this.store.api.request<Patient>('operations/patients/' + patient.id);
      if (this.destroyed || ticket !== this.detailSequence || subject !== this.store.user()?.profile.sub) return;
      this.detail.set(refreshed); void this.loadHistory(0);
    } catch (error) { if (ticket === this.detailSequence) { this.store.report(error); this.historyError.set('No pudimos actualizar el registro. Ciérralo e intenta nuevamente.'); } }
    finally { if (ticket === this.detailSequence) this.detailLoading.set(false); }
  }
  async loadHistory(offset: number) {
    const patient = this.detail(); if (!patient) return;
    const ticket = ++this.historySequence, subject = this.store.user()?.profile.sub;
    this.historyLoading.set(true); this.historyError.set('');
    try {
      const page = await this.store.api.request<Page<Appointment>>(`operations/appointments?patientId=${patient.id}&limit=6&offset=${offset}`);
      if (this.destroyed || ticket !== this.historySequence || subject !== this.store.user()?.profile.sub) return;
      this.history.set(page.items.slice(0, 5)); this.historyMore.set(page.items.length > 5); this.historyOffset.set(offset);
    } catch (error) { if (ticket === this.historySequence) { this.store.report(error); this.history.set([]); this.historyError.set('No pudimos consultar sus citas. Puedes reintentar.'); } }
    finally { if (ticket === this.historySequence) this.historyLoading.set(false); }
  }
  async checkDuplicates(offset = 0): Promise<boolean> {
    if (!this.draft.fullName.trim() || !this.draft.birthDate) { this.formError.set('Escribe el nombre y la fecha de nacimiento para revisar coincidencias.'); return false; }
    const ticket = ++this.candidateSequence, subject = this.store.user()?.profile.sub;
    this.duplicateChecking.set(true); this.formError.set('');
    const params = new URLSearchParams({ fullName: this.draft.fullName, birthDate: this.draft.birthDate, phone: this.draft.phone, limit: '21', offset: String(offset) });
    try {
      const result = await this.store.api.request<Page<DuplicateCandidate>>('operations/patients/duplicates?' + params);
      if (this.destroyed || ticket !== this.candidateSequence || subject !== this.store.user()?.profile.sub) return false;
      const candidates = result.items.filter(candidate => candidate.patient.id !== (this.formMode() === 'edit' ? this.detail()?.id : null));
      this.duplicates.set(candidates.slice(0, 20)); this.duplicateMore.set(result.items.length > 20); this.duplicateOffset.set(offset); this.duplicateChecked.set(true);
      if (candidates.length) this.duplicateRequired.set(true);
      return true;
    } catch (error) { if (ticket === this.candidateSequence) { this.store.report(error); this.formError.set('No pudimos revisar coincidencias. Conservamos tus datos; vuelve a intentar.'); } return false; }
    finally { if (ticket === this.candidateSequence) this.duplicateChecking.set(false); }
  }
  async save() {
    const mode = this.formMode(), current = this.detail(), ticket = this.detailSequence, subject = this.store.user()?.profile.sub;
    if (!mode || (mode === 'edit' && !current) || this.store.blocked() || this.duplicateChecking() || this.confirmationRecovered() || this.conflictRequired()) return;
    this.formError.set('');
    if (!this.duplicateChecked() && !await this.checkDuplicates()) return;
    // Closing/changing a form cancels only its preflight, never an already submitted command.
    if (!this.contextActive(ticket, subject) || this.formMode() !== mode || this.detail()?.id !== current?.id) return;
    if (this.duplicateRequired() && !this.draft.duplicateReviewed) { this.formError.set('Revisa las coincidencias y confirma que este registro debe mantenerse independiente.'); return; }
    const path = mode === 'edit' && current ? `operations/patients/${current.id}/update` : 'operations/patients';
    const body = { ...this.draft, duplicateReviewed: this.duplicateRequired() && this.draft.duplicateReviewed, ...(mode === 'edit' && current ? { expectedVersion: current.version } : {}) };
    this.awaitingCommand.set('');
    const result = await this.store.submit<Patient>(path, body);
    if (!this.contextActive(ticket, subject)) {
      if (result && subject === this.store.user()?.profile.sub) this.store.message.set(`Registro ${result.reference} confirmado. Se conserva el detalle que estás consultando.`);
      return;
    }
    if (result) { this.formMode.set(null); this.detail.set(result); this.historyOffset.set(0); void this.loadHistory(0); }
    else {
      this.formError.set(this.store.error()); this.awaitingCommand.set(this.store.pending()?.key || '');
      if (current && this.store.error().includes('VERSION_CONFLICT')) { this.conflictRequired.set(true); await this.loadConflict(); return; }
      if (this.store.error().includes('POSSIBLE_DUPLICATE')) {
        this.duplicateRequired.set(true); this.draft.duplicateReviewed = false;
        await this.checkDuplicates();
        if (this.contextActive(ticket, subject)) this.formError.set('Apareció una posible coincidencia. Revísala antes de continuar.');
      }
    }
  }
  async loadConflict() {
    const patient = this.detail(), ticket = this.detailSequence, subject = this.store.user()?.profile.sub;
    if (!patient || !this.conflictRequired() || this.store.blocked()) return;
    const request = ++this.conflictSequence;
    this.conflictLoading.set(true); this.conflict.set(null);
    try {
      const latest = await this.store.api.request<Patient>('operations/patients/' + patient.id);
      if (this.contextActive(ticket, subject) && request === this.conflictSequence) this.conflict.set(latest);
    } catch (error) { if (this.contextActive(ticket, subject) && request === this.conflictSequence) this.store.report(error); }
    finally { if (this.contextActive(ticket, subject) && request === this.conflictSequence) this.conflictLoading.set(false); }
  }
  conflictRows() {
    const current = this.conflict(); if (!current) return [];
    return [
      { label: 'Referencia', current: current.reference, draft: this.draft.reference },
      { label: 'Nombre', current: current.fullName, draft: this.draft.fullName },
      { label: 'Nacimiento', current: current.birthDate, draft: this.draft.birthDate },
      { label: 'Teléfono', current: current.phone || 'Sin registrar', draft: this.draft.phone || 'Sin registrar' },
      { label: 'Correo', current: current.email || 'Sin registrar', draft: this.draft.email || 'Sin registrar' },
    ];
  }
  acceptConflict() {
    const latest = this.conflict();
    if (!latest || this.conflictLoading() || this.store.blocked() || latest.id !== this.detail()?.id || this.formMode() !== 'edit') return;
    this.detail.set(latest); this.clearConflict(); this.identityChanged(); this.store.error.set('');
    this.formError.set('Borrador conservado. Revisa tus cambios y vuelve a guardar; aún no se ha enviado ninguna modificación.');
  }
}
