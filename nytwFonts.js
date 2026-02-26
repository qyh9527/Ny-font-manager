﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import { settings } from './nytwState.js';
import { LOCALE_UI_ORDER, UNICODE_RANGES } from './nytwLocaleData.js';

const FONT_STYLE_ID = 'nytw-font-style';
const EXTERNAL_FONT_LINK_ATTR = 'data-nytw-font-css';
const EXTERNAL_FONT_LINK_STATUS_ATTR = 'data-nytw-font-css-status';
const FONT_DB_NAME = 'nytw-fonts';
const FONT_DB_VERSION = 1;
const FONT_STORE_NAME = 'fonts';
const FONT_API_LOAD_TIMEOUT_MS = 5000;
const EXTERNAL_CSS_LOAD_TIMEOUT_MS = 10000;
const FONT_FAMILY_CHECK_TIMEOUT_MS = 4000;
const FONT_MEASURE_SAMPLE_TEXTS = ['NyTW_Font_Check_12345', '汉字測試', 'かなカナ', '한글테스트'];

let fontDbPromise = null;
function openFontDb() {
    if (fontDbPromise) return fontDbPromise;

    fontDbPromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error('indexedDB is not available'));
            return;
        }

        const req = globalThis.indexedDB.open(FONT_DB_NAME, FONT_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(FONT_STORE_NAME)) {
                db.createObjectStore(FONT_STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open font DB'));
    });

    return fontDbPromise;
}

function runIdbTransaction(db, mode, action) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FONT_STORE_NAME, mode);
        const store = tx.objectStore(FONT_STORE_NAME);

        /** @type {IDBRequest|undefined} */
        let request;
        try {
            request = action(store);
        } catch (error) {
            reject(error);
            return;
        }

        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        if (request) {
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        }
    });
}

async function putFontBlob(fontId, blob) {
    const db = await openFontDb();
    await runIdbTransaction(db, 'readwrite', (store) => store.put({ id: fontId, blob }));
}

async function getFontBlob(fontId) {
    const db = await openFontDb();
    const record = await runIdbTransaction(db, 'readonly', (store) => store.get(fontId));
    return record?.blob || null;
}

async function deleteFontBlob(fontId) {
    const db = await openFontDb();
    await runIdbTransaction(db, 'readwrite', (store) => store.delete(fontId));
}

function cssQuote(value) {
    return JSON.stringify(String(value ?? ''));
}

function parseFontFamilyList(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];

    const result = [];
    let buf = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '"' && !inSingle) inDouble = !inDouble;
        if (ch === '\'' && !inDouble) inSingle = !inSingle;

        if (ch === ',' && !inSingle && !inDouble) {
            const token = buf.trim();
            if (token) result.push(token);
            buf = '';
            continue;
        }
        buf += ch;
    }
    const last = buf.trim();
    if (last) result.push(last);

    return result
        .map(s => s.trim())
        .map(s => unwrapFontFamilyLabel(s))
        .filter(Boolean);
}

function inferFontFormatFromFileName(fileName) {
    const name = String(fileName || '').toLowerCase();
    if (name.endsWith('.woff2')) return 'woff2';
    if (name.endsWith('.woff')) return 'woff';
    if (name.endsWith('.otf')) return 'opentype';
    if (name.endsWith('.otc')) return 'opentype';
    if (name.endsWith('.ttc')) return 'truetype-collection';
    if (name.endsWith('.tff')) return 'truetype'; // tolerate common typo extension
    if (name.endsWith('.ttf')) return 'truetype';
    return '';
}

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const value = n / (1024 ** idx);
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function normalizeFontFamily(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function uniqueFontFamily(desiredFamily) {
    const base = normalizeFontFamily(desiredFamily) || '导入字体';
    const existing = new Set(settings.importedFonts.map(f => String(f?.family || '').trim()));
    if (!existing.has(base)) return base;

    for (let i = 2; i < 1000; i++) {
        const candidate = `${base} (${i})`;
        if (!existing.has(candidate)) return candidate;
    }
    return `${base} (${Date.now()})`;
}

const FONT_FAMILY_DISPLAY_NAME_MAP = new Map([
    // Generic families
    ['serif', '衬线'],
    ['sans-serif', '无衬线'],
    ['monospace', '等宽'],
    ['cursive', '手写'],
    ['fantasy', '装饰'],
    ['system-ui', '系统默认'],
    ['ui-serif', 'UI 衬线'],
    ['ui-sans-serif', 'UI 无衬线'],
    ['ui-monospace', 'UI 等宽'],

    // Common Chinese system fonts
    ['Microsoft YaHei', '微软雅黑'],
    ['SimSun', '宋体'],
    ['SimHei', '黑体'],
    ['KaiTi', '楷体'],
    ['FangSong', '仿宋'],
    ['PingFang SC', '苹方'],

    // CJK families (commonly seen)
    ['Noto Sans CJK SC', '思源黑体'],
    ['Source Han Sans SC', '思源黑体'],
    ['Noto Sans SC', '思源黑体'],
    ['Source Han Serif SC', '思源宋体'],
    ['Noto Serif SC', '思源宋体'],

    // Google Fonts (popular Chinese fonts)
    ['ZCOOL KuaiLe', '站酷快乐体'],
    ['ZCOOL XiaoWei', '站酷小薇体'],
    ['ZCOOL QingKe HuangYou', '站酷庆科黄油体'],
    ['Zhi Mang Xing', '志莽行书'],
    ['Ma Shan Zheng', '马善政'],
    ['Long Cang', '龙藏体'],
    ['Liu Jian Mao Cao', '刘建毛草'],
    ['Silkscreen', '像素 (Silkscreen)'],
    ['Press Start 2P', '像素 (Press Start 2P)'],
    ['DotGothic16', '像素 (DotGothic16)'],
    ['Gaegu', '可爱手写 (Gaegu)'],
    ['Gamja Flower', '可爱花朵 (Gamja Flower)'],
    ['Single Day', '可爱单日 (Single Day)'],
    ['Tiejili SC', '铁蒺藜体'],
    ['BoutiqueBitmap9x9', '精品点阵体9x9'],
    ['Mea Culpa', 'Mea Culpa'],
]);

const FONT_GROUP_MAP = {
    'serif': 'generic',
    'sans-serif': 'generic',
    'monospace': 'generic',
    'cursive': 'generic',
    'fantasy': 'generic',
    'system-ui': 'generic',
    'ui-serif': 'generic',
    'ui-sans-serif': 'generic',
    'ui-monospace': 'generic',

    'Microsoft YaHei': 'chinese',
    'SimSun': 'chinese',
    'SimHei': 'chinese',
    'KaiTi': 'chinese',
    'FangSong': 'chinese',
    'PingFang SC': 'chinese',
    'Noto Sans CJK SC': 'chinese',
    'Source Han Sans SC': 'chinese',
    'Source Han Serif SC': 'chinese',
    'Noto Sans SC': 'chinese',
    'Noto Serif SC': 'chinese',

    'ZCOOL KuaiLe': 'chinese',
    'ZCOOL XiaoWei': 'chinese',
    'ZCOOL QingKe HuangYou': 'chinese',
    'Zhi Mang Xing': 'chinese',
    'Ma Shan Zheng': 'chinese',
    'Long Cang': 'chinese',
    'Liu Jian Mao Cao': 'chinese',
    'Tiejili SC': 'chinese',
    'BoutiqueBitmap9x9': 'chinese',

    'Silkscreen': 'english',
    'Press Start 2P': 'english',
    'DotGothic16': 'english',
    'Gaegu': 'english',
    'Gamja Flower': 'english',
    'Single Day': 'english',
    'Mea Culpa': 'english',
};

const FONT_GROUP_LABELS = {
    'generic': '通用 (System)',
    'chinese': '中文字体 (Chinese)',
    'english': '英文/其他 (English/Other)',
    'imported': '导入字体 (Imported)',
};

const FONT_GROUP_ORDER = ['generic', 'chinese', 'english', 'imported'];
const GENERIC_FONT_FAMILIES = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'emoji',
    'math',
]);

function getFontFamilyDisplayLabel(family) {
    const raw = String(family || '').trim();
    if (!raw) return '';

    const direct = FONT_FAMILY_DISPLAY_NAME_MAP.get(raw);
    if (direct) return `${direct}（${raw}）`;

    const lower = raw.toLowerCase();
    const lowerDisplay = FONT_FAMILY_DISPLAY_NAME_MAP.get(lower);
    if (lowerDisplay) return `${lowerDisplay}（${raw}）`;

    return raw;
}

function unwrapFontFamilyLabel(token) {
    const stripped = String(token || '').trim().replace(/^["']|["']$/g, '');
    if (!stripped) return '';

    // Only unwrap known UI labels generated as: <displayLabel>（<rawFamily>）
    const match = stripped.match(/^(.+)（([^（）]+)）$/);
    if (!match) return stripped;

    const displayLabel = String(match[1] || '').trim();
    const candidate = String(match[2] || '').trim();
    if (!candidate) return stripped;

    const expectedDisplay = FONT_FAMILY_DISPLAY_NAME_MAP.get(candidate)
        || FONT_FAMILY_DISPLAY_NAME_MAP.get(candidate.toLowerCase());

    if (expectedDisplay && displayLabel === expectedDisplay) {
        return candidate;
    }

    return stripped;
}

function formatCssFontFamilyToken(token) {
    const family = String(token || '').trim();
    if (!family) return '';

    const lower = family.toLowerCase();
    if (GENERIC_FONT_FAMILIES.has(lower)) return lower;

    // Safe unquoted identifier list (e.g. "Times New Roman", "Microsoft YaHei")
    if (/^-?[A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z0-9_-]+)*$/.test(family)) {
        return family;
    }

    // Quote complex names (e.g. CJK names, names with punctuation like "(1)", dots, etc.)
    return cssQuote(family);
}

function toCssFontFamilyValue(value) {
    return parseFontFamilyList(value)
        .map(formatCssFontFamilyToken)
        .filter(Boolean)
        .join(', ');
}

function getImportedFontKind(font) {
    return font?.kind === 'css' ? 'css' : 'file';
}

function createFontId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `nytw_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeExternalStylesheetUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const candidate = raw.startsWith('//') ? `https:${raw}` : raw;

    try {
        const url = new URL(candidate);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function inferFamiliesFromGoogleFontsCssUrl(cssUrl) {
    const normalized = normalizeExternalStylesheetUrl(cssUrl);
    if (!normalized) return [];

    try {
        const url = new URL(normalized);
        if (!url.hostname.endsWith('fonts.googleapis.com')) return [];
        const families = url.searchParams
            .getAll('family')
            .flatMap(v => String(v || '').split('|'))
            .map(v => String(v || '').split(':')[0])
            .map(normalizeFontFamily)
            .filter(Boolean);
        return Array.from(new Set(families));
    } catch {
        return [];
    }
}

function extractFontFamiliesFromCssText(cssText) {
    const text = String(cssText || '');
    if (!text) return [];

    const families = new Set();

    const fontFaceBlocks = text.match(/@font-face\s*{[^}]*}/gi) || [];
    const scanTargets = fontFaceBlocks.length ? fontFaceBlocks : [text];

    for (const block of scanTargets) {
        const rx = /font-family\s*:\s*(?:(["'])(.*?)\1|([^;"'}]+))\s*;/gi;
        let match;
        while ((match = rx.exec(block))) {
            const family = match[2] || match[3] || '';
            const normalized = normalizeFontFamily(family);
            if (normalized) families.add(normalized);
            if (families.size >= 20) break;
        }
        if (families.size >= 20) break;
    }

    return Array.from(families);
}

function collectExternalFontCssUrlsForFamilies(families) {
    const requiredFamilies = new Set(
        (families || [])
            .map((name) => normalizeFamilyKey(name))
            .filter(Boolean),
    );

    const urls = new Set();
    for (const font of settings.importedFonts) {
        if (getImportedFontKind(font) !== 'css') continue;
        const familyKey = normalizeFamilyKey(font?.family);
        if (!familyKey || !requiredFamilies.has(familyKey)) continue;
        const href = normalizeExternalStylesheetUrl(font?.cssUrl);
        if (href) urls.add(href);
    }
    return urls;
}

const externalStylesheetPromises = new Map(); // href -> Promise<{ ok, reason }>

function ensureExternalStylesheetLoadPromise(link, href) {
    if (!(link instanceof HTMLLinkElement) || !href) {
        return Promise.resolve({ ok: false, reason: '无效的样式链接节点。' });
    }

    const cached = externalStylesheetPromises.get(href);
    if (cached) return cached;

    if (link.getAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR) === 'loaded') {
        return Promise.resolve({ ok: true, reason: '' });
    }

    // Existing links injected before this version may not have status attr.
    // If the stylesheet is already attached, treat it as loaded.
    try {
        if (link.sheet) {
            link.setAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR, 'loaded');
            return Promise.resolve({ ok: true, reason: '' });
        }
    } catch { /* ignore cross-origin/style access edge cases */ }

    if (link.getAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR) === 'error') {
        return Promise.resolve({ ok: false, reason: '字体 CSS 链接加载失败（网络或跨域策略限制）。' });
    }

    const promise = new Promise((resolve) => {
        let settled = false;
        /** @type {ReturnType<typeof setTimeout>|null} */
        let timer = null;

        const cleanup = () => {
            link.removeEventListener('load', onLoad);
            link.removeEventListener('error', onError);
            if (timer) clearTimeout(timer);
            externalStylesheetPromises.delete(href);
        };

        const done = (ok, reason) => {
            if (settled) return;
            settled = true;
            cleanup();
            link.setAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR, ok ? 'loaded' : 'error');
            resolve({ ok, reason: String(reason || '') });
        };

        const onLoad = () => done(true, '');
        const onError = () => done(false, '字体 CSS 链接加载失败（网络或跨域策略限制）。');

        link.addEventListener('load', onLoad, { once: true });
        link.addEventListener('error', onError, { once: true });

        timer = setTimeout(() => {
            done(false, `字体 CSS 链接加载超时（${EXTERNAL_CSS_LOAD_TIMEOUT_MS}ms）。`);
        }, EXTERNAL_CSS_LOAD_TIMEOUT_MS);
    });

    externalStylesheetPromises.set(href, promise);
    return promise;
}

function syncExternalFontStylesheets(requiredUrls) {
    const required = new Set();
    for (const url of requiredUrls || []) {
        const href = normalizeExternalStylesheetUrl(url);
        if (href) required.add(href);
    }

    const existingLinks = Array.from(document.querySelectorAll(`link[${EXTERNAL_FONT_LINK_ATTR}]`))
        .filter(el => el instanceof HTMLLinkElement);

    const existingByHref = new Map();
    for (const link of existingLinks) {
        const href = normalizeExternalStylesheetUrl(link.getAttribute('href') || link.href);
        if (!href) {
            link.remove();
            continue;
        }

        if (existingByHref.has(href)) {
            link.remove();
            continue;
        }

        if (!link.getAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR)) {
            try {
                link.setAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR, link.sheet ? 'loaded' : 'loading');
            } catch {
                link.setAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR, 'loading');
            }
        }

        existingByHref.set(href, link);
    }

    for (const [href, link] of existingByHref.entries()) {
        if (!required.has(href)) {
            link.remove();
            externalStylesheetPromises.delete(href);
        }
    }

    for (const href of required) {
        if (existingByHref.has(href)) {
            continue;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute(EXTERNAL_FONT_LINK_ATTR, '1');
        link.setAttribute(EXTERNAL_FONT_LINK_STATUS_ATTR, 'loading');
        link.crossOrigin = 'anonymous';
        link.referrerPolicy = 'no-referrer';
        document.head.appendChild(link);
    }
}

async function ensureExternalFontStylesheetsReady(requiredUrls) {
    const normalizedRequired = new Set();
    for (const url of requiredUrls || []) {
        const href = normalizeExternalStylesheetUrl(url);
        if (href) normalizedRequired.add(href);
    }
    if (!normalizedRequired.size) return new Map();

    /** @type {Map<string, { ok: boolean, reason: string }>} */
    const results = new Map();
    const links = Array.from(document.querySelectorAll(`link[${EXTERNAL_FONT_LINK_ATTR}]`))
        .filter((el) => el instanceof HTMLLinkElement);

    const byHref = new Map();
    for (const link of links) {
        const href = normalizeExternalStylesheetUrl(link.getAttribute('href') || link.href);
        if (!href || !normalizedRequired.has(href) || byHref.has(href)) continue;
        byHref.set(href, link);
    }

    for (const href of normalizedRequired) {
        const link = byHref.get(href);
        if (!(link instanceof HTMLLinkElement)) {
            results.set(href, { ok: false, reason: '字体 CSS 链接未注入到页面。' });
            continue;
        }
        const result = await ensureExternalStylesheetLoadPromise(link, href);
        results.set(href, result);
    }

    return results;
}

function ensureFontStyleElement() {
    let el = document.getElementById(FONT_STYLE_ID);
    if (el && el instanceof HTMLStyleElement) return el;
    el = document.createElement('style');
    el.id = FONT_STYLE_ID;
    document.head.appendChild(el);
    return el;
}

const fontApiFaces = new Map(); // id -> { family, face }
const importedFontIssues = new Map(); // id -> reason

function normalizeFamilyKey(value) {
    return String(value || '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function normalizeFamilyFuzzyKey(value) {
    return normalizeFamilyKey(value)
        .replace(/[\s"'`‘’“”.,_+\-\/\\()[\]{}:;!?]/g, '');
}

function getAutoMatchFamilyCandidates() {
    const values = new Set();
    const add = (value) => {
        const raw = String(value || '').trim().replace(/^["']|["']$/g, '');
        if (!raw) return;
        values.add(raw);
    };

    for (const family of buildSuggestedFontFamilies()) {
        add(family);
    }

    for (const font of settings.importedFonts || []) {
        add(font?.family);
    }

    for (const item of fontApiFaces.values()) {
        add(item?.family);
    }

    if (document?.fonts && typeof document.fonts.values === 'function') {
        try {
            for (const face of document.fonts.values()) {
                add(face?.family);
            }
        } catch { /* ignore */ }
    }

    return Array.from(values);
}

function getFamilyAliasScore(inputFamily, candidateFamily) {
    const inputKey = normalizeFamilyKey(inputFamily);
    const candidateKey = normalizeFamilyKey(candidateFamily);
    if (!inputKey || !candidateKey) return 0;
    if (inputKey === candidateKey) return 100;

    const inputFuzzy = normalizeFamilyFuzzyKey(inputKey);
    const candidateFuzzy = normalizeFamilyFuzzyKey(candidateKey);
    if (inputFuzzy && inputFuzzy === candidateFuzzy) return 95;

    if (inputKey.length >= 4 && (candidateKey.includes(inputKey) || inputKey.includes(candidateKey))) {
        return 86;
    }

    if (inputFuzzy.length >= 4 && (candidateFuzzy.includes(inputFuzzy) || inputFuzzy.includes(candidateFuzzy))) {
        return 84;
    }

    const inputWords = inputKey.split(/\s+/).filter(Boolean);
    const candidateWords = new Set(candidateKey.split(/\s+/).filter(Boolean));
    const overlap = inputWords.filter((word) => candidateWords.has(word)).length;
    if (overlap >= 2) return 80;

    return 0;
}

async function guessUsableFamilyByAlias(inputFamily) {
    const raw = String(inputFamily || '').trim();
    if (!raw) {
        return { ok: false, family: '', reason: '字体名称为空。' };
    }

    const inputKey = normalizeFamilyKey(raw);
    const ranked = getAutoMatchFamilyCandidates()
        .map((family) => ({ family, score: getFamilyAliasScore(raw, family) }))
        .filter((item) => item.score >= 80)
        .filter((item) => normalizeFamilyKey(item.family) !== inputKey)
        .sort((a, b) => b.score - a.score || a.family.length - b.family.length)
        .slice(0, 12);

    for (const item of ranked) {
        const availability = await ensureFontFamilyUsable(item.family);
        if (availability.ok) {
            return { ok: true, family: item.family, reason: '' };
        }
    }

    return { ok: false, family: '', reason: '未找到可自动匹配的真实字体 family 名。' };
}

function findImportedFontByFamily(family) {
    const key = normalizeFamilyKey(family);
    if (!key) return null;
    return settings.importedFonts.find((font) => normalizeFamilyKey(font?.family) === key) || null;
}

function setImportedFontIssue(fontId, reason) {
    if (!fontId) return;
    const text = String(reason || '').trim();
    if (!text) {
        importedFontIssues.delete(fontId);
        return;
    }
    importedFontIssues.set(fontId, text);
}

let measureCtx = null;
function getMeasureCtx() {
    if (measureCtx) return measureCtx;
    try {
        const canvas = document.createElement('canvas');
        measureCtx = canvas.getContext('2d');
    } catch {
        measureCtx = null;
    }
    return measureCtx;
}

function measureTextWidth(text, fontFamily) {
    const ctx = getMeasureCtx();
    if (!ctx) return NaN;
    ctx.font = `72px ${fontFamily}`;
    return ctx.measureText(String(text || '')).width;
}

function isFamilyDifferentFromFallbacks(family) {
    const token = formatCssFontFamilyToken(family);
    if (!token) return false;

    // Generic families are always available by definition.
    if (GENERIC_FONT_FAMILIES.has(String(family || '').trim().toLowerCase())) {
        return true;
    }

    const fallbackBases = ['monospace', 'serif', 'sans-serif'];
    for (const sample of FONT_MEASURE_SAMPLE_TEXTS) {
        for (const base of fallbackBases) {
            const baseWidth = measureTextWidth(sample, base);
            const candidateWidth = measureTextWidth(sample, `${token}, ${base}`);
            if (!Number.isFinite(baseWidth) || !Number.isFinite(candidateWidth)) continue;
            if (Math.abs(candidateWidth - baseWidth) > 0.02) {
                return true;
            }
        }
    }

    return false;
}

function hasLoadedFaceInDocumentFonts(family) {
    if (!document?.fonts) return false;
    const target = normalizeFamilyKey(String(family || '').replace(/^["']|["']$/g, ''));
    if (!target) return false;

    try {
        for (const face of document.fonts.values()) {
            const faceFamily = normalizeFamilyKey(String(face?.family || '').replace(/^["']|["']$/g, ''));
            if (faceFamily === target && String(face?.status || '') === 'loaded') {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
}

function removeFontApiFace(fontId) {
    const existing = fontApiFaces.get(fontId);
    if (!existing) return;

    try {
        if (document?.fonts && typeof document.fonts.delete === 'function') {
            document.fonts.delete(existing.face);
        }
    } catch { /* no-op */ }

    fontApiFaces.delete(fontId);
}

async function waitForFontFamilyReady(family) {
    const token = formatCssFontFamilyToken(family);
    if (!token) return { ok: false, reason: '字体名称无效。' };
    if (!document?.fonts || typeof document.fonts.load !== 'function') {
        return { ok: false, reason: '浏览器不支持 document.fonts API，无法验证字体是否加载。' };
    }

    /** @type {ReturnType<typeof setTimeout>|null} */
    let loadTimeout = null;
    try {
        await Promise.race([
            document.fonts.load(`16px ${token}`, 'NyTW字aあ한'),
            new Promise((_, reject) => {
                loadTimeout = setTimeout(() => {
                    reject(new Error(`字体可用性检测超时（${FONT_FAMILY_CHECK_TIMEOUT_MS}ms）`));
                }, FONT_FAMILY_CHECK_TIMEOUT_MS);
            }),
        ]);
    } catch (error) {
        return { ok: false, reason: `字体资源加载失败：${error?.message || error}` };
    } finally {
        if (loadTimeout) clearTimeout(loadTimeout);
    }

    if (typeof document.fonts.check === 'function') {
        const checkOk = document.fonts.check(`16px ${token}`, 'NyTW字aあ한');
        if (!checkOk) {
            return { ok: false, reason: '浏览器字体检查失败，字体未真正生效。' };
        }
    }

    const metricOk = isFamilyDifferentFromFallbacks(family);
    const loadedFaceOk = hasLoadedFaceInDocumentFonts(family);
    if (!metricOk && !loadedFaceOk) {
        return { ok: false, reason: '检测到浏览器仍在使用回退字体（目标字体未生效）。' };
    }

    return { ok: true, reason: '' };
}

async function ensureFontLoadedViaApi(meta, blob) {
    if (!meta?.id || !meta?.family || !blob) {
        return { ok: false, reason: '字体元数据不完整。' };
    }
    if (typeof FontFace !== 'function') {
        return { ok: false, reason: '浏览器不支持 FontFace API，无法加载本地字体。' };
    }
    if (!document?.fonts || typeof document.fonts.add !== 'function') {
        return { ok: false, reason: '浏览器不支持 document.fonts.add，无法注册本地字体。' };
    }

    const family = String(meta.family || '').trim();
    if (!family) return { ok: false, reason: '字体名称为空。' };

    const existing = fontApiFaces.get(meta.id);
    if (existing?.family === family) {
        const ready = await waitForFontFamilyReady(family);
        if (ready.ok) return ready;
    }
    if (existing) removeFontApiFace(meta.id);

    /** @type {ReturnType<typeof setTimeout>|null} */
    let loadTimeout = null;

    try {
        const buffer = typeof blob.arrayBuffer === 'function'
            ? await blob.arrayBuffer()
            : await new Response(blob).arrayBuffer();
        if (!buffer?.byteLength) {
            return { ok: false, reason: '字体文件为空或读取失败。' };
        }

        const face = new FontFace(family, buffer, { display: 'swap' });
        await Promise.race([
            face.load(),
            new Promise((_, reject) => {
                loadTimeout = setTimeout(() => {
                    reject(new Error(`FontFace 加载超时（${FONT_API_LOAD_TIMEOUT_MS}ms）`));
                }, FONT_API_LOAD_TIMEOUT_MS);
            }),
        ]);

        document.fonts.add(face);
        fontApiFaces.set(meta.id, { family, face });
        const ready = await waitForFontFamilyReady(family);
        if (!ready.ok) {
            removeFontApiFace(meta.id);
            return ready;
        }
        return ready;
    } catch (error) {
        return { ok: false, reason: `本地字体加载失败：${error?.message || error}` };
    } finally {
        if (loadTimeout) {
            clearTimeout(loadTimeout);
        }
    }
}

function revokeAllFontObjectUrls() {
    importedFontIssues.clear();

    for (const id of Array.from(fontApiFaces.keys())) {
        removeFontApiFace(id);
    }
}

async function buildFontFaceCssForFamilies(families) {
    const requiredFamilies = new Set(
        (families || [])
            .map((name) => String(name || '').trim())
            .filter(Boolean),
    );

    const metas = settings.importedFonts.filter((font) => {
        if (getImportedFontKind(font) !== 'file') return false;
        const family = String(font?.family || '').trim();
        if (!family) return false;
        return requiredFamilies.size > 0 && requiredFamilies.has(family);
    });

    const requiredIds = new Set(metas.map((font) => font.id));

    const existingImportedIds = new Set(settings.importedFonts.map((font) => font?.id).filter(Boolean));
    for (const id of Array.from(importedFontIssues.keys())) {
        if (!existingImportedIds.has(id)) {
            importedFontIssues.delete(id);
        }
    }

    for (const id of Array.from(fontApiFaces.keys())) {
        if (!requiredIds.has(id)) {
            removeFontApiFace(id);
        }
    }

    for (const meta of metas) {
        if (!meta?.id || !meta?.family) continue;

        const blob = await getFontBlob(meta.id);
        if (!blob) {
            setImportedFontIssue(meta.id, '字体文件未找到，可能已被浏览器清理。请重新导入。');
            continue;
        }

        const result = await ensureFontLoadedViaApi(meta, blob);
        if (!result.ok) {
            setImportedFontIssue(meta.id, result.reason || '未知错误');
            console.warn('[NyTW] Imported file font is not usable', meta.fileName || meta.id, result.reason);
            continue;
        }

        setImportedFontIssue(meta.id, '');
    }

    // 本地文件字体仅通过 FontFace API 注入，不再输出 @font-face CSS 兜底。
    return '';
}

async function ensureFontFamilyUsable(family) {
    const normalized = String(family || '').trim();
    if (!normalized) return { ok: false, reason: '字体名称为空。' };

    const lower = normalized.toLowerCase();
    if (GENERIC_FONT_FAMILIES.has(lower)) return { ok: true, reason: '' };

    const imported = findImportedFontByFamily(normalized);
    if (imported && getImportedFontKind(imported) === 'file') {
        const blob = await getFontBlob(imported.id);
        if (!blob) {
            const reason = '字体文件未找到，可能已被浏览器清理。请重新导入。';
            setImportedFontIssue(imported.id, reason);
            return { ok: false, reason };
        }

        const loaded = await ensureFontLoadedViaApi(imported, blob);
        if (!loaded.ok) {
            setImportedFontIssue(imported.id, loaded.reason || '未知错误');
            return loaded;
        }
        setImportedFontIssue(imported.id, '');
        return loaded;
    }

    if (imported && getImportedFontKind(imported) === 'css') {
        const href = normalizeExternalStylesheetUrl(imported.cssUrl);
        if (!href) {
            const reason = '字体 CSS 链接无效。';
            setImportedFontIssue(imported.id, reason);
            return { ok: false, reason };
        }
        syncExternalFontStylesheets([href]);
        const readiness = await ensureExternalFontStylesheetsReady([href]);
        const linkState = readiness.get(href);
        if (!linkState?.ok) {
            const reason = linkState?.reason || '字体 CSS 链接加载失败。';
            setImportedFontIssue(imported.id, reason);
            return { ok: false, reason };
        }
    }

    const ready = await waitForFontFamilyReady(normalized);
    if (imported?.id) {
        setImportedFontIssue(imported.id, ready.ok ? '' : ready.reason);
    }
    if (!ready.ok && !imported) {
        return { ok: false, reason: `字体不可用：${ready.reason || '系统未安装该字体。'}` };
    }
    return ready;
}

function getFontIssueReasonForFamily(family) {
    const imported = findImportedFontByFamily(family);
    if (!imported?.id) return '';
    return importedFontIssues.get(imported.id) || '';
}

function buildSuggestedFontFamilies() {
    return [
        'serif',
        'sans-serif',
        'monospace',
        'cursive',
        'fantasy',
        'system-ui',
        'ui-serif',
        'ui-sans-serif',
        'ui-monospace',
        'Microsoft YaHei',
        'SimSun',
        'SimHei',
        'KaiTi',
        'FangSong',
        'PingFang SC',
        'Noto Sans CJK SC',
        'Source Han Sans SC',
        'Source Han Serif SC',
    ];
}

function getAvailableFontOptions() {
    const options = [];
    // Generic & System
    const suggested = buildSuggestedFontFamilies();
    for (const raw of suggested) {
        let group = FONT_GROUP_MAP[raw];
        if (!group) group = 'english'; // Default fallback

        options.push({
            value: getFontFamilyDisplayLabel(raw) || raw,
            family: raw,
            type: 'system',
            group: group,
            sortKey: FONT_GROUP_ORDER.indexOf(group),
        });
    }
    // Imported
    for (const f of settings.importedFonts) {
        const family = String(f?.family || '').trim();
        if (family) {
            options.push({
                value: getFontFamilyDisplayLabel(family) || family,
                family,
                type: 'imported',
                meta: getImportedFontKind(f) === 'css' ? 'Web' : 'File',
                group: 'imported',
                sortKey: FONT_GROUP_ORDER.indexOf('imported'),
            });
        }
    }
    // De-duplicate by value
    const seen = new Set();
    const unique = options.filter(o => {
        if (seen.has(o.value)) return false;
        seen.add(o.value);
        return true;
    });

    // Sort by group
    unique.sort((a, b) => {
        return (a.sortKey - b.sortKey);
    });

    return unique;
}

function renderFontPopupList(popupEl, filterText, onSelect) {
    if (!popupEl) return;
    const options = getAvailableFontOptions();
    const normalizedFilter = String(filterText || '').toLowerCase().trim();

    const filtered = options.filter(o => o.value.toLowerCase().includes(normalizedFilter));

    popupEl.innerHTML = '';

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nytw-font-option';
        empty.style.opacity = '0.5';
        empty.style.justifyContent = 'center';
        empty.textContent = '无匹配字体';
        popupEl.appendChild(empty);
        return;
    }

    let lastGroup = null;

    filtered.forEach(opt => {
        if (opt.group !== lastGroup) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'nytw-font-group-header';
            groupHeader.textContent = FONT_GROUP_LABELS[opt.group] || opt.group;
            popupEl.appendChild(groupHeader);
            lastGroup = opt.group;
        }

        const row = document.createElement('div');
        row.className = 'nytw-font-option';
        row.tabIndex = 0; // Make focusable

        const nameSpan = document.createElement('span');
        nameSpan.textContent = opt.value;
        try {
            // Preview font if possible (might not be loaded yet)
            nameSpan.style.fontFamily = toCssFontFamilyValue(opt.family);
        } catch { /* ignore */ }

        row.appendChild(nameSpan);

        if (opt.meta) {
            const metaSpan = document.createElement('span');
            metaSpan.className = 'nytw-font-option-sub';
            metaSpan.textContent = opt.meta;
            row.appendChild(metaSpan);
        }

        const handleSelect = (e) => {
            e.stopPropagation();
            e.preventDefault();
            onSelect(opt.value);
        };

        row.addEventListener('mousedown', handleSelect); // mousedown fires before blur
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSelect(e);
        });

        popupEl.appendChild(row);
    });
}

function setupPicker(inputEl, popupEl, renderContent, onSave) {
    if (!inputEl || !popupEl) return;

    const hidePopup = () => {
        popupEl.classList.remove('is-open');
    };

    const showPopup = () => {
        const initialFilter = inputEl.readOnly ? '' : inputEl.value;
        renderContent(popupEl, initialFilter, (selectedValue, displayLabel) => {
            inputEl.value = displayLabel || selectedValue;
            onSave(selectedValue);
            hidePopup();
        });
        popupEl.classList.add('is-open');
    };

    inputEl.addEventListener('focus', showPopup);
    inputEl.addEventListener('click', showPopup);

    // If input is editable, filter on type
    if (!inputEl.readOnly) {
        inputEl.addEventListener('input', () => {
            renderContent(popupEl, inputEl.value, (selectedValue, displayLabel) => {
                inputEl.value = displayLabel || selectedValue;
                onSave(selectedValue);
                hidePopup();
            });
            onSave(inputEl.value);
        });
    }

    inputEl.addEventListener('blur', () => {
        setTimeout(hidePopup, 200);
    });
}

function setupFontPicker(inputEl, popupEl, onSave) {
    const updateStyle = () => {
        if (!inputEl) return;
        try {
            const font = toCssFontFamilyValue(inputEl.value);
            inputEl.style.fontFamily = font;
        } catch {
            inputEl.style.fontFamily = '';
        }
    };

    // Initial update
    updateStyle();

    setupPicker(inputEl, popupEl, renderFontPopupList, (val) => {
        onSave(val);
        updateStyle();
    });
}

function renderLocaleOptionsList(popupEl, filterText, onSelect) {
    popupEl.innerHTML = '';
    const normalizedFilter = String(filterText || '').toLowerCase().trim();

    const options = [];
    const keys = new Set(Object.keys(UNICODE_RANGES));

    // Add ordered keys first
    for (const key of LOCALE_UI_ORDER) {
        if (keys.has(key)) {
            options.push({ key, label: UNICODE_RANGES[key].label });
            keys.delete(key);
        }
    }
    // Add remaining keys
    for (const key of keys) {
        options.push({ key, label: UNICODE_RANGES[key].label });
    }

    // Simple filtering
    const filtered = options.filter(o => 
        o.label.toLowerCase().includes(normalizedFilter) || o.key.includes(normalizedFilter)
    );

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nytw-font-option';
        empty.style.opacity = '0.5';
        empty.textContent = '无匹配语言';
        popupEl.appendChild(empty);
        return;
    }

    filtered.forEach(opt => {
        const row = document.createElement('div');
        row.className = 'nytw-font-option';
        row.tabIndex = 0;
        row.textContent = opt.label;
        
        const handleSelect = (e) => {
            e.stopPropagation();
            e.preventDefault();
            onSelect(opt.key, opt.label); // Pass key AND label
        };

        row.addEventListener('mousedown', handleSelect);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSelect(e);
        });

        popupEl.appendChild(row);
    });
}

function setupLocalePicker(inputEl, popupEl, onSave) {
    setupPicker(inputEl, popupEl, renderLocaleOptionsList, onSave);
}


export {
    cssQuote,
    parseFontFamilyList,
    inferFontFormatFromFileName,
    formatBytes,
    normalizeFontFamily,
    uniqueFontFamily,
    getFontFamilyDisplayLabel,
    unwrapFontFamilyLabel,
    toCssFontFamilyValue,
    getImportedFontKind,
    createFontId,
    normalizeExternalStylesheetUrl,
    inferFamiliesFromGoogleFontsCssUrl,
    extractFontFamiliesFromCssText,
    collectExternalFontCssUrlsForFamilies,
    syncExternalFontStylesheets,
    ensureExternalFontStylesheetsReady,
    ensureFontStyleElement,
    revokeAllFontObjectUrls,
    buildFontFaceCssForFamilies,
    ensureFontFamilyUsable,
    guessUsableFamilyByAlias,
    getFontIssueReasonForFamily,
    setupFontPicker,
    setupLocalePicker,
    openFontDb,
    runIdbTransaction,
    putFontBlob,
    getFontBlob,
    deleteFontBlob,
};
