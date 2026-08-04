# Corpus de builds

Builds réels servant de référence. Ce dossier est **versionné** : c'est la
mémoire du projet, pas un cache.

## Alimenter le corpus

Crée un fichier avec un lien par ligne, puis une seule commande :

```
# mes-builds.txt
https://pobb.in/xxxxxxxx
https://pobb.in/yyyyyyyy
https://pastebin.com/zzzzzzz
```

```bash
npx tsx src/cli.ts corpus add -f mes-builds.txt
```

Relancer la commande sur la même liste est sans risque : l'identifiant
dérive du contenu, un build déjà présent est mis à jour, pas dupliqué.

## À quoi ça sert

**Vérifier les calculs.** Path of Building écrit ses propres résultats dans
le build (`<PlayerStat>`). `corpus validate` rejoue chaque build dans notre
moteur et compare. Deux bugs graves auraient été signalés en une commande
au lieu d'être trouvés à la main : les builds de minions mesurés à zéro, et
l'arbre perdu à la re-sérialisation.

```bash
npx tsx src/cli.ts corpus validate
```

**Guider la recherche.** L'espace des combinaisons est trop grand pour être
exploré : savoir ce que les vrais builds utilisent permet de tester d'abord
ce qui a des chances de marcher.

```bash
npx tsx src/cli.ts corpus stats "Summon Phantasm"
```

Les candidats absents du corpus ne sont jamais écartés — ils passent après.
Un corpus trop petit ne doit pas devenir un plafond de verre.

## Combien de builds

Une dizaine suffit pour la validation des calculs. Pour des a priori
statistiquement utiles sur une compétence donnée, viser 30 à 50.
