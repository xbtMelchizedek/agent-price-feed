const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const et = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
const KINDS = ['price-drop', 'price-rise', 'cheapest-change', 'new-offer', 'new-model', 'new-venue', 'removed-offer', 'flop-listing', 'flop-watch', 'source-down', 'source-back'];
const on = new Set(KINDS);
let data = { events: [] };

function render() {
  const q = $('q').value.trim().toLowerCase();
  const ev = data.events.filter((e) => on.has(e.kind) && (!q || `${e.model} ${e.provider} ${e.title}`.toLowerCase().includes(q)));
  $('list').innerHTML = ev.length ? ev.slice(0, 200).map((e) => `
    <article class="ev" id="${esc(e.id)}">
      <span class="badge">${esc(e.kind)}</span> <span class="muted">${esc(et(e.at))}</span>
      <h3 class="${e.kind === 'price-drop' ? 'down' : e.kind === 'price-rise' ? 'up' : ''}">${esc(e.title)}</h3>
      <p>${esc(e.summary)}</p>
      ${/^https:\/\//.test(e.source ?? "") ? `<p><a href="${esc(e.source)}" rel="noopener">source</a></p>` : ''}
    </article>`).join('')
    : `<p class="muted">${data.events.length ? 'No events match.' : 'No events yet. The first build is a baseline; changes show up from the next run (every 2 hours).'}</p>`;
}

function chips() {
  $('chips').innerHTML = KINDS.map((k) => `<button type="button" data-k="${k}" aria-pressed="${on.has(k)}">${k}</button>`).join('');
}
$('chips').addEventListener('click', (ev) => {
  const k = ev.target.closest('button')?.dataset.k;
  if (!k) return;
  on.has(k) ? on.delete(k) : on.add(k);
  chips();
  render();
});
$('q').addEventListener('input', render);

try {
  const r = await fetch('data/events.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  data = await r.json();
  $('meta').textContent = `Built ${et(data.builtAt)} from the justweight snapshot of ${et(data.snapshotAt)}. Last run: ${data.run.kind}, ${data.run.newEvents} new event(s)${data.run.truncated ? `, ${data.run.truncated} more not kept` : ''}. ${data.events.length} kept.`;
} catch (e) {
  $('meta').textContent = `Could not load events: ${e.message}`;
}
chips();
render();
