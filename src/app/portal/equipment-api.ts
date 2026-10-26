export type EquipmentStatus = 'AVAILABLE' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export interface EquipmentAsset {
  id: string;
  reference: string;
  name: string;
  location: string;
  serialNumber: string | null;
  status: EquipmentStatus;
  version: number;
  nextDueOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentMaintenance {
  id: string;
  assetId: string;
  performedOn: string;
  nextDueOn: string | null;
  description: string;
  technician: string;
  actor: string;
  createdAt: string;
  assetVersion: number;
}

export const equipmentStatuses: ReadonlyArray<{ value: EquipmentStatus; label: string }> = [
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'MAINTENANCE', label: 'En mantenimiento' },
  { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
];

export function equipmentStatusLabel(value: EquipmentStatus): string {
  return equipmentStatuses.find(status => status.value === value)?.label || value;
}

const dateFormatter = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function equipmentDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value + 'T12:00:00Z')) : 'Sin programar';
}

export function validEquipmentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
