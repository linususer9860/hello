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
    results.innerHTML = '<div class="loading">Fetching and analyzing the page</div>';

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
        summaryCard(url, finalUrl, status, responseMs),
        coreMetaCard(checks),
        headingsCard(checks.headings),
        socialCard(checks.social),
        technicalCard(checks.technical),
        imagesCard(checks.images),
        linksCard(checks.links),
    ];
    results.innerHTML = cards.join('');
}

function summaryCard(url, finalUrl, status, responseMs) {
    const redirected = finalUrl && finalUrl !== url;
    const statusOk = status >= 200 && status < 400;
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
        </div>
    `;
}

function coreMetaCard(checks) {
    const { title, description, canonical } = checks;
    return `
        <div class="card">
            <h2>Title ${badge(title.status)}</h2>
            <p class="msg">${esc(title.message)}</p>
            <dl class="kv">
                <dt>Text</dt><dd>${esc(title.value.text || '—')}</dd>
                <dt>Length</dt><dd>${title.value.length} chars</dd>
            </dl>
        </div>
        <div class="card">
            <h2>Meta description ${badge(description.status)}</h2>
            <p class="msg">${esc(description.message)}</p>
            <dl class="kv">
                <dt>Text</dt><dd>${esc(description.value.text || '—')}</dd>
                <dt>Length</dt><dd>${description.value.length} chars</dd>
            </dl>
        </div>
        <div class="card">
            <h2>Canonical URL ${badge(canonical.status)}</h2>
            <p class="msg">${esc(canonical.message)}</p>
            <dl class="kv">
                <dt>Href</dt><dd>${esc(canonical.value.href || '—')}</dd>
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
    const { og, twitter, ogImage } = s.value;
    const preview = ogImage ? `
        <div class="og-preview">
            <img src="${esc(ogImage)}" alt="OG image preview" onerror="this.style.display='none'">
            <div class="meta">
                <strong>${esc(og['og:title'] || '(no og:title)')}</strong>
                ${esc(og['og:description'] || '(no og:description)')}
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
            <h2>Technical ${badge(t.status)}</h2>
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
    const { total, missingAlt, missingCount } = i.value;
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
            </dl>
            ${examples}
        </div>
    `;
}

function linksCard(l) {
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
            <h2>Links ${badge(l.status)}</h2>
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
