/**
 * ChartLib：极简 SVG 图表（折线/柱状），班级工作台与学生端公开站共用。
 * 零依赖，返回 SVG 字符串；配色跟随页面主题（html[data-theme]）。
 */
(function () {
  "use strict";

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  function pal() {
    var dark = document.documentElement &&
      document.documentElement.dataset.theme === "dark";
    return dark
      ? { tick: "#8b98ad", ink: "#c9d3e4", grid: "#26304a", vgrid: "#212b3d", axis: "#3d4a63" }
      : { tick: "#6b7280", ink: "#374151", grid: "#edf0f4", vgrid: "#f5f7fa", axis: "#d4dae3" };
  }

  /**
   * 折线图
   * opts: { w, h, series:[{name,color,points:(number|null)[],dashed}], xLabels:[], yMax? }
   */
  function line(o) {
    const w = o.w || 680, h = o.h || 260;
    const L = 44, R = 14, T = (o.series && o.series.length > 1) ? 32 : 12, B = 46;
    const iw = w - L - R, ih = h - T - B;
    const P = pal();
    const head = '<svg viewBox="0 0 ' + w + " " + h +
      '" style="width:100%;height:auto;font-family:system-ui,-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">';

    const vals = [];
    (o.series || []).forEach(function (sr) {
      sr.points.forEach(function (v) { if (v != null) vals.push(v); });
    });
    if (!vals.length) return head + "</svg>";

    let yMin = Math.min.apply(null, vals), yMax = Math.max.apply(null, vals);
    if (o.yMax != null) yMax = Math.max(yMax, o.yMax);
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    const pad = (yMax - yMin) * 0.12;
    yMin = Math.max(0, Math.floor(yMin - pad));
    yMax = Math.ceil(yMax + pad);

    const n = (o.xLabels || []).length || 2;
    const X = function (i) { return n === 1 ? L + iw / 2 : L + i * (iw / (n - 1)); };
    const Y = function (v) { return T + ih - ((v - yMin) / (yMax - yMin)) * ih; };

    let s = head;
    const TICKS = 5;
    for (let i = 0; i <= TICKS; i++) {
      const v = yMin + ((yMax - yMin) * i) / TICKS;
      const y = Y(v);
      s += '<line x1="' + L + '" y1="' + y + '" x2="' + (w - R) + '" y2="' + y + '" stroke="' + P.grid + '"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="' + P.tick + '">' +
        Math.round(v * 10) / 10 + "</text>";
    }
    (o.xLabels || []).forEach(function (lb, i) {
      const x = X(i);
      s += '<line x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (T + ih) + '" stroke="' + P.vgrid + '"/>';
      s += '<text x="' + x + '" y="' + (T + ih + 15) + '" text-anchor="middle" font-size="11" fill="' + P.tick + '" transform="rotate(-16 ' +
        x + " " + (T + ih + 15) + ')">' + esc(lb.length > 8 ? lb.slice(0, 8) + "…" : lb) + "</text>";
    });
    s += '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ih) + '" stroke="' + P.axis + '"/>';
    s += '<line x1="' + L + '" y1="' + (T + ih) + '" x2="' + (w - R) + '" y2="' + (T + ih) + '" stroke="' + P.axis + '"/>';

    (o.series || []).forEach(function (sr) {
      const pts = [];
      sr.points.forEach(function (v, i) {
        if (v != null) pts.push([X(i), Y(v), v]);
      });
      if (!pts.length) return;
      const d = "M" + pts.map(function (p) { return p[0] + " " + p[1]; }).join(" L");
      s += '<path d="' + d + '" fill="none" stroke="' + sr.color + '" stroke-width="2"' +
        (sr.dashed ? ' stroke-dasharray="6 4"' : "") + "/>";
      pts.forEach(function (p) {
        s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.2" fill="' + sr.color +
          '"><title>' + esc(sr.name) + ": " + p[2] + "</title></circle>";
      });
    });

    if (o.series.length > 1) {
      let x = w - R;
      for (let i = o.series.length - 1; i >= 0; i--) {
        const it = o.series[i];
        x -= it.name.length * 12 + 24 + 14;
        s += '<rect x="' + x + '" y="8" width="10" height="10" rx="2" fill="' + it.color + '"/>';
        s += '<text x="' + (x + 14) + '" y="17" font-size="12" fill="' + P.ink + '">' + esc(it.name) + "</text>";
      }
    }

    return s + "</svg>";
  }

  /**
   * 柱状图（分数段分布等）
   * opts: { w, h, values:[], labels:[], color? }
   */
  function bars(o) {
    const w = o.w || 680, h = o.h || 170;
    const L = 30, R = 10, T = 20, B = 26;
    const iw = w - L - R, ih = h - T - B;
    const P = pal();
    const vals = o.values || [], labels = o.labels || [];
    const max = Math.max.apply(null, vals.concat([1]));
    const bw = (iw / Math.max(vals.length, 1)) * 0.52;
    let s = '<svg viewBox="0 0 ' + w + " " + h +
      '" style="width:100%;height:auto;font-family:system-ui,sans-serif">';
    vals.forEach(function (v, i) {
      const x = L + (iw * (i + 0.5)) / vals.length - bw / 2;
      const bh = (v / max) * ih;
      const y = T + ih - bh;
      s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh +
        '" rx="3" fill="' + (o.color || "#2f6fed") + '"/>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="12" fill="' + P.ink + '">' + v + "</text>";
      s += '<text x="' + (x + bw / 2) + '" y="' + (T + ih + 15) + '" text-anchor="middle" font-size="11" fill="' + P.tick + '">' +
        esc(labels[i] || "") + "</text>";
    });
    return s + "</svg>";
  }

  window.ChartLib = { line: line, bars: bars };
})();
