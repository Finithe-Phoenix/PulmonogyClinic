import { Component, DestroyRef, ElementRef, afterRenderEffect, inject, input, output } from '@angular/core';
import { IconComponent } from '../icon';
import { ClinicStore } from './clinic-store';
@Component({selector:'clinic-dialog', imports:[IconComponent], templateUrl:'./dialog.html'})
export class Dialog {
  readonly store = inject(ClinicStore);
  readonly heading = input.required<string>();
  readonly description = input('');
  readonly closed = output<void>();
  private readonly element = inject(ElementRef<HTMLElement>);
  private trigger: HTMLElement | null = null;
  private fieldFocus: HTMLElement | null = null;
  private opened = false;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.element.nativeElement.querySelector('dialog')?.close();
      if(!this.store.sessionLocked() && !this.store.switchingIdentity() && this.trigger?.isConnected)this.trigger.focus();
    });
    afterRenderEffect(() => {
      const dialog = this.element.nativeElement.querySelector('dialog');
      if (!dialog) return;
      if (this.store.sessionLocked() || this.store.switchingIdentity()) {
        // Do not emit closed: projected form/component state must survive suspension in memory.
        if(dialog.open)dialog.close();
        return;
      }
      if (!this.store.user()) return;
      if (!this.opened) { this.trigger = document.activeElement as HTMLElement; this.opened = true; }
      if (!dialog.open) {
        const field = this.fieldFocus;
        dialog.showModal();
        if(field?.isConnected && dialog.contains(field))field.focus();
      }
    });
  }
  rememberFocus(event: FocusEvent) { if(!this.store.sessionLocked() && event.target instanceof HTMLElement)this.fieldFocus = event.target; }
  async recover() { if (await this.store.retry()) this.close(); }
  close() {
    if(this.store.sessionLocked())return;
    this.element.nativeElement.querySelector('dialog')?.close();
    if(this.trigger?.isConnected)this.trigger.focus();
    this.closed.emit();
  }
}
