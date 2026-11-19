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
      screenshot: {
        alt: "Accueil, Votre parcours : un document dans Éléments de parcours et le Profil professionnel relu qui en est tiré.",
      },
    },
    {
      id: "job",
      title: "Ajouter une offre",
      paragraphs: [
        "Sur l’accueil, choisissez Nouvelle candidature. Donnez un nom à l’offre, collez sa description ou son lien, puis choisissez Créer la candidature.",
        "DraftLoop liste les exigences de l’offre. Relisez-les et corrigez celles qui semblent fausses, car le brouillon est écrit en fonction d’elles.",
        "Pour l’instant, DraftLoop est réglé et testé sur les métiers du logiciel et de la tech. Il fonctionne aussi pour d’autres métiers, dans les soins, la vente, l’enseignement ou l’artisanat : relisez ces brouillons un peu plus attentivement. La prise en charge de plus de métiers est prévue dans notre feuille de route.",
      ],
      keywords: [
        "candidature",
        "offre d’emploi",
        "annonce",
        "lien",
        "URL",
        "exigences",
        "poste",
        "métier",
        "profession",
        "secteur",
      ],
      screenshot: {
        alt: "La fenêtre Nouvelle candidature avec le nom du poste et l’annonce collée.",
      },
    },
    {
      id: "draft",
      title: "Lancer un brouillon",
      paragraphs: [
        "Dans la candidature, lancez une exécution. Un modèle rédige le CV et un second modèle vérifie chaque affirmation à partir de vos éléments de parcours.",
        "Une exécution dure quelques minutes, et vous pouvez quitter la page pendant ce temps. Si elle s’arrête, l’écran indique si elle reprendra seule et combien de temps attendre.",
      ],
      keywords: ["exécution", "lancer", "générer", "rédiger", "modèle", "auteur", "critique"],
      screenshot: {
        alt: "L’en-tête d’une rédaction : brouillon, critique et révision sont faits, l’approbation suit.",
      },
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
      screenshot: {
        alt: "Le panneau Constats : deux constats bloquants à accepter, rejeter, reporter ou passer outre, puis Approuver le document.",
      },
    },
    {
      id: "prepare",
      title: "Préparer la candidature",
      paragraphs: [
        "Dans une candidature, ouvrez Préparer pour rédiger une lettre de motivation ou un guide de préparation à l’entretien à partir des mêmes éléments. Cette partie est repliée par défaut.",
        "Chaque candidature payée comprend 20 brouillons, guides et recherches dans Préparer.",
      ],
      keywords: ["lettre de motivation", "lettre", "entretien", "questions", "préparation"],
      screenshot: {
        alt: "Le panneau Préparer d’une candidature, avec Lettre de motivation et Guide de préparation d’entretien.",
      },
    },
    {
      id: "display",
      title: "Choisir ce que vous voyez",
      paragraphs: [
        "Dans les Réglages, Affichage propose trois choix. Guidé montre une chose à faire à la fois, Simple montre le parcours de base, et Tout afficher ouvre toutes les options.",
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
      screenshot: { alt: "Réglages, Affichage : Guidez-moi pas à pas, Simple et Tout afficher." },
    },
    {
      id: "agents",
      title: "Travailler avec un agent",
      paragraphs: [
        "Un agent IA comme Claude Code ou Codex peut utiliser DraftLoop pour vous grâce à MCP. Dans les Réglages, ouvrez Agents, créez un jeton pour l’agent et suivez les étapes affichées.",
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
      screenshot: {
        alt: "Réglages, Agents : notes des agents, agents connectés et Connecter un agent.",
      },
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
        "Marquez une section comme privée pour la garder hors des brouillons et loin des fournisseurs de modèles. Depuis le menu du compte, vous pouvez tout télécharger. Pour supprimer tous vos documents et candidatures, ou votre compte, ouvrez Paramètres du compte dans ce menu : les deux se trouvent dans sa Zone dangereuse et vous demandent d’abord de saisir une confirmation.",
        "Pour vous connecter plus vite, ouvrez Sécurité de connexion dans le menu du compte et configurez une clé d’accès. Après votre mot de passe, votre empreinte, votre visage, votre code PIN ou votre téléphone remplace alors le code à six chiffres. Gardez votre application d’authentification en secours : Essayer une autre méthode passe de l’une à l’autre. Cochez Se souvenir de moi pour rester connecté sur cet appareil jusqu’à 30 jours.",
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
        "clé d’accès",
        "passkey",
        "connexion",
        "authentification",
      ],
    },
    {
      id: "problems",
      title: "Quand quelque chose ne marche pas",
      paragraphs: [
        "Si une étape échoue, lisez d’abord le message à l’écran : il indique si l’étape reprendra seule ou ce qu’il faut faire. Un envoi de fichier refusé signifie souvent que le consentement n’est pas encore enregistré.",
        "Si ce guide ne répond pas à votre question, ouvrez Aide dans l’en-tête puis choisissez Envoyer un avis et décrivez ce qui s’est passé. Les personnes qui gèrent DraftLoop lisent chaque note.",
        "Une note part avec des détails techniques : la page, la version, les derniers codes d’erreur et la famille de votre navigateur. Ouvrez Ce que nous joignons dans la fenêtre pour voir chaque valeur. Votre CV, vos offres d’emploi, le texte de la page et les captures d’écran ne sont jamais envoyés.",
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
