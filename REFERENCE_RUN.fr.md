# Valider les décodeurs sur votre montre

*[English version: REFERENCE_RUN.md](REFERENCE_RUN.md)*

Les formats ont été résolus et validés sur une seule montre. Si la vôtre ou
son firmware se comporte autrement (traces bizarres, `decode_gps.py` ne
trouve rien, lectures non identiques), une sortie de référence est le moyen
le plus rapide de comprendre pourquoi : un court enregistrement sur la
montre Nike, avec un second appareil GPS (téléphone, montre) qui enregistre
en même temps.

## Avant de partir

1. Lisez une fois la montre avec `python pull_raw_data_v2.py` et gardez les
   fichiers : les outils sont en lecture seule, ça ne change rien sur la
   montre, mais vous aurez une copie sûre de ce qu'elle contient déjà.
2. Attendez que la montre ait le GPS avant de lancer l'enregistrement.
3. Notez l'heure de départ, et l'heure affichée par la montre au même moment
   (son horloge peut être fausse).
4. Démarrez le second appareil en même temps que la montre Nike.

## Le parcours

Les arrêts comptent le plus : ils montrent si les pas GPS d'une seconde
tombent à zéro quand on ne bouge pas.

| Étape | Durée | Quoi |
|---|---|---|
| 1 | **2 min** | **Immobile** |
| 2 | ~3 min | Ligne droite, allure régulière |
| 3 | **1 min** | **Immobile** |
| 4 | ~3 min | Virage net à 90°, puis nouvelle ligne droite |
| 5 | ~5 min | Petite boucle qui revient au point de l'étape 4 |
| 6 | **1 min** | **Immobile** |

Évitez l'aller-retour sur le même chemin : une forme symétrique est ambiguë
à recaler. Un trajet en voiture marche aussi (la validation d'origine était
un trajet de 13 minutes), mais à grande vitesse le second appareil risque
d'enregistrer moins de points.

## Au retour

Ne branchez pas la montre sur Nike+ Connect (il l'effacerait). Puis :

    python pull_raw_data_v2.py
    python decode_gps.py nike_v2_stream_1_<horodatage>.packets gpx/
    python decode_telemetry.py nike_v2_stream_1_<horodatage>.packets sessions/ref

Comparez le GPX de la Nike avec la trace de l'autre appareil dans n'importe
quel visualiseur GPX. S'ils ne correspondent pas, [ouvrez une issue](https://github.com/chatainsim/nike-sportwatch-recovery/issues) avec la
sortie de `--analyze` et ce que vous avez constaté. Ne partagez les fichiers
`.packets` et GPX qu'en privé : ils contiennent vos positions exactes.
