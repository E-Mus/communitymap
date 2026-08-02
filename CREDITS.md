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

Alle SIL OFL 1.1 oder MIT, alle direkt per CDN mit CORS eingebunden.
Es lädt immer nur die Variante, die gerade aktiv ist.

| Variante | Display | UI | Mono |
|---|---|---|---|
| 1 · prototyp | **Anybody** — Etcetera Type Co. | **Archivo** — Omnibus-Type | **Martian Mono** — Evil Martians |
| 2 · hi-vis | **Messapia** — Luca Marsano | **Apfel Grotezk** — Collletttivo | **Necto Mono** — Marco Condello |
| 3 · zine | **Rubik Spray Paint** | **Bricolage Grotesque** — Mathieu Triay | **Space Mono** — Colophon |
| 4 · galerie | **Sprat** — Ethan Nakache | **Instrument Sans** | **DM Mono** |
| 5 · terminal | **Recursive** — Arrow Type (Stephen Nixon) | *dieselbe* | **Departure Mono** — Helena Zhang (MIT) |

Quellen: Google Fonts, [Collletttivo](https://www.collletttivo.it) (über
jsDelivr), [Departure Mono](https://departuremono.com).

> **Velvetyne** wäre für diesen Look naheliegend gewesen (Karrik, Le Murmure,
> Pilowlava) und ist bewusst *nicht* dabei: die Dateien liegen auf GitLab, das
> keinen `access-control-allow-origin`-Header sendet, und der Download-Link der
> Website liefert eine HTML-Zwischenseite statt einer ZIP. Man müsste sie von
> Hand herunterladen und mitliefern — für eine Demo ohne Build-Schritt zu
> fragil. Falls das gewünscht ist: `.woff2` in `fonts/` legen, `@font-face` in
> der jeweiligen `vN.css` umbiegen, `OFL.txt` daneben.

## Farbregel

Ausschließlich **Cyan `#009DE0` · Magenta `#C4007A` · Gelb `#FFF300` ·
Schwarz** — Weiß und Grau sind der Karte vorbehalten (`#ffffff` Papier,
`#e8e8e8` Gebäude, `#ededed` Wasser, `#9a9a9a` Beschriftung).

Prüfbar, nicht nur versprochen:

```bash
grep -nE '^\s*--(c|m|y|k|paper|block|label|water):' css/v*.css   # muss leer sein
```

Zwei Konsequenzen, die im Code stehen:

- **Kein echter Überdruck.** `multiply` von Cyan über Gelb ist Grün, über
  Magenta ein dunkles Blau. Passerversatz gibt es deshalb nur als ≤2 px Kante
  an Überschriften (Variante 3), nie als Fläche.
- **Das Halbtonraster der Demo-Fotos ist immer Schwarz-auf-Farbe oder
  Farbe-auf-Weiß**, nie Farbe-auf-Farbe, und besteht aus ganzzahligen
  Rechtecken statt antialiaster Kreise. Sonst mischt entweder das Antialiasing
  oder das Herunterskalieren im Browser zwei Druckfarben zu einer dritten.

## Das Artwork

`noe.png` (851×851) ist die Vorlage. Der cyanfarbene Hintergrund wird beim
Start per Flood-Fill von den Rändern freigestellt — Cyan *innerhalb* der
Buchstaben bleibt stehen, wie bei einem echten Stanzschnitt entlang der
Außenkontur. Darum kommt ein weißer Rand, ebenfalls einmalig per Canvas
gebacken.

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
