import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ClinicStore } from './clinic-store';
import { DataPage } from './data-page';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { IconComponent } from '../icon';
import { type Appointment, type AppointmentEvent, type AppointmentSource, type AppointmentStatus, type Page, type Patient, appointmentLabel, appointmentStatuses, birthDateLabel, mexicoDateTime, mexicoDayRange, mexicoInstant, mexicoLocal, mexicoTime, operationRoles } from './operations-api';

@Component({
  selector: 'clinic-agenda',
  imports: [FormsModule, NgTemplateOutlet, Dialog, Pager, IconComponent],
  templateUrl: './agenda.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Agenda {
  readonly store = inject(ClinicStore);
  readonly rows = new DataPage<Appointment>('operations/appointments', 25, operationRoles);
  readonly patients = new DataPage<Patient>('operations/patients', 5, ['ADMIN','RECEPCION','MEDICO']);
  readonly detail = signal<Appointment | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  readonly editor = signal<'new' | 'reschedule' | null>(null);
  readonly selectedPatient = signal<Patient | null>(null);
  readonly formError = signal('');
  readonly conflictRequired = signal(false);
  readonly conflictLoading = signal(false);
  readonly conflict = signal<Appointment | null>(null);
  readonly attemptedTransition = signal<AppointmentStatus | null>(null);
  readonly history = signal<AppointmentEvent[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal('');
  readonly historyOffset = signal(0);
  readonly historyMore = signal(false);
  readonly cancelling = signal(false);
  readonly awaitingCommand = signal('');
  readonly confirmationRecovered = computed(() => !!this.awaitingCommand() && !this.store.pending() && !this.store.busy() && !!this.store.message());
  readonly states = appointmentStatuses;
  readonly stateLabel = appointmentLabel;
  readonly time = mexicoTime;
  readonly dateTime = mexicoDateTime;
  readonly dateLabel = birthDateLabel;
  date = mexicoLocal().slice(0, 10);
  status = '';
  patientSearch = '';
  cancellationReason = '';
  draft = this.emptyDraft();
  private detailSequence = 0;
  private historySequence = 0;
  private conflictSequence = 0;
  private destroyed = false;
  constructor() {
    this.filter();
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.detailSequence++; this.historySequence++; });
  }
  private emptyDraft() { return { localStart: this.date + 'T09:00', durationMinutes: 30, service: '', practitioner: 'MEDICO-1', resource: 'CONSULTORIO-1', source: 'LOCAL' as AppointmentSource, externalReference: '' }; }
  filter() {
    const interval = mexicoDayRange(this.date);
    if (!interval) { this.store.error.set('Elige una fecha válida para consultar la jornada.'); return; }
    this.rows.filter({ ...interval, ...(this.status ? { status: this.status } : {}) });
  }
  shiftDay(days: number) { if (!mexicoDayRange(this.date)) { this.goToday(); return; } this.date = new Date(Date.parse(this.date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10); this.filter(); }
  goToday() { this.date = mexicoLocal().slice(0, 10); this.filter(); }
  newAppointment() {
    this.detailSequence++; this.historySequence++; this.clearConflict();
    this.detail.set(null); this.editor.set('new'); this.selectedPatient.set(null); this.formError.set(''); this.awaitingCommand.set(''); this.draft = this.emptyDraft();
    this.patientSearch = ''; this.patients.filter({q:''});
  }
  reschedule() {
    const appointment = this.detail(); if (!appointment) return;
    this.detailSequence++; this.historySequence++; this.clearConflict();
    this.draft = { localStart: mexicoLocal(appointment.startsAt), durationMinutes: appointment.durationMinutes, service: appointment.service, practitioner: appointment.practitioner, resource: appointment.resource, source: appointment.source, externalReference: appointment.externalReference || '' };
    this.formError.set(''); this.editor.set('reschedule'); this.awaitingCommand.set(''); this.cancelling.set(false);
  }
  close() { this.editor.set(null); this.detail.set(null); this.cancelling.set(false); this.detailSequence++; this.historySequence++; this.clearConflict(); }
  private contextActive(ticket: number, subject: string | undefined) { return !this.destroyed && ticket === this.detailSequence && !!subject && subject === this.store.user()?.profile.sub; }
  private clearConflict() { this.conflictSequence++; this.conflictRequired.set(false); this.conflictLoading.set(false); this.conflict.set(null); this.attemptedTransition.set(null); }
  async show(appointment: Appointment) {
    const ticket = ++this.detailSequence, subject = this.store.user()?.profile.sub;
    this.clearConflict();
    this.awaitingCommand.set(''); this.editor.set(null); this.cancelling.set(false); this.detail.set(appointment); this.detailLoading.set(true); this.detailError.set(''); this.formError.set(''); this.history.set([]); this.historyOffset.set(0);
    try {
      const result = await this.store.api.request<Appointment>('operations/appointments/' + appointment.id);
      if (this.destroyed || ticket !== this.detailSequence || subject !== this.store.user()?.profile.sub) return;
      this.detail.set(result); void this.loadHistory(0);
    } catch (error) { if (ticket === this.detailSequence) { this.store.report(error); this.detailError.set('No pudimos actualizar la cita. Reintenta antes de modificarla.'); } }
    finally { if (ticket === this.detailSequence) this.detailLoading.set(false); }
  }
  async loadHistory(offset: number) {
    const appointment = this.detail(); if (!appointment) return;
    const ticket = ++this.historySequence, subject = this.store.user()?.profile.sub;
    this.historyLoading.set(true); this.historyError.set('');
    try {
      const result = await this.store.api.request<Page<AppointmentEvent>>(`operations/appointments/${appointment.id}/history?limit=6&offset=${offset}`);
      if (this.destroyed || ticket !== this.historySequence || subject !== this.store.user()?.profile.sub) return;
      this.history.set(result.items.slice(0, 5)); this.historyOffset.set(offset); this.historyMore.set(result.items.length > 5);
    } catch (error) { if (ticket === this.historySequence) { this.store.report(error); this.history.set([]); this.historyError.set('No pudimos consultar los movimientos de esta cita.'); } }
    finally { if (ticket === this.historySequence) this.historyLoading.set(false); }
  }
  async save() {
    const mode = this.editor(), ticket = this.detailSequence, subject = this.store.user()?.profile.sub;
    if (!mode || this.store.blocked() || this.confirmationRecovered() || this.conflictRequired()) return;
    this.formError.set('');
    const startsAt = mexicoInstant(this.draft.localStart), current = this.detail(), patient = this.selectedPatient();
    if (mode === 'reschedule' && (!current || current.status !== 'BOOKED')) { this.formError.set('La cita ya no está programada. Conservamos el borrador, pero su estado actual no permite reprogramarla.'); return; }
    if (!startsAt) { this.formError.set('Revisa la fecha y hora de Ciudad de México.'); return; }
    if (this.editor() === 'new' && !patient) { this.formError.set('Busca y selecciona al paciente antes de reservar.'); return; }
    const body = { startsAt, durationMinutes: this.draft.durationMinutes, service: this.draft.service, practitioner: this.draft.practitioner, resource: this.draft.resource, source: this.draft.source, externalReference: this.draft.source === 'DOCTORALIA_MANUAL' ? this.draft.externalReference : null, ...(this.editor() === 'reschedule' && current ? { expectedVersion: current.version } : { patientId: patient!.id }) };
    this.awaitingCommand.set('');
    const path = this.editor() === 'reschedule' && current ? `operations/appointments/${current.id}/reschedule` : 'operations/appointments';
    const result = await this.store.submit<Appointment>(path, body);
    if (!this.contextActive(ticket, subject)) {
      if (result && subject === this.store.user()?.profile.sub) this.store.message.set(`Cita de ${result.patientReference} confirmada. Se conserva el detalle que estás consultando.`);
      return;
    }
    if (result) { this.editor.set(null); this.detail.set(result); this.date = mexicoLocal(result.startsAt).slice(0, 10); this.filter(); void this.loadHistory(0); }
    else {
      this.formError.set(this.store.error()); this.awaitingCommand.set(this.store.pending()?.key || '');
      if (current && this.store.error().includes('VERSION_CONFLICT')) { this.conflictRequired.set(true); await this.loadConflict(); }
    }
  }
  async transition(status: AppointmentStatus) {
    const appointment = this.detail(), ticket = this.detailSequence, subject = this.store.user()?.profile.sub;
    if (!appointment || this.store.blocked() || this.detailLoading() || this.detailError() || this.confirmationRecovered() || this.conflictRequired()) return;
    if (status === 'CANCELLED' && !this.cancellationReason.trim()) { this.formError.set('Escribe el motivo administrativo de la cancelación.'); return; }
    this.formError.set(''); this.awaitingCommand.set('');
    const result = await this.store.submit<Appointment>(`operations/appointments/${appointment.id}/transition`, { expectedVersion: appointment.version, status, ...(status === 'CANCELLED' ? { reason: this.cancellationReason } : {}) });
    if (!this.contextActive(ticket, subject)) {
      if (result && subject === this.store.user()?.profile.sub) this.store.message.set(`Cita de ${result.patientReference}: ${this.stateLabel(result.status)}. Se conserva el detalle que estás consultando.`);
      return;
    }
    if (result) { this.detail.set(result); this.cancelling.set(false); this.cancellationReason = ''; void this.loadHistory(0); }
    else {
      this.formError.set(this.store.error()); this.awaitingCommand.set(this.store.pending()?.key || '');
      if (this.store.error().includes('VERSION_CONFLICT')) { this.attemptedTransition.set(status); this.conflictRequired.set(true); await this.loadConflict(); }
    }
  }
  async loadConflict() {
    const appointment = this.detail(), ticket = this.detailSequence, subject = this.store.user()?.profile.sub;
    if (!appointment || !this.conflictRequired() || this.store.blocked()) return;
    const request = ++this.conflictSequence;
    this.conflictLoading.set(true); this.conflict.set(null);
    try {
      const latest = await this.store.api.request<Appointment>('operations/appointments/' + appointment.id);
      if (this.contextActive(ticket, subject) && request === this.conflictSequence) this.conflict.set(latest);
    } catch (error) { if (this.contextActive(ticket, subject) && request === this.conflictSequence) this.store.report(error); }
    finally { if (this.contextActive(ticket, subject) && request === this.conflictSequence) this.conflictLoading.set(false); }
  }
  conflictRows() {
    const latest = this.conflict(), previous = this.detail(); if (!latest || !previous) return [];
    const editing = this.editor() === 'reschedule';
    return [
      { label: 'Estado', current: this.stateLabel(latest.status), draft: this.stateLabel(previous.status) },
      { label: 'Fecha y hora · Ciudad de México', current: mexicoLocal(latest.startsAt), draft: editing ? this.draft.localStart : mexicoLocal(previous.startsAt) },
      { label: 'Duración (minutos)', current: String(latest.durationMinutes), draft: String(editing ? this.draft.durationMinutes : previous.durationMinutes) },
      { label: 'Servicio', current: latest.service, draft: editing ? this.draft.service : previous.service },
      { label: 'Profesional', current: latest.practitioner, draft: editing ? this.draft.practitioner : previous.practitioner },
      { label: 'Consultorio o equipo', current: latest.resource, draft: editing ? this.draft.resource : previous.resource },
      { label: 'Origen', current: latest.source, draft: editing ? this.draft.source : previous.source },
      { label: 'Referencia externa', current: latest.externalReference || 'Sin referencia', draft: (editing ? this.draft.externalReference : previous.externalReference) || 'Sin referencia' },
    ];
  }
  acceptConflict() {
    const latest = this.conflict();
    if (!latest || this.conflictLoading() || this.store.blocked() || latest.id !== this.detail()?.id) return;
    this.detail.set(latest); this.clearConflict(); this.store.error.set('');
    if (this.editor() === 'reschedule') {
      this.formError.set(latest.status === 'BOOKED' ? 'Borrador conservado. Revisa el horario y vuelve a guardar; aún no se ha enviado ninguna modificación.' : 'La cita ya no está programada. Conservamos el borrador, pero su estado actual no permite reprogramarla.');
    } else {
      if (latest.status !== 'BOOKED' && latest.status !== 'ARRIVED') this.cancelling.set(false);
      this.formError.set('Estado actualizado. La acción anterior no se repitió; revisa las acciones disponibles antes de confirmar.');
      void this.loadHistory(0);
    }
  }
  requestCancellation() { this.cancelling.set(true); this.cancellationReason = ''; this.formError.set(''); }
  eventLabel(event: AppointmentEvent) { return event.action === 'APPOINTMENT_RESCHEDULED' ? 'Cita reprogramada' : event.fromStatus ? this.stateLabel(event.fromStatus) + ' → ' + this.stateLabel(event.toStatus) : 'Cita registrada'; }
}
