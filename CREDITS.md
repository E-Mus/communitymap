# NöMap — Credits & Lizenzen

Demo ohne Backend. Alles läuft im Browser, Daten liegen in `localStorage`.

## Starten

ES-Module brauchen HTTP — `file://` blockiert sie.

```bash
cd "/Users/yoann/Desktop/NöMap/test2" && python3 -m http.server 8123
```

Dann `http://localhost:8123` öffnen.

> Der Standort-Button braucht einen *secure context*. `localhost` gilt als
> sicher, eine LAN-IP wie `192.168.x.x` nicht — dort ist der Button bewusst
> deaktiviert statt still zu scheitern.

## Kartendaten

| Was | Wer | Lizenz |
|---|---|---|
| Vektor-Kacheln | [OpenFreeMap](https://openfreemap.org) (Zsolt Ero) | Code MIT, Betrieb spendenfinanziert, keyless |
| Kachel-Schema | [OpenMapTiles](https://openmaptiles.org) | BSD-3 / CC-BY |
| Geodaten | © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende | ODbL |
| Karten-Engine | [MapLibre GL JS 5.24.0](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause |
| Ortssuche | [Photon](https://photon.komoot.io) (Komoot) | Apache 2.0, keyless |

Die Attribution unten rechts auf der Karte ist **Lizenzpflicht** und darf nicht
entfernt werden. Sie ist nur in die Palette gestylt, nicht versteckt.

**Risiko, offen benannt:** OpenFreeMap wird von einer einzelnen Person
betrieben und hat keine Verfügbarkeitszusage. Die App reagiert darauf mit einer
sichtbaren Fehlerfläche statt mit einer weißen Karte — siehe unten.

## Schriften

Alle SIL OFL 1.1, **selbst gehostet** in `fonts/` (Lizenztexte: `fonts/OFL-*.txt`).

| Rolle | Schrift | Designer |
|---|---|---|
| Display | **Anybody** (`wdth` 50–150) | Etcetera Type Co. |
| UI | **Archivo** (`wdth` 62–125) | Omnibus-Type |
| Mono | **Martian Mono** (`wdth` 75–112.5) | Evil Martians |

Hierarchie über *Breite* statt Gewicht — alle drei haben eine Width-Achse.

Bewusst **nicht** über Google Fonts eingebunden: der CDN-Abruf überträgt die
IP jedes Besuchers an Google, was in Deutschland als DSGVO-Verstoß gilt
(LG München I, Az. 3 O 17493/20). Selbst gehostet ist es außerdem schneller —
gleiche Herkunft, kein zusätzlicher DNS- und TLS-Aufbau. Geladen werden nur
die `latin`-Subsets (~185 KB); `latin-ext` holt der Browser nur bei Bedarf.

Aus demselben Grund liegt auch **MapLibre GL JS 5.24.0** lokal in `vendor/`
statt auf jsDelivr — das entfernt einen weiteren Dritten und einen
Ausfallpunkt.

## Farbregel

Ausschließlich **Cyan `#009DE0` · Magenta `#C4007A` · Gelb `#FFF300` ·
Schwarz** — Weiß und Grau sind der Karte vorbehalten (`#ffffff` Papier,
`#e8e8e8` Gebäude, `#ededed` Wasser, `#9a9a9a` Beschriftung).

Prüfbar, nicht nur versprochen:

```bash
grep -nE '^\s*--(c|m|y|k|paper|block|label|water):' css/style.css css/legal.css   # muss leer sein
```

Drei Konsequenzen, die im Code stehen:

- **Kein echter Überdruck.** `multiply` von Cyan über Gelb ist Grün, über
  Magenta ein dunkles Blau. Deshalb gibt es keine überlagerten Druckfarben —
  Flächen stehen nebeneinander, nicht übereinander.
- **Das Halbtonraster der Demo-Fotos ist immer Schwarz-auf-Farbe oder
  Farbe-auf-Weiß**, nie Farbe-auf-Farbe, und besteht aus ganzzahligen
  Rechtecken statt antialiaster Kreise. Sonst mischt entweder das Antialiasing
  oder das Herunterskalieren im Browser zwei Druckfarben zu einer dritten.
- **Kein halbtransparentes Schwarz auf Flächen.** Schwarz mit Deckkraft über
  Cyan ergibt ein stumpfes Dunkeltürkis, über Gelb ein Oliv. Der Abdunkler
  hinter den Sheets ist deshalb ein Linienraster aus reinem Schwarz, und
  Sekundärtext wird über Größe und Laufweite zurückgenommen statt über
  Transparenz. Einzige Ausnahme: der Hintergrund der Karten-Attribution — der
  liegt über der Karte, wo Weiß und Grau ohnehin erlaubt sind.

## Das Artwork

`noe.png` (851×851) ist die Vorlage. Der cyanfarbene Hintergrund wird beim
Start per Flood-Fill von den Rändern freigestellt — Cyan *innerhalb* der
Buchstaben bleibt stehen, wie bei einem echten Stanzschnitt entlang der
Außenkontur. Darum kommt ein weißer Rand, ebenfalls einmalig per Canvas
gebacken.

## Rechtstexte

`impressum.html` und `datenschutz.html` liegen im selben Stil daneben und sind
aus dem Menüfuß verlinkt.

> **Das Impressum ist absichtlich unausgefüllt.** Es enthält nur mit `[…]`
> markierte Platzhalter und einen deutlich sichtbaren Hinweis darauf. Ein
> Impressum muss die echten Daten des Anbieters nennen — erfundene Angaben
> wären schlimmer als gar keine. Bitte vor jeder öffentlichen Bewerbung
> ausfüllen.

Die **Datenschutzerklärung** ist dagegen inhaltlich vollständig und beschreibt
den tatsächlichen Stand: keine Cookies, kein Tracking, alles im `localStorage`;
IP-Übertragung nur an GitHub Pages (Hosting), OpenFreeMap (Kachelabruf) und —
ausschließlich bei aktiver Eingabe — Photon (Ortssuche). Prüfbar:

```bash
grep -rhoE 'https://[a-zA-Z0-9.-]+' index.html css/*.css js/*.js | sort -u
```

## Bewusste Demo-Grenzen

- **Keine echte Community.** Ohne Server sieht jeder nur seine eigenen
  Sichtungen; die vorhandenen und ihre Likes sind erfunden. Steht auch im Menü.
- **Admin ist Theater.** Passwort `nö` (auch `noe`), steht im Quelltext.
- **Speicher.** `localStorage` deckelt bei ~5 MB, also grob 10–20 Fotos. Bei
  Überlauf bietet die App an, ohne Foto zu kleben — nie stilles Verdrängen.
- **Teilen-Links** transportieren Ort, Tags und Neigung (17 Zeichen), aber
  kein Foto — das passt nicht in eine URL. Der Empfänger sieht den Sticker
  cyan geringt als „noch nicht in deiner sammlung".
- **Tastaturzugriff auf einzelne Marker** gibt es nicht: die Sticker sind ein
  GPU-Symbol-Layer, kein DOM. Der Zugang läuft über die Feed-Liste.
- **Die Tag-Liste in `js/store.js` ist ab jetzt append-only.** Ihre Reihenfolge
  ist der Bit-Index in der Tag-Bitmaske der Teilen-Links; Umsortieren ändert
  still die Bedeutung jedes bereits geteilten Links.

## Was fehlt für echt

Backend mit Sync, Spam- und Missbrauchsschutz, echte Moderation, Bild-Hosting,
Accounts, PWA/Offline, Mehrsprachigkeit, vollständiger Accessibility-Durchgang.
