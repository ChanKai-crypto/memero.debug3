# Dictionnaires de l'« IA dictionnaire »

Fichiers générés par `scripts/build-dicts.py` (format : `{ "mot normalisé": ["traduction", ...] }`).
L'anglais sert de langue pivot : les paires sans anglais (fr→ru, es→zh…) passent par l'anglais.

| Fichiers | Source | Licence |
|---|---|---|
| fr-en, en-fr, es-en, en-es, ar-en, en-ar | [FreeDict](https://github.com/freedict/fd-dictionaries) (fra-eng, eng-fra, spa-eng, eng-ara) | GNU GPL 2.0 ou ultérieure |
| ru-en, en-ru | [OpenRussian / russian-dictionary](https://github.com/Badestrand/russian-dictionary) | CC BY-SA 4.0 |
| zh-en, en-zh | [CC-CEDICT](https://cc-cedict.org) (via le paquet npm `cc-cedict`) | CC BY-SA 4.0 |

Le classement des traductions chinoises utilise la fréquence SUBTLEX-CH (paquet npm `hanzi`) ; cette liste n'est pas copiée ici.

Ces licences imposent de citer les sources et de partager à l'identique les dictionnaires modifiés.
