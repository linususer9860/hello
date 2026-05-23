const form = document.getElementById('check-form');
const input = document.getElementById('url-input');
const btn = document.getElementById('submit-btn');
const results = document.getElementById('results');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    results.innerHTML = '<div class="loading">Fetching, parsing, probing links, and checking robots/sitemap</div>';

    try {
        const res = await fetch(`/api/check?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.error) {
            renderError(data.error, data);
        } else {
            renderResults(data);
        }
    } catch (err) {
        renderError(`Network error: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze';
    }
});

function esc(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function badge(status) {
    return `<span class="badge badge-${status}">${status}</span>`;
}

function renderError(message, data = {}) {
    const urlLine = data.url ? `<p style="font-family: monospace; font-size: 13px; margin: 4px 0 0;">${esc(data.url)}</p>` : '';
    results.innerHTML = `<div class="error"><strong>Couldn't analyze that URL.</strong><p>${esc(message)}</p>${urlLine}</div>`;
}

function renderResults(data) {
    const { url, finalUrl, status, responseMs, checks } = data;
    const cards = [
        reportHeader(finalUrl || url),
        summaryCard(url, finalUrl, status, responseMs, checks),
        httpHeadersCard(checks.httpHeaders),
        httpsCard(checks.https),
        redirectChainCard(checks.redirectChain),
        pageWeightCard(checks.pageWeight),
        performanceCard(checks.performance),
        titleCard(checks.title),
        descriptionCard(checks.description),
        canonicalCard(checks.canonical),
        headingsCard(checks.headings),
        contentCard(checks.content),
        urlStructureCard(checks.urlStructure),
        socialCard(checks.social),
        structuredDataCard(checks.structuredData),
        hreflangCard(checks.hreflang),
        technicalCard(checks.technical),
        metaRefreshCard(checks.metaRefresh),
        faviconCard(checks.favicon),
        pwaCard(checks.pwa),
        feedsCard(checks.feeds),
        imagesCard(checks.images),
        imageReachabilityCard(checks.imageReachability),
        robotsCard(checks.robots),
        sitemapCard(checks.sitemap),
        internalLinksCard(checks.internalLinks),
        externalLinksCard(checks.externalLinks),
        linkReachabilityCard(checks.linkReachability),
        backlinksCard(checks.backlinks),
    ];
    results.innerHTML = cards.join('');
}

function reportHeader(url) {
    const now = new Date().toLocaleString();
    return `
        <div class="report-toolbar">
            <div class="report-meta">
                <strong>SEO report</strong>
                <span>${esc(url)} · ${esc(now)}</span>
            </div>
            <button type="button" class="pdf-btn" onclick="window.print()">Save as PDF</button>
        </div>
    `;
}

function summaryCard(url, finalUrl, status, responseMs, checks) {
    const redirected = finalUrl && finalUrl !== url;
    const statusOk = status >= 200 && status < 400;
    const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    for (const v of Object.values(checks)) {
        if (v && v.status && counts[v.status] !== undefined) counts[v.status]++;
    }
    return `
        <div class="summary">
            <div class="url">
                <strong>${esc(finalUrl || url)}</strong>
                ${redirected ? `<div style="font-size:12px;color:#999;margin-top:4px;">redirected from ${esc(url)}</div>` : ''}
            </div>
            <div class="stat">
                <strong style="color:${statusOk ? '#14693a' : '#842029'}">${status}</strong>
                <span>HTTP status</span>
            </div>
            <div class="stat">
                <strong>${responseMs}<small style="font-size:14px;color:#777"> ms</small></strong>
                <span>Response time</span>
            </div>
            <div class="stat">
                <strong style="color:#14693a">${counts.pass}</strong>
                <span>Pass</span>
            </div>
            <div class="stat">
                <strong style="color:#856404">${counts.warn}</strong>
                <span>Warn</span>
            </div>
            <div class="stat">
                <strong style="color:#842029">${counts.fail}</strong>
                <span>Fail</span>
            </div>
        </div>
    `;
}

function titleCard(t) {
    return `
        <div class="card">
            <h2>Title ${badge(t.status)}</h2>
            <p class="msg">${esc(t.message)}</p>
            <dl class="kv">
                <dt>Text</dt><dd>${esc(t.value.text || '—')}</dd>
                <dt>Length</dt><dd>${t.value.length} chars</dd>
            </dl>
        </div>
    `;
}

function descriptionCard(d) {
    return `
        <div class="card">
            <h2>Meta description ${badge(d.status)}</h2>
            <p class="msg">${esc(d.message)}</p>
            <dl class="kv">
                <dt>Text</dt><dd>${esc(d.value.text || '—')}</dd>
                <dt>Length</dt><dd>${d.value.length} chars</dd>
            </dl>
        </div>
    `;
}

function canonicalCard(c) {
    return `
        <div class="card">
            <h2>Canonical URL ${badge(c.status)}</h2>
            <p class="msg">${esc(c.message)}</p>
            <dl class="kv">
                <dt>Href</dt><dd>${esc(c.value.href || '—')}</dd>
            </dl>
        </div>
    `;
}

function headingsCard(h) {
    const items = h.value.headings.slice(0, 30).map((x) =>
        `<li><span class="lvl">H${x.level}</span>${esc(x.text || '(empty)')}</li>`
    ).join('');
    const more = h.value.headings.length > 30 ? `<li style="color:#999;font-style:italic;">…and ${h.value.headings.length - 30} more</li>` : '';
    return `
        <div class="card">
            <h2>Heading structure ${badge(h.status)}</h2>
            <p class="msg">${esc(h.message)}</p>
            <dl class="kv">
                <dt>H1 count</dt><dd>${h.value.h1Count}</dd>
                <dt>Total headings</dt><dd>${h.value.total}</dd>
            </dl>
            ${items ? `<ul class="heading-list" style="margin-top:12px;">${items}${more}</ul>` : ''}
        </div>
    `;
}

function socialCard(s) {
    const { og, twitter, ogImage, ogImageWidth, ogImageHeight, hasOgImageDims } = s.value;
    const preview = ogImage ? `
        <div class="og-preview">
            <img src="${esc(ogImage)}" alt="OG image preview" onerror="this.style.display='none'">
            <div class="meta">
                <strong>${esc(og['og:title'] || '(no og:title)')}</strong>
                ${esc(og['og:description'] || '(no og:description)')}
                ${hasOgImageDims ? `<div style="margin-top:4px;color:#777;font-size:12px;">${esc(ogImageWidth)}×${esc(ogImageHeight)}</div>` : ''}
            </div>
        </div>` : '';
    const ogRows = Object.entries(og).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    const twRows = Object.entries(twitter).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    return `
        <div class="card">
            <h2>Open Graph &amp; Twitter ${badge(s.status)}</h2>
            <p class="msg">${esc(s.message)}</p>
            ${preview}
            ${ogRows ? `<dl class="kv" style="margin-top:12px;">${ogRows}</dl>` : '<p style="color:#999;font-size:14px;">No Open Graph tags found.</p>'}
            ${twRows ? `<dl class="kv" style="margin-top:12px;border-top:1px solid #eee;padding-top:12px;">${twRows}</dl>` : ''}
        </div>
    `;
}

function technicalCard(t) {
    const { viewport, robots, charset, lang } = t.value;
    return `
        <div class="card">
            <h2>Technical meta ${badge(t.status)}</h2>
            <p class="msg">${esc(t.message)}</p>
            <dl class="kv">
                <dt>Viewport</dt><dd>${esc(viewport || '—')}</dd>
                <dt>Robots</dt><dd>${esc(robots || '—')}</dd>
                <dt>Charset</dt><dd>${esc(charset || '—')}</dd>
                <dt>html lang</dt><dd>${esc(lang || '—')}</dd>
            </dl>
        </div>
    `;
}

function imagesCard(i) {
    const { total, missingAlt, missingCount, lazy, noDims, modernFormat } = i.value;
    const examples = missingAlt.length
        ? `<dl class="kv" style="margin-top:8px;"><dt>Missing alt (sample)</dt><dd>${missingAlt.map((s) => esc(s)).join('<br>')}</dd></dl>`
        : '';
    return `
        <div class="card">
            <h2>Images ${badge(i.status)}</h2>
            <p class="msg">${esc(i.message)}</p>
            <dl class="kv">
                <dt>Total images</dt><dd>${total}</dd>
                <dt>Missing alt</dt><dd>${missingCount}</dd>
                <dt>Lazy-loaded</dt><dd>${lazy}</dd>
                <dt>Missing width/height</dt><dd>${noDims}</dd>
                <dt>Modern format (WebP/AVIF)</dt><dd>${modernFormat}</dd>
            </dl>
            ${examples}
        </div>
    `;
}

function httpsCard(h) {
    const { protocol, mixed, mixedCount } = h.value;
    const list = mixed.length
        ? `<dl class="kv" style="margin-top:8px;"><dt>Mixed content (sample)</dt><dd>${mixed.map((m) =>
            `<code>&lt;${esc(m.tag)} ${esc(m.attr)}&gt;</code> ${esc(m.value)}`).join('<br>')}</dd></dl>`
        : '';
    return `
        <div class="card">
            <h2>HTTPS &amp; mixed content ${badge(h.status)}</h2>
            <p class="msg">${esc(h.message)}</p>
            <dl class="kv">
                <dt>Protocol</dt><dd>${esc(protocol)}</dd>
                <dt>Mixed-content resources</dt><dd>${mixedCount}</dd>
            </dl>
            ${list}
        </div>
    `;
}

function pageWeightCard(p) {
    const { bytes, kb, encoding } = p.value;
    return `
        <div class="card">
            <h2>Page weight ${badge(p.status)}</h2>
            <p class="msg">${esc(p.message)}</p>
            <dl class="kv">
                <dt>HTML size</dt><dd>${kb} KB <span style="color:#999;">(${bytes.toLocaleString()} bytes)</span></dd>
                <dt>Content-Encoding</dt><dd>${esc(encoding)}</dd>
            </dl>
        </div>
    `;
}

function contentCard(c) {
    const { words, textLength, htmlLength, ratio, readability, firstParagraph } = c.value;
    return `
        <div class="card">
            <h2>Content depth ${badge(c.status)}</h2>
            <p class="msg">${esc(c.message)}</p>
            <dl class="kv">
                <dt>Word count</dt><dd>${words.toLocaleString()}</dd>
                <dt>Visible text</dt><dd>${textLength.toLocaleString()} chars</dd>
                <dt>HTML size</dt><dd>${htmlLength.toLocaleString()} chars</dd>
                <dt>Text-to-HTML</dt><dd>${(ratio * 100).toFixed(1)}%</dd>
                <dt>Readability (Flesch)</dt><dd>${readability.score} — ${esc(readability.grade)}</dd>
                <dt>Sentences</dt><dd>${readability.sentences.toLocaleString()}</dd>
                <dt>First paragraph</dt><dd>${firstParagraph.words} words</dd>
            </dl>
            ${firstParagraph.preview ? `<p class="msg" style="margin-top:8px;font-style:italic;color:#555;">"${esc(firstParagraph.preview)}${firstParagraph.preview.length >= 240 ? '…' : ''}"</p>` : ''}
        </div>
    `;
}

function structuredDataCard(s) {
    const { blocks, types, invalid } = s.value;
    const chips = types.length
        ? `<div class="chips" style="margin-top:8px;">${types.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>`
        : '';
    return `
        <div class="card">
            <h2>Structured data (JSON-LD) ${badge(s.status)}</h2>
            <p class="msg">${esc(s.message)}</p>
            <dl class="kv">
                <dt>JSON-LD blocks</dt><dd>${blocks}</dd>
                <dt>Invalid blocks</dt><dd>${invalid}</dd>
                <dt>Schema types</dt><dd>${types.length || '0'}</dd>
            </dl>
            ${chips}
        </div>
    `;
}

function hreflangCard(h) {
    const { entries, hasXDefault } = h.value;
    const rows = entries.map((e) =>
        `<dt>${esc(e.lang)}</dt><dd>${esc(e.href)}</dd>`).join('');
    return `
        <div class="card">
            <h2>Hreflang ${badge(h.status)}</h2>
            <p class="msg">${esc(h.message)}</p>
            ${entries.length ? `
                <dl class="kv">
                    <dt>Total tags</dt><dd>${entries.length}</dd>
                    <dt>x-default</dt><dd>${hasXDefault ? 'yes' : 'no'}</dd>
                </dl>
                <dl class="kv" style="margin-top:8px;">${rows}</dl>
            ` : ''}
        </div>
    `;
}

function faviconCard(f) {
    const { icons } = f.value;
    const rows = icons.map((i) =>
        `<dt>${esc(i.rel)}</dt><dd>${esc(i.href)}</dd>`).join('');
    return `
        <div class="card">
            <h2>Favicon ${badge(f.status)}</h2>
            <p class="msg">${esc(f.message)}</p>
            ${rows ? `<dl class="kv">${rows}</dl>` : ''}
        </div>
    `;
}

function robotsCard(r) {
    const { url, present, sitemaps, allowed, content, truncated } = r.value;
    const smList = sitemaps && sitemaps.length
        ? `<dl class="kv"><dt>Sitemap directives</dt><dd>${sitemaps.map((s) => esc(s)).join('<br>')}</dd></dl>`
        : '';
    const body = present && content
        ? `<pre class="code-block">${esc(content)}${truncated ? '\n…(truncated)' : ''}</pre>`
        : '';
    return `
        <div class="card">
            <h2>robots.txt ${badge(r.status)}</h2>
            <p class="msg">${esc(r.message)}</p>
            <dl class="kv">
                <dt>URL</dt><dd>${esc(url || '—')}</dd>
                <dt>Present</dt><dd>${present ? 'yes' : 'no'}</dd>
                <dt>URL allowed</dt><dd>${allowed ? 'yes' : 'no'}</dd>
            </dl>
            ${smList}
            ${body}
        </div>
    `;
}

function sitemapCard(s) {
    const { results, totalUrls, listed, newestLastmod, lastmodAgeDays } = s.value;
    const blocks = (results || []).map((r) => {
        if (!r.ok) {
            return `<div class="kv" style="margin-top:8px;">
                <dt><span class="status-pill bad">${esc(r.status || r.error || 'err')}</span></dt>
                <dd class="url">${esc(r.url)}</dd>
            </div>`;
        }
        const sample = (r.sample || []).map((u) => esc(u)).join('<br>');
        return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee;">
            <dl class="kv">
                <dt><span class="status-pill ok">${r.status}</span></dt><dd class="url">${esc(r.url)}</dd>
                <dt>Type</dt><dd>${r.isIndex ? 'sitemap index' : 'urlset'}</dd>
                <dt>URLs</dt><dd>${r.count}</dd>
                ${!r.isIndex ? `<dt>Listed?</dt><dd>${r.listed ? 'yes' : 'no'}</dd>` : ''}
                ${!r.isIndex && r.lastmodCount ? `<dt>lastmod entries</dt><dd>${r.lastmodCount}</dd>` : ''}
                ${r.mostRecent ? `<dt>Most recent lastmod</dt><dd>${esc(r.mostRecent)}</dd>` : ''}
                ${sample ? `<dt>Sample</dt><dd>${sample}</dd>` : ''}
            </dl>
        </div>`;
    }).join('');
    return `
        <div class="card">
            <h2>Sitemap ${badge(s.status)}</h2>
            <p class="msg">${esc(s.message)}</p>
            <dl class="kv">
                <dt>Total URLs (all sitemaps)</dt><dd>${totalUrls.toLocaleString()}</dd>
                <dt>This URL listed</dt><dd>${listed ? 'yes' : 'no / not verified'}</dd>
                ${newestLastmod ? `<dt>Newest lastmod</dt><dd>${esc(newestLastmod)}${lastmodAgeDays != null ? ` <span style="color:#999;">(${lastmodAgeDays} days ago)</span>` : ''}</dd>` : ''}
            </dl>
            ${blocks}
        </div>
    `;
}

function internalLinksCard(l) {
    const { total, contextual, navigational, other, nofollow, topAnchors, generic, genericExamples, placeholderEmpty, placeholderHash } = l.value;
    const anchorRows = topAnchors.map((a) =>
        `<dt>${esc(a.anchor.slice(0, 60))}</dt><dd>${a.count}</dd>`).join('');
    const genericList = genericExamples.length
        ? `<dl class="kv" style="margin-top:8px;"><dt>Generic-anchor examples</dt><dd>${
            genericExamples.map((g) => `<em>"${esc(g.anchor)}"</em> → ${esc(g.url)}`).join('<br>')
        }</dd></dl>`
        : '';
    return `
        <div class="card">
            <h2>Internal links ${badge(l.status)}</h2>
            <p class="msg">${esc(l.message)}</p>
            <dl class="kv">
                <dt>Total internal</dt><dd>${total}</dd>
                <dt>Contextual (in content)</dt><dd>${contextual}</dd>
                <dt>Navigational</dt><dd>${navigational}</dd>
                <dt>Other</dt><dd>${other}</dd>
                <dt>Nofollow internal</dt><dd>${nofollow}</dd>
                <dt>Generic anchors</dt><dd>${generic}</dd>
                <dt>Empty href ("")</dt><dd>${placeholderEmpty}</dd>
                <dt>Placeholder href ("#")</dt><dd>${placeholderHash}</dd>
            </dl>
            ${anchorRows ? `<h3 style="font-size:14px;margin-top:14px;margin-bottom:6px;">Top anchor texts</h3><dl class="kv">${anchorRows}</dl>` : ''}
            ${genericList}
        </div>
    `;
}

function externalLinksCard(l) {
    const { total, follow, nofollow, topDomains, unsafeTargetBlank, unsafeExamples } = l.value;
    const domainRows = topDomains.map((d) =>
        `<dt>${esc(d.domain)}</dt><dd>${d.count}</dd>`).join('');
    const unsafeList = unsafeExamples.length
        ? `<dl class="kv" style="margin-top:8px;"><dt>Unsafe target="_blank"</dt><dd>${unsafeExamples.map((u) => esc(u)).join('<br>')}</dd></dl>`
        : '';
    return `
        <div class="card">
            <h2>External links ${badge(l.status)}</h2>
            <p class="msg">${esc(l.message)}</p>
            <dl class="kv">
                <dt>Total external</dt><dd>${total}</dd>
                <dt>Follow</dt><dd>${follow}</dd>
                <dt>Nofollow</dt><dd>${nofollow}</dd>
                <dt>Unsafe target="_blank"</dt><dd>${unsafeTargetBlank}</dd>
            </dl>
            ${domainRows ? `<h3 style="font-size:14px;margin-top:14px;margin-bottom:6px;">Top external domains</h3><dl class="kv">${domainRows}</dl>` : ''}
            ${unsafeList}
        </div>
    `;
}

function linkReachabilityCard(l) {
    const { total, internal, external, probes } = l.value;
    const rows = probes.map((p) => {
        const ok = p.ok;
        const statusLabel = p.status || (p.error || 'err');
        return `<tr>
            <td><span class="status-pill ${ok ? 'ok' : 'bad'}">${esc(statusLabel)}</span></td>
            <td class="url">${esc(p.url)}</td>
        </tr>`;
    }).join('');
    return `
        <div class="card">
            <h2>Link reachability ${badge(l.status)}</h2>
            <p class="msg">${esc(l.message)}</p>
            <dl class="kv">
                <dt>Total links</dt><dd>${total}</dd>
                <dt>Internal</dt><dd>${internal}</dd>
                <dt>External</dt><dd>${external}</dd>
            </dl>
            ${rows ? `<table class="link-table"><thead><tr><th>Status</th><th>URL</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        </div>
    `;
}

function backlinksCard(b) {
    const { tools } = b.value;
    const links = tools.map((t) =>
        `<li><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a> — <span style="color:#777;">${esc(t.note)}</span></li>`
    ).join('');
    return `
        <div class="card">
            <h2>Backlinks (inbound) ${badge('info')}</h2>
            <p class="msg">${esc(b.message)}</p>
            <p style="font-size:14px;color:#555;">
                Backlinks point TO your URL from other websites. Detecting them requires a
                full crawl of the web — something a single page fetch can't do. Use one of
                these tools instead:
            </p>
            <ul style="font-size:14px;padding-left:20px;line-height:1.8;">${links}</ul>
        </div>
    `;
}

function httpHeadersCard(h) {
    const { xRobotsTag, hsts, xContentTypeOptions, xFrameOptions, csp, cspPresent, referrerPolicy, permissionsPolicy, server } = h.value;
    const fmt = (v) => v ? esc(v) : '<span style="color:#bbb;">—</span>';
    return `
        <div class="card">
            <h2>HTTP response headers ${badge(h.status)}</h2>
            <p class="msg">${esc(h.message)}</p>
            <dl class="kv">
                <dt>X-Robots-Tag</dt><dd>${fmt(xRobotsTag)}</dd>
                <dt>Strict-Transport-Security</dt><dd>${fmt(hsts)}</dd>
                <dt>X-Content-Type-Options</dt><dd>${fmt(xContentTypeOptions)}</dd>
                <dt>X-Frame-Options</dt><dd>${fmt(xFrameOptions)}</dd>
                <dt>Content-Security-Policy</dt><dd>${cspPresent ? esc(csp) : '<span style="color:#bbb;">—</span>'}</dd>
                <dt>Referrer-Policy</dt><dd>${fmt(referrerPolicy)}</dd>
                <dt>Permissions-Policy</dt><dd>${fmt(permissionsPolicy)}</dd>
                <dt>Server</dt><dd>${fmt(server)}</dd>
            </dl>
        </div>
    `;
}

function redirectChainCard(r) {
    const { hops, chain } = r.value;
    const rows = chain.map((c, i) => {
        const last = i === chain.length - 1;
        const ok = c.status >= 200 && c.status < 300;
        const redir = c.status >= 300 && c.status < 400;
        const label = c.status || (c.error || 'err');
        const cls = ok ? 'ok' : (redir ? 'warn' : 'bad');
        return `<tr>
            <td style="color:#999;font-family:monospace;">${i + 1}.</td>
            <td><span class="status-pill ${cls}">${esc(label)}</span></td>
            <td class="url">${esc(c.url)}${last ? ' <span style="color:#999;">(final)</span>' : ''}</td>
        </tr>`;
    }).join('');
    return `
        <div class="card">
            <h2>Redirect chain ${badge(r.status)}</h2>
            <p class="msg">${esc(r.message)}</p>
            <dl class="kv">
                <dt>Hops</dt><dd>${hops}</dd>
                <dt>Total requests</dt><dd>${chain.length}</dd>
            </dl>
            ${rows ? `<table class="link-table" style="margin-top:8px;"><thead><tr><th>#</th><th>Status</th><th>URL</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        </div>
    `;
}

function performanceCard(p) {
    const { hints, totalHints, blockingScripts, blockingStyles, blocking } = p.value;
    return `
        <div class="card">
            <h2>Performance hints ${badge(p.status)}</h2>
            <p class="msg">${esc(p.message)}</p>
            <dl class="kv">
                <dt>preconnect</dt><dd>${hints.preconnect}</dd>
                <dt>dns-prefetch</dt><dd>${hints.dnsPrefetch}</dd>
                <dt>preload</dt><dd>${hints.preload}</dd>
                <dt>prefetch</dt><dd>${hints.prefetch}</dd>
                <dt>modulepreload</dt><dd>${hints.modulepreload}</dd>
                <dt>Total resource hints</dt><dd>${totalHints}</dd>
                <dt>Render-blocking scripts</dt><dd>${blockingScripts}</dd>
                <dt>Render-blocking stylesheets</dt><dd>${blockingStyles}</dd>
                <dt>Total blocking</dt><dd>${blocking}</dd>
            </dl>
        </div>
    `;
}

function urlStructureCard(u) {
    const { length, uppercase, underscores, hyphens, params, segments } = u.value;
    return `
        <div class="card">
            <h2>URL structure ${badge(u.status)}</h2>
            <p class="msg">${esc(u.message)}</p>
            <dl class="kv">
                <dt>Length</dt><dd>${length} chars</dd>
                <dt>Uppercase in path</dt><dd>${uppercase ? 'yes' : 'no'}</dd>
                <dt>Underscores in path</dt><dd>${underscores}</dd>
                <dt>Hyphens in path</dt><dd>${hyphens}</dd>
                <dt>Query parameters</dt><dd>${params}</dd>
                <dt>Path segments</dt><dd>${segments}</dd>
            </dl>
        </div>
    `;
}

function metaRefreshCard(m) {
    const { present, content, delay } = m.value;
    return `
        <div class="card">
            <h2>Meta refresh ${badge(m.status)}</h2>
            <p class="msg">${esc(m.message)}</p>
            <dl class="kv">
                <dt>Present</dt><dd>${present ? 'yes' : 'no'}</dd>
                ${present ? `<dt>Content</dt><dd>${esc(content)}</dd>` : ''}
                ${present && delay != null ? `<dt>Delay</dt><dd>${delay}s</dd>` : ''}
            </dl>
        </div>
    `;
}

function pwaCard(p) {
    const { manifest, themeColor, amp } = p.value;
    const fmt = (v) => v ? esc(v) : '<span style="color:#bbb;">—</span>';
    return `
        <div class="card">
            <h2>PWA / Mobile ${badge(p.status)}</h2>
            <p class="msg">${esc(p.message)}</p>
            <dl class="kv">
                <dt>Web app manifest</dt><dd>${fmt(manifest)}</dd>
                <dt>theme-color</dt><dd>${fmt(themeColor)}</dd>
                <dt>AMP version</dt><dd>${fmt(amp)}</dd>
            </dl>
        </div>
    `;
}

function feedsCard(f) {
    const { feeds } = f.value;
    const rows = feeds.map((x) =>
        `<dt>${esc(x.type)}</dt><dd>${esc(x.href)}${x.title ? ` <span style="color:#999;">(${esc(x.title)})</span>` : ''}</dd>`
    ).join('');
    return `
        <div class="card">
            <h2>RSS / Atom feeds ${badge(f.status)}</h2>
            <p class="msg">${esc(f.message)}</p>
            ${rows ? `<dl class="kv">${rows}</dl>` : ''}
        </div>
    `;
}

function imageReachabilityCard(i) {
    const { total, probes } = i.value;
    const rows = probes.map((p) => {
        const ok = p.ok;
        const statusLabel = p.status || (p.error || 'err');
        return `<tr>
            <td><span class="status-pill ${ok ? 'ok' : 'bad'}">${esc(statusLabel)}</span></td>
            <td class="url">${esc(p.url)}</td>
        </tr>`;
    }).join('');
    return `
        <div class="card">
            <h2>Image reachability ${badge(i.status)}</h2>
            <p class="msg">${esc(i.message)}</p>
            <dl class="kv">
                <dt>Total image URLs</dt><dd>${total}</dd>
                <dt>Probed</dt><dd>${probes.length}</dd>
            </dl>
            ${rows ? `<table class="link-table"><thead><tr><th>Status</th><th>URL</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        </div>
    `;
}
