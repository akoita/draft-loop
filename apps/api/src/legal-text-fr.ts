import type { LegalTexts } from "./legal-pages.js";

/** Les pages légales en français (#2462) : pour les consommateurs, cette version prévaut. */
export const legalTextsFr: LegalTexts = {
  languageName: "Français",
  otherLanguage: "English version",
  versionLabel: "Version du {version}",
  prevails: "Une version anglaise existe ; pour les consommateurs, la version française prévaut.",
  missing: "[à compléter]",
  pages: {
    terms: {
      title: "Conditions d'utilisation",
      description:
        "Les conditions d'utilisation de DraftLoop, un test public gratuit qui rédige CV et lettres de motivation à partir de vos propres documents.",
      intro: [
        "Ces conditions régissent votre utilisation du service de test DraftLoop. Vous les acceptez en créant votre compte. Elles vont avec la [politique de confidentialité](/legal/privacy) et les [mentions légales](/legal/notice).",
      ],
      sections: [
        {
          heading: "1. Un service de test gratuit, qui peut s'arrêter",
          blocks: [
            "DraftLoop est proposé en version de test gratuite, sur invitation. C'est un environnement de test : ses fonctions peuvent changer, le service peut être interrompu, et il peut s'arrêter à tout moment.",
            "Avant un arrêt prévu, nous ferons notre possible pour l'annoncer dans le service ou par e-mail et pour vous laisser le temps de télécharger vos données. Gardez votre propre copie de ce qui compte pour vous : le service n'est pas un service de stockage.",
          ],
        },
        {
          heading: "2. Ce que fait le service",
          blocks: [
            "DraftLoop vous aide à préparer vos candidatures à partir des éléments de carrière que vous fournissez : CV, lettres de motivation et préparation d'entretien. Une IA autrice rédige un brouillon, une IA critique d'une autre entreprise le relit, et vous décidez de ce que vous gardez, modifiez et exportez.",
            "Le service prépare des documents. Il ne postule jamais à une offre, n'envoie aucun message et ne contacte aucun employeur à votre place.",
          ],
        },
        {
          heading: "3. Votre compte",
          blocks: [
            "Il faut une invitation et avoir au moins 16 ans. Gardez votre connexion pour vous : vous êtes responsable de ce qui est fait avec votre compte.",
          ],
        },
        {
          heading: "4. Vos éléments et vos documents",
          blocks: [
            "Vous gardez tous vos droits sur les éléments que vous téléversez et sur les documents que vous exportez. Vous autorisez {publisher} à les conserver et à les traiter uniquement pour fournir le service, comme le décrit la politique de confidentialité. Vos éléments ne servent pas à entraîner des modèles d'IA.",
            "Ne téléversez que des éléments que vous avez le droit de partager. Ne téléversez pas d'éléments sur une autre personne sans en avoir le droit, par exemple avec son accord.",
          ],
        },
        {
          heading: "5. Ce que produit l'IA",
          blocks: [
            "Les brouillons et suggestions sont rédigés par des modèles d'IA. Ils peuvent contenir des erreurs, comme une date fausse, un rôle exagéré ou une exigence lue trop largement. Le service montre la source de chaque affirmation et les remarques de la critique pour que vous puissiez les vérifier.",
            "Vous êtes responsable de chaque document que vous envoyez à un employeur : vérifiez-le avant. Rien dans le service n'est un conseil de carrière, juridique ou en droit du travail, et aucun résultat n'est promis.",
          ],
        },
        {
          heading: "6. Utilisation acceptable",
          blocks: [
            "N'utilisez pas le service pour inventer des diplômes ou une expérience, usurper l'identité de quelqu'un, traiter les données d'une autre personne sans en avoir le droit, attaquer ou surcharger le service, ni pour quoi que ce soit d'illégal. Les éléments téléversés et les pages d'offres sont contrôlés pour repérer les instructions visant l'IA, et un abus peut entraîner une suspension.",
          ],
        },
        {
          heading: "7. Prix",
          blocks: [
            "Le test est gratuit. Si des offres payantes ouvrent plus tard, elles auront leurs propres conditions, et rien ne sera facturé sans un achat que vous faites vous-même.",
          ],
        },
        {
          heading: "8. Responsabilité",
          blocks: [
            "Le service de test est fourni tel quel, sans garantie de disponibilité ni de résultat. Dans la mesure permise par la loi, {publisher} n'est pas responsable des décisions que vous ou un employeur prenez sur la base d'un document, ni de la perte de données que vous n'avez pas téléchargées. Rien ne limite la responsabilité en cas de faute lourde, de faute intentionnelle, ou dans les cas où la loi interdit de la limiter. Les consommateurs gardent tous les droits que leur loi nationale leur donne.",
          ],
        },
        {
          heading: "9. Fin",
          blocks: [
            "Vous pouvez arrêter à tout moment. Vous pouvez télécharger et supprimer chaque dossier de candidat dans le service, et écrire à {email} pour faire supprimer tout votre compte. Un compte inactif pendant 90 jours est supprimé, après un avertissement par e-mail deux semaines avant. Nous pouvons suspendre ou fermer un compte en cas de manquement grave à ces conditions.",
          ],
        },
        {
          heading: "10. Droit applicable et litiges",
          blocks: [
            "Le droit français s'applique, sans priver un consommateur de la protection impérative de la loi de son pays de résidence. Écrivez d'abord à {email} : nous chercherons à régler tout désaccord à l'amiable.",
          ],
        },
        {
          heading: "11. Modifications de ces conditions",
          blocks: [
            "Nous pouvons mettre à jour ces conditions. Chaque version est datée. Un changement qui vous concerne est annoncé dans le service avant de s'appliquer ; si vous n'êtes pas d'accord, cessez d'utiliser le service et demandez-nous de supprimer votre compte.",
          ],
        },
      ],
    },
    privacy: {
      title: "Politique de confidentialité",
      description:
        "Ce que DraftLoop conserve sur vous, pourquoi, où, quels fournisseurs d'IA y accèdent, et comment l'exporter ou le supprimer.",
      intro: [
        "DraftLoop conserve les éléments de carrière que vous choisissez de téléverser, en envoie des extraits choisis à des fournisseurs de modèles d'IA pour rédiger et relire vos brouillons, et garde une trace de chaque brouillon pour que vous voyiez d'où vient chaque affirmation. Cette politique dit ce qui est traité, pourquoi, où, combien de temps, et ce que vous pouvez faire.",
      ],
      sections: [
        {
          heading: "1. Qui est responsable",
          blocks: [
            "Le responsable du traitement est {publisher}. Contact : {email}.",
            "Adresse : {address}",
            "Informations sur la société : [{detailsUrl}]({detailsUrl})",
          ],
        },
        {
          heading: "2. Ce que nous traitons, et pourquoi",
          blocks: [
            {
              list: [
                "Données de compte (adresse e-mail, nom, connexions) : créer et sécuriser votre compte. Base : le contrat (RGPD art. 6(1)(b)).",
                "Demandes de liste d'attente (adresse e-mail, date, version du texte de consentement et votre langue) : vérifier par e-mail que l'adresse est la vôtre, puis vous inviter quand une place s'ouvre. Base : votre consentement (art. 6(1)(a)).",
                "Vos éléments (CV, notes de carrière, profils, offres d'emploi et documents que vous rédigez) : préparer vos candidatures. Base : le contrat, et votre consentement pour ce que vous choisissez de téléverser.",
                "Brouillons et historique (brouillons, remarques de la critique, vos décisions, modèles utilisés, nombre de jetons et coût estimé) : vous montrer chaque brouillon, ses sources et son coût. Base : le contrat.",
                "Questions d'assistance et avis que vous envoyez : vous répondre et améliorer le service. Base : le contrat et notre intérêt légitime.",
                "Traces de sécurité (requêtes refusées, résultats des contrôles, journaux du serveur, traces d'audit sans contenu) : protéger le service. Base : notre intérêt légitime à la sécurité (art. 6(1)(f)).",
              ],
            },
            "Un CV peut mentionner la santé, la religion ou d'autres sujets sensibles. Le service ne les demande pas ; merci de les laisser de côté. Vous pouvez marquer une section comme à ne jamais partager : elle n'est alors jamais envoyée à un fournisseur d'IA.",
            "L'IA rédige et relit du texte. Elle ne prend aucune décision vous concernant : vous relisez, modifiez et validez chaque document.",
          ],
        },
        {
          heading: "3. Ce que reçoivent les fournisseurs d'IA, hors de l'UE",
          blocks: [
            "Quand vous rédigez un document, les extraits choisis de vos éléments et l'offre d'emploi sont envoyés à deux fournisseurs d'IA. Pendant ce test, tous deux traitent les requêtes hors de l'Union européenne :",
            {
              list: [
                "Anthropic, PBC (États-Unis) : les modèles Claude rédigent les brouillons, répondent aux questions d'assistance et font des recherches, par l'API d'Anthropic.",
                "OpenAI (États-Unis) : les modèles d'OpenAI relisent les brouillons en tant que critique.",
              ],
            },
            "Chaque transfert est encadré par les conditions de traitement des données du fournisseur, qui incluent les clauses contractuelles types de la Commission européenne. Aucun des deux fournisseurs n'entraîne ses modèles sur les données envoyées par son API. Selon leurs conditions standard, chacun peut conserver les requêtes jusqu'à 30 jours pour détecter les abus, puis les supprime. Chaque exécution enregistre quel fournisseur et quel modèle a reçu quoi.",
            "Vous confirmez avoir compris ces transferts en créant votre compte.",
          ],
        },
        {
          heading: "4. Où sont stockées vos données, et qui d'autre les traite",
          blocks: [
            {
              list: [
                "Google Cloud (Google Cloud EMEA Limited, Irlande) : hébergement, base de données, fichiers et service de connexion, dans la région europe-west1 (Belgique), chiffrés en transit et au repos.",
                "Brevo (Sendinblue SAS, France) : les e-mails du service, comme la vérification d'adresse, la confirmation de liste d'attente, les invitations et les avis sur votre compte.",
              ],
            },
            "Chaque sous-traitant est lié par un accord de traitement des données. Nous ne vendons pas vos données, et ne les communiquons aux autorités que lorsque la loi l'exige.",
            "Lorsque le service vend des packs de crédits, Stripe (Stripe Payments Europe, Limited, Irlande) les vend en tant que vendeur officiel (merchant of record), via son service Link. Stripe recueille vos données de paiement et votre adresse de facturation sur sa propre page, selon sa propre politique de confidentialité, et envoie le reçu. DraftLoop ne voit jamais votre carte ; il reçoit seulement le pack acheté par votre organisation, le montant et le fait qu'il a été payé ou remboursé.",
          ],
        },
        {
          heading: "5. Combien de temps nous les gardons",
          blocks: [
            {
              list: [
                "Votre compte et vos éléments : jusqu'à ce que vous les supprimiez, ou jusqu'à la suppression du compte après 90 jours sans activité (avec un avertissement par e-mail deux semaines avant).",
                "Après une suppression : les sauvegardes de la base expirent sous 35 jours.",
                "Demandes de liste d'attente : jusqu'à votre invitation, au plus six mois ; une demande dont le lien de confirmation n'a jamais été ouvert est supprimée après 48 heures.",
                "Journaux du serveur : 30 jours.",
                "Fournisseurs d'IA : jusqu'à 30 jours, comme le dit la section 3.",
                "Si le test s'arrête, nous ferons notre possible pour vous laisser télécharger vos données avant, puis nous les supprimerons.",
              ],
            },
          ],
        },
        {
          heading: "6. Vos droits",
          blocks: [
            "Vous pouvez accéder à vos données, les corriger, les exporter et les supprimer, limiter leur traitement ou vous y opposer, et retirer un consentement à tout moment. Vous pouvez télécharger et supprimer chaque dossier de candidat dans le service. Pour le reste, écrivez à {email} ; nous répondons sous un mois.",
            "Vous pouvez aussi saisir la CNIL, 3 place de Fontenoy, 75007 Paris, [www.cnil.fr](https://www.cnil.fr).",
          ],
        },
        {
          heading: "7. Sécurité",
          blocks: [
            "Chiffrement en transit et au repos, isolation entre les comptes, accès au strict nécessaire sans clé de longue durée, contrôle des éléments téléversés et des pages d'offres, et aucun élément de candidat dans les journaux.",
          ],
        },
        {
          heading: "8. Cookies et stockage local",
          blocks: [
            "Le service n'utilise que ce dont il a besoin pour vous garder connecté et retenir vos réglages. Il n'y a ni cookie publicitaire ni mesure d'audience par un tiers.",
          ],
        },
        {
          heading: "9. Modifications",
          blocks: [
            "Nous mettons à jour cette politique quand le service change ce qu'il traite. Chaque version est datée, et un changement qui vous concerne est annoncé dans le service avant de s'appliquer.",
          ],
        },
      ],
    },
    notice: {
      title: "Mentions légales",
      description: "Qui publie DraftLoop et comment le contacter.",
      intro: [
        "Informations requises par la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN), article 6-III.",
      ],
      sections: [
        {
          heading: "Éditeur",
          blocks: [
            {
              list: [
                "Éditeur : {publisher}",
                "Informations sur la société : [{detailsUrl}]({detailsUrl})",
                "Adresse : {address}",
                "Immatriculation : {registration}",
                "E-mail : {email}",
                "Téléphone : {phone}",
                "Directeur de la publication : {director}",
              ],
            },
          ],
        },
        {
          heading: "Hébergement",
          blocks: [
            "Google Cloud EMEA Limited, 70 Sir John Rogerson's Quay, Dublin 2, Irlande. Le service fonctionne dans la région europe-west1 (Belgique).",
          ],
        },
        {
          heading: "Données personnelles",
          blocks: [
            "Le traitement des données personnelles, et la façon d'exercer vos droits, sont décrits dans la [politique de confidentialité](/legal/privacy).",
          ],
        },
        {
          heading: "Propriété intellectuelle",
          blocks: [
            "Le code source de l'application est publié sous sa licence open source. Vos éléments et les documents que vous exportez restent les vôtres.",
          ],
        },
      ],
    },
  },
};
