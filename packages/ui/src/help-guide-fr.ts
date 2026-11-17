import type { HelpGuide } from "./help-guide.js";

export const frenchHelpGuide: HelpGuide = {
  intro:
    "DraftLoop transforme vos éléments de parcours en un CV pour une offre. La première fois, suivez ces étapes dans l’ordre.",
  sections: [
    {
      id: "evidence",
      title: "Ajouter vos éléments de parcours",
      paragraphs: [
        "Depuis l’accueil, ouvrez Éléments de parcours. Ajoutez un CV ou d’autres documents, collez du texte, ou lancez une conversation pour raconter votre parcours si vous n’avez pas de CV.",
        "DraftLoop lit ce que vous ajoutez et liste les faits trouvés. Ouvrez ensuite Profil professionnel et confirmez ou corrigez chaque fait. Vos CV n’utilisent que les faits que vous gardez.",
      ],
    },
    {
      id: "job",
      title: "Ajouter une offre",
      paragraphs: [
        "Sur l’accueil, choisissez Nouvelle candidature. Donnez un nom à l’offre, collez sa description ou son lien, puis choisissez Créer la candidature.",
        "DraftLoop liste les exigences de l’offre. Relisez-les et corrigez celles qui semblent fausses, car le brouillon est écrit en fonction d’elles.",
      ],
    },
    {
      id: "draft",
      title: "Lancer un brouillon",
      paragraphs: [
        "Dans la candidature, lancez une exécution. Un modèle rédige le CV et un second modèle vérifie chaque affirmation à partir de vos éléments de parcours.",
        "Une exécution dure quelques minutes, et vous pouvez quitter la page pendant ce temps. Si elle s’arrête, l’écran indique si elle reprendra seule et combien de temps attendre.",
      ],
    },
    {
      id: "review",
      title: "Relire et exporter",
      paragraphs: [
        "Quand l’exécution est prête, lisez le brouillon et chaque constat. Acceptez ou rejetez chaque constat, puis choisissez Approuver le document.",
        "Une fois le document approuvé, choisissez un modèle de mise en page puis Exporter pour enregistrer le fichier. Vous pourrez exporter de nouveau plus tard dans un autre modèle.",
      ],
    },
    {
      id: "prepare",
      title: "Préparer la candidature",
      paragraphs: [
        "Dans une candidature, ouvrez Préparer pour rédiger une lettre de motivation ou un guide de préparation à l’entretien à partir des mêmes éléments. Cette partie est repliée par défaut.",
        "Chaque candidature payée comprend 20 brouillons, guides et recherches dans Préparer.",
      ],
    },
    {
      id: "display",
      title: "Choisir ce que vous voyez",
      paragraphs: [
        "Dans les réglages de l’espace de travail, Affichage propose trois choix. Guidé montre une chose à faire à la fois, Simple montre le parcours de base, et Tout afficher ouvre toutes les options.",
        "Les choix techniques, comme les modèles, se trouvent sous Options avancées en bas d’une carte. Le parcours de base n’en a jamais besoin.",
      ],
    },
  ],
};
