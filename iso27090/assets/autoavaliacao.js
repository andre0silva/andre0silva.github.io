// Autoavaliação ISO/IEC 27090 — questionário, gráfico 3D (canvas) e exportação
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

/* ---------- Gráfico 3D minimalista: fileira de barras (canvas, projeção própria) ---------- */
var PITCH = 0.42, GAP = 1, HALF = 0.27, HMAX = 3.1, YAWMAX = 0.55, PERSP = 0.035;
function draw3D(ctx, W, H, doms, yaw, pal, fonts){
  ctx.clearRect(0, 0, W, H);
  var N = doms.length, L = (N - 1) / 2 * GAP + HALF + 0.25;
  var cp = Math.cos(PITCH), sp = Math.sin(PITCH), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  // enquadramento fixo para toda a faixa de rotação (sem "pulos" ao girar)
  var dz = L * Math.sin(YAWMAX) + 0.3, kN = 1 + dz * cp * PERSP;
  var up = (HMAX + 0.55) * cp + dz * sp, down = dz * sp + 0.55;
  var scale = Math.min(W / (2 * L * kN * 1.06), H / ((up + down) * kN * 1.06));
  var cx = W / 2, cy = (H - (up + down) * scale) / 2 + up * scale;
  function P(x, y, z){
    var xr = x * cyw - z * syw, zr = x * syw + z * cyw;
    var depth = zr * cp + y * sp, k = 1 + depth * PERSP;
    return {x: cx + xr * scale * k, y: cy + (-y * cp + zr * sp) * scale * k, d: depth};
  }
  function poly(pts, fill, stroke){
    ctx.beginPath();
    pts.forEach(function(p, k){ var q = P(p[0], p[1], p[2]); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath();
    if (fill){ ctx.fillStyle = fill; ctx.fill(); }
    if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, W / 1000); ctx.stroke(); }
  }
  // base: placa fina
  poly([[-L,0,-0.6],[L,0,-0.6],[L,0,0.6],[-L,0,0.6]], null, pal.line);
  var bars = doms.map(function(D, i){
    var x = (i - (N - 1) / 2) * GAP;
    return {i: i, D: D, x: x, z: 0, depth: P(x, 0, 0).d};
  }).sort(function(a, b){ return a.depth - b.depth; });
  bars.forEach(function(b){
    var x0 = b.x - HALF, x1 = b.x + HALF, z0 = -HALF, z1 = HALF;
    poly([[x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1]], pal.line);             // pegada (0%)
    if (b.D.pct === null || b.D.pct <= 0) return;
    var h = HMAX * b.D.pct / 100, c = colorFor(b.D.pct, pal);
    [[1,0,[[x1,0,z0],[x1,0,z1],[x1,h,z1],[x1,h,z0]]],
     [-1,0,[[x0,0,z1],[x0,0,z0],[x0,h,z0],[x0,h,z1]]],
     [0,1,[[x1,0,z1],[x0,0,z1],[x0,h,z1],[x1,h,z1]]],
     [0,-1,[[x0,0,z0],[x1,0,z0],[x1,h,z0],[x0,h,z0]]]].forEach(function(f){
      var nzr = f[0] * syw + f[1] * cyw; if (nzr <= 0.001) return;
      var nxr = f[0] * cyw - f[1] * syw;
      poly(f[2], mix(c, f[1] ? 0.92 : 0.74 + 0.08 * nxr));
    });
    poly([[x0,h,z0],[x1,h,z0],[x1,h,z1],[x0,h,z1]], mix(c, 0, 0.3));
  });
  // rótulos: porcentagem acima, número do domínio na frente da base
  ctx.textAlign = 'center';
  var fs = Math.max(11, Math.round(scale * 0.34));
  bars.forEach(function(b){
    var h = b.D.pct ? HMAX * b.D.pct / 100 : 0, t = P(b.x, h, 0), bt = P(b.x, 0, 0.6);
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = pal.fg;
    ctx.font = '600 ' + fs + 'px ' + fonts.display;
    ctx.fillText(b.D.pct === null ? '–' : b.D.pct + '%', t.x, t.y - scale * 0.42);
    ctx.textBaseline = 'top'; ctx.fillStyle = pal.muted;
    ctx.font = '500 ' + Math.round(fs * 0.82) + 'px ' + fonts.mono;
    ctx.fillText(String(b.i + 1), bt.x, bt.y + scale * 0.12);
  });
}
var FONTS = {display: '"Archivo","Arial Narrow",system-ui,sans-serif', body: '"Source Sans 3",system-ui,sans-serif', mono: '"JetBrains Mono",ui-monospace,monospace'};

var canvas = $('chart3d'), ctx = canvas.getContext('2d');
var yaw = YAWMAX * 0.45, phase = Math.asin(0.6), dragging = false, lastX = 0, autoSpin = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var state = null, visible = true, raf = 0;

function fit(){
  var dpr = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)){ canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  return true;
}
function render(){
  if (!state || !fit()) return;
  draw3D(ctx, canvas.width, canvas.height, state.doms, yaw, palette(false), FONTS);
}
function loop(){
  raf = 0;
  if (autoSpin && !dragging && visible && state){ phase += 0.006; yaw = YAWMAX * 0.75 * Math.sin(phase); render(); raf = requestAnimationFrame(loop); }
}
function kick(){ if (!raf && autoSpin) raf = requestAnimationFrame(loop); }
canvas.addEventListener('pointerdown', function(e){ dragging = true; autoSpin = false; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', function(e){ if (!dragging) return; yaw = Math.max(-YAWMAX, Math.min(YAWMAX, yaw - (e.clientX - lastX) * 0.008)); lastX = e.clientX; render(); });
canvas.addEventListener('pointerup', function(){ dragging = false; });
canvas.addEventListener('pointercancel', function(){ dragging = false; });
window.addEventListener('resize', render);
if ('IntersectionObserver' in window){
  new IntersectionObserver(function(en){ visible = en[0].isIntersecting; if (visible){ render(); kick(); } }).observe(canvas);
}
new MutationObserver(render).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

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
  var pal = palette(false);
  $('legend').innerHTML = r.doms.map(function(D, i){
    var c = colorFor(D.pct, pal);
    return '<li><span class="ln">' + (i + 1) + '</span><span class="lt">' + esc(D.d) + '</span>' +
      '<span class="lp">' + (D.pct === null ? '–' : D.pct + '%') + '</span>' +
      '<span class="lb"><i style="width:' + (D.pct || 0) + '%;background:' + c + '"></i></span></li>';
  }).join('');
  canvas.setAttribute('aria-label', 'Pontuação por domínio: ' + r.doms.map(function(D){ return D.d + ' ' + (D.pct === null ? 'sem resposta' : D.pct + '%'); }).join('; '));
  var order = {M:0, E:1, A:2};
  var gaps = Q.map(function(q, i){ return {q:q, i:i, v:a[i]}; }).filter(function(x){ return x.v === '0' || x.v === '1'; })
    .sort(function(x, y){ return order[x.q.s] - order[y.q.s] || (+x.v) - (+y.v); });
  var h = '';
  if (has){
    h = '<h2 id="gaps">Gaps em ordem de prioridade</h2>';
    if (!gaps.length) h += '<p>Nenhum gap nas perguntas respondidas.</p>';
    gaps.forEach(function(g){
      h += '<div class="gap' + (g.v === '1' ? ' part' : '') + '"><b>' + (g.i + 1) + '. ' + ST[g.q.s] + ' · ' + (g.v === '1' ? 'Parcial' : 'Não') + '</b><br>' + esc(g.q.q) +
        '<br><span class="muted">Próximo passo: ' + esc(g.q.rec) + '</span></div>';
    });
  }
  $('gaps-box').innerHTML = h;
  render(); kick();
}
form.addEventListener('change', update);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
update();

/* ---------- Exportação ---------- */
function today(){ var d = new Date(); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear(); }
function download(blob, name){
  var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(function(){ URL.revokeObjectURL(link.href); }, 2000);
}
function wrapText(c, text, maxW){
  var words = text.split(' '), lines = [], line = '';
  words.forEach(function(w){ var t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t; });
  if (line) lines.push(line); return lines;
}
function card(){
  var r = state, pal = palette(true), W = 1200, PAD = 72, chartH = 500, rowH = 58;
  var H = 360 + chartH + r.doms.length * rowH + 150;
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var g = c.getContext('2d');
  if ('fontStretch' in g) g.fontStretch = 'semi-expanded';
  g.fillStyle = pal.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = pal.accent; g.fillRect(0, 0, W, 10);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = pal.muted; g.font = '500 20px ' + FONTS.mono;
  g.fillText('AUTOAVALIAÇÃO · ISO/IEC 27090:2026', PAD, 92);
  g.fillStyle = pal.fg; g.font = '800 52px ' + FONTS.display;
  g.fillText('Maturidade em segurança de IA', PAD, 160);
  g.fillStyle = pal.muted; g.font = '24px ' + FONTS.body;
  g.fillText('Gerado em ' + today() + ' · ' + r.n + ' de ' + Q.length + ' perguntas respondidas', PAD, 202);
  // pontuação e nível
  g.fillStyle = pal.fg; g.font = '800 96px ' + FONTS.display; g.fillText(r.pct + '%', PAD, 312);
  var pw = g.measureText(r.pct + '%').width;
  g.fillStyle = pal.muted; g.font = '500 18px ' + FONTS.mono; g.fillText('NÍVEL', PAD + pw + 48, 262);
  g.fillStyle = pal.fg; g.font = '600 34px ' + FONTS.display; g.fillText(r.level, PAD + pw + 48, 306);
  if ('fontStretch' in g) g.fontStretch = 'normal';
  // gráfico
  g.save(); g.translate(0, 330);
  var off = document.createElement('canvas'); off.width = W; off.height = chartH;
  var og = off.getContext('2d'); if ('fontStretch' in og) og.fontStretch = 'semi-expanded';
  draw3D(og, W, chartH, r.doms, yaw, pal, FONTS);
  g.drawImage(off, 0, 0); g.restore();
  // legenda
  var y = 330 + chartH + 40;
  r.doms.forEach(function(D, i){
    var col = colorFor(D.pct, pal);
    g.fillStyle = pal.muted; g.font = '500 20px ' + FONTS.mono; g.fillText(String(i + 1), PAD, y);
    g.fillStyle = pal.fg; g.font = '26px ' + FONTS.body; g.fillText(D.d, PAD + 44, y);
    var bx = 760, bw = 300;
    g.fillStyle = pal.line; g.fillRect(bx, y - 16, bw, 10);
    g.fillStyle = col; g.fillRect(bx, y - 16, bw * (D.pct || 0) / 100, 10);
    g.fillStyle = pal.fg; g.font = '600 26px ' + FONTS.display; g.textAlign = 'right';
    g.fillText(D.pct === null ? '–' : D.pct + '%', W - PAD, y); g.textAlign = 'left';
    y += rowH;
  });
  // rodapé
  g.fillStyle = pal.line; g.fillRect(PAD, H - 110, W - PAD * 2, 1);
  g.fillStyle = pal.muted; g.font = '20px ' + FONTS.body;
  wrapText(g, 'andre0silva.github.io/iso27090 · Material de apoio, não é certificação nem comprova conformidade · CC BY-NC 4.0', W - PAD * 2)
    .forEach(function(l, k){ g.fillText(l, PAD, H - 72 + k * 28); });
  return c;
}
$('png').addEventListener('click', function(){
  if (!state) return;
  var go = function(){ card().toBlob(function(b){ if (b) download(b, 'autoavaliacao-iso27090.png'); }, 'image/png'); };
  (document.fonts && document.fonts.ready) ? document.fonts.ready.then(go) : go();
});
$('csv').addEventListener('click', function(){
  var a = answers(), r = compute(a);
  var rows = [['#','Domínio','Estágio','Pergunta','Referência','Resposta','Próximo passo']];
  Q.forEach(function(q, i){ var v = a[i]; rows.push([i + 1, q.d, ST[q.s], q.q, q.r, v === undefined ? '' : LAB[v], (v === '0' || v === '1') ? q.rec : '']); });
  rows.push([]); rows.push(['Domínio', 'Pontuação']);
  r.doms.forEach(function(D){ rows.push([D.d, D.pct === null ? '' : D.pct + '%']); });
  rows.push([]); rows.push(['Pontuação geral', r.pct + '%']); rows.push(['Nível', r.level]); rows.push(['Data', today()]);
  var csv = rows.map(function(row){ return row.map(function(c){ return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
  download(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}), 'autoavaliacao-iso27090.csv');
});
var printImg = null;
window.addEventListener('beforeprint', function(){
  if (!state) return;
  printImg = document.createElement('img'); printImg.className = 'print-only'; printImg.alt = 'Gráfico da pontuação por domínio';
  var off = document.createElement('canvas'); off.width = 1200; off.height = 640;
  draw3D(off.getContext('2d'), 1200, 640, state.doms, yaw, palette(true), FONTS);
  printImg.src = off.toDataURL('image/png'); $('viz').insertBefore(printImg, $('viz').firstChild);
});
window.addEventListener('afterprint', function(){ if (printImg){ printImg.remove(); printImg = null; } });
$('print').addEventListener('click', function(){ window.print(); });
$('reset').addEventListener('click', function(){
  if (!window.confirm('Apagar todas as respostas desta autoavaliação?')) return;
  form.querySelectorAll('input:checked').forEach(function(el){ el.checked = false; });
  update();
});
})();
