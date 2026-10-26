export interface Page<T> { items: T[]; limit: number; offset: number }
export interface Patient {
  id: string; reference: string; fullName: string; birthDate: string; phone: string | null;
  email: string | null; version: number; synthetic: boolean; createdAt: string; updatedAt: string;
}
export interface DuplicateCandidate { patient: Patient; matchedOn: string[] }
export type AppointmentStatus = 'BOOKED' | 'ARRIVED' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED';
export type AppointmentSource = 'LOCAL' | 'DOCTORALIA_MANUAL';
export interface Appointment {
  id: string; patientId: string; patientName: string; patientReference: string; startsAt: string;
  endsAt: string; durationMinutes: number; service: string; practitioner: string; resource: string;
  source: AppointmentSource; externalReference: string | null; status: AppointmentStatus;
  cancellationReason: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface AppointmentEvent {
  id: string; appointmentId: string; commandId: string; action: string; fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus; version: number; reason: string; actor: string; createdAt: string;
  startsAt: string; endsAt: string; practitioner: string; resource: string;
}
export const operationRoles = ['ADMIN', 'RECEPCION', 'MEDICO', 'AUDITOR'];
export const appointmentStatuses: { value: AppointmentStatus; label: string }[] = [
  { value: 'BOOKED', label: 'Programada' }, { value: 'ARRIVED', label: 'En espera' },
  { value: 'IN_CONSULTATION', label: 'En consulta' }, { value: 'COMPLETED', label: 'Finalizada' },
  { value: 'CANCELLED', label: 'Cancelada' },
];
export const appointmentLabel = (status: string) => appointmentStatuses.find(item => item.value === status)?.label || status;
export const mexicoZone = 'America/Mexico_City';
const clockFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: mexicoZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Local calendar controls always represent Mexico City, regardless of browser timezone. */
export function mexicoLocal(value: string | Date = new Date()): string {
  const parts = Object.fromEntries(clockFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
}
export function mexicoInstant(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const parts = local.match(/\d+/g)!.map(Number);
  const desired = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shown = mexicoLocal(new Date(candidate)).match(/\d+/g)!.map(Number);
    candidate += desired - Date.UTC(shown[0], shown[1] - 1, shown[2], shown[3], shown[4]);
  }
  return mexicoLocal(new Date(candidate)) === local ? new Date(candidate).toISOString() : null;
}
export function mexicoDayRange(date: string): { from: string; to: string } | null {
  const from = mexicoInstant(date + 'T00:00');
  if (!from) return null;
  const next = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const to = mexicoInstant(next + 'T00:00');
  return to ? { from, to } : null;
}
export const mexicoTime = (value: string) => new Intl.DateTimeFormat('es-MX', { timeZone: mexicoZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
export const mexicoDateTime = (value: string) => new Intl.DateTimeFormat('es-MX', { timeZone: mexicoZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
export const birthDateLabel = (value: string) => new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value + 'T12:00:00Z'));
