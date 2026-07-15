# 🌲 Home Sweet Home — site privé de mon terrain

Un petit site web (Docker) pour présenter ton terrain : **carte**, **galerie /
time-lapse** des chantiers (pergola…), le tout **protégé par mot de passe**.

L'accès se fait via des **balises QR code / NFC** posées sur le terrain : chaque
balise contient une URL avec le mot de passe déjà inclus, donc scanner = entrer
directement. Sans balise, le visiteur doit taper le mot de passe. Une **page
admin secrète** permet de gérer le contenu et de générer les QR.

## Comment ça marche

- **Site public** (`/`, `/carte`, `/galerie`) : protégé par le *mot de passe
  visiteur*.
  - Si l'URL contient `?k=LE_MOT_DE_PASSE` → accès automatique, puis le mot de
    passe est retiré de l'URL et un cookie garde la session ~30 jours.
  - Sinon → une page demande le mot de passe.
- **Balises** : une balise « Avant la forêt » qui ouvre la carte pointe par
  exemple vers `https://ton-site/carte?k=LE_MOT_DE_PASSE`. Tu mets cette URL
  dans un tag NFC **ou** tu imprimes le QR code généré.
- **Admin** (`/admin`, **jamais affichée ni liée sur le site**) : protégée par
  un *mot de passe admin* séparé. Permet de modifier les textes, la carte, la
  galerie, de créer les balises + QR, et de changer le mot de passe visiteur.

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
2. **Présentation** : titre + texte d'intro.
3. **Carte** : colle un lien d'intégration (Google *My Maps* → Partager →
   Intégrer une carte → copie l'URL du `src`) **ou** téléverse une image.
4. **Galerie** : ajoute des photos/vidéos (mp4/webm) ou un lien YouTube
   (utilise l'URL au format `https://www.youtube.com/embed/XXXX`).
5. **Balises NFC / QR** : donne un nom (« Avant la forêt »), choisis la page à
   ouvrir → une balise est créée avec son URL et son QR.
   - **NFC** : copie l'URL affichée et écris-la sur ton tag (appli type *NFC
     Tools*).
   - **QR** : bouton « Télécharger le QR », ou page « Imprimer les balises »
     pour tout imprimer d'un coup.
6. **Mot de passe visiteur** : le changer met automatiquement à jour toutes les
   balises et déconnecte les anciens visiteurs.

## Configuration (variables d'environnement)

| Variable         | Rôle                                                        | Défaut            |
|------------------|-------------------------------------------------------------|-------------------|
| `SITE_PASSWORD`  | Mot de passe visiteur initial (intégré aux QR/NFC)          | `terrain`         |
| `ADMIN_PASSWORD` | Mot de passe de la page admin                               | `admin-change-moi`|
| `SESSION_SECRET` | Secret de signature des cookies (garde les sessions)        | *aléatoire*       |
| `ADMIN_PATH`     | Chemin de l'admin (rends-le discret si tu veux)             | `/admin`          |
| `PUBLIC_URL`     | URL publique finale (pour des QR corrects en prod)          | déduit de la requête |
| `DATA_DIR`       | Dossier de données (config + médias)                        | `/data`           |

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
