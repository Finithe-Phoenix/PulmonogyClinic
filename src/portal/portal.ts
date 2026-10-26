import { Component, afterRenderEffect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ClinicStore } from '../app/portal/clinic-store';
import { IconComponent } from '../app/icon';
@Component({selector:'app-root', imports:[RouterOutlet, RouterLink, RouterLinkActive, IconComponent], templateUrl:'./portal.html',
  styles:'.session-concealed{display:none!important}.session-recovery{max-width:38rem;margin:0 auto;padding:clamp(24px,6vw,64px)}.session-recovery h1{margin:24px 0 16px}.session-recovery p{margin:16px 0;line-height:1.6}.session-recovery .form-actions{justify-content:flex-start;flex-wrap:wrap}'})
export class PortalComponent {
  readonly store = inject(ClinicStore);
  readonly menuOpen = signal(false);
  readonly date = new Intl.DateTimeFormat('es-MX', {weekday:'long', day:'numeric', month:'long', timeZone:'America/Mexico_City'}).format(new Date());
  readonly nav = [
    {path:'/inicio', name:'Inicio', icon:'grid', group:'ESPACIO DE TRABAJO', roles:[]},
    {path:'/agenda', name:'Agenda', icon:'calendar', group:'ATENCIÓN', roles:['ADMIN','RECEPCION','MEDICO','AUDITOR']},
    {path:'/pacientes', name:'Pacientes', icon:'users', group:'', roles:['ADMIN','RECEPCION','MEDICO','AUDITOR']},
    {path:'/inventario', name:'Inventario', icon:'box', group:'ABASTECIMIENTO', roles:['ADMIN','FARMACIA','AUDITOR']},
    {path:'/compras', name:'Compras', icon:'cart', group:'', roles:['ADMIN','FARMACIA','AUDITOR']},
    {path:'/proveedores', name:'Proveedores', icon:'users', group:'', roles:['ADMIN','FARMACIA','AUDITOR']},
    {path:'/equipos', name:'Equipos', icon:'pulse', group:'OPERACIÓN', roles:['ADMIN','FARMACIA','AUDITOR','RECEPCION','MEDICO']},
    {path:'/caja', name:'Caja', icon:'wallet', group:'', roles:['ADMIN','RECEPCION','AUDITOR']},
    {path:'/auditoria', name:'Auditoría', icon:'shield', group:'CONTROL', roles:['ADMIN','AUDITOR']},
  ];
  constructor() {
    afterRenderEffect(() => {
      if (this.store.sessionLocked() && !this.store.switchingIdentity()) {
        // The suspended native dialog closes during render; focus the independent recovery screen after it.
        requestAnimationFrame(() => {
          if (this.store.sessionLocked()) document.getElementById('session-recovery-title')?.focus();
        });
      }
    });
  }
  focusPage() {
    this.menuOpen.set(false);
    requestAnimationFrame(() => { if (!this.store.sessionLocked()) document.querySelector<HTMLElement>('main h1')?.focus(); });
  }
}
