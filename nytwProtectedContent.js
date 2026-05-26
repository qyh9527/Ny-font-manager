// Markdown tables rely on browser table layout and the stable HTML structure
// emitted by the Markdown renderer. Character-level locale/stream/typewriter
// spans can destabilize columns, so table internals are protected structured
// content along with script/style/code-like regions.
export const NYTW_PROTECTED_CONTENT_SELECTOR = 'style, script, textarea, pre, code, table, thead, tbody, tfoot, tr, th, td, caption';

export function isWithinNytwProtectedContent(el) {
    return Boolean(el?.closest?.(NYTW_PROTECTED_CONTENT_SELECTOR));
}

export function isNytwProtectedContentElement(el) {
    return Boolean(el?.matches?.(NYTW_PROTECTED_CONTENT_SELECTOR));
}
