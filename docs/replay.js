/* ============================================================================
   replay.js — 展開を再生（参考）: 買い目のあるレースの予想の動きを、上から見たコース図で再生する。
   データ: data.json の formation.replay（競馬リポジトリ replay_site.py が作る。予想だけで実際の結果は含まない）
           data/courses.json（公開されている情報をもとに書き起こしたコースの形・距離・起伏の概略）
   動きの作り方: スタート → 最初の角＝展開予想図の予想位置 → 残り600mと4角＝予想時計の順番（間隔は過去の同じ頭数の典型的な秒差）
                 → ゴール＝勝つ確率の順（切り替えで予想時計の順）。馬の横位置はゲート順から4角の予想の内外へ。
   物理の制約（simulate、0.1秒刻みで一度だけ計算して再生はそれをなぞる）:
     ・先頭の速さはコースの典型的なラップ（先頭の1ハロン毎、予想ペースに合わせたもの）。無ければ残り600mまで一定・後3F 35.5秒。
     ・前（同じ進路で1馬身以内）に馬がいれば、その馬より前には出られない（1馬身あける）。
     ・横に動けるのは、動く先の進路の前後1馬身に馬がいない時だけ（斜行しない・馬をすり抜けない）。横の速さは約1.7m/秒まで。
     ・前が詰まったら（2馬身先に遅い馬がいる時も先読みして）、外が空いていれば外へ持ち出し、無理なら内、どちらも無理なら前が空くのを待つ。
       持ち出した分は少しずつしか戻さない。最初の角から各馬の内外（展開予想図の4角の内外）を目標にする。
     ・詰まった時に横へ動くのは、動く先の進路の前が今より1馬身以上空いている時だけ（抜けられない方へふくらんで戻る動きを抑える。2026-09-29）。
     ・横の速さ・並走の間隔・先読みの距離は、過去の実際のレース295Rに合わせて決めた（競馬リポジトリ course_transfer_research/sim_calib.py、
       実際の通過順・着差を目標に再生して 4角の順位・内外・着順が最も実際に近い組み合わせ）。
   CSP(style-src 'self') のため style 属性は使わない（SVG は属性だけ、見た目は style.css の .rp-*）。
   ============================================================================ */
'use strict';
(function () {
  var BL = 2.4, LANE_M = 1.2;
  var SEC_PER_BL = 0.2, V_DISP = 16.5;   // 着差の表示は JRA の目安（1馬身 ≒ 0.2秒）。走っている間は距離を 16.5m/秒 で秒に直す
  var FRAME = ['#fff', '#222', '#d33', '#26c', '#ec3', '#2a4', '#f80', '#f7a'];
  var FTXT = ['#000', '#fff', '#fff', '#fff', '#000', '#fff', '#000', '#000'];
  var COURSES = null;

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function frameOf(u, N) {
    if (N <= 8) return u;
    var base = Math.floor(N / 8), extra = N % 8, n = 0;
    for (var f = 1; f <= 8; f++) { n += base + (f > 8 - extra ? 1 : 0); if (u <= n) return f; }
    return 8;
  }
  function loadCourses() {
    if (COURSES) return Promise.resolve(COURSES);
    return fetch('data/courses.json', { cache: 'force-cache' }).then(function (r) { return r.json(); })
      .then(function (j) { COURSES = j.courses || {}; return COURSES; });
  }

  /* ── コースの形: 点列（ゴール起点・進行方向順）→ u(ゴールから進行方向の距離) と外側へのずれ → 画面座標 ── */
  function makeGeo(c) {
    var P = c.pts, n = P.length, C = c.circ, W = 1000, H = 520, pad = 40;
    var xs = P.map(function (p) { return p[0]; }), ys = P.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var sc = Math.min((W - 2 * pad) / (x1 - x0 + 60), (H - 2 * pad) / (y1 - y0 + 60));
    var ox = W / 2 - sc * (x0 + x1) / 2, oy = H / 2 - sc * (y0 + y1) / 2;
    var area = 0; for (var i = 0; i < n; i++) { var a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var cw = area > 0, step = C / n;
    function pt(u, off) {
      u = ((u % C) + C) % C;
      var f = u / step, i = Math.floor(f) % n, j = (i + 1) % n, w = f - Math.floor(f);
      var a = P[i], b = P[j], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      var nx = cw ? ty : -ty, ny = cw ? -tx : tx;
      return [ox + sc * (a[0] + (b[0] - a[0]) * w + nx * off), oy + sc * (a[1] + (b[1] - a[1]) * w + ny * off)];
    }
    return { C: C, sc: sc, pt: pt, cu: c.cu };
  }
  function crossings(D, g) {
    var out = [];
    [1, 2, 3, 4].forEach(function (c) { for (var k = -3; k <= 3; k++) { var s = D + g.cu[c] - k * g.C; if (s > 0 && s < D) out.push({ s: s, c: c }); } });
    return out.sort(function (a, b) { return a.s - b.s; });
  }
  function resolveSegs(c, g) {
    var C = g.C;
    var at = function (q) { if (q.rem !== undefined) return C - q.rem; if (q.goal !== undefined) return 0; return g.cu[q.corner] + (q.off || 0); };
    return (c.seg || []).map(function (x) {
      var u0 = ((at(x.from) % C) + C) % C, u1 = ((at(x.to) % C) + C) % C; if (u1 <= u0) u1 += C;
      return { u0: u0, u1: u1, dh: x.dh };
    });
  }
  function elevU(segs, C, u) {
    var e = 0; u = ((u % C) + C) % C;
    segs.forEach(function (g) {
      var uu = u >= g.u0 ? u : (g.u1 > C && u + C <= g.u1 ? u + C : null);
      if (uu !== null) e += g.dh * Math.max(0, Math.min(1, (uu - g.u0) / (g.u1 - g.u0)));
    });
    return e;
  }

  /* ── 予想の動き: 各馬 [先頭の距離, 先頭からの遅れ(m), 内外(レーン)] ── */
  /* 直線で内を空ける量（レーン、1レーン≒1.2m）: 芝は仮柵を替えてから日が経つほど・馬場が悪いほど内の荒れた所を避ける
     （見た目の目安。4角で前の馬のラチ沿いの割合は、仮柵1-2日目の良 60% → 7-8日目の重不良 54% と芝だけ下がる。
     ラチからの距離そのものはデータに無いので量は固定値）。仮柵日目が無い時は開催日目。ダートは 0（ダートは変わらない）。 */
  function railShift(rp) {
    if (!/芝/.test(rp.surface || '')) return 0;
    var d = rp.rail_day || rp.meeting_day, b = String(rp.baba || '').charAt(0), s = 0;
    if (d) s = d <= 4 ? 0 : (d <= 6 ? 1 : (d <= 8 ? 1.5 : 2));
    if (b === '稍') s += 0.5; else if (b === '重' || b === '不') s += 1;
    return s;
  }
  function buildKeys(rp, g, goalMode) {
    var D = rp.distance, N = rp.N, cr = crossings(D, g), rs = railShift(rp);
    var firstS = cr.length ? cr[0].s : D * 0.3, lastS = cr.length ? cr[cr.length - 1].s : D * 0.75;
    var v3 = (D - 600) / rp.pace.pred, vend = 600 / 35.5, keys = {}, tmax = D, pre = {};
    rp.horses.forEach(function (h) {
      var K = [[0, 0, (h.u - 1) * 0.95], [firstS, h.first * 1.18 * (N - 1) * BL, h.lane * 0.8]];
      var mids = [[D - 600, h.g3 * v3, h.lane * 0.8], [lastS, h.g3 * v3, h.lane * 1.2]].filter(function (x) { return x[0] > firstS + 20; })
        .sort(function (a, b) { return a[0] - b[0]; });
      var goal = (goalMode === 'time' ? h.goal_time : h.goal_v9) * vend;
      pre[h.u] = { K: K.concat(mids), b4: mids.length ? mids[mids.length - 1][1] : goal, lane4: h.lane * 1.2, goal: goal };
    });
    // 直線の横の広がり: 4角で前にいた馬は内寄りのまま、後ろにいた馬ほど前をかわすために外へ（順位1つにつき0.7レーン≒0.84m）、
    // 差を詰める馬ほどさらに外へ（15m詰めるごとに+1レーン）。芝で内が荒れていれば全体が内を空ける（rs）。量は見た目の目安。
    var order = rp.horses.map(function (h) { return h.u; }).sort(function (a, b) { return pre[a].b4 - pre[b].b4; });
    var rank4 = {}; order.forEach(function (u, i) { rank4[u] = i; });
    rp.horses.forEach(function (h) {
      var q = pre[h.u], gain = Math.max(0, q.b4 - q.goal);
      var fan = Math.min(12, rank4[h.u] * 0.7 + gain / 15);
      var laneGoal = rs + q.lane4 * 0.4 + fan;
      var K = q.K.concat([[D - Math.min(250, D * 0.14), q.b4 * 0.6 + q.goal * 0.4, rs * 0.8 + q.lane4 * 0.7 + fan * 0.6],
                          [D, q.goal, laneGoal]]);
      keys[h.u] = K; tmax = Math.max(tmax, D + q.goal + 30);
    });
    return { keys: keys, tmax: tmax };
  }
  /* 先頭の走った距離 → 時刻（秒）の表。laps があればハロン毎、無ければ 残り600mまで一定＋後3F */
  function leaderPlan(rp) {
    var D = rp.distance, segs = [];
    if (rp.laps && rp.laps.length >= 4) {
      var n = rp.laps.length, first = D - 200 * (n - 1);
      rp.laps.forEach(function (x, i) { segs.push([i === 0 ? (first > 0 ? first : 200) : 200, x]); });
    } else {
      segs.push([D - 600, rp.pace.pred]); segs.push([600, 35.5]);
    }
    var last = segs[segs.length - 1], vEnd = last[0] / last[1];
    return function (t) {                       // 時刻 t の先頭の距離
      var s = 0, tt = 0;
      for (var i = 0; i < segs.length; i++) {
        if (t <= tt + segs[i][1]) return s + segs[i][0] * (t - tt) / segs[i][1];
        s += segs[i][0]; tt += segs[i][1];
      }
      return s + (t - tt) * vEnd * 0.85;
    };
  }
  function simulate(rp, g, goalMode) {
    var KK = buildKeys(rp, g, goalMode), D = rp.distance, lead = leaderPlan(rp), DT = 0.1;
    var H = rp.horses.map(function (h) { return { u: h.u, K: KK.keys[h.u], s: 0, lane: (h.u - 1) * 0.95, v: 0, lo: 0 }; })
      .sort(function (a, b) { return a.u - b.u; });        // 記録は馬番順（描画側の hidx と合わせる）
    var frames = [], t = 0, LAT = 0.14, GAPL = 0.75, LOOK = 2;
    var clear = function (me, lane) {
      if (lane < 0 || lane > 16) return false;
      for (var k = 0; k < H.length; k++) {
        var o = H[k]; if (o === me) continue;
        if (Math.abs(o.lane - lane) < GAPL && Math.abs(o.s - me.s) < BL) return false;
      }
      return true;
    };
    frames.push(H.map(function (h) { return [h.s, h.lane]; }));
    while (t < 400) {
      t += DT;
      var x = lead(t), xn = lead(t + DT), vl = (xn - x) / DT;
      H.sort(function (a, b) { return b.s - a.s; });
      H.forEach(function (h) {
        if (h.ft !== undefined) {                              // ゴール後: その場の速さから自然に減速して走り抜ける（並び・間隔を保つ）
          h.v = Math.max(0, h.v - 1.2 * DT);
          var sF = h.s + h.v * DT;
          for (var k2 = 0; k2 < H.length; k2++) {             // ゴール後も前の馬（同じ進路）に1馬身以上は近づかない
            var o4 = H[k2]; if (o4 === h || o4.s < h.s) continue;
            if (Math.abs(o4.lane - h.lane) < GAPL && o4.s - sF < BL) sF = Math.min(sF, o4.s - BL);
          }
          sF = Math.max(h.s, sF); h.v = (sF - h.s) / DT; h.s = sF; return;
        }
        var tg = interp(h.K, x), sT = x - tg[0];
        var vd = Math.max(0, Math.min(19.5, vl + (sT - h.s) / 0.8));
        var v = Math.max(h.v - 8 * DT, Math.min(h.v + 7 * DT, vd));
        var sN = h.s + v * DT, blocked = false;
        for (var k = 0; k < H.length; k++) {                  // 前の馬（同じ進路・1馬身以内）より前には出ない
          var o = H[k]; if (o === h || o.s < h.s) continue;
          if (Math.abs(o.lane - h.lane) < GAPL && o.s - sN < BL) { sN = Math.min(sN, o.s - BL); blocked = true; }
        }
        sN = Math.max(h.s, sN);
        if (sN >= D && h.s < D) { h.ft = t - DT * (sN - D) / Math.max(1e-6, sN - h.s); h.vf = (sN - h.s) / DT; }   // ゴールを通過した時刻と速さ
        h.v = (sN - h.s) / DT; h.s = sN;
        var want = blocked && sT - h.s > BL * 0.5;
        if (!want && sT - h.s > BL * 0.3) {                   // 先読み: 2馬身先の同じ進路に遅い馬がいれば、詰まる前に進路を探す
          for (var q = 0; q < H.length; q++) {
            var o2 = H[q]; if (o2 === h) continue;
            if (o2.s > h.s && o2.s - h.s < BL * LOOK && Math.abs(o2.lane - h.lane) < GAPL && o2.v < vd - 0.3) { want = true; break; }
          }
        }
        if (want) {                                            // 詰まった: 前が今より空いている側へ（外 → 内）、どちらも無理なら待つ
          var room = function (L) {                            // その進路の前の空き(m)
            var r = 99; for (var q2 = 0; q2 < H.length; q2++) { var o3 = H[q2]; if (o3 !== h && o3.s > h.s && Math.abs(o3.lane - L) < GAPL) r = Math.min(r, o3.s - h.s); }
            return r;
          };
          var here = room(h.lane);                             // 抜けられない方へはふくらまない（2026-09-29、はじき出されて戻る動きを抑える）
          if (room(h.lane + LAT * 7) > here + BL && clear(h, h.lane + LAT)) { h.lane += LAT; h.lo += LAT; }
          else if (room(h.lane - LAT * 7) > here + BL && clear(h, h.lane - LAT)) { h.lane -= LAT; h.lo -= LAT; }
        } else {
          var L = tg[1] + h.lo, d = L - h.lane;
          if (Math.abs(d) > 0.02) { var st = Math.max(-LAT, Math.min(LAT, d)); if (clear(h, h.lane + st)) h.lane += st; }
          h.lo *= 0.995;                                        // 持ち出した分は少しずつしか戻さない
        }
      });
      H.sort(function (a, b) { return a.u - b.u; });
      frames.push(H.map(function (h) { return [h.s, h.lane]; }));
      if (H.every(function (h) { return h.ft !== undefined; }) &&
          t >= Math.max.apply(null, H.map(function (h) { return h.ft; })) + 2.5) break;   // 最後の馬がゴールして少ししたら終わり
    }
    var fin = {}; H.forEach(function (h) { fin[h.u] = { t: h.ft === undefined ? 1e9 : h.ft, v: h.vf || 16 }; });
    return { frames: frames, dt: DT, T: t, fin: fin };
  }
  function interp(K, t) {
    if (t <= K[0][0]) return [K[0][1], K[0][2]];
    for (var i = 1; i < K.length; i++) if (t <= K[i][0]) { var a = K[i - 1], b = K[i], w = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]; }
    var z = K[K.length - 1]; return [z[1], z[2]];
  }

  /* ── 本体 ── */
  function open(host, d) {
    var rp = (d.formation || {}).replay;
    if (!rp) { host.textContent = '再生用のデータがありません。'; return; }
    host.innerHTML = '<div class="rp-loading">読み込み中…</div>';
    loadCourses().then(function (CS) { mount(host, d, rp, CS[rp.course]); })
      .catch(function () { host.textContent = 'コースの情報を読み込めませんでした。'; });
  }

  function mount(host, d, rp, course) {
    if (!course || !course.pts) { host.textContent = 'このコースの形の情報がありません。'; return; }
    var g = makeGeo(course), segs = resolveSegs(course, g), D = rp.distance, N = rp.N;
    var names = {}, marks = {};
    (d.horses || []).forEach(function (h) { names[h.umaban] = h.name; marks[h.umaban] = h.mark || ''; });
    var mobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    var st = { t: 0, playing: false, speed: 2, follow: mobile, goal: 'v9', sel: null, last: 0 };
    var K = simulate(rp, g, st.goal);
    var hidx = {}; rp.horses.slice().sort(function (a, b) { return a.u - b.u; }).forEach(function (h, i) { hidx[h.u] = i; });
    var df = rp.pace.pred - rp.pace.base, tag = Math.abs(df) < 0.3 ? '標準並み' : (df < 0 ? '標準より速い' : '標準より遅い');

    host.innerHTML =
      '<div class="rp">' +
      '<div class="rp-stage"><div class="rp-left">' +
      '<svg class="rp-track" viewBox="0 0 1000 520" role="img" aria-label="予想の展開の再生"></svg>' +
      '<div class="rp-ctrl"><button type="button" class="rp-play">▶ 再生</button>' +
      '<input type="range" class="rp-seek" min="0" max="1000" step="1" value="0" aria-label="位置">' +
      '<span class="rp-pos"></span></div>' +
      '<div class="rp-ctrl2"><button type="button" class="rp-speed">×2</button>' +
      '<button type="button" class="rp-view">' + (st.follow ? '全体を見る' : '馬群を追う') + '</button>' +
      '<label class="rp-goal-l">ゴールの並び <select class="rp-goal"><option value="v9">勝つ確率の順</option><option value="time">予想時計の順</option></select></label></div>' +
      '<svg class="rp-elev" viewBox="0 0 1000 90" role="img" aria-label="コースの高低"></svg></div>' +
      '<div class="rp-board"><div class="rp-board-h">いまの順番（予想）</div><ol class="rp-list"></ol></div></div>' +
      '<div class="note rp-note">' + esc(course.name) + '（一周' + course.circ + 'm・直線' + course.straight + 'm・高低差' + course.elev + 'm' +
      (rp.course_guess ? '・内回り/外回りは推定' : '') + '）　予想ペース: ' + tag +
      '（先頭が残り600mに着くまで 予想' + rp.pace.pred.toFixed(1) + '秒／標準' + rp.pace.base.toFixed(1) + '秒）<br>' +
      '※ 各馬の過去の位置取りと予想の時計から作った<b>参考の動き</b>で、実際のレースの映像ではありません。' +
      '最初のコーナーまでは展開予想図の隊列、残り600mは予想の時計の順（間隔は過去のレースの典型的な差）、ゴールは勝つ確率の順を目標に動きます。' +
      '先頭の速さはコースの典型的なラップの緩急、前が詰まった馬は1馬身以上空いた所にしか動けない（外へ持ち出すか前が空くのを待つ）ため、目標の順とずれることがあります。' +
      'コースの形・距離・高低は、公開されている情報をもとに書き起こした概略です。</div>' +
      '</div>';
    var $ = function (c) { return host.querySelector(c); };
    var svg = $('.rp-track'), elev = $('.rp-elev'), list = $('.rp-list'), seek = $('.rp-seek'), pos = $('.rp-pos');

    svg.innerHTML = '<g class="rp-bg"></g><g class="rp-fg"></g>';
    var bg = svg.querySelector('.rp-bg'), fg = svg.querySelector('.rp-fg');
    // 静的な部分（コース・高低）は先に作る
    var trackStr = (function () {
      var col = /ダ/.test(course.name) ? '#efe3d0' : '#e3efd9', s = '', path = function (off) {
        var p = '', n = 300; for (var i = 0; i <= n; i++) { var q = g.pt(g.C * i / n, off); p += (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); } return p + 'Z';
      };
      s += '<path d="' + path(10) + '" fill="none" stroke="' + col + '" stroke-width="' + (22 * g.sc).toFixed(1) + '"/>';
      s += '<path d="' + path(-1) + '" fill="none" stroke="#999" stroke-width="@K@"/><path d="' + path(21) + '" fill="none" stroke="#999" stroke-width="@K@"/>';
      segs.forEach(function (sg) {
        var p = '', n = Math.max(8, Math.round((sg.u1 - sg.u0) / 8));
        for (var i = 0; i <= n; i++) { var q = g.pt(sg.u0 + (sg.u1 - sg.u0) * i / n, 24); p += (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); }
        s += '<path d="' + p + '" fill="none" stroke="' + (sg.dh > 0 ? '#f39c34' : '#4a90d9') + '" stroke-opacity="0.7" stroke-width="' + (3 * g.sc).toFixed(1) + '"/>';
      });
      [1, 2, 3, 4].forEach(function (c) { var q = g.pt(g.cu[c], 34); s += '<text x="' + q[0].toFixed(1) + '" y="' + q[1].toFixed(1) + '" font-size="@F14@" fill="#888" text-anchor="middle">' + c + '角</text>'; });
      [600, 200].forEach(function (m) { if (m >= D) return; var a = g.pt(-m, -1), b = g.pt(-m, 21); s += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="#bbb" stroke-width="@K@"/>'; });
      var ga = g.pt(0, -3), gb = g.pt(0, 24), gl = g.pt(0, 38);
      s += '<line x1="' + ga[0] + '" y1="' + ga[1] + '" x2="' + gb[0] + '" y2="' + gb[1] + '" stroke="#c00" stroke-width="@K2@"/>' +
           '<text x="' + gl[0] + '" y="' + gl[1] + '" font-size="@F13@" fill="#c00" text-anchor="middle">ゴール</text>';
      var sa = g.pt(-D, -3), sb = g.pt(-D, 24), sl = g.pt(-D, 38);
      s += '<line x1="' + sa[0] + '" y1="' + sa[1] + '" x2="' + sb[0] + '" y2="' + sb[1] + '" stroke="#06c" stroke-width="@K2@"/>' +
           '<text x="' + sl[0] + '" y="' + sl[1] + '" font-size="@F13@" fill="#06c" text-anchor="middle">スタート</text>';
      return s;
    })();
    var elevBase = (function () {
      var n = 160, pts = [], lo = 1e9, hi = -1e9;
      for (var i = 0; i <= n; i++) { var sd = D * i / n, e = elevU(segs, g.C, sd - D); pts.push([sd, e]); lo = Math.min(lo, e); hi = Math.max(hi, e); }
      var span = Math.max(hi - lo, 1.5), X = function (sd) { return 30 + sd / D * 950; }, Y = function (e) { return 70 - (e - lo) / span * 50; };
      var s = '<path d="M' + pts.map(function (q) { return X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1); }).join('L') + 'L980,75L30,75Z" fill="#eee" stroke="#999"/>';
      crossings(D, g).forEach(function (c) { s += '<text x="' + X(c.s) + '" y="12" font-size="11" fill="#888" text-anchor="middle">' + c.c + '角</text>'; });
      s += '<text x="30" y="88" font-size="11" fill="#06c">スタート</text><text x="980" y="88" font-size="11" fill="#c00" text-anchor="end">ゴール</text>' +
           '<text x="2" y="' + Y(hi).toFixed(0) + '" font-size="10" fill="#888">' + (hi - lo).toFixed(1) + 'm</text>';
      return { s: s, X: X };
    })();

    function draw() {
      var f = Math.min(K.frames.length - 1, st.t / K.dt), i0 = Math.floor(f), i1 = Math.min(K.frames.length - 1, i0 + 1), w = f - i0, items = [];
      rp.horses.forEach(function (h) {
        var a = K.frames[i0][hidx[h.u]], b = K.frames[i1][hidx[h.u]];
        items.push({ h: h, s: a[0] + (b[0] - a[0]) * w, lane: a[1] + (b[1] - a[1]) * w });
      });
      var t = Math.max.apply(null, items.map(function (i) { return i.s; }));
      items.forEach(function (it) { it.p = g.pt(it.s - D, 1 + it.lane * LANE_M); });
      var vx = 0, vy = 0, vw = 1000, vh = 520;
      if (st.follow) {
        var xs = items.map(function (i) { return i.p[0]; }), ys = items.map(function (i) { return i.p[1]; });
        var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
        var span = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 1000 / 520);
        vw = Math.min(1000, Math.max(90 * g.sc, span + 40 * g.sc)); vh = vw * 0.52; vx = cx - vw / 2; vy = cy - vh / 2;
      }
      var k = vw / 1000, rad = st.follow ? 1.25 * g.sc : 9, s = '';
      // コース図は拡大率が変わった時だけ描き直す（毎コマは馬だけ）
      var kk = k.toFixed(3);
      if (kk !== st.bgK) {
        bg.innerHTML = trackStr.replace(/@K@/g, kk).replace(/@K2@/g, (2 * k).toFixed(3)).replace(/@F14@/g, (14 * k).toFixed(2)).replace(/@F13@/g, (13 * k).toFixed(2));
        st.bgK = kk;
      }
      items.slice().reverse().forEach(function (it) {
        var u = it.h.u, f = frameOf(u, N) - 1, isSel = st.sel === u, ax = marks[u] === '◎';
        var rr = rad * (isSel ? 1.3 : 1);
        s += '<g class="rp-horse" data-u="' + u + '"><circle cx="' + it.p[0].toFixed(2) + '" cy="' + it.p[1].toFixed(2) + '" r="' + rr.toFixed(2) + '" fill="' + FRAME[f] +
             '" stroke="' + (isSel ? '#e60' : (ax ? '#c00' : '#333')) + '" stroke-width="' + ((isSel || ax ? 3 : 1) * k).toFixed(3) + '"/>' +
             '<text x="' + it.p[0].toFixed(2) + '" y="' + (it.p[1] + rr * 0.38).toFixed(2) + '" font-size="' + (rr * 1.05).toFixed(2) +
             '" text-anchor="middle" font-weight="bold" fill="' + FTXT[f] + '">' + u + '</text></g>';
      });
      svg.setAttribute('viewBox', vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + vw.toFixed(1) + ' ' + vh.toFixed(1));
      fg.innerHTML = s;
      elev.innerHTML = elevBase.s + '<line x1="' + elevBase.X(Math.min(t, D)) + '" y1="16" x2="' + elevBase.X(Math.min(t, D)) + '" y2="75" stroke="#e33" stroke-width="2"/>';
      // いまの順番
      // ゴールした馬は通過した順で固定し、着差はゴールの時点の差（馬身）。まだの馬はその後ろに今の位置の順。
      var fin = K.fin, done = items.filter(function (it) { return fin[it.h.u].t <= st.t; })
        .sort(function (a, b) { return fin[a.h.u].t - fin[b.h.u].t; });
      var run = items.filter(function (it) { return fin[it.h.u].t > st.t; }).sort(function (a, b) { return b.s - a.s; });
      var order = done.concat(run), w0 = done.length ? fin[done[0].h.u] : null;
      list.innerHTML = order.map(function (it, i) {
        var u = it.h.u, f = frameOf(u, N) - 1, gap;
        if (fin[u].t <= st.t) gap = i === 0 ? '🏁1着' : '🏁+' + ((fin[u].t - w0.t) / SEC_PER_BL).toFixed(1) + '馬身';
        else gap = i === 0 ? '' : '+' + ((order[0].s - it.s) / V_DISP / SEC_PER_BL).toFixed(1) + '馬身';
        return '<li class="rp-row' + (st.sel === u ? ' rp-sel' : '') + '" data-u="' + u + '"><span class="rp-no rp-f' + f + '">' + u + '</span>' +
               '<span class="rp-mk">' + esc(marks[u]) + '</span><span class="rp-nm">' + esc(names[u] || '') + '</span><span class="rp-gap">' + gap + '</span></li>';
      }).join('');
      pos.textContent = t <= D ? '残り ' + Math.max(0, D - t).toFixed(0) + 'm' : 'ゴール後';
      seek.value = Math.round(st.t / K.T * 1000);
    }
    function tick(ts) {
      if (!st.playing) return;
      var dt = st.last ? Math.min(0.5, (ts - st.last) / 1000) : 0;   // 描画が遅い端末でも速度を保つ（上限0.5秒）
      st.last = ts;
      st.t = Math.min(K.T, st.t + dt * st.speed);
      if (st.t >= K.T) { st.playing = false; $('.rp-play').textContent = '▶ もう一度'; }
      draw();
      if (st.playing) requestAnimationFrame(tick);
    }
    function play(on) {
      st.playing = on === undefined ? !st.playing : on;
      $('.rp-play').textContent = st.playing ? '❚❚ 止める' : '▶ 再生';
      if (st.playing) { if (st.t >= K.T) st.t = 0; st.last = 0; requestAnimationFrame(tick); }
    }
    $('.rp-play').addEventListener('click', function () { play(); });
    seek.addEventListener('input', function () { play(false); st.t = +seek.value / 1000 * K.T; draw(); });
    $('.rp-speed').addEventListener('click', function () { st.speed = st.speed === 1 ? 2 : (st.speed === 2 ? 4 : 1); this.textContent = '×' + st.speed; });
    $('.rp-view').addEventListener('click', function () { st.follow = !st.follow; this.textContent = st.follow ? '全体を見る' : '馬群を追う'; draw(); });
    $('.rp-goal').addEventListener('change', function () { st.goal = this.value; K = simulate(rp, g, st.goal); draw(); });
    var pick = function (ev) { var el = ev.target.closest('[data-u]'); if (!el) return; var u = +el.getAttribute('data-u'); st.sel = st.sel === u ? null : u; draw(); };
    svg.addEventListener('click', pick); list.addEventListener('click', pick);
    host.querySelector('.rp').setAttribute('tabindex', '0');
    host.querySelector('.rp').addEventListener('keydown', function (ev) {
      if (ev.key === ' ') { ev.preventDefault(); play(); }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); play(false); st.t = Math.max(0, Math.min(K.T, st.t + (ev.key === 'ArrowRight' ? 3 : -3))); draw(); }
    });
    draw();
  }

  window.KeibaReplay = { open: open };
})();
