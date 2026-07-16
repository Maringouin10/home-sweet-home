# 🌲 Home Sweet Home — site privé de mon terrain

Un site web (Docker) pour présenter ton terrain, **protégé par mot de passe**.
Tu composes autant de **pages** que tu veux, comme des articles, à partir de
**blocs** (titre, texte, image, vidéo, stats, intégration). Les textes et les
stats peuvent afficher des **données live** tirées d'URLs JSON (ex. la
production de tes panneaux solaires).

L'accès se fait via des **balises QR code / NFC** posées sur le terrain : chaque
balise contient une URL avec le mot de passe déjà inclus, donc scanner = entrer
directement. Sans balise, le visiteur doit taper le mot de passe. Une **page
admin secrète** sert d'éditeur (style Google Sites) et à générer les QR.

## Comment ça marche

- **Site public** (`/`, `/p/<slug>`) : protégé par le *mot de passe visiteur*.
  - Si l'URL contient `?k=LE_MOT_DE_PASSE` → accès automatique, puis le mot de
    passe est retiré de l'URL et un cookie garde la session ~30 jours.
  - Sinon → une page demande le mot de passe.
- **Pages & blocs** : chaque page est un article composé de blocs que tu ajoutes,
  réordonnes et modifies. Types de blocs : **titre**, **texte**, **stat** (grand
  chiffre), **image**, **vidéo**, **intégration** (iframe), **séparateur**.
- **Données live** : tu déclares des *sources* (nom + URL qui renvoie du JSON).
  À chaque affichage, l'URL est appelée, et tu insères ses valeurs dans tes
  textes / stats via des jetons `{{nom.chemin}}` — par glisser-déposer depuis la
  palette de l'éditeur. Ex. « Aujourd'hui : `{{solaire.today}}` kWh ».
- **Balises** : une balise « Avant la forêt » qui ouvre la carte pointe par
  exemple vers `https://ton-site/p/carte?k=LE_MOT_DE_PASSE`. Tu mets cette URL
  dans un tag NFC **ou** tu imprimes le QR code généré.
- **Admin** (`/admin`, **jamais affichée ni liée sur le site**) : protégée par
  un *mot de passe admin* séparé.

## Démarrage rapide (Docker)

```bash
# 1. Configurer les mots de passe
cp .env.example .env
# puis édite .env (ADMIN_PASSWORD, SITE_PASSWORD, SESSION_SECRET…)

# 2. Lancer
docker compose up -d --build
```

Le site est sur http://localhost:3007

- Page publique : http://localhost:3007
- Page admin : http://localhost:3007/admin *(ne partage pas ce lien)*

> Le port côté machine (`3007`) est fixé dans `docker-compose.yml`. Pour en
> changer, édite la ligne `ports:` (ex. `"8080:3000"`).

Pour générer un `SESSION_SECRET` solide : `openssl rand -hex 32`.

### Sans docker compose

```bash
docker build -t home-sweet-home .
docker run -d --name home-sweet-home -p 3007:3000 \
  -e ADMIN_PASSWORD='mon-admin' \
  -e SITE_PASSWORD='terrain' \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v hsh_data:/data \
  home-sweet-home
```

### En local sans Docker (dev)

```bash
npm install
ADMIN_PASSWORD=admin SITE_PASSWORD=terrain npm run dev
```

## Utilisation de l'admin

1. Va sur `/admin`, connecte-toi avec `ADMIN_PASSWORD`.
2. **Pages** : crée/renomme/réordonne tes pages, choisis la page d'accueil,
   masque une page (brouillon). Clique **Éditer** pour ouvrir l'éditeur.
3. **Éditeur d'une page** : ajoute des blocs, réordonne-les (▲▼), modifie-les.
   - **Titre**, **Texte**, **Stat** (grand chiffre bien visible), **Image**
     (upload ou URL), **Vidéo** (mp4/webm ou lien YouTube `.../embed/XXXX`),
     **Intégration** (iframe, ex. Google *My Maps*), **Carte** (voir plus bas),
     **Séparateur**.
4. **Données live** (section « 🔌 Données live » de l'admin) :
   - Ajoute une source : un **nom** (ex. `solaire`) et une **URL** qui renvoie
     du JSON. En-têtes HTTP optionnels (ex. `Authorization: Bearer xxx`).
   - Clique **Tester / voir les variables** pour lister les chemins disponibles.
   - Dans l'éditeur, une **palette** à droite montre toutes les variables avec
     leur valeur du moment. **Glisse** une variable dans un champ texte/stat
     (ou clique dessus) pour insérer le jeton `{{solaire.today}}`.
   - Jeton avec valeur par défaut : `{{solaire.today|indisponible}}`.
5. **Stat en plus gros** : dans un bloc *Stat*, choisis la taille (Moyen / Grand
   / Très grand). La *valeur* peut être fixe ou une variable live.
6. **Balises NFC / QR** : donne un nom (« Avant la forêt »), choisis la page à
   ouvrir → une balise est créée avec son URL et son QR.
   - **NFC** : copie l'URL affichée et écris-la sur ton tag (appli type *NFC
     Tools*).
   - **QR** : télécharge en **PNG** ou en **SVG** (vectoriel, idéal pour
     imprimer en grand sans perte), ou ouvre « Imprimer les balises ».
7. **Mot de passe visiteur** : le changer met automatiquement à jour toutes les
   balises et déconnecte les anciens visiteurs.

## Carte interactive (bloc « Carte »)

Le bloc **Carte** est une vraie carte interactive (Leaflet). Fonds disponibles
(commutables via le sélecteur en haut à droite) :

- **Satellite (Google)** — l'imagerie de Google Earth (fond par défaut) ;
- **Satellite + noms (Google)** — la même vue avec les rues et lieux ;
- **Plan (OpenStreetMap)**.

- **Importer un tracé** : dans l'éditeur du bloc, importe un fichier **`.kml`**
  ou **`.kmz`** (export Google *My Maps* ou Google Earth). Les limites du
  terrain, sentiers, etc. s'affichent par-dessus la carte.
- **Points cliquables** : **clique sur la carte** pour poser un point, donne-lui
  un nom + un emoji, et choisis **la page qu'il ouvre**. Sur le site, appuyer
  sur le point envoie le visiteur vers cette page. Ex. un point 🏗️ « La pergola »
  qui ouvre la page Pergola.
- **Vue par défaut** : cadre la carte comme tu veux puis « Fixer la vue actuelle
  par défaut » (sinon la carte s'ajuste automatiquement au tracé et aux points).

> La carte a besoin d'une connexion internet côté visiteur (les tuiles se
> chargent depuis Google / OpenStreetMap dans le navigateur du visiteur). La
> bibliothèque Leaflet, elle, est servie par le site (rien à installer).
> Note : l'imagerie satellite provient des serveurs de tuiles Google ; c'est
> parfait pour un usage privé, mais ce n'est pas l'API officielle payante.

## Restriction géographique (Québec)

Tu peux limiter l'accès au site à une zone géographique : **hors zone, l'accès
est bloqué même avec le bon mot de passe / QR / NFC**. (L'administration, elle,
reste accessible de partout.)

- Active-la en mettant `GEO_RESTRICT=1` dans `.env`. Par défaut la zone autorisée
  est le Québec (`GEO_ALLOW=CA-QC`).
- La localisation utilise une base **embarquée** (aucune API externe). Elle est
  fiable au niveau du pays, un peu approximative au niveau provincial : un IP
  canadien dont la province est indéterminée est autorisé (bénéfice du doute) ;
  les autres pays et provinces connues hors-liste sont bloqués.
- Les IP locales (réseau privé / `localhost`) passent toujours — tu ne peux pas
  te bloquer toi-même en test.
- **Derrière un reverse-proxy** (Nginx/Caddy/Traefik), mets `TRUST_PROXY=1` pour
  que la vraie IP du visiteur soit lue (via `X-Forwarded-For`), sinon tout le
  monde apparaît comme « le proxy ».
- `GEO_BLOCK_UNKNOWN=1` bloque en plus les IP impossibles à localiser (plus
  strict, mais peut bloquer certains réseaux mobiles / VPN).

> Note : la base GeoIP embarquée ajoute ~150 Mo à l'image Docker.

> **Note données live** : les URLs sont appelées côté serveur, donc tu peux
> viser un appareil de ton réseau local (ex. `http://192.168.1.50/api/...` de
> ton onduleur solaire). Seul l'admin configure ces URLs.

## Configuration (variables d'environnement)

| Variable         | Rôle                                                        | Défaut            |
|------------------|-------------------------------------------------------------|-------------------|
| `SITE_PASSWORD`  | Mot de passe visiteur initial (intégré aux QR/NFC)          | `terrain`         |
| `ADMIN_PASSWORD` | Mot de passe de la page admin                               | `admin-change-moi`|
| `SESSION_SECRET` | Secret de signature des cookies (garde les sessions)        | *aléatoire*       |
| `ADMIN_PATH`     | Chemin de l'admin (rends-le discret si tu veux)             | `/admin`          |
| `PUBLIC_URL`     | URL publique finale (pour des QR corrects en prod)          | déduit de la requête |
| `DATA_DIR`       | Dossier de données (config + médias)                        | `/data`           |
| `GEO_RESTRICT`   | `1` = bloque l'accès hors des régions autorisées            | `0` (désactivé)   |
| `GEO_ALLOW`      | Régions autorisées (`PAYS-REGION`, séparées par virgules)   | `CA-QC`           |
| `GEO_BLOCK_UNKNOWN` | `1` = bloque aussi les IP non localisables               | `0`               |
| `TRUST_PROXY`    | `1` derrière un reverse-proxy (vraie IP via X-Forwarded-For)| `0`               |

## Données & persistance

Tout (config, images, vidéos) est stocké dans `DATA_DIR` (`/data`), monté comme
volume Docker `hsh_data`. Tes contenus survivent aux redémarrages et
reconstructions du conteneur.

## Notes de sécurité

- Mettre le mot de passe dans l'URL (`?k=…`) est **volontaire** pour les
  QR/NFC : c'est pratique mais peu secret. Le site retire ensuite le mot de
  passe de l'URL et le remplace par un cookie signé (`httpOnly`).
- Mets un **vrai** `ADMIN_PASSWORD` et un `SESSION_SECRET` aléatoire.
- Pour une exposition sur Internet, place le site derrière un reverse-proxy
  **HTTPS** (Caddy, Traefik, Nginx). Les cookies passent en `secure`
  automatiquement derrière un proxy HTTPS.
- Le site envoie `noindex, nofollow` pour ne pas être référencé par Google.
