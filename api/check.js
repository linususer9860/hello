const cheerio = require('cheerio');

const USER_AGENT = 'SEOCheckerBot/1.0 (+https://hello-lilac-psi.vercel.app)';
const PAGE_TIMEOUT_MS = 10000;
const LINK_TIMEOUT_MS = 3000;
const LINK_PROBE_LIMIT = 10;

function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function verdict(status, message, value) {
  return { status, message, value };
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

  const ogImage = og['og:image'] ? new URL(og['og:image'], finalUrl).toString() : '';
  const twitterImage = twitter['twitter:image'] ? new URL(twitter['twitter:image'], finalUrl).toString() : '';

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
      links.push({ url: abs, internal });
    } catch {
      // skip malformed
    }
  });
  return links;
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

async function analyzeLinks($, finalUrl) {
  const all = collectLinks($, finalUrl);
  const internal = all.filter((l) => l.internal).length;
  const external = all.length - internal;
  const probes = await Promise.all(all.slice(0, LINK_PROBE_LIMIT).map((l) => probeLink(l.url)));
  const broken = probes.filter((p) => !p.ok).length;
  let status = 'pass';
  let message = `Probed ${probes.length} of ${all.length} links — all reachable.`;
  if (probes.length === 0) {
    message = 'No probeable links found.';
  } else if (broken > 0) {
    status = broken === probes.length ? 'fail' : 'warn';
    message = `${broken} of ${probes.length} probed links failed.`;
  }
  return verdict(status, message, { total: all.length, internal, external, probes });
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

  const checks = {
    title: analyzeTitle($),
    description: analyzeDescription($),
    canonical: analyzeCanonical($, finalUrl),
    headings: analyzeHeadings($),
    social: analyzeSocial($, finalUrl),
    technical: analyzeTechnical($),
    images: analyzeImages($),
    links: await analyzeLinks($, finalUrl),
  };

  return res.status(200).json({
    url: parsed.toString(),
    finalUrl,
    status: pageRes.status,
    responseMs,
    checks,
  });
};
