import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClinicStore } from './clinic-store';
import { DataPage } from './data-page';
import { type Supplier } from '../../portal/api';
import { IconComponent } from '../icon';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { CSV_PAGE_NOTICE, canExportPage, suppliersCsv, preparePageExport, downloadPageCsv } from './csv-export';
@Component({selector:'suppliers', imports:[FormsModule,IconComponent,Dialog,Pager], templateUrl:'./suppliers.html'})
export class Suppliers {
  readonly store=inject(ClinicStore);
  readonly rows=new DataPage<Supplier>('purchasing/suppliers');
  readonly creating=signal(false);
  readonly exportNotice=CSV_PAGE_NOTICE;
  search='';
  draft={reference:'',name:''};
  exportAvailable(){return canExportPage(this.rows,
    this.store.has('ADMIN','FARMACIA','AUDITOR') && !this.store.blocked() && !this.store.error());}
  exportPage(){
    try {
      const file=preparePageExport(this.rows,this.exportAvailable(),'proveedores',suppliersCsv);
      if(file){downloadPageCsv(file);this.store.message.set(`Descarga CSV solicitada: ${file.count} proveedores de la página visible. Exportación parcial.`);}
    }catch{this.store.error.set('No se pudo preparar el CSV. Revisa los datos y vuelve a consultar la página.');}
  }
  async save(){ const result=await this.store.submit('purchasing/suppliers',this.draft); if(result){this.creating.set(false);this.draft={reference:'',name:''};this.rows.filter({q:this.search});} }
}
