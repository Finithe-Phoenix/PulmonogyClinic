import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ClinicStore } from './clinic-store';
import { DataPage, statusLabel, today } from './data-page';
import { type Product, type Lot, type Movement } from '../../portal/api';
import { IconComponent } from '../icon';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { CSV_PAGE_NOTICE, canExportPage, catalogCsv, lotsCsv, preparePageExport, downloadPageCsv } from './csv-export';
@Component({selector:'inventory', imports:[FormsModule,IconComponent,Dialog,Pager], templateUrl:'./inventory.html'})
export class Inventory {
  readonly store=inject(ClinicStore);
  readonly products=new DataPage<Product>('inventory/products');
  readonly lots=new DataPage<Lot>('inventory/lots');
  readonly movements=new DataPage<Movement>('inventory/movements');
  readonly tab=signal(inject(ActivatedRoute).snapshot.queryParamMap.get('vista') === 'lotes' ? 'lotes' : 'catalogo');
  readonly modal=signal<'product'|'lot'|'detail'|null>(null);
  readonly selected=signal<Lot|null>(null);
  readonly selectedProduct=signal<Product|null>(null);
  private readonly historySubject=signal<string|undefined>(undefined);
  readonly historyItems=computed(() => this.historySubject() === this.store.user()?.profile.sub
    ? this.movements.items().filter(movement => movement.lotId === this.selected()?.id) : []);
  readonly operation=signal<'movement'|'quarantine'|null>(null);
  readonly statusLabel=statusLabel;
  readonly exportNotice=CSV_PAGE_NOTICE;
  search=''; availableOnly=false;
  product={sku:'',name:'',category:'INSUMOS',unit:'pieza',minimumStock:0};
  lot={productId:'',batch:'',expiresOn:'',quarantined:false};
  movement={kind:'ISSUE',quantity:1,reason:''};
  reason='';
  exportAvailable(){return canExportPage(this.tab()==='catalogo' ? this.products : this.lots,
    this.store.has('ADMIN','FARMACIA','AUDITOR') && !this.store.blocked() && !this.store.error());}
  exportCount(){return (this.tab()==='catalogo' ? this.products : this.lots).items().length;}
  exportPage(){
    try {
      const file=this.tab()==='catalogo'
        ? preparePageExport(this.products,this.exportAvailable(),'catalogo',catalogCsv)
        : preparePageExport(this.lots,this.exportAvailable(),'lotes',rows=>lotsCsv(rows,lot=>this.lotState(lot)));
      if(file){downloadPageCsv(file);this.store.message.set(`Descarga CSV solicitada: ${file.count} registros de la página visible. Exportación parcial.`);}
    }catch{this.store.error.set('No se pudo preparar el CSV. Revisa los datos y vuelve a consultar la página.');}
  }
  applyFilter(){ this.tab()==='catalogo' ? this.products.filter({q:this.search}) : this.lots.filter({q:this.search,availableOnly:this.availableOnly}); }
  changeTab(tab:string){this.tab.set(tab);this.search='';this.applyFilter();}
  async saveProduct(){if(await this.store.submit('inventory/products',this.product)){this.modal.set(null);this.product={sku:'',name:'',category:'INSUMOS',unit:'pieza',minimumStock:0};}}
  newLot(product:Product){this.selectedProduct.set(product);this.lot={productId:product.id,batch:'',expiresOn:'',quarantined:false};this.modal.set('lot');}
  async saveLot(){if(await this.store.submit('inventory/lots',{...this.lot,expiresOn:this.lot.expiresOn||null})){this.modal.set(null);this.changeTab('lotes');}}
  async openLot(lot:Lot){
    this.selected.set(lot);this.selectedProduct.set(null);this.operation.set(null);this.reason='';this.movement={kind:'ISSUE',quantity:1,reason:''};
    this.historySubject.set(this.store.user()?.profile.sub);
    this.movements.filter({lotId:lot.id});this.modal.set('detail');
    try { const product=await this.store.api.request<Product>('inventory/products/'+lot.productId); if(this.selected()?.id===lot.id)this.selectedProduct.set(product); }catch(error){this.store.report(error);}
  }
  retryHistory(){
    const lot=this.selected();
    if(lot && this.modal()==='detail' && !this.store.blocked() && this.historySubject()===this.store.user()?.profile.sub){
      this.movements.filter({lotId:lot.id});
    }
  }
  async saveMovement(){
    const lot=this.selected();if(!lot)return;
    if(await this.store.submit('inventory/lots/'+lot.id+'/movements',this.movement)){if(this.selected()?.id===lot.id && this.modal()==='detail'){this.operation.set(null);await this.reloadLot(lot.id);}}
  }
  async saveQuarantine(){
    const lot=this.selected();if(!lot)return;
    if(await this.store.submit('inventory/lots/'+lot.id+'/quarantine',{quarantined:!lot.quarantined,reason:this.reason})){if(this.selected()?.id===lot.id && this.modal()==='detail'){this.operation.set(null);await this.reloadLot(lot.id);}}
  }
  async reloadLot(id:string){try{const result=await this.store.api.request<Lot>('inventory/lots/'+id);if(this.selected()?.id===id && this.modal()==='detail')this.selected.set(result);}catch(error){this.store.report(error);}}
  lotState(lot:Lot){return lot.expiresOn && lot.expiresOn<today() ? 'Caducado' : lot.quarantined ? 'Cuarentena' : lot.quantity>0 ? 'Disponible' : 'Sin existencias';}
}
