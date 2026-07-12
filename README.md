# VocaLat Web

Responsive Web-Version der VocaLat-iOS-App mit allen Vokabeln und Grammatikabschnitten.

## Funktionen

- 612 Vokabeln aus 31 Lektionen mit Suche, Filtern und Favoriten
- Karteikarten, Multiple Choice und Texteingabe
- Kategorisierte Grammatik mit responsiven Tabellen
- Lokaler Lernfortschritt über `localStorage`
- Responsive Navigation für Smartphone, Tablet und Desktop
- Hell-/Dunkelmodus und installierbare PWA mit Offline-Cache

## Lokal starten

Da die Inhalte als JSON geladen werden, muss die Seite über einen kleinen lokalen Server geöffnet werden:

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` öffnen.
