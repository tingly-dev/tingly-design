/* @ds-bundle: {"format":4,"namespace":"Tingly","components":[{"name":"Button"},{"name":"Badge"},{"name":"Card"},{"name":"Eyebrow"}]} */
(function () {
  // No React: each component returns an element. Text goes in as text, never as HTML.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  window.Tingly = {
    Button: function (p) {
      var b = el('button', 'tg-button tg-button--' + (p.variant || 'secondary'), p.label);
      b.type = 'button';
      if (p.disabled) b.disabled = true;
      return b;
    },
    Badge: function (p) { return el('span', 'tg-badge tg-badge--' + (p.tone || 'neutral'), p.label); },
    Card: function (p) {
      var c = el('div', 'tg-card');
      if (p.label) c.appendChild(el('p', 'tg-label', p.label));
      c.appendChild(el('p', 'tg-stat', p.value));
      if (p.caption) c.appendChild(el('p', 'tg-caption' + (p.trend ? ' tg-caption--' + p.trend : ''), p.caption));
      return c;
    },
    Eyebrow: function (p) { return el('p', 'tg-eyebrow', p.text); },
  };
})();
