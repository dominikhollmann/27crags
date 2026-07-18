# Boulder-Gebiete Europa

Scraper für Boulder-Grad-Verteilungen von thetopo.com + eine kleine interaktive Karte,
die die Ergebnisse anzeigt.

## 1. Daten scrapen

```
pip install -r requirements.txt
python scrape_thetopo.py
```

Läuft ca. 30-45 Minuten (bewusst langsam, 3-6s Pause zwischen Requests), ist
resumable -- ein Abbruch verliert keine bereits gecrawlten Regionen. Ergebnis:
`data/boulder_areas_europe.json`.

## 2. Frontend-Daten bauen

```
python build_site_data.py
```

Erzeugt die kompakte `docs/data/crags.json`, die die Karte lädt. Muss nach jedem
erneuten Scrape-Lauf wiederholt werden.

## 3. Mapbox-Token erstellen

Die Karte nutzt Mapbox GL JS und braucht einen kostenlosen Access Token:

1. Auf https://account.mapbox.com/auth/signup ein kostenloses Konto anlegen
   (Free-Tier: 50.000 "map loads"/Monat -- für 3 Nutzer bei weitem ausreichend).
2. Im Dashboard unter "Access tokens" den **Default public token** kopieren
   (beginnt mit `pk.`), oder einen neuen erstellen.
3. Empfohlen: den Token auf die spätere GitHub-Pages-URL beschränken
   (Token bearbeiten -> "URL restrictions" -> `https://<username>.github.io/*`
   eintragen), damit niemand sonst ihn verwenden kann.
4. In `docs/app.js` die Zeile

   ```js
   const MAPBOX_TOKEN = "PASTE_YOUR_MAPBOX_TOKEN_HERE";
   ```

   durch den eigenen Token ersetzen.

Ohne gültigen Token zeigt die Seite eine Fehlermeldung statt einer leeren Karte
(Filter/Statistik funktionieren trotzdem, nur die Kartenansicht fehlt).

## 4. Lokal testen

```
python -m http.server 8000 --directory docs
```

Dann http://localhost:8000 öffnen.

## 5. Auf GitHub Pages veröffentlichen

```
git init
git add .
git commit -m "Boulder-Gebiete Europa: Scraper + Karte"
gh repo create <repo-name> --public --source=. --push
gh api -X POST repos/<username>/<repo-name>/pages -f "source[branch]=main" -f "source[path]=/docs"
```

Die Seite ist danach unter `https://<username>.github.io/<repo-name>/` erreichbar.
Hinweis: Bei einem kostenlosen GitHub-Account ist die Pages-Seite öffentlich
(nicht durchsuchbar/beworben, aber ohne Login-Schutz erreichbar für jeden mit
dem Link).

## Datenformat

`data/boulder_areas_europe.json` und `docs/data/crags.json` enthalten pro
Boulder-Gebiet: `name`, `url` (Link zum Gebiet auf thetopo.com), `region`,
`region_url`, `country`, Koordinaten und `grades` (Anzahl Boulder je
Font-Schwierigkeitsgrad). Nur Gebiete mit mindestens einem Boulder sind
enthalten; Sport-/Trad-/DWS-Routen sind nirgends mitgezählt.
