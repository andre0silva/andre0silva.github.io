// Sumário automático da página
(function(){
  document.addEventListener('DOMContentLoaded', function(){
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
