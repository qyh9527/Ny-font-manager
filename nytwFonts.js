﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import { settings } from './nytwState.js';
import { LOCALE_UI_ORDER, UNICODE_RANGES } from './nytwLocaleData.js';

const FONT_STYLE_ID = 'nytw-font-style';
const EXTERNAL_FONT_LINK_ATTR = 'data-nytw-font-css';
const FONT_DB_NAME = 'nytw-fonts';
const FONT_DB_VERSION = 1;
const FONT_STORE_NAME = 'fonts';
const FONT_API_LOAD_TIMEOUT_MS = 5000;
const FONT_API_BYPASS_SIZE_BYTES = 8 * 1024 * 1024;

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
    // Load all imported CSS fonts to ensure they are available for preview
    const urls = new Set();
    for (const font of settings.importedFonts) {
        if (getImportedFontKind(font) !== 'css') continue;
        const href = normalizeExternalStylesheetUrl(font?.cssUrl);
        if (href) urls.add(href);
    }
    return urls;
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

        existingByHref.set(href, link);
    }

    for (const [href, link] of existingByHref.entries()) {
        if (!required.has(href)) link.remove();
    }

    for (const href of required) {
        if (existingByHref.has(href)) continue;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute(EXTERNAL_FONT_LINK_ATTR, '1');
        link.crossOrigin = 'anonymous';
        link.referrerPolicy = 'no-referrer';
        document.head.appendChild(link);
    }
}

function ensureFontStyleElement() {
    let el = document.getElementById(FONT_STYLE_ID);
    if (el && el instanceof HTMLStyleElement) return el;
    el = document.createElement('style');
    el.id = FONT_STYLE_ID;
    document.head.appendChild(el);
    return el;
}

const fontObjectUrls = new Map(); // id -> blob URL
const fontApiFaces = new Map(); // id -> { family, face }
const fontApiFailedIds = new Set(); // ids that failed FontFace API and should use CSS fallback

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

async function ensureFontLoadedViaApi(meta, blob) {
    if (!meta?.id || !meta?.family || !blob) return false;
    if (typeof FontFace !== 'function') return false;
    if (!document?.fonts || typeof document.fonts.add !== 'function') return false;

    const family = String(meta.family || '').trim();
    if (!family) return false;

    const existing = fontApiFaces.get(meta.id);
    if (existing?.family === family) return true;
    if (existing) removeFontApiFace(meta.id);

    /** @type {ReturnType<typeof setTimeout>|null} */
    let loadTimeout = null;

    try {
        const buffer = typeof blob.arrayBuffer === 'function'
            ? await blob.arrayBuffer()
            : await new Response(blob).arrayBuffer();
        const face = new FontFace(family, buffer, { display: 'swap' });
        await Promise.race([
            face.load(),
            new Promise((_, reject) => {
                loadTimeout = setTimeout(() => {
                    reject(new Error(`FontFace load timeout (${FONT_API_LOAD_TIMEOUT_MS}ms)`));
                }, FONT_API_LOAD_TIMEOUT_MS);
            }),
        ]);
        document.fonts.add(face);
        fontApiFaces.set(meta.id, { family, face });
        return true;
    } catch (error) {
        console.warn('[NyTW] Failed to load local font via FontFace API', meta?.fileName || meta?.id, error);
        return false;
    } finally {
        if (loadTimeout) {
            clearTimeout(loadTimeout);
        }
    }
}

function shouldBypassFontApiBySize(meta) {
    const size = Number(meta?.size);
    if (!Number.isFinite(size) || size <= 0) return false;
    return size > FONT_API_BYPASS_SIZE_BYTES;
}

function revokeAllFontObjectUrls() {
    for (const url of fontObjectUrls.values()) {
        try { URL.revokeObjectURL(url); } catch { /* no-op */ }
    }
    fontObjectUrls.clear();
    fontApiFailedIds.clear();

    for (const id of Array.from(fontApiFaces.keys())) {
        removeFontApiFace(id);
    }
}

async function buildFontFaceCssForFamilies(families) {
    // Load imported file fonts on-demand (only families currently referenced by active settings).
    const requiredFamilies = new Set(
        (families || [])
            .map((name) => String(name || '').trim())
            .filter(Boolean),
    );

    const metas = settings.importedFonts.filter((f) => {
        if (getImportedFontKind(f) !== 'file') return false;
        const family = String(f?.family || '').trim();
        if (!family) return false;
        return requiredFamilies.size > 0 && requiredFamilies.has(family);
    });

    const requiredIds = new Set(metas.map(f => f.id));
    for (const [id, url] of fontObjectUrls.entries()) {
        if (!requiredIds.has(id)) {
            try { URL.revokeObjectURL(url); } catch { /* no-op */ }
            fontObjectUrls.delete(id);
        }
    }
    for (const id of Array.from(fontApiFaces.keys())) {
        if (!requiredIds.has(id)) {
            removeFontApiFace(id);
        }
    }
    for (const id of Array.from(fontApiFailedIds)) {
        if (!requiredIds.has(id)) {
            fontApiFailedIds.delete(id);
        }
    }

    const rules = [];
    for (const meta of metas) {
        if (!meta?.id || !meta?.family) continue;

        const cachedApiFace = fontApiFaces.get(meta.id);
        const expectedFamily = String(meta.family || '').trim();
        if (cachedApiFace && cachedApiFace.family !== expectedFamily) {
            removeFontApiFace(meta.id);
        }

        const bypassFontApi = shouldBypassFontApiBySize(meta);
        if (bypassFontApi && fontApiFaces.has(meta.id)) {
            removeFontApiFace(meta.id);
        }

        if (!bypassFontApi && fontApiFaces.has(meta.id)) {
            fontApiFailedIds.delete(meta.id);
            // Already loaded via FontFace API.
            continue;
        }
        if (bypassFontApi) {
            fontApiFailedIds.add(meta.id);
        }

        let blob = null;
        const shouldTryApi = !bypassFontApi && !fontApiFailedIds.has(meta.id);
        if (shouldTryApi) {
            blob = await getFontBlob(meta.id);
            if (!blob) {
                console.warn('[NyTW] Missing local font blob for imported font', meta?.fileName || meta?.id);
                const staleUrl = fontObjectUrls.get(meta.id);
                if (staleUrl) {
                    try { URL.revokeObjectURL(staleUrl); } catch { /* no-op */ }
                    fontObjectUrls.delete(meta.id);
                }
                continue;
            }

            const loadedViaApi = await ensureFontLoadedViaApi(meta, blob);
            if (loadedViaApi) {
                fontApiFailedIds.delete(meta.id);
                const staleUrl = fontObjectUrls.get(meta.id);
                if (staleUrl) {
                    try { URL.revokeObjectURL(staleUrl); } catch { /* no-op */ }
                    fontObjectUrls.delete(meta.id);
                }
                continue;
            }
            fontApiFailedIds.add(meta.id);
        }

        let url = fontObjectUrls.get(meta.id);
        if (!url) {
            if (!blob) {
                blob = await getFontBlob(meta.id);
            }
            if (!blob) continue;
            url = URL.createObjectURL(blob);
            fontObjectUrls.set(meta.id, url);
        }

        const urlToken = `url(${cssQuote(url)})`;
        const resolvedFormat = meta.format || inferFontFormatFromFileName(meta.fileName);
        // Keep an unhinted fallback src for maximum compatibility (some font files/extensions mismatch).
        const hintedSrc = resolvedFormat ? `${urlToken} format(${cssQuote(resolvedFormat)})` : '';
        const srcValue = hintedSrc ? `${hintedSrc}, ${urlToken}` : urlToken;
        rules.push([
            '@font-face{',
            `font-family:${cssQuote(meta.family)};`,
            `src:${srcValue};`,
            'font-display:swap;',
            '}',
        ].join(''));
    }

    return rules.join('\n');
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
    ensureFontStyleElement,
    revokeAllFontObjectUrls,
    buildFontFaceCssForFamilies,
    setupFontPicker,
    setupLocalePicker,
    openFontDb,
    runIdbTransaction,
    putFontBlob,
    getFontBlob,
    deleteFontBlob,
};
