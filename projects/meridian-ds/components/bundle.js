/* @ds-bundle: {"format":4,"namespace":"Meridian","components":[{"name":"Button"},{"name":"Badge"},{"name":"Card"},{"name":"Eyebrow"}]} */
(function () {
  // No React: each component returns an element. Text goes in as text, never as HTML.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  window.Meridian = {
    Button: function (p) {
      var b = el('button', 'mr-button mr-button--' + (p.variant || 'secondary'), p.label);
      b.type = 'button';
      if (p.disabled) b.disabled = true;
      return b;
    },
    Badge: function (p) { return el('span', 'mr-badge mr-badge--' + (p.tone || 'neutral'), p.label); },
    Card: function (p) {
      var c = el('div', 'mr-card');
      if (p.label) c.appendChild(el('p', 'mr-label', p.label));
      c.appendChild(el('p', 'mr-stat', p.value));
      if (p.caption) c.appendChild(el('p', 'mr-caption' + (p.trend ? ' mr-caption--' + p.trend : ''), p.caption));
      return c;
    },
    Eyebrow: function (p) { return el('p', 'mr-eyebrow', p.text); },
  };
})();
