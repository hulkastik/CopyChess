# Chess

Konten, Freundesliste, Herausforderungen mit Zeitkontrolle und Farbwahl,
serverseitige Uhr, Partieanalyse mit Stockfish.

## Start

```bash
npm install                # kopiert danach automatisch Stockfish nach public/
npx prisma migrate deploy  # Datenbank anlegen
npm run seed               # Admin-Konto anlegen

npm run server             # Socket-Server auf :3001  (eigenes Terminal)
npm run dev                # Next.js auf :3000
```

Beide Prozesse müssen laufen. Der Socket-Server hält den Spielzustand im
Speicher und schreibt über die internen Next-Routen in die Datenbank.

## Konten

| Username | Passwort | Anzeigename | Besonderheit |
|---|---|---|---|
| `Admin` | `Admin` | Emre | Engine-Empfehlung während der Partie |

Alle anderen Konten entstehen über die Registrierung auf der Seite.

Das Feld `engineAssist` auf dem Konto steuert die Live-Empfehlung. Ist es
gesetzt, blendet das Brett während der eigenen Züge einen grünen Pfeil mit dem
besten Zug ein — die Farbe wird aus der Partiezuordnung übernommen, es gibt
nichts einzustellen. Der Gegner sieht davon nichts. Umschalten geht über die
Datenbank:

```bash
npx prisma studio          # Tabelle User -> engineAssist
```

## Ablauf

1. Anmelden, oben rechts die Freundesliste öffnen, Username eintragen.
2. Der Freund nimmt die Anfrage an (Badge am Button).
3. Schwert-Button neben einem **online** stehenden Freund: Zeitkontrolle
   (Bullet 1+0, Blitz 3+2, 10 Minuten) und Farbe (Weiß / Schwarz / Zufall).
4. Nach Annahme landen beide automatisch auf `/play/<id>`.
5. Nach Partieende: **Partieanalyse öffnen** oder **Revanche** (Farben getauscht).

## Wertung, Ränge und Profil

Jedes Konto startet bei **100** Punkten. Nach jeder beendeten Partie wird nach der
Elo-Formel abgerechnet (K = 32, 400er-Skala): ein Sieg gegen einen deutlich
stärkeren Gegner bringt bis zu +31, gegen einen deutlich schwächeren nur +1 —
und eine Niederlage gegen einen Schwächeren kostet entsprechend viel. Die
Wertung fällt nicht unter den Startwert.

| Rang | ab |
|---|---|
| ♙ Bauer | 100 |
| ♘ Springer | 250 |
| ♗ Läufer | 450 |
| ♖ Turm | 700 |
| ♕ Dame | 1000 |
| ♔ König | 1400 |

`/profile/<userId>` zeigt Rang, Wertung, Siege/Niederlagen/Remis, Siegquote und
den Partieverlauf mit Ergebnis, Grund, gespielter Genauigkeit beider Seiten und
Wertungsänderung. Sichtbar für das eigene Konto und bestätigte Freunde — fremde
Profile bleiben zu, weil die Partieliste sonst verrät, wer wann gegen wen
gespielt hat.

Die Wertung wird in derselben Transaktion wie das Partieende verrechnet, mit
`status: "ACTIVE"` als Bedingung. Der Socket-Server schreibt nach Partieende
teils mehrfach; so zählt die Abrechnung trotzdem genau einmal.

Die Genauigkeit rechnet der Browser (dort läuft Stockfish) und reicht sie über
`POST /api/games/<id>/accuracy` nach. Der erste Aufruf gewinnt.

## Startbildschirm-Icon

`npm run icons` erzeugt `apple-icon.png`, `icon.png` und die Manifest-Icons aus
`scripts/generate-icons.js` — König mit Krone auf Schachbrettsockel, ohne
Bildbibliothek gerastert und von Hand als PNG kodiert. Zusammen mit
`display: standalone` im Manifest startet die Seite vom iOS-Homescreen ohne
Safari-Leisten.

## Remis- und Abbruchregeln

Gelten identisch in Freundespartien, Training und lokalem Spiel
(`src/lib/gameRules.ts`, serverseitig gespiegelt in `checkGameEnd`):

| Bedingung | Ergebnis |
|---|---|
| Schachmatt | 1-0 / 0-1 |
| Patt | Remis |
| Ungenügendes Material | Remis |
| Dreifache Stellungswiederholung | Remis |
| 50-Züge-Regel | Remis |
| Zeit abgelaufen | Sieg, oder Remis wenn der Gegner kein Mattmaterial hat |
| Aufgabe / Remis-Einigung | 0-1 bzw. 1-0 / Remis |

Nach FIDE sind Wiederholung und 50-Züge-Regel Reklamationsrechte — zwingend
werden sie erst bei fünffacher Wiederholung bzw. 75 Zügen. Hier greifen sie wie
im Online-Schach sofort, sonst kann eine Partie nicht enden, wenn beide Seiten
stur wiederholen. Eine Stufe vorher erscheint eine Warnung.

Fallstrick, der dabei behoben wurde: `new Chess(fen)` hat keinen Zugverlauf und
kann eine Wiederholung deshalb prinzipiell nicht erkennen. Alle Bretter halten
jetzt die UCI-Zugliste als Wahrheit und spielen die Stellung daraus nach.

```bash
npm run test:rules   # inkl. Regressionstest fuer genau diesen Fall
```

## Partieanalyse

Zwei Quellen, gleiche Oberfläche:

- `/analyse/<id>` — gespeicherte Partie gegen einen Freund, aus der Datenbank.
- `/analyse/session` — Training oder lokales Spiel. Diese Partien haben keinen
  zweiten Benutzer und stehen deshalb nicht in der Datenbank; die Zugliste
  wandert per `sessionStorage` vom Brett zur Analyse (`src/lib/analysisHandoff.ts`).
  Kein Konto nötig. Knopf **Partieanalyse öffnen** direkt am Brett.

Stockfish bewertet jede Stellung einmal, die Bewertung nach
dem gespielten Zug ist die vorzeichengedrehte Bewertung der Folgestellung.
Das halbiert die Rechenzeit gegenüber dem naiven Weg.

Einstufung pro Zug: Brillant, Großartig, Bester Zug, Gut, Eröffnung, Ungenau,
Schlecht, Patzer. Grundlage ist der Centipawn-Verlust gegenüber dem besten Zug;
*Großartig* verlangt zusätzlich, dass die zweitbeste Fortsetzung mindestens
150 Centipawn schlechter ist, *Brillant* zusätzlich ein echtes Materialopfer.
Die Genauigkeit in Prozent kommt aus der Gewinnwahrscheinlichkeitskurve.

Navigation: `←` `→` `Home` `End` oder die Zugliste.

**Eigene Züge ausprobieren:** auf dem Brett ist jeder legale Zug erlaubt, auch
mit Figuren der Gegenseite — greift man eine Figur, die gerade nicht am Zug ist,
wird das Zugrecht gedreht, sonst ließe sich eine Variante nicht zu Ende spielen.
Nach jedem eigenen Zug rechnet die Engine die Folgestellung durch, legt eine
farbige Marke auf das Zielfeld (`!!` `!` `★` `✓` `?!` `✗` `?` `??`) und zeigt in
der Variantenliste die Einstufung plus den besseren Zug. Der grüne Pfeil zeigt
durchgehend den besten Zug der aktuellen Stellung.

Kategorien: Brillant, Großartig, Bester Zug, Gut, Eröffnung, Ungenau,
**Verpasste Chance** (Gewinnstellung oder erzwungenes Matt weggegeben),
Schlecht, Patzer.

### Genauigkeit

Pro Zug: Verlust an Gewinnwahrscheinlichkeit gegenüber dem besten Zug, umgerechnet
über `103.1668 · e^(−0.04354 · Verlust) − 3.1669 + 1`. Kein Verlust = 100 %, ein
weggeworfener halber Punkt = knapp über 0 %. Die Gewinnwahrscheinlichkeit ist bei
±1000 Centipawn gedeckelt — ob eine Stellung +10 oder +20 Bauern steht, ändert am
Ausgang nichts.

Für die Gesamtgenauigkeit werden zwei Mittel gebildet und gemittelt:

- **gewichtetes arithmetisches Mittel** — Gewicht ist die Streuung der
  Gewinnwahrscheinlichkeit im Fenster vor dem Zug. Züge aus scharfen Phasen zählen
  mehr als Züge aus einer toten Stellung.
- **harmonisches Mittel** — bestraft Ausreißer nach unten hart.

Das reine arithmetische Mittel taugt dafür nicht: bei 20 Zügen kostete ein
partieentscheidender Patzer darin nur 4,4 Prozentpunkte, weil 19 fehlerfreie Züge
ihn erdrücken. Mit der jetzigen Berechnung sind es 16,6.

```bash
npm test   # Regeln, Zug-Einstufung, Genauigkeit, Wertung — 53 Checks
```

## Architektur

```
src/app/api/…            REST: Auth, Freunde, Partien
src/app/api/internal/…   nur für den Socket-Server (x-internal-secret)
server/src/index.ts      Socket.IO: Präsenz, Herausforderungen, Zug- und Uhrenlogik
src/lib/stockfish.ts     ein WASM-Worker für die ganze App, Anfragen serialisiert
src/lib/analysis.ts      Bewertung, Einstufung, Genauigkeit
```

Die Zugvalidierung und die Uhr liegen ausschließlich beim Socket-Server; der
Client zeigt Züge optimistisch an und wird bei Abweichung korrigiert. Nach
einem Server-Neustart werden laufende Partien beim ersten `game:join` aus der
Datenbank rekonstruiert.

Sitzungen laufen über ein HMAC-signiertes Token (`INTERNAL_API_SECRET`), das im
`Authorization`-Header mitgeht. In `.env` gehört für den Betrieb außerhalb des
eigenen Rechners ein eigener Wert.
