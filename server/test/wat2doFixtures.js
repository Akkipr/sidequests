// Builds HTML that mirrors the structure of a rendered wat2do.ca event card (link + data-slot attributes + a Lucide
// icon on each row), filled with made-up events. If WAT2DO's markup changes, update this and services/wat2do.js together.
const icon = (name) => `<svg class="lucide lucide-${name} size-4"></svg>`;

function card({ id, title, organizer = '@uwclub', img = 'https://wat2do.io/media/event-images/abc.jpg', rows = [], registration = false, omitTitle = false }) {
  const row = ([kind, text]) => `<div>${icon(kind)}<span title="${text}">${text}</span></div>`;
  return `<div style="opacity: 1"><a href="/events/${id}"><div data-slot="card">
    <div><img alt="${title}" loading="lazy" src="${img}">${organizer ? `<div><div><div>${organizer}</div></div></div>` : ''}</div>
    <div data-slot="card-header">${omitTitle ? '' : `<div data-slot="card-title" title="${title}">${title}</div>`}</div>
    <div data-slot="card-content">${rows.map(row).join('')}${registration ? '<div>Registration required</div>' : ''}<div><button>${icon('heart')}</button></div></div>
  </div></a></div>`;
}

const page = (...cards) => `<!doctype html><html><body>
  <nav><a href="/events">Events</a><a href="/clubs">Clubs</a><a href="/events/create">New</a></nav>
  <main>${cards.join('\n')}</main></body></html>`;

module.exports = { card, page, icon };
