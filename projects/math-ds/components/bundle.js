/* @ds-bundle: {"format":4,"namespace":"MathMotion","components":[{"name":"Eyebrow"},{"name":"Card"},{"name":"Stat"}]} */
(function () {
  // No React: each component returns an element. Text goes in as text, never as HTML.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  window.MathMotion = {
    Eyebrow: function (p) { return el('p', 'mm-eyebrow', p.text); },
    Stat: function (p) { return el('p', 'mm-stat', p.value); },
    Card: function (p) {
      var c = el('div', 'mm-card');
      c.appendChild(el('p', 'mm-stat', p.value));
      if (p.caption) c.appendChild(el('p', 'mm-caption', p.caption));
      return c;
    },
  };
})();
