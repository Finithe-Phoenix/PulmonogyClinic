import { bootstrapApplication } from '@angular/platform-browser';
import { PortalComponent } from './portal/portal';
import { provideRouter, withHashLocation } from '@angular/router';
import { portalRoutes } from './app/portal/routes';
bootstrapApplication(PortalComponent, {providers:[provideRouter(portalRoutes, withHashLocation())]}).catch(() => console.error('No se pudo iniciar el portal.'));
