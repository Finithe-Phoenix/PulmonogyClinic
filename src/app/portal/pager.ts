import { Component, input } from '@angular/core';
import { DataPage } from './data-page';
@Component({selector:'clinic-pager', template:`<div class="pagination"><span aria-live="polite">{{page().loading() ? 'Consultando…' : page().failed() ? 'Consulta no disponible' : page().items().length ? 'Registros ' + (page().offset()+1) + '–' + (page().offset()+page().items().length) : 'Sin registros en esta página'}}</span><div><button (click)="page().previous()" [disabled]="page().loading() || page().offset()===0">Anterior</button><button (click)="page().next()" [disabled]="page().loading() || !page().more()">Siguiente</button></div></div>`})
export class Pager { readonly page = input.required<DataPage<any>>(); }
