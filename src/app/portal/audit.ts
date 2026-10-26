import { Component, inject } from '@angular/core';
import { ClinicStore } from './clinic-store';
import { DataPage } from './data-page';
import { type Audit as AuditEvent } from '../../portal/api';
import { Pager } from './pager';
import { IconComponent } from '../icon';
@Component({selector:'audit', imports:[Pager,IconComponent], templateUrl:'./audit.html'})
export class Audit {
  readonly store=inject(ClinicStore);
  readonly rows=new DataPage<AuditEvent>('audit/events');
  date(value:string){return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(value));}
}
