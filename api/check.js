const cheerio = require('cheerio');

const USER_AGENT = 'SEOCheckerBot/1.0 (+https://hello-lilac-psi.vercel.app)';
const PAGE_TIMEOUT_MS = 10000;
const LINK_TIMEOUT_MS = 3000;
const ROBOTS_TIMEOUT_MS = 3000;
const SITEMAP_TIMEOUT_MS = 5000;
const LINK_PROBE_LIMIT = 10;
const SITEMAP_LIMIT = 3;
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;

const GENERIC_ANCHORS = new Set([
  'click here', 'read more', 'learn more', 'here', 'this', 'more',
  'details', 'link', 'click', 'visit', '',
]);

function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function verdict(status, message, value) {
  return { status, message, value };
}

function safeUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function analyzeTitle($) {
  const title = ($('head > title').first().text() || '').trim();
  if (!title) return verdict('fail', 'Missing <title> tag.', { text: '', length: 0 });
  const length = title.length;
  if (length < 30) return verdict('warn', `Title is short (${length} chars). Aim for 50-60.`, { text: title, length });
  if (length > 60) return verdict('warn', `Title is long (${length} chars). Aim for 50-60.`, { text: title, length });
  return verdict('pass', `Title length looks good (${length} chars).`, { text: title, length });
}

function analyzeDescription($) {
  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  if (!desc) return verdict('fail', 'Missing meta description.', { text: '', length: 0 });
  const length = desc.length;
  if (length < 120) return verdict('warn', `Description is short (${length} chars). Aim for 150-160.`, { text: desc, length });
  if (length > 160) return verdict('warn', `Description is long (${length} chars). Aim for 150-160.`, { text: desc, length });
  return verdict('pass', `Description length looks good (${length} chars).`, { text: desc, length });
}

function analyzeCanonical($, finalUrl) {
  const canonical = ($('link[rel="canonical"]').attr('href') || '').trim();
  if (!canonical) return verdict('warn', 'No canonical URL set.', { href: '' });
  try {
    const absolute = new URL(canonical, finalUrl).toString();
    const matches = absolute.replace(/\/$/, '') === finalUrl.replace(/\/$/, '');
    return verdict(
      matches ? 'pass' : 'warn',
      matches ? 'Canonical matches page URL.' : 'Canonical differs from page URL.',
      { href: absolute, matches }
    );
  } catch {
    return verdict('warn', 'Canonical URL is not a valid URL.', { href: canonical });
  }
}

function analyzeHeadings($) {
  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const level = parseInt(tag.slice(1), 10);
    const text = $(el).text().trim().slice(0, 120);
    headings.push({ level, text });
  });
  const h1s = headings.filter((h) => h.level === 1);
  const skipped = [];
  let prev = 0;
  for (const h of headings) {
    if (prev && h.level > prev + 1) skipped.push({ from: prev, to: h.level });
    prev = h.level;
  }
  let status = 'pass';
  let message = `Exactly one H1 found, ${headings.length} headings total.`;
  if (h1s.length === 0) {
    status = 'fail';
    message = 'No H1 tag found on the page.';
  } else if (h1s.length > 1) {
    status = 'warn';
    message = `Found ${h1s.length} H1 tags. Use only one.`;
  } else if (skipped.length > 0) {
    status = 'warn';
    message = `One H1 found, but heading levels skipped (${skipped.map((s) => `H${s.from}→H${s.to}`).join(', ')}).`;
  }
  return verdict(status, message, { h1Count: h1s.length, total: headings.length, headings, skipped });
}

function analyzeSocial($, finalUrl) {
  const og = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property');
    const content = ($(el).attr('content') || '').trim();
    if (prop && content) og[prop] = content;
  });
  const twitter = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr('name');
    const content = ($(el).attr('content') || '').trim();
    if (name && content) twitter[name] = content;
  });

  const ogImage = og['og:image'] ? safeUrl(og['og:image'], finalUrl) || og['og:image'] : '';
  const twitterImage = twitter['twitter:image'] ? safeUrl(twitter['twitter:image'], finalUrl) || twitter['twitter:image'] : '';

  const required = ['og:title', 'og:description', 'og:image', 'og:url'];
  const missing = required.filter((k) => !og[k]);

  let status = 'pass';
  let message = 'Open Graph and Twitter tags look good.';
  if (missing.length === required.length) {
    status = 'fail';
    message = 'No Open Graph tags found.';
  } else if (missing.length > 0) {
    status = 'warn';
    message = `Missing Open Graph tags: ${missing.join(', ')}.`;
  } else if (!twitter['twitter:card']) {
    status = 'warn';
    message = 'OG complete, but no twitter:card defined.';
  }

  return verdict(status, message, { og, twitter, ogImage, twitterImage });
}

function analyzeTechnical($) {
  const viewport = ($('meta[name="viewport"]').attr('content') || '').trim();
  const robots = ($('meta[name="robots"]').attr('content') || '').trim();
  const charset = ($('meta[charset]').attr('charset') || '').trim();
  const lang = ($('html').attr('lang') || '').trim();

  const issues = [];
  if (!viewport) issues.push('viewport');
  if (!charset) issues.push('charset');
  if (!lang) issues.push('html[lang]');
  const noindex = /noindex/i.test(robots);

  let status = 'pass';
  let message = 'Technical meta tags present.';
  if (noindex) {
    status = 'fail';
    message = 'Robots meta tag contains "noindex".';
  } else if (issues.length > 0) {
    status = 'warn';
    message = `Missing: ${issues.join(', ')}.`;
  }

  return verdict(status, message, { viewport, robots, charset, lang });
}

function analyzeImages($) {
  const imgs = $('img').toArray();
  const total = imgs.length;
  const missingAlt = [];
  for (const el of imgs) {
    const alt = $(el).attr('alt');
    const src = $(el).attr('src') || '';
    if (alt === undefined || alt.trim() === '') missingAlt.push(src);
  }
  let status = 'pass';
  let message = total === 0 ? 'No images on page.' : `All ${total} images have alt text.`;
  if (missingAlt.length > 0) {
    const ratio = missingAlt.length / total;
    status = ratio > 0.3 ? 'fail' : 'warn';
    message = `${missingAlt.length} of ${total} images missing alt text.`;
  }
  return verdict(status, message, { total, missingAlt: missingAlt.slice(0, 5), missingCount: missingAlt.length });
}

function analyzeHttps($, finalUrl) {
  const isHttps = finalUrl.startsWith('https://');
  if (!isHttps) {
    return verdict('fail', 'Page served over HTTP, not HTTPS.', { protocol: 'http', mixed: [], mixedCount: 0 });
  }
  const mixed = [];
  const attrs = ['src', 'href', 'data-src'];
  $('script, link, img, iframe, audio, video, source').each((_, el) => {
    for (const attr of attrs) {
      const v = $(el).attr(attr);
      if (v && /^http:\/\//i.test(v)) {
        mixed.push({ tag: el.tagName, attr, value: v });
      }
    }
  });
  $('img[srcset], source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset') || '';
    if (/(^|,\s*)http:\/\//i.test(srcset)) {
      mixed.push({ tag: el.tagName, attr: 'srcset', value: srcset.slice(0, 100) });
    }
  });
  if (mixed.length === 0) {
    return verdict('pass', 'HTTPS in use, no mixed content detected.', { protocol: 'https', mixed: [], mixedCount: 0 });
  }
  return verdict('warn', `${mixed.length} mixed-content resource(s) loaded over HTTP.`, {
    protocol: 'https', mixed: mixed.slice(0, 8), mixedCount: mixed.length,
  });
}

function analyzeStructuredData($) {
  const blocks = [];
  const types = new Set();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data)
        ? data
        : (data && Array.isArray(data['@graph']) ? data['@graph'] : [data]);
      for (const item of items) {
        if (item && item['@type']) {
          const t = Array.isArray(item['@type']) ? item['@type'].join(' / ') : item['@type'];
          types.add(t);
        }
      }
      blocks.push({ ok: true });
    } catch {
      blocks.push({ ok: false });
    }
  });
  const invalid = blocks.filter((b) => !b.ok).length;
  if (blocks.length === 0) {
    return verdict('warn', 'No JSON-LD structured data found.', { blocks: 0, types: [], invalid: 0 });
  }
  if (invalid > 0) {
    return verdict('warn', `${blocks.length} JSON-LD block(s), but ${invalid} failed to parse.`, {
      blocks: blocks.length, types: [...types], invalid,
    });
  }
  return verdict('pass', `${blocks.length} JSON-LD block(s), ${types.size} schema type(s).`, {
    blocks: blocks.length, types: [...types], invalid: 0,
  });
}

function analyzeHreflang($, finalUrl) {
  const entries = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = ($(el).attr('hreflang') || '').trim();
    const href = ($(el).attr('href') || '').trim();
    if (lang && href) entries.push({ lang, href: safeUrl(href, finalUrl) || href });
  });
  if (entries.length === 0) {
    return verdict('info', 'No hreflang tags (only needed for multi-language sites).', {
      entries: [], hasXDefault: false,
    });
  }
  const hasXDefault = entries.some((e) => e.lang === 'x-default');
  if (!hasXDefault) {
    return verdict('warn', `${entries.length} hreflang tag(s), but missing x-default.`, { entries, hasXDefault });
  }
  return verdict('pass', `${entries.length} hreflang tag(s) including x-default.`, { entries, hasXDefault });
}

function analyzeFavicon($, finalUrl) {
  const icons = [];
  const selectors = 'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]';
  $(selectors).each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (href) {
      icons.push({ rel: $(el).attr('rel') || '', href: safeUrl(href, finalUrl) || href });
    }
  });
  if (icons.length === 0) {
    return verdict('warn', 'No favicon link found.', { icons: [] });
  }
  return verdict('pass', `${icons.length} favicon link(s) found.`, { icons });
}

function analyzeContent($, htmlLength) {
  const clone = $.root().clone();
  clone.find('script, style, noscript').remove();
  const text = clone.text().replace(/\s+/g, ' ').trim();
  const words = text ? text.split(/\s+/).length : 0;
  const ratio = htmlLength > 0 ? text.length / htmlLength : 0;
  let status = 'pass';
  let message = `${words} words, text-to-HTML ratio ${(ratio * 100).toFixed(1)}%.`;
  if (words < 50) {
    status = 'fail';
    message = `Very thin content (${words} words).`;
  } else if (words < 300) {
    status = 'warn';
    message = `Content is short (${words} words). Aim for 300+.`;
  }
  return verdict(status, message, { words, textLength: text.length, htmlLength, ratio });
}

function ancestorContext($, el) {
  let nav = false;
  let contextual = false;
  $(el).parents().each((_, p) => {
    if (!p.tagName) return;
    const t = p.tagName.toLowerCase();
    if (t === 'nav' || t === 'header' || t === 'footer' || t === 'aside') nav = true;
    if (t === 'main' || t === 'article' || t === 'p' || t === 'section' || t === 'li') contextual = true;
  });
  if (nav) return 'navigational';
  if (contextual) return 'contextual';
  return 'other';
}

function collectLinks($, finalUrl) {
  const base = new URL(finalUrl);
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) return;
    try {
      const abs = new URL(raw, base).toString();
      if (!/^https?:/.test(abs)) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      const internal = new URL(abs).hostname === base.hostname;
      const anchor = $(el).text().replace(/\s+/g, ' ').trim();
      const rel = ($(el).attr('rel') || '').toLowerCase();
      const target = ($(el).attr('target') || '').toLowerCase();
      const context = ancestorContext($, el);
      links.push({ url: abs, internal, anchor, rel, target, context });
    } catch {
      // skip malformed
    }
  });
  return links;
}

function analyzeInternalLinks(links) {
  const internals = links.filter((l) => l.internal);
  if (internals.length === 0) {
    return verdict('warn', 'No internal links found.', {
      total: 0, contextual: 0, navigational: 0, other: 0, nofollow: 0,
      topAnchors: [], generic: 0, genericExamples: [],
    });
  }
  const contextual = internals.filter((l) => l.context === 'contextual').length;
  const navigational = internals.filter((l) => l.context === 'navigational').length;
  const other = internals.length - contextual - navigational;
  const nofollow = internals.filter((l) => /\bnofollow\b/.test(l.rel)).length;
  const counts = new Map();
  const genericExamples = [];
  let generic = 0;
  for (const l of internals) {
    const a = l.anchor.toLowerCase();
    counts.set(a, (counts.get(a) || 0) + 1);
    if (GENERIC_ANCHORS.has(a) || a.length < 2) {
      generic++;
      if (genericExamples.length < 5) {
        genericExamples.push({ anchor: l.anchor || '(empty)', url: l.url });
      }
    }
  }
  const topAnchors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([anchor, count]) => ({ anchor: anchor || '(empty)', count }));
  const genericRatio = generic / internals.length;
  let status = 'pass';
  let message = `${internals.length} internal links — ${contextual} contextual, ${navigational} navigational.`;
  if (nofollow > 0) {
    status = 'warn';
    message = `${nofollow} of ${internals.length} internal links are nofollowed — usually a red flag.`;
  } else if (genericRatio > 0.3) {
    status = 'warn';
    message = `${generic} of ${internals.length} internal links use generic anchor text.`;
  }
  return verdict(status, message, {
    total: internals.length, contextual, navigational, other, nofollow,
    topAnchors, generic, genericExamples,
  });
}

function analyzeExternalLinks(links) {
  const externals = links.filter((l) => !l.internal);
  if (externals.length === 0) {
    return verdict('info', 'No external links found.', {
      total: 0, follow: 0, nofollow: 0, topDomains: [],
      unsafeTargetBlank: 0, unsafeExamples: [],
    });
  }
  const nofollow = externals.filter((l) => /\bnofollow\b/.test(l.rel)).length;
  const follow = externals.length - nofollow;
  const unsafeExamples = [];
  let unsafeTargetBlank = 0;
  for (const l of externals) {
    if (l.target === '_blank' && !/\bnoopener\b/.test(l.rel)) {
      unsafeTargetBlank++;
      if (unsafeExamples.length < 5) unsafeExamples.push(l.url);
    }
  }
  const domainCounts = new Map();
  for (const l of externals) {
    try {
      const h = new URL(l.url).hostname;
      domainCounts.set(h, (domainCounts.get(h) || 0) + 1);
    } catch { /* skip */ }
  }
  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));
  let status = 'pass';
  let message = `${externals.length} external links (${follow} follow, ${nofollow} nofollow).`;
  if (unsafeTargetBlank > 0) {
    status = 'warn';
    message = `${unsafeTargetBlank} external link(s) use target="_blank" without rel="noopener".`;
  }
  return verdict(status, message, {
    total: externals.length, follow, nofollow, topDomains,
    unsafeTargetBlank, unsafeExamples,
  });
}

async function probeLink(url) {
  try {
    let res = await fetchWithTimeout(
      url,
      { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': USER_AGENT } },
      LINK_TIMEOUT_MS
    );
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(
        url,
        { method: 'GET', redirect: 'follow', headers: { 'User-Agent': USER_AGENT } },
        LINK_TIMEOUT_MS
      );
    }
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function analyzeLinkReachability(links) {
  const internal = links.filter((l) => l.internal).length;
  const external = links.length - internal;
  const probes = await Promise.all(links.slice(0, LINK_PROBE_LIMIT).map((l) => probeLink(l.url)));
  const broken = probes.filter((p) => !p.ok).length;
  let status = 'pass';
  let message = `Probed ${probes.length} of ${links.length} links — all reachable.`;
  if (probes.length === 0) {
    message = 'No probeable links found.';
  } else if (broken > 0) {
    status = broken === probes.length ? 'fail' : 'warn';
    message = `${broken} of ${probes.length} probed links failed.`;
  }
  return verdict(status, message, { total: links.length, internal, external, probes });
}

function analyzePageWeight(html, headers) {
  const bytes = Buffer.byteLength(html, 'utf8');
  const encoding = (headers.get('content-encoding') || 'none').toLowerCase();
  const kb = bytes / 1024;
  const issues = [];
  let status = 'pass';
  if (bytes > 1024 * 1024) {
    status = 'fail';
    issues.push(`HTML ${kb.toFixed(0)} KB exceeds 1 MB`);
  } else if (bytes > 500 * 1024) {
    status = 'warn';
    issues.push(`HTML ${kb.toFixed(0)} KB exceeds 500 KB`);
  }
  if (encoding === 'none') {
    if (status === 'pass') status = 'warn';
    issues.push('no compression (gzip/br) detected');
  }
  const message = issues.length
    ? issues.join('; ') + '.'
    : `HTML ${kb.toFixed(1)} KB, ${encoding} encoded.`;
  return verdict(status, message, { bytes, kb: Math.round(kb * 10) / 10, encoding });
}

function parseRobots(text) {
  const blocks = [];
  let curBlock = null;
  let collectingAgents = false;
  const sitemaps = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) { collectingAgents = false; continue; }
    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
    } else if (key === 'user-agent') {
      if (!collectingAgents || !curBlock) {
        curBlock = { agents: [], rules: [] };
        blocks.push(curBlock);
        collectingAgents = true;
      }
      curBlock.agents.push(value.toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      collectingAgents = false;
      if (!curBlock) { curBlock = { agents: ['*'], rules: [] }; blocks.push(curBlock); }
      curBlock.rules.push({ type: key, value });
    } else {
      collectingAgents = false;
    }
  }
  return { blocks, sitemaps };
}

function isUrlAllowed(blocks, uaName, urlPath) {
  function patternMatches(pattern, path) {
    if (pattern === '') return false;
    if (pattern.includes('*') || pattern.endsWith('$')) {
      let re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      if (re.endsWith('\\$')) re = re.slice(0, -2) + '$';
      try { return new RegExp('^' + re).test(path); } catch { return false; }
    }
    return path.startsWith(pattern);
  }
  const uaLower = uaName.toLowerCase();
  let applicable = blocks.find((b) => b.agents.some((a) => a === uaLower));
  if (!applicable) applicable = blocks.find((b) => b.agents.includes('*'));
  if (!applicable) return true;
  let best = null;
  for (const r of applicable.rules) {
    if (r.value && patternMatches(r.value, urlPath)) {
      if (!best
        || r.value.length > best.value.length
        || (r.value.length === best.value.length && r.type === 'allow')) {
        best = r;
      }
    }
  }
  if (!best) return true;
  return best.type === 'allow';
}

async function analyzeRobots(finalUrl) {
  let originUrl;
  try {
    const u = new URL(finalUrl);
    originUrl = `${u.protocol}//${u.host}/robots.txt`;
  } catch {
    return verdict('warn', 'Could not derive robots.txt URL.', {
      url: '', present: false, sitemaps: [], allowed: true,
    });
  }
  let res;
  try {
    res = await fetchWithTimeout(originUrl, { headers: { 'User-Agent': USER_AGENT } }, ROBOTS_TIMEOUT_MS);
  } catch (err) {
    return verdict('warn', `robots.txt fetch failed: ${err.name === 'AbortError' ? 'timeout' : err.message}.`, {
      url: originUrl, present: false, sitemaps: [], allowed: true,
    });
  }
  if (!res.ok) {
    return verdict('warn', `No robots.txt (HTTP ${res.status}).`, {
      url: originUrl, status: res.status, present: false, sitemaps: [], allowed: true,
    });
  }
  const text = (await res.text()).slice(0, 50000);
  const { blocks, sitemaps } = parseRobots(text);
  let urlPath = '/';
  try { urlPath = new URL(finalUrl).pathname || '/'; } catch { /* keep '/' */ }
  const allowedForAll = isUrlAllowed(blocks, '*', urlPath);
  const allowedForBot = isUrlAllowed(blocks, 'seocheckerbot', urlPath);
  const blocked = !allowedForAll || !allowedForBot;
  let status = 'pass';
  let message = sitemaps.length === 0
    ? 'robots.txt found, no Sitemap directive, URL is allowed.'
    : `robots.txt found, ${sitemaps.length} sitemap directive(s), URL is allowed.`;
  if (blocked) {
    status = 'fail';
    message = 'robots.txt blocks crawling of this URL.';
  }
  return verdict(status, message, {
    url: originUrl, present: true, status: res.status,
    content: text.slice(0, 1500),
    truncated: text.length > 1500,
    sitemaps,
    allowed: !blocked,
  });
}

async function analyzeSitemap(finalUrl, robotsResult) {
  let originBase;
  try {
    const u = new URL(finalUrl);
    originBase = `${u.protocol}//${u.host}`;
  } catch {
    return verdict('fail', 'Invalid origin URL.', { results: [], totalUrls: 0, listed: false });
  }
  const candidates = [];
  const seen = new Set();
  function addCandidate(url) {
    if (!url) return;
    const abs = safeUrl(url, originBase);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    candidates.push(abs);
  }
  addCandidate(`${originBase}/sitemap.xml`);
  for (const sm of (robotsResult.value.sitemaps || [])) addCandidate(sm);
  const list = candidates.slice(0, SITEMAP_LIMIT);

  const normTarget = finalUrl.replace(/\/$/, '');
  const results = await Promise.all(list.map(async (sm) => {
    try {
      const res = await fetchWithTimeout(sm, { headers: { 'User-Agent': USER_AGENT } }, SITEMAP_TIMEOUT_MS);
      if (!res.ok) return { url: sm, ok: false, status: res.status };
      let body = await res.text();
      if (body.length > MAX_SITEMAP_BYTES) body = body.slice(0, MAX_SITEMAP_BYTES);
      const $xml = cheerio.load(body, { xmlMode: true });
      const isIndex = $xml('sitemapindex').length > 0;
      const sel = isIndex ? 'sitemap > loc' : 'url > loc';
      const locs = $xml(sel).map((_, el) => $xml(el).text().trim()).get();
      const listed = !isIndex && locs.some((u) => u.replace(/\/$/, '') === normTarget);
      return {
        url: sm, ok: true, status: res.status, isIndex,
        count: locs.length, sample: locs.slice(0, 5), listed,
      };
    } catch (err) {
      return { url: sm, ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
    }
  }));
  const found = results.filter((r) => r.ok);
  const totalUrls = found.reduce((s, r) => s + (r.count || 0), 0);
  const listed = found.some((r) => r.listed);
  const anyIndex = found.some((r) => r.isIndex);
  if (found.length === 0) {
    return verdict('fail', 'No sitemap found at /sitemap.xml or referenced in robots.txt.', {
      candidates: list, results, totalUrls: 0, listed: false,
    });
  }
  let status = 'pass';
  let message = `${found.length} sitemap(s) found, ${totalUrls} URL(s) total. This URL is listed.`;
  if (anyIndex && !listed) {
    status = 'warn';
    message = `Sitemap index found (${totalUrls} child sitemaps). Listing of this URL not verified — deep crawl disabled.`;
  } else if (!listed) {
    status = 'warn';
    message = `${found.length} sitemap(s) found, but this URL is not listed in them.`;
  }
  return verdict(status, message, { candidates: list, results, totalUrls, listed });
}

function backlinksInfo() {
  return verdict('info', 'Inbound backlinks require external crawler data. Use one of the tools below.', {
    tools: [
      { name: 'Google Search Console', url: 'https://search.google.com/search-console', note: 'For verified site owners' },
      { name: 'Ahrefs Free Backlink Checker', url: 'https://ahrefs.com/backlink-checker', note: 'Free, capped results' },
      { name: 'Moz Link Explorer', url: 'https://moz.com/link-explorer', note: 'Free with account' },
      { name: 'SEMrush Backlink Analytics', url: 'https://www.semrush.com/analytics/backlinks/', note: 'Free with account' },
    ],
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = (req.query && req.query.url) || '';
  if (!url) {
    return res.status(400).json({ error: 'Missing ?url= query parameter.' });
  }
  let parsed;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) URLs are supported.');
  } catch (err) {
    return res.status(400).json({ error: `Invalid URL: ${err.message}` });
  }

  const start = Date.now();
  let pageRes;
  try {
    pageRes = await fetchWithTimeout(
      parsed.toString(),
      { redirect: 'follow', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' } },
      PAGE_TIMEOUT_MS
    );
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Request timed out after 10s.' : err.message;
    return res.status(200).json({ url: parsed.toString(), error: `Could not fetch URL: ${reason}` });
  }

  const responseMs = Date.now() - start;
  const finalUrl = pageRes.url || parsed.toString();
  const contentType = pageRes.headers.get('content-type') || '';
  if (!/html/i.test(contentType)) {
    return res.status(200).json({
      url: parsed.toString(),
      finalUrl,
      status: pageRes.status,
      responseMs,
      error: `Response is not HTML (content-type: ${contentType || 'unknown'}).`,
    });
  }

  const html = await pageRes.text();
  const $ = cheerio.load(html);
  const links = collectLinks($, finalUrl);

  const linkReachabilityPromise = analyzeLinkReachability(links);
  const robotsThenSitemapPromise = (async () => {
    const robots = await analyzeRobots(finalUrl);
    const sitemap = await analyzeSitemap(finalUrl, robots);
    return { robots, sitemap };
  })();

  const [linkReachability, { robots, sitemap }] = await Promise.all([
    linkReachabilityPromise,
    robotsThenSitemapPromise,
  ]);

  const checks = {
    pageWeight: analyzePageWeight(html, pageRes.headers),
    https: analyzeHttps($, finalUrl),
    title: analyzeTitle($),
    description: analyzeDescription($),
    canonical: analyzeCanonical($, finalUrl),
    headings: analyzeHeadings($),
    content: analyzeContent($, html.length),
    social: analyzeSocial($, finalUrl),
    structuredData: analyzeStructuredData($),
    hreflang: analyzeHreflang($, finalUrl),
    technical: analyzeTechnical($),
    favicon: analyzeFavicon($, finalUrl),
    images: analyzeImages($),
    robots,
    sitemap,
    internalLinks: analyzeInternalLinks(links),
    externalLinks: analyzeExternalLinks(links),
    linkReachability,
    backlinks: backlinksInfo(),
  };

  return res.status(200).json({
    url: parsed.toString(),
    finalUrl,
    status: pageRes.status,
    responseMs,
    checks,
  });
};
