import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const corePath = join(rootDir, 'nytwCore.js');
const customPath = join(rootDir, 'customIndependentFont.js');
const guardPath = join(rootDir, 'nytwProtectedContent.js');

assert.ok(existsSync(guardPath), 'shared protected content guard module should exist');

const guardSource = readFileSync(guardPath, 'utf8');
const coreSource = readFileSync(corePath, 'utf8');
const customSource = readFileSync(customPath, 'utf8');

const requiredTags = ['style', 'script', 'textarea', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'];
const selectorMatch = guardSource.match(/NYTW_PROTECTED_CONTENT_SELECTOR\s*=\s*'([^']+)'/);
assert.ok(selectorMatch, 'shared selector should be exported');

for (const tag of requiredTags) {
    assert.match(selectorMatch[1], new RegExp(`\\b${tag}\\b`), `protected selector should include ${tag}`);
}

assert.match(guardSource, /function isWithinNytwProtectedContent/, 'ancestor guard helper should be exported');
assert.match(guardSource, /function isNytwProtectedContentElement/, 'element guard helper should be exported');

function getFunctionBody(source, name) {
    const marker = `function ${name}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${name} should exist`);

    const argsStart = source.indexOf('(', start);
    assert.notEqual(argsStart, -1, `${name} should have params`);

    let parenDepth = 0;
    let argsEnd = -1;
    for (let i = argsStart; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (parenDepth === 0) {
            argsEnd = i;
            break;
        }
    }
    assert.notEqual(argsEnd, -1, `${name} params should close`);

    const openBrace = source.indexOf('{', argsEnd);
    assert.notEqual(openBrace, -1, `${name} should have a body`);

    let depth = 0;
    for (let i = openBrace; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) return source.slice(openBrace + 1, i);
    }

    assert.fail(`${name} body should close`);
}

const quoteBody = getFunctionBody(coreSource, 'applyQuoteWrapping');
assert.match(quoteBody, /isWithinNytwProtectedContent\(parent\)/, 'quote wrapping should skip protected structured content');

const localeBody = getFunctionBody(coreSource, 'collectEligibleLocaleTextNodes');
assert.match(localeBody, /isWithinNytwProtectedContent\(parent\)/, 'locale text walker should skip protected structured content');

const localeCharsBody = getFunctionBody(coreSource, 'applyLocaleFontsToTypewriterChars');
assert.match(localeCharsBody, /isWithinNytwProtectedContent\(el\)/, 'locale typewriter marking should skip protected structured content');

const streamBody = getFunctionBody(coreSource, 'segmentTextForStreamingAnimation');
assert.match(streamBody, /isNytwProtectedContentElement\(el\)/, 'stream walker should reject protected element subtrees');
assert.match(streamBody, /isWithinNytwProtectedContent\(parent\)/, 'stream walker should skip protected text and br nodes');

const typewriterBody = getFunctionBody(coreSource, 'typewriterizeNode');
assert.match(typewriterBody, /isNytwProtectedContentElement\(el\)/, 'typewriter recursion should detect protected structured content');
assert.match(typewriterBody, /cloneNode\(true\)/, 'typewriter recursion should preserve protected structured content without char spans');

const bundleBody = getFunctionBody(coreSource, 'wrapBundleQuotesAndCustom');
assert.match(bundleBody, /isWithinNytwProtectedContent\(parent\)/, 'bundle custom walker should skip protected structured content');

const customCollectBody = getFunctionBody(customSource, 'collectEligibleTextNodes');
assert.match(customCollectBody, /isWithinNytwProtectedContent\(parent\)/, 'custom independent font walker should skip protected structured content');

const staleProtectedChecks = /closest\('(?:style, script, textarea, pre, code|pre, code, textarea, script, style|style, script, textarea, pre, code, q)'/;
assert.doesNotMatch(coreSource, staleProtectedChecks, 'nytwCore should not keep stale raw protected closest checks');
assert.doesNotMatch(customSource, staleProtectedChecks, 'customIndependentFont should not keep stale raw protected closest checks');
