import type { LegalTexts } from "./legal-pages.js";

/**
 * The English legal pages (#2462). The French version prevails for consumers. Tokens in braces are
 * the publisher details read at deploy time; `[label](href)` is a link.
 */
export const legalTextsEn: LegalTexts = {
  languageName: "English",
  otherLanguage: "Version française",
  versionLabel: "Version of {version}",
  prevails: "A French version exists; for consumers, the French version prevails.",
  missing: "[to be completed]",
  pages: {
    terms: {
      title: "Terms of use",
      description:
        "The terms for using Redakloop, a free public test that drafts CVs and cover letters from your own documents.",
      intro: [
        "These terms govern your use of the Redakloop test service. You accept them when you create your account. They come with the [privacy policy](/legal/privacy) and the [legal notice](/legal/notice).",
      ],
      sections: [
        {
          heading: "1. A free test service that can stop",
          blocks: [
            "Redakloop is offered as a free, invite-only test version. It is a test environment: features can change, the service can pause, and it can stop at any time.",
            "Before a planned stop, we will make an effort to announce it in the service or by email and to give you time to download your data. Keep your own copy of anything that matters to you: the service is not a storage service.",
          ],
        },
        {
          heading: "2. What the service does",
          blocks: [
            "Redakloop helps you prepare job applications from career material you supply: CVs, cover letters and interview preparation. An AI author writes a draft, an AI critic from another company reviews it, and you decide what to keep, edit and export.",
            "The service prepares documents. It never applies to a job, sends a message or contacts an employer for you.",
          ],
        },
        {
          heading: "3. Your account",
          blocks: [
            "You need an invite and must be at least 16. Keep your sign-in to yourself: you are responsible for what is done with your account.",
          ],
        },
        {
          heading: "4. Your material and your documents",
          blocks: [
            "You keep every right to the material you upload and to the documents you export. You allow {publisher} to store and process that material only to provide the service, as the privacy policy describes. Your material is not used to train AI models.",
            "Upload only material you have the right to share. Do not upload material about another person unless you are allowed to process it, for example with their consent.",
          ],
        },
        {
          heading: "5. What the AI output is",
          blocks: [
            "Drafts and suggestions are written by AI models. They can contain mistakes, such as a wrong date, an overstated role or a requirement read too generously. The service shows the source of each statement and the critic's findings so that you can check them.",
            "You are responsible for every document you send to an employer: check it first. Nothing in the service is career, legal or employment advice, and no result is promised.",
          ],
        },
        {
          heading: "6. Acceptable use",
          blocks: [
            "Do not use the service to invent qualifications or experience, to impersonate anyone, to process another person's data without the right to, to attack or overload the service, or for anything unlawful. Uploaded material and job pages are screened for instructions aimed at the AI, and abuse may lead to suspension.",
          ],
        },
        {
          heading: "7. Price",
          blocks: [
            "The test is free. If paid plans open later, they will come with their own terms, and nothing will be charged without a purchase you make yourself.",
          ],
        },
        {
          heading: "8. Liability",
          blocks: [
            "The test service is provided as it is, without a guarantee of availability or of results. To the extent the law allows, {publisher} is not liable for decisions you or an employer make on the basis of a document, nor for the loss of data you did not download. Nothing limits liability for gross negligence, wilful misconduct, or anything the law does not allow to be limited. Consumers keep every right their national law gives them.",
          ],
        },
        {
          heading: "9. Ending",
          blocks: [
            "You can stop at any time. You can download and delete each candidate record from the service, and write to {email} to have your whole account deleted. An account inactive for 90 days is deleted, after an email warning two weeks before. We may suspend or close an account for a serious breach of these terms.",
          ],
        },
        {
          heading: "10. Law and disputes",
          blocks: [
            "French law applies, without depriving a consumer of the mandatory protection of the law of their country of residence. Write to {email} first; we will try to settle any disagreement amicably.",
          ],
        },
        {
          heading: "11. Changes to these terms",
          blocks: [
            "We may update these terms. Each version is dated. A change that matters to you is announced in the service before it applies; if you disagree, stop using the service and ask us to delete your account.",
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy policy",
      description:
        "What Redakloop keeps about you, why, where it is stored, which AI providers see it, and how to export or delete it.",
      intro: [
        "Redakloop stores the career material you choose to upload, sends selected parts of it to AI model providers to write and review your drafts, and keeps a record of each draft so you can see where every statement came from. This policy says what is processed, why, where, for how long, and what you can do about it.",
      ],
      sections: [
        {
          heading: "1. Who is responsible",
          blocks: [
            "The controller is {publisher}. Contact: {email}.",
            "Address: {address}",
            "Company details: [{detailsUrl}]({detailsUrl})",
          ],
        },
        {
          heading: "2. What we process, and why",
          blocks: [
            {
              list: [
                "Account data (email address, name, sign-in events): to create and secure your account. Basis: the contract (GDPR Art. 6(1)(b)).",
                "Waitlist requests (email address, the day, the version of the consent text and your language): to confirm the address is yours by email, then to invite you when a place opens. Basis: your consent (Art. 6(1)(a)).",
                "Your material (CVs, career notes, profiles, job posts and the documents you write): to prepare your applications. Basis: the contract, and your consent for what you choose to upload.",
                "Drafts and run history (drafts, the critic's findings, your decisions, the models used, token counts and estimated cost): to show you each draft, its sources and its cost. Basis: the contract.",
                "Support questions and feedback you send: to answer you and improve the service. Basis: the contract and our legitimate interest.",
                "Security records (refused requests, screening results, server logs, content-free audit records): to keep the service safe. Basis: our legitimate interest in security (Art. 6(1)(f)).",
              ],
            },
            "A CV can mention health, religion or other sensitive matters. The service does not ask for them; please leave them out. You can mark a section as never to be shared, and it is then never sent to an AI provider.",
            "The AI writes and reviews text. It makes no decision about you: you review, edit and approve every document.",
          ],
        },
        {
          heading: "3. What the AI providers receive, outside the EU",
          blocks: [
            "When you draft a document, the selected parts of your material and the job post are sent to two AI providers. During this test, both process requests outside the European Union:",
            {
              list: [
                "Anthropic, PBC (United States): Claude models write drafts, answer support questions and run research searches, through Anthropic's own API.",
                "OpenAI (United States): OpenAI models review the drafts as the critic.",
              ],
            },
            "Each transfer is covered by the provider's data processing terms, which include the European Commission's standard contractual clauses. Neither provider trains models on data sent through its API. Under their standard API terms, each may keep requests for up to 30 days to detect abuse, then deletes them. Each run records which provider and model received what.",
            "You confirm that you understand these transfers when you create your account.",
          ],
        },
        {
          heading: "4. Where your data is stored, and who else processes it",
          blocks: [
            {
              list: [
                "Google Cloud (Google Cloud EMEA Limited, Ireland): hosting, database, files and the sign-in service, in the europe-west1 region (Belgium), encrypted in transit and at rest.",
                "Brevo (Sendinblue SAS, France): the service's emails, such as address verification, waitlist confirmations, invites and account notices.",
              ],
            },
            "Each processor is bound by a data processing agreement. We do not sell your data, and we share it with authorities only when the law requires it.",
            "Where the service sells credit packs, Stripe (Stripe Payments Europe, Limited, Ireland) sells them as the merchant of record, through its Link service. Stripe collects your payment details and billing address on its own page, under its own privacy policy, and sends the receipt. Redakloop never sees your card; it receives only which pack your organisation bought, the amount and whether it was paid or refunded.",
          ],
        },
        {
          heading: "5. How long we keep it",
          blocks: [
            {
              list: [
                "Your account and material: until you delete them, or until your account is deleted after 90 days without activity (you get an email warning two weeks before).",
                "After a deletion: database backups age out within 35 days.",
                "Waitlist requests: until you are invited, at most six months; a request whose confirmation link was never opened goes after 48 hours.",
                "Server logs: 30 days.",
                "AI providers: up to 30 days, as section 3 says.",
                "If the test stops, we will make an effort to let you download your data first, then delete it.",
              ],
            },
          ],
        },
        {
          heading: "6. Your rights",
          blocks: [
            "You can access, correct, export and delete your data, restrict or object to its processing, and withdraw a consent at any time. You can download and delete each candidate record in the service itself. For anything else, write to {email}; we answer within one month.",
            "You can also complain to the CNIL, 3 place de Fontenoy, 75007 Paris, [www.cnil.fr](https://www.cnil.fr).",
          ],
        },
        {
          heading: "7. Security",
          blocks: [
            "Encryption in transit and at rest, isolation between accounts, least-privilege access with no long-lived keys, screening of uploaded material and job pages, and no candidate material in logs.",
          ],
        },
        {
          heading: "8. Cookies and local storage",
          blocks: [
            "The service uses only what it needs to keep you signed in and to remember your settings. There are no advertising or third-party analytics cookies.",
          ],
        },
        {
          heading: "9. Changes",
          blocks: [
            "We update this policy when the service changes what it processes. Each version is dated, and a change that matters to you is announced in the service before it applies.",
          ],
        },
      ],
    },
    notice: {
      title: "Legal notice",
      description: "Who publishes Redakloop and how to contact them.",
      intro: ["Information required by French law 2004-575 of 21 June 2004 (LCEN), Article 6-III."],
      sections: [
        {
          heading: "Publisher",
          blocks: [
            {
              list: [
                "Publisher: {publisher}",
                "Company details: [{detailsUrl}]({detailsUrl})",
                "Address: {address}",
                "Registration: {registration}",
                "Email: {email}",
                "Phone: {phone}",
                "Publication director: {director}",
              ],
            },
          ],
        },
        {
          heading: "Hosting",
          blocks: [
            "Google Cloud EMEA Limited, 70 Sir John Rogerson's Quay, Dublin 2, Ireland. The service runs in the europe-west1 region (Belgium).",
          ],
        },
        {
          heading: "Personal data",
          blocks: [
            "How personal data is processed, and how to use your rights, is in the [privacy policy](/legal/privacy).",
          ],
        },
        {
          heading: "Intellectual property",
          blocks: [
            "The application's source code is published under its open-source licence. Your material and the documents you export remain yours.",
          ],
        },
      ],
    },
  },
};
