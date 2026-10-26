import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClinicStore } from './clinic-store';
import { DataPage, money, statusLabel, today, toCents } from './data-page';
import { type OrderSummary, type Order, type Product, type Supplier, type Receipt } from '../../portal/api';
import { IconComponent } from '../icon';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { CSV_PAGE_NOTICE, canExportPage, purchasesCsv, preparePageExport, downloadPageCsv } from './csv-export';
@Component({selector:'purchases',imports:[FormsModule,RouterLink,IconComponent,Dialog,Pager],templateUrl:'./purchases.html'})
export class Purchases {
  readonly store=inject(ClinicStore);
  readonly router=inject(Router);
  readonly route=inject(ActivatedRoute);
  readonly rows=new DataPage<OrderSummary>('purchasing/orders');
  readonly products=new DataPage<Product>('inventory/products',49);
  readonly suppliers=new DataPage<Supplier>('purchasing/suppliers',49);
  readonly receipts=new DataPage<Receipt>('purchasing/receipts');
  readonly selected=signal<Order|null>(null);
  readonly detailId=signal(this.route.snapshot.paramMap.get('id'));
  readonly detailLoading=signal(false);
  readonly creating=signal(false);
  readonly dialog=signal<'receipt'|'cancel'|null>(null);
  readonly money=money;readonly statusLabel=statusLabel;
  readonly exportNotice=CSV_PAGE_NOTICE;
  search='';productSearch='';supplierSearch='';
  draft={reference:'',supplierId:'',expectedOn:today(),lines:[{productId:'',quantity:1,unitCost:'10.00',name:''}]};
  supplierName='';
  receipt={reference:'',lineId:'',quantity:1,batch:'',expiresOn:'',quarantined:false};
  reason='';
  private ticket=0;
  exportAvailable(){return !this.detailId() && !this.creating() && canExportPage(this.rows,
    this.store.has('ADMIN','FARMACIA','AUDITOR') && !this.store.blocked() && !this.store.error());}
  exportPage(){
    try {
      const file=preparePageExport(this.rows,this.exportAvailable(),'compras',rows=>purchasesCsv(rows,statusLabel));
      if(file){downloadPageCsv(file);this.store.message.set(`Descarga CSV solicitada: ${file.count} órdenes de la página visible; importes en centavos MXN. Exportación parcial.`);}
    }catch{this.store.error.set('No se pudo preparar el CSV. Revisa los datos y vuelve a consultar la página.');}
  }
  constructor(){
    const sub=this.route.paramMap.subscribe(params=>this.detailId.set(params.get('id')));
    inject(DestroyRef).onDestroy(()=>{sub.unsubscribe();this.ticket++;});
    effect(()=>{this.store.revision();const id=this.detailId();if(id && this.store.user())untracked(()=>void this.loadOrder(id));});
  }
  async loadOrder(id:string){
    const ticket=++this.ticket;this.detailLoading.set(true);
    if(this.selected()?.id!==id)this.selected.set(null);
    try{const order=await this.store.api.request<Order>('purchasing/orders/'+id);if(ticket!==this.ticket)return;this.selected.set(order);this.receipts.filter({orderId:id});}
    catch(error){if(ticket===this.ticket)this.store.report(error);}
    finally{if(ticket===this.ticket)this.detailLoading.set(false);}
  }
  productInPage(id:string){return this.products.items().some(p=>p.id===id);}
  supplierInPage(id:string){return this.suppliers.items().some(p=>p.id===id);}
  selectProduct(line:typeof this.draft.lines[number]){line.name=this.products.items().find(p=>p.id===line.productId)?.name||line.name;}
  chooseSupplier(){this.supplierName=this.suppliers.items().find(s=>s.id===this.draft.supplierId)?.name||this.supplierName;}
  total(){return this.draft.lines.reduce((sum,line)=>sum+line.quantity*(toCents(line.unitCost)||0),0);}
  async saveOrder(){
    const lines=this.draft.lines.map(l=>({productId:l.productId,quantity:l.quantity,unitCostCents:toCents(l.unitCost)}));
    if(lines.some(l=>!l.unitCostCents)){this.store.error.set('Revisa los costos: usa pesos con un máximo de dos decimales y hasta $1,000,000.00 por unidad.');return;}
    const result=await this.store.submit('purchasing/orders',{...this.draft,lines});
    if(result){this.creating.set(false);await this.router.navigate(['/compras',result.id]);}
  }
  openReceipt(){const order=this.selected();if(!order)return;this.receipt={reference:'',lineId:order.lines.find(l=>l.received<l.ordered)?.id||'',quantity:1,batch:'',expiresOn:'',quarantined:false};this.dialog.set('receipt');}
  async receive(){const order=this.selected();if(order && await this.store.submit('purchasing/orders/'+order.id+'/receipts',{...this.receipt,expiresOn:this.receipt.expiresOn||null}))this.dialog.set(null);}
  async cancel(){const order=this.selected();if(order && await this.store.submit('purchasing/orders/'+order.id+'/cancel',{reason:this.reason}))this.dialog.set(null);}
}
