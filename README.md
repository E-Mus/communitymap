# NöMap

Eine community-basierte Weltkarte für Nö-Sticker-Sichtungen.
Man trägt ein, wo einer klebt, liked die von anderen und stöbert durch den Feed.

**→ [Demo ansehen](https://e-mus.github.io/communitymap/)**

Prototyp ohne Server: alles läuft im Browser, die eigenen Sichtungen liegen in
`localStorage`. Die schon eingetragenen Sichtungen und ihre Likes sind erfunden.

## Funktioniert

- Weltkarte, beim Rauszoomen bündeln sich Sichtungen zu Zahlen-Clustern
- Sticker setzen: **lange auf die Karte tippen**, oder über den Button mit
  Standort bzw. Fadenkreuz
- Tags, optionales Foto, Likes, Melden (ab 3 Meldungen verborgen)
- Ortssuche, Teilen-Link pro Sticker, Admin-Ansicht zum Löschen
- **Fünf UI-Varianten** mit eigener Typografie *und* eigenem Layout —
  umschaltbar über *stil* unten im Menü

## Ausprobieren

| | |
|---|---|
| Sticker setzen | Finger eine halbe Sekunde auf die Karte halten |
| Stil wechseln | Menü ☰ → unten *stil 1/5* |
| Admin | Menü ☰ → *admin* → Passwort `nö` |
| Karte kaputt sehen | Flugmodus an, neu laden — schwarze Schraffur statt weiß |

## Farbregel

Ausschließlich **Cyan `#009DE0` · Magenta `#C4007A` · Gelb `#FFF300` ·
Schwarz**. Weiß und Grau sind allein der Karte vorbehalten.

Prüfbar statt versprochen — keine Variante darf die Markenfarben anfassen:

```bash
grep -nE '^\s*--(c|m|y|k|paper|block|label|water):' css/v*.css   # muss leer sein
```

## Lokal starten

ES-Module brauchen HTTP, `file://` blockiert sie:

```bash
python3 -m http.server 8123
```

## Technik

Vanilla ES-Module, kein Build-Schritt, keine npm-Abhängigkeit.
[MapLibre GL JS](https://maplibre.org) auf keylessen Vektorkacheln von
[OpenFreeMap](https://openfreemap.org), Ortssuche über
[Photon](https://photon.komoot.io).

Lizenzen, Schriften, Kartendaten und die bewussten Demo-Grenzen stehen in
[CREDITS.md](CREDITS.md).
