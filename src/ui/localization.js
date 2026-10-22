import { messageSource, normalizeLocale, translate } from '../core/i18n.js';

// These regions contain user material or values owned by dynamic presenters.
const CONTENT =
  'script,style,svg,textarea,input,.brand-subtitle,[data-language],#dance-canvas,#knowledge-stage,#knowledge-accessible,#topic-title,#topic-list,#playlist,#effect-options,#source-label,#line-counter,#reading-hint,#audio-state,#beat-state,#toast,#script-error,#characters-value,#intensity-value,#ghost-frequency-value,#play-caption,#welcome-play-label';

/** Capture only known static messages, never whole HTML or user-entered values. */
export function createLocalization(documentRef) {
  const bindings = [];
  const texts = new WeakSet();
  const attributes = new WeakMap();
  let language = 'zh';
  function collect() {
    if (!documentRef?.body || typeof documentRef.createTreeWalker !== 'function') return;
    for (let index = bindings.length - 1; index >= 0; index--)
      if (bindings[index].retired || bindings[index].node.isConnected === false) bindings.splice(index, 1);
    const walker = documentRef.createTreeWalker(documentRef.body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (texts.has(node) || node.parentElement?.closest(CONTENT)) continue;
      const original = node.nodeValue;
      const source = messageSource(original.trim().replace(/\s+/g, ' '));
      if (!source) continue;
      texts.add(node);
      bindings.push({ node, source, leading: /^\s*/.exec(original)[0], trailing: /\s*$/.exec(original)[0] });
    }
    documentRef.querySelectorAll('[aria-label],[title],[placeholder]').forEach((node) => {
      if (node.closest('svg,#dance-canvas,#source-label,[data-language]')) return;
      const known = attributes.get(node) ?? new Map();
      attributes.set(node, known);
      for (const attribute of ['aria-label', 'title', 'placeholder']) {
        const current = node.getAttribute(attribute) ?? '';
        const previous = known.get(attribute);
        if (previous && current === previous.rendered) continue;
        const source = messageSource(current);
        if (previous) {
          // Follow a capability presenter's new guidance instead of restoring
          // an old title when its source message changes after initial boot.
          if (source) previous.source = source;
          else {
            previous.retired = true;
            known.delete(attribute);
          }
          continue;
        }
        if (!source) continue;
        const binding = { node, source, attribute };
        known.set(attribute, binding);
        bindings.push(binding);
      }
    });
  }
  return {
    apply(locale) {
      language = normalizeLocale(locale);
      collect();
      for (const binding of bindings) {
        if (binding.retired) continue;
        const text = translate(language, binding.source);
        if (binding.attribute) {
          binding.node.setAttribute(binding.attribute, text);
          binding.rendered = text;
        } else binding.node.nodeValue = binding.leading + text + binding.trailing;
      }
      if (documentRef.documentElement) documentRef.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
      documentRef.title = translate(language, 'Words Actually Dance · 字真的在跳动');
      const subtitle = documentRef.querySelector?.('.brand-subtitle');
      if (subtitle) subtitle.textContent = language === 'en' ? 'Knowledge in rhythm' : 'Words Actually Dance';
      documentRef.querySelectorAll?.('[data-language]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.language === language));
      });
      return language;
    },
    get language() {
      return language;
    },
    destroy() {
      bindings.length = 0;
    },
  };
}

export function musicFileImportAllowed(documentRef) {
  const flags = documentRef?.documentElement?.dataset;
  return flags?.webMusicImport !== 'off' && flags?.webPublic !== 'true';
}

export function applyMusicImportPolicy(documentRef) {
  const allowed = musicFileImportAllowed(documentRef);
  for (const id of ['import-audio-button', 'audio-input']) {
    const element = documentRef?.getElementById(id);
    if (!element || allowed) continue;
    element.hidden = true;
    element.disabled = true;
    element.setAttribute('aria-disabled', 'true');
  }
  return allowed;
}
