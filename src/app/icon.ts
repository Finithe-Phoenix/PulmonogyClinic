import { Component, Input } from "@angular/core";
const paths: Record<string, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2zM7 14h3m4 0h3m-10 4h3",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-8a4 4 0 0 1 0 8",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M8 13h8m-8 4h5",
  box: "m12 3 9 5-9 5-9-5 9-5zM3 8v9l9 5 9-5V8m-9 5v9M7 5.8l9 5",
  pulse: "M2 12h4l3-8 6 16 3-8h4",
  wallet: "M3 6h16v14H3V6zm0 0V4h14m4 7h-6v5h6v-5zm-4 2v1",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  arrowup: "M7 17 17 7M7 7h10v10",
  check: "m5 12 4 4L19 6",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M16 16l5 5",
  plus: "M12 5v14M5 12h14",
  location:
    "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zm-4 9 3 3 5-6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  reset: "M3 10a9 9 0 1 1 1 8M3 3v7h7",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  route:
    "M6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 7v8a3 3 0 0 0 3 3h6M9 4h6a3 3 0 0 1 3 3v4",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v6m0-10v1",
  lungs:
    "M11 2v8l-4 3m6-11v8l4 3M9 7C5 3 1 12 2 19c1 4 7 1 7-2V7zm6 0c4-4 8 5 7 12-1 4-7 1-7-2V7z",
};
@Component({
  selector: "app-icon",
  standalone: true,
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="path"/></svg>',
  styles:
    ":host{display:inline-flex;width:20px;height:20px;flex-shrink:0;vertical-align:middle}svg{width:100%;height:100%}",
})
export class IconComponent {
  @Input() name = "grid";
  get path() {
    return paths[this.name] || paths["grid"];
  }
}
