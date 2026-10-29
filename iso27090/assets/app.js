// Tema claro/escuro e sumário automático da página
(function(){
  var root = document.documentElement;
  function stored(){ try { return localStorage.getItem('iso27090-theme'); } catch(e){ return null; } }
  function save(v){ try { localStorage.setItem('iso27090-theme', v); } catch(e){} }
  var t = stored();
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);

  document.addEventListener('DOMContentLoaded', function(){
    var btn = document.querySelector('.theme-btn');
    function label(){
      var dark = root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (btn) btn.textContent = dark ? 'Tema claro' : 'Tema escuro';
      return dark;
    }
    label();
    if (btn) btn.addEventListener('click', function(){
      var next = label() ? 'light' : 'dark';
      root.setAttribute('data-theme', next); save(next); label();
    });

    var toc = document.querySelector('.toc ol');
    if (toc) {
      document.querySelectorAll('.content h2[id]').forEach(function(h){
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + h.id; a.textContent = h.dataset.toc || h.textContent;
        li.appendChild(a); toc.appendChild(li);
      });
      if (!toc.children.length) document.querySelector('.toc').remove();
    }
  });
})();
