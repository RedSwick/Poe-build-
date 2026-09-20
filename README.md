# IA Academy

Une petite application web (HTML/CSS/JS, aucune installation nécessaire) pour apprendre l'intelligence artificielle de A à Z :

- 📰 **Actualités & frise historique** — repères pour comprendre l'évolution de l'IA, et une liste de sources fiables à suivre en continu.
- 📚 **Comprendre l'IA** — tous les concepts (LLM, token, RAG, agent, hallucination...) expliqués simplement, avec analogies et exemples.
- ⚖️ **Comparatif des IA** — ChatGPT, Claude, Gemini, Mistral, Llama, Midjourney... gratuit ou payant, pour quoi faire, filtrable par catégorie.
- 🎯 **Prompt Engineering** — les techniques essentielles, une bibliothèque de gabarits, et un **Prompt Canvas** interactif qui génère un prompt structuré à partir de tes réponses.
- 🛠️ **Cas d'usage** — où l'IA est déjà utilisée aujourd'hui, secteur par secteur.
- 💻 **IA en local** — tuto pas à pas pour faire tourner un modèle gratuitement et en privé sur ton ordinateur (Ollama, LM Studio...).
- 🏋️ **Exercices & quiz** — un quiz de connaissances avec correction immédiate, et des exercices pratiques d'écriture de prompts avec checklist d'auto-évaluation.
- 📖 **Glossaire** — tous les termes techniques, cherchables.
- 🚀 **Se former / Carrière** — un parcours débutant → avancé, les métiers de l'IA, des ressources pour aller plus loin.

## Utilisation

Aucune installation ni build : ouvre simplement `index.html` dans un navigateur, ou sers le dossier avec un serveur statique (ex : `python3 -m http.server`).

## Mettre à jour le contenu

Toutes les données affichées (actus, comparatif, glossaire, quiz...) sont centralisées dans `js/data.js`. La logique d'affichage et les interactions (recherche, filtres, Prompt Canvas, quiz) sont dans `js/app.js`.
