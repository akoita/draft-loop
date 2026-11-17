import type { HelpGuide } from "./guide.js";

export const frenchHelpGuide: HelpGuide = {
  intro:
    "DraftLoop transforme vos éléments de parcours en un CV pour une offre. La première fois, suivez les cinq premières étapes dans l’ordre, ou cherchez ce dont vous avez besoin.",
  sections: [
    {
      id: "evidence",
      title: "Ajouter vos éléments de parcours",
      paragraphs: [
        "Depuis l’accueil, ouvrez Éléments de parcours. Ajoutez un CV ou d’autres documents, collez du texte, ou lancez une conversation pour raconter votre parcours si vous n’avez pas de CV.",
        "DraftLoop lit ce que vous ajoutez et liste les faits trouvés. Ouvrez ensuite Profil professionnel et confirmez ou corrigez chaque fait. Vos CV n’utilisent que les faits que vous gardez.",
      ],
      keywords: [
        "CV",
        "curriculum",
        "importer",
        "fichier",
        "document",
        "coller",
        "entretien",
        "faits",
        "profil",
      ],
    },
    {
      id: "job",
      title: "Ajouter une offre",
      paragraphs: [
        "Sur l’accueil, choisissez Nouvelle candidature. Donnez un nom à l’offre, collez sa description ou son lien, puis choisissez Créer la candidature.",
        "DraftLoop liste les exigences de l’offre. Relisez-les et corrigez celles qui semblent fausses, car le brouillon est écrit en fonction d’elles.",
      ],
      keywords: ["candidature", "offre d’emploi", "annonce", "lien", "URL", "exigences", "poste"],
    },
    {
      id: "draft",
      title: "Lancer un brouillon",
      paragraphs: [
        "Dans la candidature, lancez une exécution. Un modèle rédige le CV et un second modèle vérifie chaque affirmation à partir de vos éléments de parcours.",
        "Une exécution dure quelques minutes, et vous pouvez quitter la page pendant ce temps. Si elle s’arrête, l’écran indique si elle reprendra seule et combien de temps attendre.",
      ],
      keywords: ["exécution", "lancer", "générer", "rédiger", "modèle", "auteur", "critique"],
    },
    {
      id: "review",
      title: "Relire et exporter",
      paragraphs: [
        "Quand l’exécution est prête, lisez le brouillon et chaque constat. Acceptez ou rejetez chaque constat, puis choisissez Approuver le document.",
        "Une fois le document approuvé, choisissez un modèle de mise en page puis Exporter pour enregistrer le fichier. Vous pourrez exporter de nouveau plus tard dans un autre modèle.",
      ],
      keywords: [
        "constat",
        "approuver",
        "télécharger",
        "PDF",
        "Word",
        "mise en page",
        "enregistrer",
      ],
    },
    {
      id: "prepare",
      title: "Préparer la candidature",
      paragraphs: [
        "Dans une candidature, ouvrez Préparer pour rédiger une lettre de motivation ou un guide de préparation à l’entretien à partir des mêmes éléments. Cette partie est repliée par défaut.",
        "Chaque candidature payée comprend 20 brouillons, guides et recherches dans Préparer.",
      ],
      keywords: ["lettre de motivation", "lettre", "entretien", "questions", "préparation"],
    },
    {
      id: "display",
      title: "Choisir ce que vous voyez",
      paragraphs: [
        "Dans les réglages de l’espace de travail, Affichage propose trois choix. Guidé montre une chose à faire à la fois, Simple montre le parcours de base, et Tout afficher ouvre toutes les options.",
        "Les choix techniques, comme les modèles, se trouvent sous Options avancées en bas d’une carte. Le parcours de base n’en a jamais besoin.",
      ],
      keywords: [
        "réglages",
        "paramètres",
        "guidé",
        "simple",
        "avancé",
        "options",
        "langue",
        "thème",
      ],
    },
    {
      id: "agents",
      title: "Travailler avec un agent",
      paragraphs: [
        "Un agent IA comme Claude Code ou Codex peut utiliser DraftLoop pour vous grâce à MCP. Dans les réglages de l’espace de travail, ouvrez Agents, créez un jeton pour l’agent et suivez les étapes affichées.",
        "Un agent connecté peut lister vos candidatures, ajouter une offre, lancer un CV et rédiger des lettres de motivation. Il peut aussi noter dans votre journal de travail ce que vous avez livré ; une note ne devient un élément de parcours qu’après votre approbation.",
      ],
      keywords: [
        "MCP",
        "Claude",
        "Codex",
        "jeton",
        "journal de travail",
        "assistant",
        "automatisation",
      ],
    },
    {
      id: "credits",
      title: "Offres et crédits",
      paragraphs: [
        "Votre offre définit ce que vous pouvez utiliser. Crédits et consentement montre votre offre, ses limites et votre solde de crédits.",
        "Avant qu’une exécution démarre, DraftLoop indique les crédits qu’il va réserver ; une exécution lancée compte tout de suite. Une exécution qui ne laisse aucun brouillon est remboursée. Là où le service en vend, Acheter des crédits liste les packs de crédits.",
      ],
      keywords: [
        "prix",
        "coût",
        "payer",
        "acheter",
        "facturation",
        "abonnement",
        "limite",
        "gratuit",
        "remboursement",
      ],
    },
    {
      id: "privacy",
      title: "Confidentialité et données",
      paragraphs: [
        "DraftLoop n’enregistre votre contenu qu’après votre consentement, et le garde dans l’UE. Il n’envoie aux fournisseurs de modèles que le contenu dont une étape a besoin.",
        "Marquez une section comme privée pour la garder hors des brouillons et loin des fournisseurs de modèles. Un propriétaire peut télécharger tout ce qui est conservé sur un dossier, et effacer un dossier ou toute l’organisation.",
      ],
      keywords: [
        "consentement",
        "RGPD",
        "supprimer",
        "effacer",
        "exporter",
        "privé",
        "sensible",
        "sécurité",
      ],
    },
    {
      id: "problems",
      title: "Quand quelque chose ne marche pas",
      paragraphs: [
        "Si une étape échoue, lisez d’abord le message à l’écran : il indique si l’étape reprendra seule ou ce qu’il faut faire. Un envoi de fichier refusé signifie souvent que le consentement n’est pas encore enregistré.",
        "Si ce guide ne répond pas à votre question, choisissez Envoyer un avis dans l’en-tête et décrivez ce qui s’est passé. Les personnes qui gèrent DraftLoop lisent chaque note.",
      ],
      keywords: [
        "erreur",
        "bug",
        "échec",
        "bloqué",
        "cassé",
        "assistance",
        "support",
        "contact",
        "avis",
      ],
    },
  ],
};
