import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Les fichiers de locale sont des JSON copiés tels quels à la compilation ;
// on les lit depuis les sources pour rester valable en dev (tsx) comme en
// production (dist).
const LOCALES_DIR = existsSync(path.join(here, 'locales'))
  ? path.join(here, 'locales')
  : path.resolve(here, '..', '..', 'src', 'i18n', 'locales');

export const DEFAULT_LOCALE = 'fr';

export type Messages = Record<string, unknown>;

export function availableLocales(): string[] {
  try {
    return readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f, '.json'))
      .sort();
  } catch {
    return [DEFAULT_LOCALE];
  }
}

function loadMessages(locale: string): Messages {
  const file = path.join(LOCALES_DIR, `${locale}.json`);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Messages;
}

function lookup(messages: Messages, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as object)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, messages);
  return typeof value === 'string' ? value : undefined;
}

export class Translator {
  private messages: Messages;
  private fallback: Messages;

  constructor(public readonly locale: string) {
    this.messages = loadMessages(locale);
    // Le français est la langue de référence : les autres locales peuvent
    // être incomplètes sans casser l'affichage.
    this.fallback = locale === DEFAULT_LOCALE ? this.messages : loadMessages(DEFAULT_LOCALE);
  }

  /**
   * Traduit une clé, avec interpolation `{nom}`.
   *
   * Une clé manquante est renvoyée telle quelle plutôt que de lever : un
   * défaut de traduction ne doit jamais interrompre un calcul.
   */
  /**
   * Récupère une valeur non textuelle (liste, objet) depuis les locales.
   *
   * Utilisé pour les contenus structurés — listes de priorités par exemple —
   * qui ne doivent pas plus être en dur dans le code que les phrases.
   */
  raw<T>(key: string): T | undefined {
    const get = (m: Messages) =>
      key.split('.').reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object' && part in (acc as object)) {
          return (acc as Record<string, unknown>)[part];
        }
        return undefined;
      }, m);
    return (get(this.messages) ?? get(this.fallback)) as T | undefined;
  }

  t(key: string, params: Record<string, string | number> = {}): string {
    const template = lookup(this.messages, key) ?? lookup(this.fallback, key) ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      name in params ? String(params[name]) : `{${name}}`,
    );
  }
}

/**
 * Traducteur appelable : `t('cle')` traduit, `t.raw('cle')` récupère une
 * valeur structurée, `t.locale` donne la langue effectivement retenue.
 */
export interface TFunction {
  (key: string, params?: Record<string, string | number>): string;
  raw<T>(key: string): T | undefined;
  locale: string;
}

export function createTranslator(locale?: string): TFunction {
  const wanted = (locale ?? process.env.PBA_LOCALE ?? DEFAULT_LOCALE).toLowerCase();
  const available = availableLocales();
  const resolved = available.includes(wanted)
    ? wanted
    : available.includes(wanted.slice(0, 2))
      ? wanted.slice(0, 2)
      : DEFAULT_LOCALE;

  const instance = new Translator(resolved);
  const fn = ((key: string, params?: Record<string, string | number>) =>
    instance.t(key, params)) as TFunction;
  fn.raw = (key: string) => instance.raw(key);
  fn.locale = instance.locale;
  return fn;
}
