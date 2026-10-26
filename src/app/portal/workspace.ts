import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClinicStore } from './clinic-store';
import { DataPage, money, statusLabel } from './data-page';
import { type OrderSummary, type Lot } from '../../portal/api';
import { IconComponent } from '../icon';
import { type Appointment, mexicoDayRange, mexicoLocal, mexicoTime, appointmentLabel } from './operations-api';
@Component({selector:'workspace', imports:[RouterLink, IconComponent], templateUrl:'./workspace.html'})
export class Workspace {
  readonly store = inject(ClinicStore);
  readonly orders = new DataPage<OrderSummary>('purchasing/orders', 5, ['ADMIN','FARMACIA','AUDITOR']);
  readonly lots = new DataPage<Lot>('inventory/lots?availableOnly=true', 4, ['ADMIN','FARMACIA','AUDITOR']);
  readonly appointments = new DataPage<Appointment>('operations/appointments', 5, ['ADMIN','RECEPCION','MEDICO','AUDITOR']);
  readonly time = mexicoTime;
  readonly appointmentLabel = appointmentLabel;
  readonly money = money;
  readonly statusLabel = statusLabel;
  constructor(){ this.appointments.filter(mexicoDayRange(mexicoLocal().slice(0,10))!); }
}
