import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Routes } from '@angular/router';
import { ClinicStore } from './clinic-store';
const roleGuard: CanActivateFn = route => {
  const store = inject(ClinicStore);
  return !store.user() || store.has(...route.data['roles']) || inject(Router).createUrlTree(['/inicio']);
};
const stock = ['ADMIN','FARMACIA','AUDITOR'];
export const portalRoutes: Routes = [
  {path:'inicio', title:'Inicio · PulmonogyClinic', loadComponent:() => import('./workspace').then(m => m.Workspace)},
  {path:'pacientes', title:'Pacientes · PulmonogyClinic', canActivate:[roleGuard], data:{roles:['ADMIN','RECEPCION','MEDICO','AUDITOR']}, loadComponent:() => import('./patients').then(m => m.Patients)},
  {path:'agenda', title:'Agenda · PulmonogyClinic', canActivate:[roleGuard], data:{roles:['ADMIN','RECEPCION','MEDICO','AUDITOR']}, loadComponent:() => import('./agenda').then(m => m.Agenda)},
  {path:'caja', title:'Caja · PulmonogyClinic', canActivate:[roleGuard], data:{roles:['ADMIN','RECEPCION','AUDITOR']}, loadComponent:() => import('./cash').then(m => m.Cash)},
  {path:'caja/:id', title:'Detalle de caja · PulmonogyClinic', canActivate:[roleGuard], data:{roles:['ADMIN','RECEPCION','AUDITOR']}, loadComponent:() => import('./cash').then(m => m.Cash)},
  {path:'equipos', title:'Equipos · PulmonogyClinic', canActivate:[roleGuard], data:{roles:['ADMIN','RECEPCION','MEDICO','AUDITOR','FARMACIA']}, loadComponent:() => import('./equipment').then(m => m.Equipment)},
  {path:'inventario', title:'Inventario · PulmonogyClinic', canActivate:[roleGuard], data:{roles:stock}, loadComponent:() => import('./inventory').then(m => m.Inventory)},
  {path:'compras', title:'Compras · PulmonogyClinic', canActivate:[roleGuard], data:{roles:stock}, loadComponent:() => import('./purchases').then(m => m.Purchases)},
  {path:'compras/:id', title:'Detalle de compra · PulmonogyClinic', canActivate:[roleGuard], data:{roles:stock}, loadComponent:() => import('./purchases').then(m => m.Purchases)},
  {path:'proveedores', title:'Proveedores · PulmonogyClinic', canActivate:[roleGuard], data:{roles:stock}, loadComponent:() => import('./suppliers').then(m => m.Suppliers)},
  {path:'auditoria', title:'Auditoría · PulmonogyClinic', canActivate:[roleGuard], data:{roles:['ADMIN','AUDITOR']}, loadComponent:() => import('./audit').then(m => m.Audit)},
  {path:'', pathMatch:'full', redirectTo:'inicio'}, {path:'**', redirectTo:'inicio'},
];
