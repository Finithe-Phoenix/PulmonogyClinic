import { bootstrapApplication } from '@angular/platform-browser';
import { PortalComponent } from './portal/portal';
bootstrapApplication(PortalComponent).catch(() => console.error('No se pudo iniciar el portal.'));
