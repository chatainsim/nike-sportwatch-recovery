# Nike+ SportWatch GPS — récupérer ses sorties

*[English version: README.md](README.md)*

Nike a fermé les serveurs de la **Nike+ SportWatch GPS** (fabriquée par
TomTom), et avec eux le seul moyen de récupérer les sorties de la montre :
le logiciel Nike+ Connect se contentait d'envoyer les données brutes, et tout
le décodage se faisait chez Nike. La montre, elle, fonctionne toujours et
garde ses sorties en mémoire.

Ces outils lisent cette mémoire par USB et en tirent :

- des **traces GPX** : un point par seconde, avec altitude et heure, à
  importer dans Strava, Garmin Connect ou n'importe quelle appli de carte ;
- la **télémétrie** : vitesse et allure seconde par seconde, marqueurs de
  départ/pause/reprise/fin et calories, en résumé et en fichier CSV par
  sortie.

Les formats GPS et télémétrie ont été retrouvés par rétro-ingénierie et
validés contre une trace GPS enregistrée en même temps par un autre appareil
(voir [Comment ça a été validé](#comment-ça-a-été-validé)).

> Projet sans lien avec Nike ou TomTom, ni soutenu par eux.
> Testé sur une seule montre, sous Windows : les retours sur d'autres
> montres, firmwares et systèmes sont bienvenus.

## 🌐 Le plus simple : l'appli web (expérimentale)

> ⚠️ **Expérimentale.** La lecture a été confirmée sur une vraie montre
> (Windows, Chrome) ; les autres configurations ne sont pas testées. Si elle
> ne fonctionne pas chez vous, utilisez les [outils Python](#outils-python)
> et ouvrez une issue avec le journal technique de la page (« Afficher le
> journal technique »).

Ouvrez **https://chatainsim.github.io/nike-sportwatch-recovery/** dans **Chrome ou Edge** sur un ordinateur, posez la montre
sur son dock, cliquez sur **Connecter la montre**, et téléchargez vos
sorties. Rien à installer, et rien n'est envoyé : la montre est lue et
décodée dans l'onglet du navigateur (seuls les fonds de carte viennent
d'OpenStreetMap). La page liste chaque sortie avec sa carte, sa distance, sa
durée, son allure, ses calories et sa courbe de vitesse, et exporte les GPX
et les CSV de vitesse, un par un ou tous d'un coup.

Après une lecture complète et vérifiée, la page peut aussi **vider la
montre** (expérimental : la commande d'effacement n'a pas encore été
confirmée sur une vraie montre). Il faut d'abord télécharger une sauvegarde
(GPX, CSV et données brutes) et taper `EFFACER` ; juste avant d'effacer, la
page vérifie que la montre contient toujours exactement les données
sauvegardées, envoie la commande une seule fois, puis relit la montre pour
confirmer qu'elle est vide. Si la montre refuse la commande, rien n'est perdu.

Elle utilise WebHID, que Firefox et Safari ne gèrent pas. La page sait aussi
ouvrir un fichier `.packets` enregistré par `pull_raw_data_v2.py`.

L'appli est dans `docs/` (HTML/JavaScript simple, sans compilation) ;
`docs/nike-decoder.js` est un portage JavaScript des décodeurs Python et
donne des résultats identiques sur les mêmes données.

## ⚠️ Avant de commencer

- **Ne branchez pas la montre sur Nike+ Connect.** Ce logiciel efface la
  mémoire de la montre une fois qu'il l'a « envoyée », vers des serveurs qui
  n'existent plus.
- Ces outils sont **en lecture seule** : ils n'envoient que les commandes
  version, eeprom-query et lecture des sorties. Rien n'est effacé ni modifié
  sur la montre, et on peut les relancer autant qu'on veut.
- Les fichiers produits contiennent **les positions GPS exactes de vos
  sorties** (qui partent souvent de chez vous). Réfléchissez avant de les
  partager publiquement.

## Outils Python

Prérequis : Python 3.9 ou plus récent, et la montre avec son dock USB.

    pip install hidapi
    python pull_raw_data_v2.py
    python decode_gps.py nike_v2_stream_1_<horodatage>.packets gpx/
    python decode_telemetry.py nike_v2_stream_1_<horodatage>.packets sessions/sortie

1. `pull_raw_data_v2.py` lit la montre deux fois et vérifie que les deux
   lectures sont identiques (« IDENTICAL: this read method is reliable. »).
   Il écrit `nike_v2_stream_1_<horodatage>.packets` et
   `nike_v2_stream_2_...`.
2. `decode_gps.py` écrit un fichier GPX par sortie dans `gpx/`, nommé d'après
   son heure de départ en UTC : `gpx/nike_AAAA-MM-JJ_HHhMM.gpx`.
3. `decode_telemetry.py` affiche un résumé par sortie et écrit
   `sessions/sortie_session<N>.csv` (heure, vitesse en m/s, allure en min/km).

**Linux / macOS** : non testés. `hidapi` doit avoir accès au périphérique
USB ; sous Linux, il faut en général lancer le script en root ou ajouter une
règle udev pour le vendor `11ac`, product `5455`. Le lecteur de stockage que
la montre fait apparaître est un leurre (il ne contient qu'un raccourci vers
le site de Nike) : ignorez-le.

**Si la lecture échoue**, `python pull_raw_data_v2.py --analyze "nike_v2_*.packets"`
résume ce qui a été reçu. Ouvrez une issue avec cette sortie, mais sans y
joindre publiquement les fichiers `.packets`, qui contiennent vos positions.

## Ce qui est récupéré

| Donnée | État |
|---|---|
| Trace GPS (position, altitude, heure, 1 point par seconde) | ✅ décodée et validée |
| Vitesse / allure, 1 valeur par seconde | ✅ décodée et validée |
| Marqueurs départ / pause / reprise / fin | ✅ décodés |
| Calories | ✅ décodées |
| Cardio, capteur de foulée (pas) | ❌ non décodés : les enregistrements existent, mais aucune ceinture ni capteur n'était appairé sur la montre utilisée ici. Aide bienvenue. |
| Quelques octets de chaque point GPS (sans doute vitesse/cap ou qualité du signal) | ❌ non décodés, inutiles pour la trace |

L'horloge de la montre peut dériver ou être fausse : pour la date et l'heure
d'une sortie, fiez-vous à l'heure GPS (utilisée dans le GPX) plutôt qu'à
l'heure de la montre affichée par `decode_telemetry.py`.

## Comment ça marche

### Protocole USB

La montre est un périphérique USB HID, vendor `0x11ac`, product `0x5455`.
Chaque paquet de réponse fait 64 octets :

    [01][longueur][txid][suite][adresse : 3 octets big-endian][56 octets de données][écho du txid]

- `longueur` compte à partir de l'octet 2 ; un paquet plein porte 56 octets
  de données ;
- `txid` renvoie l'octet 2 de la requête (par exemple `0x96` pour la lecture
  des sorties), répété en dernier octet ;
- `suite` vaut 1 tant que d'autres données suivent, 0 sur le dernier paquet.

| Opcode | Nom | Rôle |
|---|---|---|
| `0x08` | `version` | version du firmware (vérifie la connexion) |
| `0x12` | `eeprom-query` | y a-t-il des données enregistrées ? |
| `0x10` | `readWorkouts` | lit la mémoire des sorties |

`pull_raw_data_v2.py` envoie une seule requête `readWorkouts` puis lit tout
ce que la montre envoie jusqu'à ce qu'elle se taise (mode « stream », la
méthode du mémoire de recherche de 2014 cité plus bas). Demander un paquet
à la fois avec un offset n'est pas fiable : la montre attend l'adresse en
big-endian dans les octets 4 à 6, et répond à chaque requête par plus d'un
paquet.

### Blocs de données

La mémoire est une suite de blocs :

    [classe:1][longueur des données/2:1][données][crc16:2]

Un bloc est valide quand le CRC-16/CCITT-FALSE (polynôme `0x1021`, init
`0xFFFF`) calculé sur tout le bloc, CRC compris, vaut zéro. Classes : 1 =
infos de l'appareil, 2 = télémétrie, 4 = GPS, 6 = accéléromètre, 7 = bloc de
fin de séance (non décodé).

### Points GPS (classe 4, un par seconde)

| Taille | Drapeaux | Contenu (big-endian) |
|---|---|---|
| 22 octets | `82 04` | **position absolue** : heure Unix (u32, octets 2-5), latitude et longitude (i32 × 10⁻⁷°, octets 6-9 et 10-13), altitude en mètres (i16, octets 14-15), puis 6 octets non décodés |
| 10 octets | `02 04` / `00 04` | **pas d'une seconde** : Δlat, Δlon (i8, unité 16 × 10⁻⁷°), Δalt (i8, 1/16 m), puis 5 octets non décodés |

La montre écrit une position absolue quand un pas ne tient plus dans un
octet signé (au-delà de ~22 m/s vers le nord), et périodiquement sinon.
Quand une position absolue suit une série de pas, le dernier pas couvre
aussi la seconde de cette position.

### Télémétrie (classe 2)

Mis bout à bout, les blocs de classe 2 forment un flux d'enregistrements
dont la taille vient de la table d'opcodes du logiciel Nike+ Connect :

| Enregistrement | Contenu |
|---|---|
| `a0 00 c0 vv` | vitesse absolue en 0,1 m/s (0 = pas de mesure, `fe` = invalide/saturée, `ff` = inconnue) |
| 2 octets `00`-`7f` | trois variations de vitesse de 5 bits signés, une par seconde, dans l'ordre de lecture (« PaceRelative3 ») |
| `c0 03 00 tt` + u32 | marqueur de séance + heure Unix (horloge de la montre) : 0 départ, 1 pause, 2 reprise, 3 fin |
| `a2 00` + u16 | calories (kcal), écrites en fin de sortie |

### Comment ça a été validé

Une sortie de référence de 13 minutes a été enregistrée avec la montre Nike
et un autre appareil GPS (une montre Amazfit) démarrés ensemble, dont
2 minutes immobile.

- En additionnant les pas d'une seconde, on retombe sur la position absolue
  suivante à 0-3 m près, même après 240 pas consécutifs.
- La trace décodée passe à 2,1 m en médiane de la trace de référence.
- À l'arrêt, les pas sont nuls : ce sont des déplacements, pas des mesures
  satellites brutes.
- Télémétrie : 527 vitesses absolues + 3 × 88 enregistrements relatifs =
  791 valeurs pour 791 secondes, et elles suivent la vitesse GPS (par
  exemple +3 +2 +2 depuis 114 donnent 117, 119, 121, contre 113, 117, 121
  au GPS).

Les mêmes décodeurs ont aussi permis de récupérer deux sorties de 2017, à
partir d'un dump fait avant que le protocole soit bien compris (voir
ci-dessous).

## Récupérer un dump fait avec un ancien outil

`reconstruct_v1_dump.py` sert aux dumps faits en lisant un paquet à la fois
avec un offset en little-endian, comme le faisait le premier lecteur de ce
projet, non publié. Un tel dump est brouillé : la requête *j* lisait en
réalité 56 octets à l'adresse `byteswap16(57 × j)`, plus un octet d'écho. Le
script replace chaque paquet à sa vraie adresse et fait un vote majoritaire
octet par octet (chaque octet est en général lu de nombreuses fois), puis
fait tourner l'anneau mémoire de 64 Ko pour que la sortie la plus ancienne
vienne en premier.

    python reconstruct_v1_dump.py ancien_dump.bin memoire.bin
    python decode_gps.py memoire.bin gpx/
    python decode_telemetry.py memoire.bin sessions/ancien

Seuls les 64 premiers Ko sont accessibles de cette façon. Si vous avez
encore la montre, relisez-la plutôt avec `pull_raw_data_v2.py`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `docs/` | l'appli web (index.html, app.js, watch-usb.js, nike-decoder.js) |
| `pull_raw_data_v2.py` | lit la montre par USB, enregistre les paquets bruts |
| `decode_gps.py` | blocs GPS → GPX, un fichier par sortie |
| `decode_telemetry.py` | télémétrie → résumé + CSV vitesse/allure par seconde |
| `extract_blocks.py` | découpe un flux en blocs validés par CRC (aussi outil de diagnostic) |
| `reconstruct_v1_dump.py` | reconstitue la mémoire à partir d'un ancien dump paquet par paquet |
| `REFERENCE_RUN.fr.md` | comment valider les décodeurs sur une autre montre ou un autre firmware |

## Crédits

- **Leendert van Duijn et Hristo Dimitrov**, *Information retrieval from a
  TomTom Nike+ smart watch*, projet étudiant du master Security and Network
  Engineering (OS3), Université d'Amsterdam, juin 2014 : captures USB et
  réseau, décompilation de Nike+ Connect, opcodes des commandes, et méthode
  de lecture en continu.
  Mémoire : https://www.os3.nl/_media/2013-2014/courses/ccf/smartwatches-hristo-leendert.pdf (le site d'OS3 répond actuellement « 403 Forbidden » ;
  [copie archivée](https://web.archive.org/web/20170113075239/https://www.os3.nl/_media/2013-2014/courses/ccf/smartwatches-hristo-leendert.pdf)).
- **Jurph/sportwatch**, projet qui a repris ce mémoire pour en reproduire
  les résultats sur une autre montre — https://github.com/Jurph/sportwatch
- **comsport / nikePlus-SportWatchGPS**, implémentation C++ du protocole
  USB — https://github.com/neklaf/nikePlus-SportWatchGPS
- Le conteneur de blocs, le CRC et la table d'opcodes ont été confirmés en
  analysant `SportWatchPlugin.dll`, du logiciel Nike+ Connect. Le logiciel
  lui-même n'est pas distribué ici.

## Comment ce projet a été fait

Tout ce projet a été réalisé avec [Claude Code](https://claude.com/claude-code),
l'assistant de programmation IA d'Anthropic : la rétro-ingénierie du
protocole USB et des formats GPS et télémétrie, les outils et cette
documentation. Le propriétaire de la montre s'est chargé de tout ce qui
demandait le matériel : lancer le lecteur sur la montre, et enregistrer la
sortie de référence avec un second appareil GPS.

## Licence

MIT — voir [LICENSE](LICENSE).
