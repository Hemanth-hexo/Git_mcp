// A practical, non-legal-advice classification of common SPDX license
// identifiers into "how much does this constrain you" buckets, plus a
// plain-English note per license. This is a rule-of-thumb for a quick "can I
// use this?" gut check, not a substitute for actually reading the license
// text or asking a lawyer for anything that matters (a commercial product,
// distributing modified source, etc).
const LICENSES = {
    MIT: { category: 'permissive', note: 'Very few restrictions - use, modify, and distribute freely, including in closed-source/commercial projects. Just keep the copyright notice.' },
    'Apache-2.0': { category: 'permissive', note: 'Like MIT but with an explicit patent grant and a notice requirement for changes. Safe for commercial and closed-source use.' },
    'BSD-2-Clause': { category: 'permissive', note: 'Very few restrictions, similar to MIT. Safe for commercial and closed-source use.' },
    'BSD-3-Clause': { category: 'permissive', note: 'Like BSD-2-Clause, plus you can\'t use the author\'s name to promote derived products. Safe for commercial and closed-source use.' },
    ISC: { category: 'permissive', note: 'Functionally equivalent to MIT, just shorter wording. Safe for commercial and closed-source use.' },
    '0BSD': { category: 'permissive', note: 'Public-domain-equivalent - no conditions at all, not even attribution.' },
    Unlicense: { category: 'permissive', note: 'Public-domain dedication - no conditions at all.' },
    'CC0-1.0': { category: 'permissive', note: 'Public-domain dedication - no conditions at all. Common for data/docs, less common for code.' },
    Zlib: { category: 'permissive', note: 'Very permissive, similar to MIT with a minor attribution nuance for modified versions.' },
    WTFPL: { category: 'permissive', note: 'No conditions at all, informally worded.' },
    'BSL-1.0': { category: 'permissive', note: 'Very permissive (Boost license) - notice only required in source form, not binaries.' },

    'MPL-2.0': { category: 'weak-copyleft', note: 'File-level copyleft: if you modify MPL-licensed files, those specific files must stay open source - but you can combine them with proprietary code in the same project.' },
    'LGPL-2.1': { category: 'weak-copyleft', note: 'You can link to this from closed-source code, but if you modify the library itself, those changes must be shared.' },
    'LGPL-2.1-only': { category: 'weak-copyleft', note: 'You can link to this from closed-source code, but if you modify the library itself, those changes must be shared.' },
    'LGPL-2.1-or-later': { category: 'weak-copyleft', note: 'You can link to this from closed-source code, but if you modify the library itself, those changes must be shared.' },
    'LGPL-3.0': { category: 'weak-copyleft', note: 'You can link to this from closed-source code, but if you modify the library itself, those changes must be shared.' },
    'LGPL-3.0-only': { category: 'weak-copyleft', note: 'You can link to this from closed-source code, but if you modify the library itself, those changes must be shared.' },
    'LGPL-3.0-or-later': { category: 'weak-copyleft', note: 'You can link to this from closed-source code, but if you modify the library itself, those changes must be shared.' },
    'EPL-1.0': { category: 'weak-copyleft', note: 'Similar spirit to MPL - modifications to EPL-covered files must stay open, but it can be combined with proprietary code.' },
    'EPL-2.0': { category: 'weak-copyleft', note: 'Similar spirit to MPL - modifications to EPL-covered files must stay open, but it can be combined with proprietary code.' },

    'GPL-2.0': { category: 'copyleft', note: 'Strong copyleft: if you distribute a project built on this, the whole project generally must be GPL-licensed too. Fine for internal/personal use; think carefully before shipping it in a closed-source product.' },
    'GPL-2.0-only': { category: 'copyleft', note: 'Strong copyleft: if you distribute a project built on this, the whole project generally must be GPL-licensed too. Fine for internal/personal use; think carefully before shipping it in a closed-source product.' },
    'GPL-2.0-or-later': { category: 'copyleft', note: 'Strong copyleft: if you distribute a project built on this, the whole project generally must be GPL-licensed too. Fine for internal/personal use; think carefully before shipping it in a closed-source product.' },
    'GPL-3.0': { category: 'copyleft', note: 'Strong copyleft: if you distribute a project built on this, the whole project generally must be GPL-licensed too. Fine for internal/personal use; think carefully before shipping it in a closed-source product.' },
    'GPL-3.0-only': { category: 'copyleft', note: 'Strong copyleft: if you distribute a project built on this, the whole project generally must be GPL-licensed too. Fine for internal/personal use; think carefully before shipping it in a closed-source product.' },
    'GPL-3.0-or-later': { category: 'copyleft', note: 'Strong copyleft: if you distribute a project built on this, the whole project generally must be GPL-licensed too. Fine for internal/personal use; think carefully before shipping it in a closed-source product.' },
    'AGPL-3.0': { category: 'copyleft', note: 'The strictest common copyleft: even running a modified version as a network service counts as "distribution" and can trigger the share-alike requirement. Be especially careful using this in a SaaS product.' },
    'AGPL-3.0-only': { category: 'copyleft', note: 'The strictest common copyleft: even running a modified version as a network service counts as "distribution" and can trigger the share-alike requirement. Be especially careful using this in a SaaS product.' },
    'AGPL-3.0-or-later': { category: 'copyleft', note: 'The strictest common copyleft: even running a modified version as a network service counts as "distribution" and can trigger the share-alike requirement. Be especially careful using this in a SaaS product.' },
};

// GitHub returns 'NOASSERTION' (via the license API) when it detected some
// license-shaped text but couldn't confidently identify it - treated the
// same as "no license" here since neither tells you anything actionable.
const NO_LICENSE_IDS = new Set(['NOASSERTION', 'NONE', '']);

export function classifyLicense(spdxIdOrName) {
    if (!spdxIdOrName || NO_LICENSE_IDS.has(spdxIdOrName)) {
        return {
            id: null,
            category: 'none',
            note: 'No license declared. Under default copyright law that means all rights are reserved by the author - technically, you may not be permitted to use, modify, or redistribute this code at all without asking them directly.',
        };
    }
    const known = LICENSES[spdxIdOrName];
    if (known) return { id: spdxIdOrName, ...known };
    return {
        id: spdxIdOrName,
        category: 'unknown',
        note: `"${spdxIdOrName}" isn't in this tool's lookup table - read the actual license text (or check choosealicense.com/appendix) before relying on it.`,
    };
}
