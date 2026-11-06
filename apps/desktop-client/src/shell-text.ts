/**
 * The desktop client shell's own words (#2329): menus, dialogs and the server picker. They follow
 * the screen language the person chose in a server's Workspace settings, else the system's.
 *
 * The shell is a few dozen strings built apart from the web screen, so they live here as a typed
 * table rather than in the screens' Lingui catalog; a test keeps both languages complete. This
 * module imports nothing, so the picker page bundles it as well as the main process.
 */

export const shellLanguages = ["en", "fr"] as const;
export type ShellLanguage = (typeof shellLanguages)[number];

export function isShellLanguage(value: unknown): value is ShellLanguage {
  return typeof value === "string" && (shellLanguages as readonly string[]).includes(value);
}

/** The saved choice, else the first system language the shell has, else English. */
export function negotiateShellLanguage(
  saved: unknown,
  preferred: readonly string[],
): ShellLanguage {
  if (isShellLanguage(saved)) return saved;
  for (const tag of preferred) {
    const language = tag.toLowerCase().split("-")[0];
    if (isShellLanguage(language)) return language;
  }
  return "en";
}

export interface ShellText {
  readonly serverMenu: string;
  readonly switchServer: string;
  readonly viewMenu: string;
  readonly checkForNewVersion: string;
  readonly noNewerVersion: string;
  readonly ok: string;
  readonly newVersionAvailable: string;
  readonly newVersionDetail: (tag: string) => string;
  readonly openReleasesPage: string;
  readonly later: string;
  readonly saveExport: string;
  readonly save: string;
  readonly pageDidNotLoad: (description: string) => string;
  readonly pickerTitle: string;
  readonly pickerHeading: string;
  readonly pickerLead: string;
  readonly yourServers: string;
  readonly noServers: string;
  readonly anotherServer: string;
  readonly address: string;
  readonly name: string;
  readonly optional: string;
  readonly open: string;
  readonly remove: string;
  readonly tryAgain: string;
  readonly cantReach: (origin: string) => string;
  readonly startThisComputer: (reason: string) => string;
  readonly checkAddress: (reason: string) => string;
  readonly confirmRemove: (name: string) => string;
  /** The checks' and address rules' reasons, written in English where they are decided. */
  readonly reasons: Readonly<Record<string, string>>;
  readonly serverAnswered: (status: string) => string;
}

const english: ShellText = {
  serverMenu: "Server",
  switchServer: "Switch server…",
  viewMenu: "View",
  checkForNewVersion: "Check for a new version…",
  noNewerVersion: "No newer desktop version was found.",
  ok: "OK",
  newVersionAvailable: "A new desktop version is available.",
  newVersionDetail: (tag) =>
    `DraftLoop ${tag} is on the releases page. Download it there and replace this app.`,
  openReleasesPage: "Open the releases page",
  later: "Later",
  saveExport: "Save export",
  save: "Save",
  pageDidNotLoad: (description) => `The page did not load (${description}).`,
  pickerTitle: "DraftLoop: choose a server",
  pickerHeading: "Choose your DraftLoop server",
  pickerLead:
    "The desktop app opens a DraftLoop server: the self-hosted server on this computer, or another server you reach over https.",
  yourServers: "Your servers",
  noServers: "No server yet. Add one below.",
  anotherServer: "Another server",
  address: "Address",
  name: "Name",
  optional: "Optional",
  open: "Open",
  remove: "Remove",
  tryAgain: "Try again",
  cantReach: (origin) => `Can't reach ${origin}.`,
  startThisComputer: (reason) =>
    `${reason} If it is this computer's server, start it with draft-loop-server up, then try again.`,
  checkAddress: (reason) => `${reason} Check the address and your connection, then try again.`,
  confirmRemove: (name) =>
    `Remove ${name}? Its sign-in and saved pages are cleared from this computer.`,
  reasons: {},
  serverAnswered: (status) => `The server answered ${status}.`,
};

const french: ShellText = {
  serverMenu: "Serveur",
  switchServer: "Changer de serveur…",
  viewMenu: "Affichage",
  checkForNewVersion: "Rechercher une nouvelle version…",
  noNewerVersion: "Aucune version de bureau plus récente n’a été trouvée.",
  ok: "OK",
  newVersionAvailable: "Une nouvelle version de bureau est disponible.",
  newVersionDetail: (tag) =>
    `DraftLoop ${tag} est sur la page des versions. Téléchargez-la et remplacez cette application.`,
  openReleasesPage: "Ouvrir la page des versions",
  later: "Plus tard",
  saveExport: "Enregistrer l’export",
  save: "Enregistrer",
  pageDidNotLoad: (description) => `La page ne s’est pas chargée (${description}).`,
  pickerTitle: "DraftLoop : choisir un serveur",
  pickerHeading: "Choisissez votre serveur DraftLoop",
  pickerLead:
    "L’application de bureau ouvre un serveur DraftLoop : le serveur auto-hébergé sur cet ordinateur, ou un autre serveur joint en https.",
  yourServers: "Vos serveurs",
  noServers: "Aucun serveur pour l’instant. Ajoutez-en un ci-dessous.",
  anotherServer: "Un autre serveur",
  address: "Adresse",
  name: "Nom",
  optional: "Facultatif",
  open: "Ouvrir",
  remove: "Retirer",
  tryAgain: "Réessayer",
  cantReach: (origin) => `Impossible de joindre ${origin}.`,
  startThisComputer: (reason) =>
    `${reason} S’il s’agit du serveur de cet ordinateur, démarrez-le avec draft-loop-server up, puis réessayez.`,
  checkAddress: (reason) => `${reason} Vérifiez l’adresse et votre connexion, puis réessayez.`,
  confirmRemove: (name) =>
    `Retirer ${name} ? Sa connexion et ses pages enregistrées sont effacées de cet ordinateur.`,
  reasons: {
    "Enter the server's address.": "Saisissez l’adresse du serveur.",
    "That is not a web address.": "Ce n’est pas une adresse web.",
    "The address must start with https://.": "L’adresse doit commencer par https://.",
    "Use https:// for a server on another computer.":
      "Utilisez https:// pour un serveur sur un autre ordinateur.",
    "Leave the user name and password out of the address.":
      "N’indiquez ni nom d’utilisateur ni mot de passe dans l’adresse.",
    "Give the server's address without a path.": "Donnez l’adresse du serveur sans chemin.",
    "This does not look like a DraftLoop server.": "Cela ne ressemble pas à un serveur DraftLoop.",
    "The server did not answer in time.": "Le serveur n’a pas répondu à temps.",
    "The server cannot be reached.": "Le serveur est injoignable.",
  },
  serverAnswered: (status) => `Le serveur a répondu ${status}.`,
};

export const shellText: Readonly<Record<ShellLanguage, ShellText>> = { en: english, fr: french };

/** A reason the checks wrote in English, in the shell's language when it has the words. */
export function shellReason(reason: string, language: ShellLanguage): string {
  const text = shellText[language];
  const known = text.reasons[reason];
  if (known !== undefined) return known;
  const answered = /^The server answered (\d{3})\.$/u.exec(reason);
  if (answered?.[1] !== undefined) return text.serverAnswered(answered[1]);
  const notLoaded = /^The page did not load \((.*)\)\.$/u.exec(reason);
  if (notLoaded?.[1] !== undefined) return text.pageDidNotLoad(notLoaded[1]);
  return reason;
}
