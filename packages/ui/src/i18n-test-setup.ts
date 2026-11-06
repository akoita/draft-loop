// The repository's Vitest setup (#2321): the shared screens read their English catalog, as they
// do once a host has rendered them inside `ScreensI18nProvider`.
import { activateScreenLocale } from "./i18n.js";

activateScreenLocale("en");
