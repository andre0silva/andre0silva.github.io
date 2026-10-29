// Autoavaliação ISO/IEC 27090 — questionário, painel de resultado (estilo apuração) e exportação
(function(){
'use strict';
var Q = window.AA_Q || [];
var ST = {M:'Mínimo', E:'Estabelecido', A:'Avançado'};
var OPTS = [['2','Sim'],['1','Parcial'],['0','Não'],['na','Não se aplica']];
var LAB = {'2':'Sim','1':'Parcial','0':'Não','na':'Não se aplica'};
var KEY = 'iso27090-autoavaliacao-v2';
var DOMS = []; Q.forEach(function(q){ if (DOMS.indexOf(q.d) < 0) DOMS.push(q.d); });

var $ = function(id){ return document.getElementById(id); };
var esc = function(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };

/* ---------- Questionário ---------- */
var form = $('aa'), html = '', dom = null;
Q.forEach(function(q, i){
  if (q.d !== dom){ dom = q.d; html += '<h2 id="d' + DOMS.indexOf(dom) + '"><span class="dnum">' + (DOMS.indexOf(dom) + 1) + '</span> ' + esc(dom) + '</h2>'; }
  html += '<fieldset class="q"><legend class="vh">Pergunta ' + (i + 1) + '</legend>' +
    '<p class="qt">' + esc(q.t) + '</p>' +
    '<p><b>' + (i + 1) + '.</b> ' + esc(q.q) + '</p>' +
    '<p class="ref"><span class="chip' + (q.s === 'M' ? ' sig' : '') + '">' + ST[q.s] + '</span> ' + esc(q.r) + '</p><div class="opts">';
  OPTS.forEach(function(o){ html += '<label><input type="radio" name="q' + i + '" value="' + o[0] + '"><span>' + o[1] + '</span></label>'; });
  html += '</div></fieldset>';
});
form.innerHTML = html;
$('tot').textContent = Q.length;

function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ return {}; } }
function save(a){ try { localStorage.setItem(KEY, JSON.stringify(a)); } catch(e){} }
function answers(){
  var a = {};
  Q.forEach(function(q, i){ var c = form.querySelector('input[name=q' + i + ']:checked'); if (c) a[i] = c.value; });
  return a;
}
var saved = load();
Object.keys(saved).forEach(function(i){
  var el = form.querySelector('input[name=q' + i + '][value="' + saved[i] + '"]'); if (el) el.checked = true;
});

/* ---------- Cálculo ---------- */
function level(a){
  function ok(s){
    var items = []; Q.forEach(function(q, i){ if (q.s === s && a[i] !== 'na') items.push(i); });
    if (!items.length) return true;
    var sum = 0;
    for (var k = 0; k < items.length; k++){ var v = a[items[k]]; if (v === undefined || v === '0') return false; sum += +v; }
    return sum / items.length >= 1.5;
  }
  if (!ok('M')) return 'Abaixo do mínimo';
  if (!ok('E')) return 'Mínimo';
  if (!ok('A')) return 'Estabelecido';
  return 'Avançado';
}
function compute(a){
  var n = 0, got = 0, max = 0, doms = DOMS.map(function(d){ return {d:d, got:0, max:0, n:0}; });
  Q.forEach(function(q, i){
    var v = a[i]; if (v === undefined) return; n++;
    var D = doms[DOMS.indexOf(q.d)]; D.n++;
    if (v === 'na') return;
    max += 2; got += +v; D.max += 2; D.got += +v;
  });
  doms.forEach(function(D){ D.pct = D.max ? Math.round(D.got / D.max * 100) : null; });
  return {
    n: n, pct: max ? Math.round(got / max * 100) : 0, doms: doms,
    level: n === Q.length ? level(a) : (n ? 'Parcial' : '—')
  };
}

/* ---------- Cores ---------- */
function cssv(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function palette(light){
  if (light) return {bg:'#ffffff', fg:'#14232b', muted:'#5a6b73', line:'#d5dee2', accent:'#0d5e6e', signal:'#b86a12', bad:'#a63d32'};
  return {bg:cssv('--bg'), fg:cssv('--fg'), muted:cssv('--muted'), line:cssv('--line'), accent:cssv('--accent'), signal:cssv('--signal'), bad:cssv('--bad')};
}
function rgb(h){
  h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
  var n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function mix(c, f, white){
  var r = rgb(c);
  return 'rgb(' + r.map(function(x){ var v = white ? x + (255 - x) * white : x * f; return Math.max(0, Math.min(255, Math.round(v))); }).join(',') + ')';
}
function colorFor(p, pal){ return p === null ? pal.muted : p < 40 ? pal.bad : p < 75 ? pal.signal : pal.accent; }

/* ---------- Painel de resultado (estilo apuração) ---------- */
var FONTS = {display: '"Archivo","Arial Narrow",system-ui,sans-serif', body: '"Source Sans 3",system-ui,sans-serif', mono: '"JetBrains Mono",ui-monospace,monospace'};
var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var state = null, rows = {}, rankEl = $('rank'), shown = {};
function band(p){ return p === null ? 'none' : p < 40 ? 'low' : p < 75 ? 'mid' : 'ok'; }
function ranked(doms){
  return doms.map(function(D, i){ return {D: D, i: i}; }).sort(function(a, b){
    var pa = a.D.pct === null ? -1 : a.D.pct, pb = b.D.pct === null ? -1 : b.D.pct;
    return pb - pa || a.i - b.i;
  });
}
function countTo(el, key, to, suffix){
  var from = shown[key] === undefined ? 0 : shown[key];
  shown[key] = to;
  if (to === null){ el.textContent = '—'; return; }
  if (REDUCED || from === to){ el.textContent = to + suffix; return; }
  var t0 = performance.now(), dur = 650;
  (function step(t){
    var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round((from || 0) + (to - (from || 0)) * e) + suffix;
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
function renderBoard(r){
  var total = Q.length, frac = r.n / total;
  $('bp-val').textContent = r.n + ' de ' + total + ' · ' + (Math.round(frac * 1000) / 10).toString().replace('.', ',') + '%';
  $('bp-fill').style.width = (frac * 100) + '%';
  countTo($('bh-pct'), 'total', r.pct, '%');
  $('bh-pct').className = 'b-' + band(r.pct);
  $('bh-lvl').textContent = r.level;
  // linhas: cria uma vez por domínio e reordena com animação (FLIP)
  var before = {};
  Object.keys(rows).forEach(function(k){ before[k] = rows[k].getBoundingClientRect().top; });
  var order = ranked(r.doms);
  order.forEach(function(o, pos){
    var li = rows[o.i];
    if (!li){
      li = document.createElement('li'); li.className = 'rrow';
      li.innerHTML = '<span class="rpos"></span><span class="rname"></span><span class="rval"></span>' +
        '<span class="rtrack"><i class="rfill"></i><span class="rtick" style="left:40%"></span><span class="rtick" style="left:75%"></span></span>';
      li.querySelector('.rname').textContent = (o.i + 1) + '. ' + o.D.d;
      rows[o.i] = li;
    }
    li.querySelector('.rpos').textContent = o.D.pct === null ? '–' : (pos + 1) + 'º';
    li.dataset.band = band(o.D.pct);
    li.querySelector('.rfill').style.width = (o.D.pct || 0) + '%';
    li.setAttribute('aria-label', o.D.d + ': ' + (o.D.pct === null ? 'sem resposta' : o.D.pct + '%'));
    countTo(li.querySelector('.rval'), 'd' + o.i, o.D.pct, '%');
    rankEl.appendChild(li);
  });
  if (!REDUCED) Object.keys(rows).forEach(function(k){
    if (before[k] === undefined) return;
    var dy = before[k] - rows[k].getBoundingClientRect().top;
    if (!dy) return;
    var li = rows[k];
    li.style.transition = 'none'; li.style.transform = 'translateY(' + dy + 'px)';
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ li.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1)'; li.style.transform = ''; }); });
  });
}

/* ---------- Atualização da página ---------- */
function update(){
  var a = answers(); save(a);
  var r = compute(a); state = r;
  $('pct').textContent = r.pct + '%';
  $('barfill').style.width = r.pct + '%';
  $('cnt').textContent = r.n;
  $('lvl').textContent = r.level;
  var has = r.n > 0;
  $('viz').hidden = !has; $('export').hidden = !has; $('empty-msg').hidden = has;
  if (has) renderBoard(r);
  var order = {M:0, E:1, A:2};
  var gaps = Q.map(function(q, i){ return {q:q, i:i, v:a[i]}; }).filter(function(x){ return x.v === '0' || x.v === '1'; })
    .sort(function(x, y){ return order[x.q.s] - order[y.q.s] || (+x.v) - (+y.v); });
  var h = '';
  if (has){
    h = '<h2 id="gaps">Gaps em ordem de prioridade</h2>';
    if (!gaps.length) h += '<p>Nenhum gap nas perguntas respondidas.</p>';
    gaps.forEach(function(g){
      h += '<div class="gap' + (g.v === '1' ? ' part' : '') + '">' +
        '<p class="gap-head"><b>' + esc(g.q.t) + '</b><span class="gap-tags"><span class="chip' + (g.q.s === 'M' ? ' sig' : '') + '">' + ST[g.q.s] + '</span><span class="gap-st">' + (g.v === '1' ? 'Parcial' : 'Não') + '</span></span></p>' +
        '<p class="gap-meta">' + esc(g.q.d) + ' · Pergunta ' + (g.i + 1) + ' · Ref.: ' + esc(g.q.r) + '</p>' +
        '<p>' + esc(g.q.q) + '</p>' +
        '<p><b>Próximo passo:</b> ' + esc(g.q.rec) + '</p>' +
        (g.q.l ? '<p class="gap-link"><a href="' + esc(g.q.l) + '">Ver no guia →</a></p>' : '') +
        '</div>';
    });
  }
  $('gaps-box').innerHTML = h;
}
form.addEventListener('change', update);
update();

/* ---------- Exportação ---------- */
function today(){ var d = new Date(); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear(); }
function download(blob, name){
  var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(function(){ URL.revokeObjectURL(link.href); }, 2000);
}
function rr(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function card(){
  var r = state, pal = palette(true), W = 1200, PAD = 72, ROW = 92;
  var order = ranked(r.doms), H = 560 + order.length * ROW + 170;
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var g = c.getContext('2d'), stretch = function(on){ if ('fontStretch' in g) g.fontStretch = on ? 'semi-expanded' : 'normal'; };
  var colOf = function(p){ return colorFor(p, pal); };
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  // faixa superior escura
  g.fillStyle = '#14232b'; g.fillRect(0, 0, W, 300);
  g.fillStyle = pal.accent; g.fillRect(0, 300, W, 8);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = '#97a9b1'; g.font = '500 20px ' + FONTS.mono; g.fillText('AUTOAVALIAÇÃO · ISO/IEC 27090:2026', PAD, 78);
  stretch(true); g.fillStyle = '#ffffff'; g.font = '800 46px ' + FONTS.display; g.fillText('Maturidade em segurança de IA', PAD, 136); stretch(false);
  // "apuração": perguntas respondidas
  var frac = r.n / Q.length, bx = PAD, by = 214, bw = W - PAD * 2;
  g.fillStyle = '#97a9b1'; g.font = '500 18px ' + FONTS.mono; g.fillText('PERGUNTAS RESPONDIDAS', bx, by - 14);
  g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.font = '600 22px ' + FONTS.body;
  g.fillText(r.n + ' de ' + Q.length + ' · ' + (Math.round(frac * 1000) / 10).toString().replace('.', ',') + '%', W - PAD, by - 12); g.textAlign = 'left';
  g.fillStyle = '#2a3a42'; rr(g, bx, by, bw, 14, 7); g.fill();
  g.fillStyle = '#5fbccd'; rr(g, bx, by, Math.max(14, bw * frac), 14, 7); g.fill();
  g.fillStyle = '#97a9b1'; g.font = '20px ' + FONTS.body; g.fillText("Gerado em " + today(), PAD, 272);
  // pontuação geral e nível
  stretch(true); g.fillStyle = colOf(r.pct); g.font = '800 120px ' + FONTS.display; g.fillText(r.pct + '%', PAD, 450);
  var pw = g.measureText(r.pct + '%').width; stretch(false);
  g.fillStyle = pal.muted; g.font = '500 18px ' + FONTS.mono; g.fillText('PONTUAÇÃO GERAL', PAD, 344);
  g.fillText('NÍVEL DE MATURIDADE', PAD + pw + 60, 382);
  stretch(true); g.fillStyle = pal.fg; g.font = '700 40px ' + FONTS.display; g.fillText(r.level, PAD + pw + 60, 430); stretch(false);
  // legenda
  var lx = PAD + pw + 60, ly = 466;
  [['75% ou mais', pal.accent], ['40% a 74%', pal.signal], ['abaixo de 40%', pal.bad]].forEach(function(L){
    g.fillStyle = L[1]; rr(g, lx, ly - 13, 16, 16, 3); g.fill();
    g.fillStyle = pal.muted; g.font = '19px ' + FONTS.body; g.fillText(L[0], lx + 24, ly); lx += g.measureText(L[0]).width + 60;
  });
  // ranking
  g.fillStyle = pal.muted; g.font = '500 18px ' + FONTS.mono; g.fillText('RANKING POR DOMÍNIO', PAD, 540);
  var y = 580, trackX = PAD + 64, trackW = W - PAD * 2 - 64 - 130;
  order.forEach(function(o, pos){
    var p = o.D.pct, col = colOf(p);
    stretch(true); g.fillStyle = pal.fg; g.font = '800 34px ' + FONTS.display; g.fillText(p === null ? '–' : (pos + 1) + 'º', PAD, y + 50); stretch(false);
    g.fillStyle = pal.fg; g.font = '600 24px ' + FONTS.body; g.fillText((o.i + 1) + '. ' + o.D.d, trackX, y + 18);
    g.fillStyle = '#e8eef0'; rr(g, trackX, y + 32, trackW, 30, 4); g.fill();
    if (p){ var grad = g.createLinearGradient(0, y + 32, 0, y + 62); grad.addColorStop(0, mix(col, 0, 0.18)); grad.addColorStop(1, col);
      g.fillStyle = grad; rr(g, trackX, y + 32, Math.max(8, trackW * p / 100), 30, 4); g.fill(); }
    [40, 75].forEach(function(t){ g.fillStyle = 'rgba(20,35,43,.35)'; g.fillRect(trackX + trackW * t / 100 - 1, y + 28, 2, 38); });
    stretch(true); g.textAlign = 'right'; g.fillStyle = p === null ? pal.muted : col; g.font = '800 40px ' + FONTS.display;
    g.fillText(p === null ? '—' : p + '%', W - PAD, y + 60); g.textAlign = 'left'; stretch(false);
    y += ROW;
  });
  // escala
  g.fillStyle = pal.muted; g.font = '16px ' + FONTS.mono; g.textAlign = 'center';
  [0, 40, 75, 100].forEach(function(t){ g.fillText(String(t), trackX + trackW * t / 100, y + 6); }); g.textAlign = 'left';
  // rodapé
  g.fillStyle = pal.line; g.fillRect(PAD, H - 96, W - PAD * 2, 1);
  g.fillStyle = pal.muted; g.font = '19px ' + FONTS.body;
  g.fillText('andre0silva.github.io/iso27090 · Material de apoio, não é certificação nem comprova conformidade · CC BY-NC 4.0', PAD, H - 56);
  return c;
}
$('png').addEventListener('click', function(){
  if (!state) return;
  var go = function(){ card().toBlob(function(b){ if (b) download(b, 'autoavaliacao-iso27090.png'); }, 'image/png'); };
  (document.fonts && document.fonts.ready) ? document.fonts.ready.then(go) : go();
});
$('csv').addEventListener('click', function(){
  var a = answers(), r = compute(a);
  var rows2 = [['#','Domínio','Tema','Estágio','Pergunta','Referência','Resposta','Próximo passo']];
  Q.forEach(function(q, i){ var v = a[i]; rows2.push([i + 1, q.d, q.t, ST[q.s], q.q, q.r, v === undefined ? '' : LAB[v], (v === '0' || v === '1') ? q.rec : '']); });
  rows2.push([]); rows2.push(['Posição', 'Domínio', 'Pontuação']);
  ranked(r.doms).forEach(function(o, pos){ rows2.push([o.D.pct === null ? '' : (pos + 1) + 'º', o.D.d, o.D.pct === null ? '' : o.D.pct + '%']); });
  rows2.push([]); rows2.push(['Pontuação geral', r.pct + '%']); rows2.push(['Nível', r.level]); rows2.push(['Data', today()]);
  var csv = rows2.map(function(row){ return row.map(function(c){ return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
  download(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}), 'autoavaliacao-iso27090.csv');
});
$('print').addEventListener('click', function(){ window.print(); });
$('reset').addEventListener('click', function(){
  if (!window.confirm('Apagar todas as respostas desta autoavaliação?')) return;
  form.querySelectorAll('input:checked').forEach(function(el){ el.checked = false; });
  update();
});
})();
