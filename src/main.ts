import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app";
bootstrapApplication(AppComponent).catch((error) =>
  console.error("No se pudo iniciar la demo", error),
);
