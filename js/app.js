/* =========================================================
   黑体辐射可视化 PWA — 逻辑层
   物理：普朗克定律 B(λ,T) 与维恩位移定律 λ_peak = b/T
   ========================================================= */
'use strict';

/* ---------- 物理常数 ---------- */
const H = 6.62607015e-34;   // J·s
const C = 2.99792458e8;     // m/s
const KB = 1.380649e-23;    // J/K
const B_WIEN = 2.897771955e-3; // m·K
const ZFLOOR = 1e-12;       // 对数模式下限，避免 log(0)

/* ---------- 工具 ---------- */
const $ = (id) => document.getElementById(id);
const T = (id) => $(id).value;

function linspace(a, b, n) {
  if (n <= 1) return [a];
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

// 普朗克光谱辐射亮度 B(λ,T)，λ 单位 nm，返回 W·m⁻²·sr⁻¹·m⁻¹
function planck(lambdaNm, temp) {
  const lam = lambdaNm * 1e-9;            // nm -> m
  const x = (H * C) / (lam * KB * temp);  // hc / (λkT)
  const denom = Math.expm1(x);            // e^x - 1，小 x 时数值稳定
  if (!isFinite(denom) || denom <= 0) return 0;
  const pref = (2 * H * C * C) / Math.pow(lam, 5);
  return pref / denom;
}

/* ---------- 配色方案（仅保留 Hot / Jet） ---------- */
const SCHEMES = [
  { name: 'Hot', grad: 'linear-gradient(90deg,#000,#5a0000,#ff0000,#ff7a00,#ffd400,#fff)' },
  { name: 'Jet', grad: 'linear-gradient(90deg,#000080,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000,#800000)' },
];

/* ---------- 状态 ---------- */
let currentView = 'surface';
let scheme = 'Hot';
let ymode = 'linear';
let presetActive = false;   // 预设模式：锁定温度上下限，绘图用单温度

/* ---------- 教学预设场景 ----------
   每个场景代表一个真实物理对象的“单一特征温度”，并按维恩位移定律
   自动框定波长窗口，让学生直观看到该温度下对应的一条黑体辐射谱线。 */
const PRESETS = [
  { title: '☀️ 太阳表面', sub: '≈ 5778 K', temp: 5778, lmin: 200, lmax: 2500, lsteps: 140 },
  { title: '💡 钨丝灯', sub: '≈ 2800 K', temp: 2800, lmin: 300, lmax: 3200, lsteps: 140 },
  { title: '🔥 蜡烛火焰', sub: '≈ 1800 K', temp: 1800, lmin: 300, lmax: 3500, lsteps: 140 },
  { title: '🧍 人体', sub: '≈ 310 K', temp: 310, lmin: 2000, lmax: 10000, lsteps: 120 },
];

/* ---------- 主题（system / light / dark） ---------- */
const THEMES = ['system', 'light', 'dark'];
let themeIndex = Math.max(0, THEMES.indexOf(localStorage.getItem('bb-theme') || 'system'));

function isDark() {
  const t = THEMES[themeIndex];
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme() {
  const t = THEMES[themeIndex];
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('bb-theme', t);
  // 图标切换
  $('theme-btn').querySelectorAll('svg').forEach((s) => s.classList.add('hidden'));
  const ico = t === 'dark' ? '.ico-moon' : t === 'light' ? '.ico-sun' : '.ico-auto';
  $(ico) && $(ico).classList.remove('hidden');
  if (window.__ready && typeof Plotly !== 'undefined') {
    try { Plotly.relayout('plot', baseLayout()); } catch (e) {}
    render();
  }
}

/* ---------- 峰值波长（维恩位移） ---------- */
function updatePeak() {
  const tmin = +T('tmin'), tmax = +T('tmax');
  const pk = (tp) => ((B_WIEN / tp) * 1e9).toFixed(0) + ' nm';
  $('peak-min').textContent = pk(Math.min(tmin, tmax));
  $('peak-max').textContent = pk(Math.max(tmin, tmax));
}

/* ---------- 温度序列 ----------
   当 T_min 与 T_max 设为同一值（预设/手动）时视为“单一温度”，
   曲线视图据此只画一条曲线；范围类视图（曲面/等高线/热力图）
   需 ≥2 个温度才能成图，故自动围绕该温度展开一个小的温度带用于渲染。 */
function buildTemps() {
  const tmin = +T('tmin'), tmax = +T('tmax');
  if (tmax <= tmin) return [tmin];                 // 单一温度 → 一条曲线
  return linspace(tmin, tmax, Math.max(1, +T('tsteps')));
}
function displayTemps() {
  let Ts = buildTemps();
  if (Ts.length < 2) {                              // 单温度时围绕它展开可视图温度带
    const t0 = Ts[0] || +T('tmin');
    Ts = linspace(t0 * 0.75, t0 * 1.25, 14);
  }
  return Ts;
}

/* ---------- 构建数据 ---------- */
function buildData() {
  let lmin = +T('lmin'), lmax = +T('lmax');
  if (lmax <= lmin) lmax = lmin + 10;
  const Ts = (currentView === 'curves') ? buildTemps() : displayTemps();
  const Ls = linspace(lmin, lmax, +T('lsteps'));
  const Z = Ts.map((temp) => Ls.map((lam) => planck(lam, temp)));
  return { Ts, Ls, Z };
}

/* ---------- 布局基线 ---------- */
function baseLayout() {
  const dark = isDark();
  const isMobile = window.matchMedia('(max-width: 860px)').matches;
  return {
    margin: isMobile ? { l: 46, r: 12, t: 10, b: 38 } : { l: 60, r: 16, t: 14, b: 46 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: dark ? '#e8ecf3' : '#131720', size: isMobile ? 10 : 11 },
    showlegend: currentView === 'curves',
    legend: { orientation: 'h', y: -0.2, font: { size: 9 } },
    hoverlabel: { bgcolor: dark ? '#1a2030' : '#ffffff', bordercolor: 'transparent', font: { size: 11 } },
    dragmode: currentView === 'surface' ? 'orbit' : 'zoom',
  };
}

/* ---------- 渲染 ---------- */
function render() {
  if (typeof Plotly === 'undefined') {
    $('status').textContent = '图表库加载失败（需联网首次加载 Plotly）';
    return;
  }
  const { Ts, Ls, Z } = buildData();
  const logMode = ymode === 'log';
  const zUnit = logMode ? 'log₁₀ B(λ,T)' : 'B(λ,T)';
  let traces, layout;

  if (currentView === 'surface') {
    const z = logMode ? Z.map((r) => r.map((v) => Math.log10(Math.max(v, ZFLOOR)))) : Z;
    traces = [{
      type: 'surface', x: Ls, y: Ts, z, colorscale: scheme,
      colorbar: { title: { text: zUnit, side: 'right' }, len: 0.82, thickness: 12 },
      contours: { z: { show: true, usecolormap: true, project: { z: true }, width: 1 } },
      lighting: { ambient: 0.75, diffuse: 0.6 },
      hovertemplate: 'λ=%{x} nm<br>T=%{y} K<br>' + zUnit + '=%{z:.3f}<extra></extra>',
    }];
    layout = Object.assign(baseLayout(), {
      scene: {
        xaxis: { title: { text: 'λ (nm)' }, color: isDark() ? '#cdd5e0' : '#3a4350', gridcolor: 'rgba(128,128,128,.15)', backgroundcolor: 'rgba(0,0,0,0)' },
        yaxis: { title: { text: 'T (K)' }, color: isDark() ? '#cdd5e0' : '#3a4350', gridcolor: 'rgba(128,128,128,.15)', backgroundcolor: 'rgba(0,0,0,0)' },
        zaxis: { title: { text: zUnit }, color: isDark() ? '#cdd5e0' : '#3a4350', gridcolor: 'rgba(128,128,128,.15)', backgroundcolor: 'rgba(0,0,0,0)' },
        camera: { eye: { x: 1.5, y: -1.5, z: 0.85 } },
      },
    });
  } else { // curves（多温度曲线）
    traces = Ts.map((temp, i) => ({
      type: 'scatter', mode: 'lines', name: temp + ' K',
      x: Ls, y: Z[i],
      line: { width: window.matchMedia('(max-width:860px)').matches ? 1.6 : 2 },
      hovertemplate: 'λ=%{x} nm<br>B=%{y:.3e}<extra>' + temp + ' K</extra>',
    }));
    layout = Object.assign(baseLayout(), {
      xaxis: { title: { text: 'λ (nm)' }, gridcolor: 'rgba(128,128,128,.12)', zeroline: false },
      yaxis: {
        title: { text: 'B(λ,T)' }, type: logMode ? 'log' : 'linear',
        gridcolor: 'rgba(128,128,128,.12)', zeroline: false,
      },
    });
  }

  const config = {
    responsive: true, displaylogo: false,
    modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d', 'autoScale2d'],
    scrollZoom: true,
  };

  $('status').textContent = '渲染中…';
  Plotly.react('plot', traces, layout, config).then(() => {
    const pts = Ts.length * Ls.length;
    $('status').textContent = `已渲染 · ${Ts.length}×${Ls.length} = ${pts} 点 · ${scheme}`;
  }).catch((e) => {
    $('status').textContent = '渲染出错：' + e.message;
  });
}

/* ---------- 滑块联动 ---------- */
function bindSlider(id, outId, suffix) {
  const el = $(id), out = $(outId);
  const sync = () => { out.textContent = el.value + (suffix || ''); };
  el.addEventListener('input', () => { sync(); if (id === 'tmin' || id === 'tmax') updatePeak(); });
  sync();
}

/* ---------- 配色按钮 ---------- */
function buildColorButtons() {
  const grid = $('cs-grid');
  SCHEMES.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'cs-btn' + (s.name === scheme ? ' active' : '');
    b.style.background = s.grad;
    b.textContent = s.name;
    b.title = s.name;
    b.addEventListener('click', () => {
      scheme = s.name;
      grid.querySelectorAll('.cs-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      render();
    });
    grid.appendChild(b);
  });
}

/* ---------- 预设场景按钮 ---------- */
function setSlider(id, val) {
  const el = $(id);
  val = Math.min(+el.max, Math.max(+el.min, val));
  el.value = val;
  el.dispatchEvent(new Event('input')); // 触发已绑定的 output/peak 更新
}

function applyPreset(p) {
  presetActive = true;
  setSlider('tmin', p.temp); setSlider('tmax', p.temp); setSlider('tsteps', 1);
  setSlider('lmin', p.lmin); setSlider('lmax', p.lmax); setSlider('lsteps', p.lsteps);
  // 锁定温度上下限（预设模式）：禁用滑块并显示提示
  ['tmin', 'tmax', 'tsteps'].forEach((id) => { $(id).disabled = true; });
  document.querySelectorAll('.temp-field').forEach((f) => f.classList.add('disabled'));
  $('preset-badge').classList.remove('hidden');
  $('preset-exit-wrap').classList.remove('hidden');
  // 预设 = 单一温度，自动切到多温度曲线视图，确保只画该温度的一条谱线
  currentView = 'curves';
  document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'curves'));
  updatePeak();
  if (window.matchMedia('(max-width: 860px)').matches) closePanel();
  render();
}

// 退出预设模式：恢复温度滑块为可编辑
function exitPreset() {
  presetActive = false;
  ['tmin', 'tmax', 'tsteps'].forEach((id) => { $(id).disabled = false; });
  document.querySelectorAll('.temp-field').forEach((f) => f.classList.remove('disabled'));
  $('preset-badge').classList.add('hidden');
  $('preset-exit-wrap').classList.add('hidden');
  render();
}

function buildPresetButtons() {
  const grid = $('preset-grid');
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.innerHTML = `<span class="p-title">${p.title}</span><span class="p-sub">${p.sub}</span>`;
    b.addEventListener('click', () => applyPreset(p));
    grid.appendChild(b);
  });
}

/* ---------- 导出当前图表为 PNG ---------- */
function exportPNG() {
  if (typeof Plotly === 'undefined') {
    $('status').textContent = '图表库未就绪，无法导出';
    return;
  }
  $('status').textContent = '正在导出 PNG…';
  Plotly.toImage('plot', { format: 'png', width: 1280, height: 800, scale: 2 })
    .then((dataUrl) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `黑体辐射_${currentView}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      $('status').textContent = '已导出 PNG ✓';
    })
    .catch((e) => { $('status').textContent = '导出失败：' + e.message; });
}

/* ---------- 抽屉（移动端） ---------- */
function openPanel() { $('panel').classList.add('open'); $('overlay').classList.add('show'); }
function closePanel() { $('panel').classList.remove('open'); $('overlay').classList.remove('show'); }

/* ---------- 安装提示 ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; $('install-btn').classList.remove('hidden');
});
$('install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $('install-btn').classList.add('hidden');
});
window.addEventListener('appinstalled', () => $('install-btn').classList.add('hidden'));

/* ---------- 初始化 ---------- */
function init() {
  applyTheme();
  buildColorButtons();
  buildPresetButtons();
  bindSlider('tmin', 'tmin-out', ' K');
  bindSlider('tmax', 'tmax-out', ' K');
  bindSlider('tsteps', 'tsteps-out', '');
  bindSlider('lmin', 'lmin-out', ' nm');
  bindSlider('lmax', 'lmax-out', ' nm');
  bindSlider('lsteps', 'lsteps-out', '');
  updatePeak();

  // 主题按钮
  $('theme-btn').addEventListener('click', () => {
    themeIndex = (themeIndex + 1) % THEMES.length; applyTheme();
  });

  // 视图切换
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentView = tab.dataset.view;
      render();
    });
  });

  // 纵轴模式
  $('ymode').querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      $('ymode').querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      ymode = b.dataset.val;
      render();
    });
  });

  // 更新按钮 / 抽屉
  $('btn-update').addEventListener('click', render);
  $('btn-export').addEventListener('click', exportPNG);
  $('preset-exit').addEventListener('click', exitPreset);
  $('open-panel').addEventListener('click', openPanel);
  $('panel-close').addEventListener('click', closePanel);
  $('drawer-handle').addEventListener('click', closePanel);
  $('overlay').addEventListener('click', closePanel);

  window.addEventListener('resize', () => { if (window.__ready) render(); });

  window.__ready = true;
  render();

  // Service Worker（离线缓存）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
