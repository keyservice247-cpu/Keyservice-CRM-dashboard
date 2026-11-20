// Prototype nieuwe indeling (audit 20 nov 2026). Alleen voor het ontwerpvoorstel — geen verbinding met het echte CRM.
(function () {
  var NAV = [
    ['vandaag', 'Vandaag', 'vandaag.html', ''],
    ['inbox', 'Inbox', 'inbox.html', '3'],
    ['opdrachten', 'Opdrachten', 'opdrachten.html', ''],
    ['planning', 'Planning', 'later.html#planning', ''],
    ['klanten', 'Klanten & projecten', 'later.html#klanten', ''],
    ['team', 'Team', 'later.html#team', ''],
    ['cijfers', 'Cijfers', 'later.html#cijfers', ''],
    ['instellingen', 'Instellingen', 'koppelingen.html', ''],
  ];
  var pagina = document.body.getAttribute('data-pagina') || '';
  var schil = document.querySelector('[data-schil]');
  if (schil) {
    var links = NAV.map(function (n) {
      return '<a href="' + n[2] + '"' + (n[0] === pagina ? ' class="actief" aria-current="page"' : '') + '><span>' + n[1] + '</span>' + (n[3] ? '<span class="teller num">' + n[3] + '</span>' : '') + '</a>';
    }).join('');
    var zij = document.createElement('aside');
    zij.className = 'zijbalk';
    zij.innerHTML = '<a class="merk" href="index.html"><i></i>Keyservice</a><nav class="nav" aria-label="Hoofdmenu">' + links + '</nav>' +
      '<div class="onder">Noor · assistente<br><a href="index.html">Terug naar het overzicht</a></div>';
    var hoofd = document.createElement('div');
    hoofd.className = 'hoofd';
    hoofd.innerHTML = '<div class="bovenbalk"><label class="zoek"><span aria-hidden="true">Zoek</span><input id="zoek-alles" type="search" placeholder="klant, 06-nummer, postcode, factuurnummer" aria-label="Zoek in alles"></label>' +
      '<a class="status-kort" href="koppelingen.html" title="Status van de koppelingen"><i class="stip ok"></i><span>Alle koppelingen werken</span></a></div>';
    var inhoud = document.createElement('main');
    inhoud.className = 'inhoud';
    while (schil.firstChild) inhoud.appendChild(schil.firstChild);
    hoofd.appendChild(inhoud);
    schil.className = 'schil';
    schil.appendChild(zij);
    schil.appendChild(hoofd);
    var onder = document.createElement('nav');
    onder.className = 'ondernav';
    onder.setAttribute('aria-label', 'Menu onderaan');
    onder.innerHTML = [NAV[0], NAV[1], NAV[2], NAV[3], ['meer', 'Meer', 'index.html', '']].map(function (n) {
      return '<a href="' + n[2] + '"' + (n[0] === pagina ? ' class="actief"' : '') + '>' + n[1] + '</a>';
    }).join('');
    document.body.appendChild(onder);
  }

  // Tabbladen: [data-tabs] met knoppen [data-tab] en vlakken [data-vlak] binnen dezelfde [data-tabgroep].
  document.querySelectorAll('[data-tabs]').forEach(function (balk) {
    var groep = balk.closest('[data-tabgroep]') || document;
    function kies(naam) {
      balk.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === naam ? 'true' : 'false'); });
      groep.querySelectorAll('[data-vlak]').forEach(function (v) { if (v.closest('[data-tabgroep]') === (balk.closest('[data-tabgroep]'))) v.hidden = v.getAttribute('data-vlak') !== naam; });
    }
    balk.addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) kies(b.getAttribute('data-tab')); });
    var start = balk.querySelector('[aria-selected="true"]') || balk.querySelector('[data-tab]');
    if (start) kies(start.getAttribute('data-tab'));
  });

  // Bewaarde filters: knoppen [data-filter] tonen alleen elementen waarvan data-soort de waarde bevat.
  document.querySelectorAll('[data-filters]').forEach(function (balk) {
    balk.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]'); if (!b) return;
      balk.querySelectorAll('[data-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      var f = b.getAttribute('data-filter');
      document.querySelectorAll('[data-soort]').forEach(function (el) { el.hidden = f !== 'alle' && (' ' + el.getAttribute('data-soort') + ' ').indexOf(' ' + f + ' ') < 0; });
      document.querySelectorAll('[data-telt]').forEach(function (t) { var k = t.closest('.kolom'); if (k) t.textContent = k.querySelectorAll('.kaart:not([hidden])').length; });
    });
  });

  // Zijpaneel van een opdracht: elk element met data-open vult de kop en opent het paneel.
  var paneel = document.getElementById('paneel');
  if (paneel) {
    var zet = function (id, tekst) { var el = document.getElementById(id); if (el) el.textContent = tekst || ''; };
    document.addEventListener('click', function (e) {
      var bron = e.target.closest('[data-open]');
      if (bron) {
        zet('p-titel', bron.getAttribute('data-titel')); zet('p-klant', bron.getAttribute('data-klant')); zet('p-adres', bron.getAttribute('data-adres'));
        zet('p-status', bron.getAttribute('data-status')); zet('p-merk', bron.getAttribute('data-merk')); zet('p-stap', bron.getAttribute('data-stap'));
        paneel.hidden = false; var sluit = paneel.querySelector('[data-sluit]'); if (sluit) sluit.focus();
      } else if (e.target.closest('[data-sluit]')) { paneel.hidden = true; }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') paneel.hidden = true; });
  }

  // Inbox: een rij kiezen toont het bijbehorende detail.
  document.querySelectorAll('[data-kies]').forEach(function (rij) {
    rij.addEventListener('click', function () {
      document.querySelectorAll('[data-kies]').forEach(function (r) { r.setAttribute('aria-current', r === rij ? 'true' : 'false'); });
      document.querySelectorAll('[data-detail]').forEach(function (d) { d.hidden = d.getAttribute('data-detail') !== rij.getAttribute('data-kies'); });
    });
  });

  // Knoppen die alleen iets "doen alsof": tonen de tekst uit data-zeg in het element met id uit data-in.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-zeg]'); if (!b) return;
    var doel = document.getElementById(b.getAttribute('data-in')); if (doel) { doel.textContent = b.getAttribute('data-zeg'); doel.hidden = false; }
    if (b.hasAttribute('data-volgende')) { var stappen = b.getAttribute('data-volgende').split('|'); var i = Number(b.getAttribute('data-i') || 0); if (i < stappen.length) { b.textContent = stappen[i]; b.setAttribute('data-i', i + 1); } }
  });

  // Monteur: een klus openen en weer terug.
  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-klus]'); var terug = e.target.closest('[data-terug]');
    if (open) { document.querySelectorAll('[data-scherm]').forEach(function (s) { s.hidden = s.getAttribute('data-scherm') !== 'klus'; }); window.scrollTo(0, 0); }
    if (terug) { document.querySelectorAll('[data-scherm]').forEach(function (s) { s.hidden = s.getAttribute('data-scherm') !== 'lijst'; }); }
  });
})();
