# FluidCalendar — Orientierung fuer Mika / Claude Code

Dieses Dokument ist der erste Anlauf, um in dem Repo nicht wieder stundenlang
nach der richtigen Komponente zu suchen. Bitte hier ergaenzen wenn etwas
wiederholt schlecht auffindbar war.

## Branches und Deploy

- **`marlin/main`** ist der Arbeits-Branch. Hier liegt der lokale Dev-Stack
  (PWA, Mobile-Canvas, TimeTheme, Swipe-Navigation). **Alle Feature-Arbeit
  passiert hier.**
- `main` folgt dem Upstream (eibrahim/fluid-calendar) und dient fuer Merges
  aus Upstream. Nicht direkt draufarbeiten.
- `feat/focus-budget` ist ein aelterer Feature-Branch — vor neuem Einsatz
  pruefen ob noch relevant.

Drei Umgebungen auf der Werkbank (`root@187.77.66.133`), gepflegt via
`_scripts/fluid-calendar-deploy.sh` im Mika-Vault:

| Umgebung | Pfad                            | URL                            |
|----------|---------------------------------|--------------------------------|
| dev      | `/opt/fluid-calendar-dev`       | `https://dev.kalender.hylox.org` |
| staging  | `/opt/fluid-calendar-staging`   | `https://staging.kalender.hylox.org` |
| prod     | `/opt/fluid-calendar`           | `https://kalender.hylox.org`    |

Workflow: lokal committen → rsync nach dev → `deploy.sh stage` (dev→staging)
→ Marlin macht `deploy.sh promote` (staging→prod).

## Zwei Kalender-Views, ein Repo

Das ist die haeufigste Stolperfalle: **die Wochenansicht forkt sich nach
Viewport-Breite**.

```
Calendar.tsx
 └── if (isMobile && view === "week")  → MobileTimeline.tsx   (eigener Canvas)
     else if (view === "week")          → WeekView.tsx         (FullCalendar)
     else if (view === "day")           → DayView.tsx          (FullCalendar)
     ...
```

- `WeekView.tsx` rendert **FullCalendar** (timeGrid-Plugin). Das ist das,
  was Desktop-Nutzer sehen.
- `MobileTimeline.tsx` ist **kein FullCalendar**, sondern eine eigene,
  horizontal scrollbare Canvas-Implementation mit 91 Tagen im voraus gerendert
  (1 Monat vor / 2 Monate nach dem Zentrum). CSS-Inspector findet dort
  **keine** `.fc-*` Klassen.

Wenn du eine Aenderung am Event-Rendering, Overlap-Verhalten, Farben, Fonts
oder Interaktionen machst: **beide Pfade anfassen**, sonst driften Mobile
und Desktop auseinander. Aenderungen auf einer Seite sichtbar, auf der
anderen nicht — genau das ist die typische Bug-Quelle.

### Schneller Smoke-Test

Wenn du in einer dieser Dateien etwas aenderst, pruefe mit Playwright gegen
beide Viewports:

```js
// Mobile
await page.setViewportSize({ width: 412, height: 915 });
await page.goto("https://kalender.hylox.org/calendar");
// Sollte KEINE .fc-Klassen haben (nutzt MobileTimeline)
await page.evaluate(() => document.querySelectorAll(".fc").length); // 0

// Desktop
await page.setViewportSize({ width: 1920, height: 1080 });
// Sollte .fc haben (nutzt FullCalendar/WeekView)
await page.evaluate(() => document.querySelectorAll(".fc").length); // >=1
```

## MobileTimeline — wichtige Details

Siehe Kopfkommentar der Datei. Kurz:

- Overlapping Events werden via `assignLanes()` in nebeneinanderliegende
  Spuren aufgeteilt. Sortierung: start asc, duration desc → laengere
  Events links, kuerzere rechts und mit hoeherem z-index.
- Ganztaegige Events werden in einer eigenen Zeile oberhalb des Grids
  gerendert (siehe `allDayBars`), nicht im Stunden-Grid.
- Tap auf leeres Grid erzeugt einen neuen Termin an der getappten Uhrzeit;
  Tap auf Event oeffnet das QuickView-Overlay.
- Horizontales Scroll des Haupt-Containers wird ueber `handleScroll` mit
  dem Header-Bereich und dem All-Day-Bar synchronisiert.

## Auth fuer API-Clients

Die `/api/*`-Routen nutzen NextAuth-Session-Cookies (`next-auth.session-token`
oder `__Secure-next-auth.session-token` bei HTTPS). Fuer native/externe
Clients (z.B. Mika-Android-App, Widgets) gibt es seit Commit `aaf5a4a` einen
Bearer-Token-Flow (`FluidCalendar API Token` Items in Bitwarden Org "Mika").

## Wenn eine UI-Aenderung im Code nicht erklaerbar ist

Reflexartig Playwright gegen die Live-URL schicken und per
`document.querySelectorAll(...)` den DOM mit dem erwarteten Code abgleichen.
In diesem Repo gibt es Divergenz zwischen `main` (Upstream-Sync) und
`marlin/main` (Deploy) plus conditional Rendering pro Viewport. Der DOM auf
prod ist Ground Truth — alles andere ist Vermutung.
