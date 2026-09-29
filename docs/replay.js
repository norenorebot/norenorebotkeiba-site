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
     ・速さは実際の馬に近づける（2026-09-29）: 最高 時速68.4km、加速は1秒に2.5m/秒（スタート直後は5）、減速は3m/秒（詰まりそうな時は6）。
       前の馬に3馬身以内まで近づいたら先読みでその馬の速さに合わせる。1馬身を切った時は急停止せず、前の馬より少し遅い速さに落として
       1秒ほどで間隔を戻す（カクッと下がる動きを防ぐ）。横に動く判定では、まだ動いていない馬の進む分も見込む（重なりを防ぐ）。
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
  function buildKeys(rp, g, goalMode, sl) {
    var D = rp.distance, N = rp.N, cr = crossings(D, g), rs = railShift(rp);
    var firstS = cr.length ? cr[0].s : D * 0.3, lastS = cr.length ? cr[cr.length - 1].s : D * 0.75;
    var v3 = (D - 600) / rp.pace.pred, vend = 600 / 35.5, keys = {}, tmax = D, pre = {};
    rp.horses.forEach(function (h) {
      var f1 = sl && sl[h.u] ? Math.min(1, h.first + 0.48) : h.first;   // 出遅れた馬: 最初の角で頭数の約半分後ろ（実際の出遅れの中央値 0.48）
      var K = [[0, 0, (h.u - 1) * 0.95], [firstS, f1 * 1.18 * (N - 1) * BL, h.lane * 0.8]];
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
  function simulate(rp, g, goalMode, sl) {
    var KK = buildKeys(rp, g, goalMode, sl), D = rp.distance, lead = leaderPlan(rp), DT = 0.1;
    var H = rp.horses.map(function (h) { return { u: h.u, K: KK.keys[h.u], s: 0, lane: (h.u - 1) * 0.95, v: 0, lo: 0 }; })
      .sort(function (a, b) { return a.u - b.u; });        // 記録は馬番順（描画側の hidx と合わせる）
    var frames = [], t = 0, LAT = 0.14, GAPL = 0.75, LOOK = 3;
    var VMAX = 19.0, TAU = 0.8, ACC = 2.5, ACC_LOW = 5.0, DEC = 3.0, DEC_HARD = 6.0;
    // 馬ごとの最高速（2026-09-29）: 残り600mからは、その馬の上がり3F（先頭の上がり＋ゴールの遅れ−残り600mの遅れ）を先頭の上がり3ハロンの形に
    // 伸ばした最速の1ハロンの1.03倍まで。それより前は、先頭の最速ラップ（最初の半端な区間を除く）の1.03倍まで。
    var L3 = (rp.laps && rp.laps.length >= 4) ? rp.laps.slice(-3) : [35.5 / 3, 35.5 / 3, 35.5 / 3];
    var sL3 = L3[0] + L3[1] + L3[2], mL3 = Math.min.apply(null, L3);
    var eL = (rp.laps && rp.laps.length >= 5) ? rp.laps.slice(1, -3) : [rp.pace.pred / Math.max(1, (D - 600) / 200)];
    var capE = Math.min(VMAX, 200 / Math.min.apply(null, eL) * 1.03), byU = {};
    rp.horses.forEach(function (h) { byU[h.u] = h; });
    H.forEach(function (h) {
      var o = byU[h.u], gs = goalMode === 'time' ? o.goal_time : o.goal_v9, A = sL3 + Math.max(gs - o.g3, -0.1 * sL3);   // 差を詰める馬は先頭より速い
      h.cap = Math.min(VMAX, 200 / (mL3 * A / sL3) * 1.03); h.capE = Math.max(h.cap, capE);
    });
    var clear = function (me, lane) {
      if (lane < 0 || lane > 20) return false;                // 18頭の大外はゲートで16.15レーン目（2026-09-29: 上限16で大外が内へ一度も動けなかった）
      for (var k = 0; k < H.length; k++) {
        var o = H[k]; if (o === me) continue;
        var os = o.upd ? o.s : o.s + o.v * DT;               // まだこのコマで動いていない馬は、進む分も見込む
        if (Math.abs(o.lane - lane) < GAPL && Math.abs(os - me.s) < BL) return false;
      }
      return true;
    };
    frames.push(H.map(function (h) { return [h.s, h.lane]; }));
    while (t < 400) {
      t += DT;
      var x = lead(t), xn = lead(t + DT), vl = (xn - x) / DT;
      H.sort(function (a, b) { return b.s - a.s; });
      H.forEach(function (h) { h.upd = false; });
      H.forEach(function (h) {
        if (h.ft !== undefined) {                              // ゴール後: その場の速さから自然に減速して走り抜ける（並び・間隔を保つ）
          h.v = Math.max(0, h.v - 1.2 * DT);
          var sF = h.s + h.v * DT;
          for (var k2 = 0; k2 < H.length; k2++) {             // ゴール後も前の馬（同じ進路）に1馬身以上は近づかない
            var o4 = H[k2]; if (o4 === h || o4.s < h.s) continue;
            if (Math.abs(o4.lane - h.lane) < GAPL && o4.s - sF < BL) sF = Math.min(sF, o4.s - BL);
          }
          sF = Math.max(h.s, sF); h.v = (sF - h.s) / DT; h.s = sF; h.upd = true; return;
        }
        var tg = interp(h.K, x), sT = x - tg[0];
        // 速さ（2026-09-29 実際の馬に近づける）: 最高 時速68.4km（馬ごとの上限は上）、加速 2m/秒²（秒速12mまでのスタート直後は 5）、減速 3m/秒²。
        var vd = Math.max(0, Math.min(h.s > D - 600 ? h.cap : h.capE, vl + (sT - h.s) / TAU)), fol = false;
        if (sl && sl[h.u] && t < 0.5) vd = 0;                  // 出遅れ: ゲートを出るのが0.5秒遅れる
        var nr = null;                                         // 先読みのブレーキ: 同じ進路の前の馬に3馬身以内まで近づいたら、その馬の速さに合わせる
        for (var k0 = 0; k0 < H.length; k0++) {
          var o0 = H[k0]; if (o0 === h || o0.s <= h.s || Math.abs(o0.lane - h.lane) >= GAPL) continue;
          if (!nr || o0.s < nr.s) nr = o0;
        }
        if (nr && nr.s - h.s < 3 * BL) { vd = Math.min(vd, Math.max(0, nr.v + (nr.s - h.s - 1.2 * BL) / 1.0)); fol = true; }
        var dec = (fol && vd < h.v - DEC * DT) ? DEC_HARD : DEC, acc = h.v < 12 ? ACC_LOW : ACC;
        var v = Math.max(h.v - dec * DT, Math.min(h.v + acc * DT, vd));
        var sN = h.s + v * DT, blocked = false, vAhead = 99, gMin = 99;
        for (var k = 0; k < H.length; k++) {                  // 前の馬（同じ進路・1馬身以内）より前には出ない
          var o = H[k]; if (o === h || o.s < h.s) continue;
          if (Math.abs(o.lane - h.lane) < GAPL && o.s - sN < BL) { blocked = true; vAhead = Math.min(vAhead, o.v); gMin = Math.min(gMin, o.s - h.s); }
        }
        if (blocked) {                                         // 急停止せず、前の馬より少し遅い速さまで強め（最大8m/秒²）に落として1秒ほどで1馬身に戻す
          var vt = Math.max(0, vAhead - Math.max(0, BL - gMin) / 1.0);
          v = Math.max(h.v - 8 * DT, Math.min(v, vt));
          sN = h.s + v * DT;
        }
        sN = Math.max(h.s, sN);
        if (sN >= D && h.s < D) { h.ft = t - DT * (sN - D) / Math.max(1e-6, sN - h.s); h.vf = (sN - h.s) / DT; }   // ゴールを通過した時刻と速さ
        h.v = (sN - h.s) / DT; h.s = sN; h.upd = true;
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
  /* ── 物理で走らせる（試験, 2026-09-29, course_transfer_research/phys_sim2.py の simulate_cp を移植・PHYS_SIM.md）──
     着順・位置の目標は入れず、能力と作戦だけで走らせる。隊列・ペース・並走・外を回す・詰まり・着順は物理で決まる。
     能力: T = ふつうのペースでの走破タイム（構成要素の予想）→ 臨界速度 CS = 基準の前半の速さ×0.87、余力 W = 距離 − CS×T（予想は縮むので T の差は2倍に広げる。1着〜最下位が実際の中央値3.2秒に近い）。
       風よけ: 前2.5馬身以内・左右1頭分以内に馬がいる間は、保てる速さが2%上がる（先頭や単独で外を走る馬ほど消耗し、直線で順位が入れ替わる）。
       速さ v で走ると 余力が (v − CS)×時間 減る（CS より遅ければ戻る）。残り600mからは、ゴールまでに余力を使い切る速さ CS×R/(R−W) で追う。
     作戦: スタート〜最初の角は テンの速さ（出せる速さの上限）と行きたい位置（展開予想図の最初の角の予想位置: 先頭から 予想位置×(頭数−1)×0.8馬身）。
       道中は最初の角の位置を保つ（先頭は基準の残り600mまでの時計を、前に行きたい馬の数と強さで速めた予定に合わせる）。
       3〜4角（残り1000〜600m）で後ろの馬が差を詰める。差し馬（脚質の後ろ3割）は残り1000mから前に馬がいれば外へ。直線は前6馬身以内に馬がいれば早めに外へ。
     物理: 同じ進路で1馬身以内の前の馬は抜けない・3馬身以内で先読みのブレーキ・横は空いている所だけ・コーナーでは外ほど長く走る（曲がり具合×ラチからの距離）。 */
  var PHYS = { kcs: 0.87, push: 0.06, tau: 2.0, duel: 0.015, spurt: 600, acc: 2.5, acc_lo: 5.0, dec: 3.0, lat: 0.14, gapl: 0.75, look: 3, vmax: 19.0,
               spread: 2, max_wide: 3.5, ten_k: 0.03, gap_start: 0.8, front_pp: 0.25, ten_top: 0.05, lat_sp: 7.0, fan_bl: 6.0,
               closer_pp: 0.7, closer_pre: 400, closer_bl: 3.0, compress: 0.4, pre: 400, inward_early: 0.5, move_up: 2.0,
               path_sp: 2.0, path_cost: 2.0, path_out: 6.0, path_wait: 0.3, draft: 0.02, crowd: 3.0, room_cap: 60, spread_re: 1.0 };
  function curvature(course) {                  // コースの点列（一周を等間隔）から 1点ごとの曲がり具合（1/m）
    // 向きを付けたまま前後11点でならし、回る向きと逆の小さな曲がりは0、一周の合計がちょうど360度になるように合わせる
    // （2026-09-29: 点列のギザギザで一周 744〜1539度になり、外を回る損が2〜4倍に出ていた）
    var P = course.pts, n = P.length, step = course.circ / n, th = [], d = [], out = [], tot = 0, sum = 0;
    for (var i = 0; i < n; i++) { var a = P[i], b = P[(i + 1) % n]; th.push(Math.atan2(b[1] - a[1], b[0] - a[0])); }
    for (var i2 = 0; i2 < n; i2++) { var x = th[(i2 + 1) % n] - th[i2]; x = Math.atan2(Math.sin(x), Math.cos(x)); d.push(x); tot += x; }
    var sgn = tot >= 0 ? 1 : -1;
    for (var j = 0; j < n; j++) { var m = 0; for (var q = -5; q <= 5; q++) m += d[((j + q) % n + n) % n]; m = Math.max(0, sgn * m / 11); out.push(m); sum += m; }
    for (var j2 = 0; j2 < n; j2++) out[j2] = out[j2] * (2 * Math.PI) / Math.max(sum, 1e-9) / step;
    return { k: out, step: step };
  }
  function simulatePhys(rp, g, course, sl) {
    var P = PHYS, D = rp.distance, H = rp.horses.slice().sort(function (a, b) { return a.u - b.u; }), n = H.length, DT = 0.1;
    var KP = curvature(course), kap = KP.k, step = KP.step, nk = kap.length, C = course.circ;
    var fstd = rp.phys.f, CS = fstd * P.kcs;
    var Tm = H.reduce(function (a, h) { return a + h.T; }, 0) / n;
    var W0 = H.map(function (h) { return D - CS * (Tm + (h.T - Tm) * P.spread); }), W = W0.slice();
    // 脚質の代わりに、展開予想図の「最初の角の予想位置」（first）を使う（2026-09-29: 最初の角 0.464→0.488・着順 0.366→0.406、250R）
    var pp = H.map(function (h) { return typeof h.first === 'number' ? h.first : h.pp; }), dz = H.map(function (h) { return h.dz; });
    var s = H.map(function () { return 0; }), v = s.slice(), lane = H.map(function (h) { return (h.u - 1) * 1.0; });
    var ppmin = Math.min.apply(null, pp), nf = pp.filter(function (x) { return x < 0.25; }).length;
    var T3plan = rp.phys.T3 * (1 - P.push * 0.3 * (0.4 - ppmin) - P.duel * Math.max(0, nf - 1));
    var cr = crossings(D, g), firstS = cr.length ? cr[0].s : Math.min(400, D * 0.3);
    var ft = H.map(function () { return NaN; }), frames = [], t = 0, upd = [];
    var hold = H.map(function (h) { return sl && sl[h.u] ? 0.5 : 0; });
    var tgt = H.map(function () { return NaN; }), tpick = H.map(function () { return -99; }), blkSince = H.map(function () { return NaN; });   // 出遅れ（抽選）: ゲートを出るのが0.5秒遅れる
    frames.push(H.map(function (h, i) { return [s[i], lane[i]]; }));
    var clear = function (i, L) {
      if (L < 0 || L > 20) return false;                              // 18頭の大外はゲートで17レーン目
      for (var k2 = 0; k2 < n; k2++) {
        if (k2 === i) continue;
        var sx = upd[k2] ? s[k2] : s[k2] + v[k2] * DT;               // まだこのコマで動いていない馬は、進む分も見込む
        if (Math.abs(lane[k2] - L) < P.gapl + 0.05 && Math.abs(sx - s[i]) < BL) return false;   // 横に並ぶ時は少し間隔をあける
      }
      return true;
    };
    var room = function (i, L) {                                      // その進路の前の空き（m）
      var r = 99;
      for (var k2 = 0; k2 < n; k2++) if (k2 !== i && s[k2] > s[i] && Math.abs(lane[k2] - L) < P.gapl) r = Math.min(r, s[k2] - s[i]);
      return r;
    };
    while (t < 400) {
      t += DT;
      var lead = -1, il = 0;
      for (var a = 0; a < n; a++) if (s[a] > lead) { lead = s[a]; il = a; }
      var ord = [];
      for (var a2 = 0; a2 < n; a2++) ord.push(a2);
      ord.sort(function (x, y) { return s[y] - s[x] || x - y; });      // 前の馬から順に動かす（同じ位置なら馬番順）
      for (var a3 = 0; a3 < n; a3++) upd[a3] = false;
      for (var oi = 0; oi < n; oi++) {
        var i = ord[oi]; upd[i] = true;
        if (!isNaN(ft[i])) { v[i] = Math.max(0, v[i] - 1.2 * DT); s[i] += v[i] * DT; continue; }   // ゴール後は減速して走り抜ける
        var R = D - s[i], vd, bp = 0, sBefore = s[i], laneBefore = lane[i];
        if (R <= P.spurt) {
          vd = W[i] > 0 ? CS * R / Math.max(R - W[i], 1.0) : CS;          // 残り600m: 余力をゴールまでに使い切る速さ
        } else {
          if (s[i] < firstS) {
            var vmaxI = fstd * (1 + P.ten_k * dz[i] + P.ten_top);          // スタートで出せる速さ（テンの速さ）
            if (pp[i] < P.front_pp || i === il) vd = vmaxI;
            else vd = Math.min(vmaxI, v[il] + ((lead - pp[i] * (n - 1) * P.gap_start * BL) - s[i]) / 2.0);
          } else if (i === il) {
            if (D - 600 - s[i] > 50 && T3plan - t > 3) vd = (D - 600 - s[i]) / (T3plan - t);   // 先頭: 残り600mまでの予定の時計
            else vd = fstd * (1 + P.push * 0.5 * (0.4 - pp[i]));
          } else {
            var gapM = lead - s[i], pre0 = D - P.spurt - P.pre;             // 道中は今の位置を保つ。3〜4角で差を詰める
            if (s[i] > pre0) gapM *= 1 - P.compress * Math.min(1, (s[i] - pre0) / P.pre);
            vd = v[il] + ((lead - gapM) - s[i]) / P.tau;
            bp = (lead - gapM) - s[i];
          }
          if (pp[i] < 0.25) {                                               // 前に行きたい馬どうしが並ぶと少し速くなる
            for (var k3 = 0; k3 < n; k3++) if (k3 !== i && Math.abs(s[k3] - s[i]) < BL && Math.abs(lane[k3] - lane[i]) < 2.0 && pp[k3] < 0.25) { vd *= 1 + P.duel; break; }
          }
        }
        if (t < hold[i]) vd = 0;
        vd = Math.min(vd, P.vmax);
        var fol = false, jn = -1;                                           // 先読みのブレーキ: 同じ進路の前の馬に3馬身以内まで近づいたら、その馬の速さに合わせる
        for (var k4 = 0; k4 < n; k4++) if (k4 !== i && s[k4] > s[i] && Math.abs(lane[k4] - lane[i]) < P.gapl && (jn < 0 || s[k4] < s[jn])) jn = k4;
        if (jn >= 0) { var gp = s[jn] - s[i]; if (gp < P.look * BL) { vd = Math.min(vd, Math.max(0, v[jn] + (gp - 1.2 * BL) / 1.0)); fol = true; } }
        var acc = (v[i] < 12 ? P.acc_lo : P.acc) * (1 + 0.1 * Math.max(-2, Math.min(2, dz[i])));
        var dec = fol && vd < v[i] - P.dec * DT ? 6.0 : P.dec;
        var vi = Math.max(v[i] - dec * DT, Math.min(v[i] + acc * DT, vd));
        var u = ((s[i] - D) % C + C) % C, kx = kap[Math.floor(u / step) % nk], fac = 1 + kx * lane[i] * LANE_M;   // コーナーでは外ほど長く走る
        if (kx > 2e-4 && lane[i] > P.max_wide && D - s[i] > P.spurt && s[i] >= firstS) {   // 最初の角より前（スタート直後）は寄せない   // コーナーで外4頭より外: 内へ入れる隙を探し、無ければ少し下げる
          if (clear(i, lane[i] - P.lat * 2)) lane[i] -= P.lat * 2;
          else {                                                          // 内の馬より少し遅い速さまで下げて後ろに入る（基準の9割より下げない）
            var vIn = 1e9;
            for (var kw = 0; kw < n; kw++) if (kw !== i && Math.abs(s[kw] - s[i]) < 2 * BL && lane[kw] < lane[i]) vIn = Math.min(vIn, v[kw]);
            var tv = vIn < 1e9 ? Math.max(vIn - 0.3, fstd * 0.9) : vi;
            vi = Math.max(v[i] - 1.0 * DT, Math.min(vi, tv));
          }
        }
        var sN = s[i] + vi * DT / fac, blk = false, gmin = 1e9, vah = 1e9;   // 同じ進路の1馬身以内の前の馬は抜けない
        for (var k5 = 0; k5 < n; k5++) if (k5 !== i && s[k5] > s[i] && Math.abs(lane[k5] - lane[i]) < P.gapl && s[k5] - sN < BL) { gmin = Math.min(gmin, s[k5] - s[i]); vah = Math.min(vah, v[k5]); }
        if (gmin < 1e9) {
          var vt = Math.max(0, vah - Math.max(0, BL - gmin) / 1.0);
          vi = Math.max(v[i] - 8.0 * DT, Math.min(vi, vt)); sN = s[i] + vi * DT / fac; blk = true;
        }
        var csI = CS;                                                       // 風よけ: 前2.5馬身以内・左右1頭分以内に馬がいれば、保てる速さが2%上がる（先頭や単独で外を走る馬ほど消耗する）
        for (var kd = 0; kd < n; kd++) if (kd !== i && s[kd] > s[i] && s[kd] - s[i] < 2.5 * BL && Math.abs(lane[kd] - lane[i]) < 1.0) { csI = CS * (1 + P.draft); break; }
        W[i] -= (vi - csI) * DT;                                            // 余力 = 走った距離 − CS×時間 の勘定
        v[i] = vi; s[i] = Math.max(s[i], sN);
        if (s[i] >= D && isNaN(ft[i])) ft[i] = t;
        // 横の動き
        var settle = s[i] < D - P.spurt && !(bp > P.move_up * BL);
        if (s[i] > D - P.spurt - P.pre) settle = false;
        var fan = false;
        if (D - s[i] <= P.spurt && kx < 2e-4) {                           // 直線: 前6馬身以内に馬がいれば早めに外へ
          for (var k6 = 0; k6 < n; k6++) if (k6 !== i && s[k6] > s[i] && s[k6] - s[i] < P.fan_bl * BL && Math.abs(lane[k6] - lane[i]) < 1.0) { fan = true; break; }
        }
        if (!fan && pp[i] >= P.closer_pp && D - P.spurt - P.closer_pre < s[i]) {   // 差し馬: 4角の手前から、前に馬がいれば外へ
          for (var k7 = 0; k7 < n; k7++) if (k7 !== i && s[k7] > s[i] && s[k7] - s[i] < P.closer_bl * BL && Math.abs(lane[k7] - lane[i]) < 1.0) { fan = true; break; }
        }
        if (D - s[i] <= P.spurt && (kx < 2e-4 || pp[i] >= P.closer_pp)) {
          // 直線（差し馬は4角から）: 進む先の進路を決めて、そこへなめらかに移る。前が空いていて近くの馬が少ない進路を選ぶ（パトロール映像: 直線の半ばで横11〜12頭分・真後ろに付く馬は1〜2割）。1秒ごと・前がふさがって0.3秒で選び直す
          if (blk) { if (isNaN(blkSince[i])) blkSince[i] = t; } else blkSince[i] = NaN;
          if (isNaN(tgt[i]) || (!isNaN(blkSince[i]) && t - blkSince[i] > P.path_wait && t - tpick[i] > P.path_wait) || t - tpick[i] > P.spread_re) {
            var best = lane[i], bsc = -1e9, c0 = Math.max(0, lane[i] - 1.0);
            for (var kc = 0; c0 + kc * 0.5 < lane[i] + P.path_out + 0.01; kc++) {
              var cc = c0 + kc * 0.5, rm = P.room_cap, crowd = 0;
              for (var kr = 0; kr < n; kr++) if (kr !== i && s[kr] > s[i] && Math.abs(lane[kr] - cc) < P.gapl) rm = Math.min(rm, s[kr] - s[i]);
              for (var kw2 = 0; kw2 < n; kw2++) if (kw2 !== i && Math.abs(s[kw2] - s[i]) < 3 * BL && Math.abs(lane[kw2] - cc) < 1.0) crowd++;   // 近くの馬が多い進路は避ける（直線で各馬が自分の進路へ散る）
              var sc = rm - P.path_cost * Math.abs(cc - lane[i]) - (cc < lane[i] ? 1.0 : 0.0) - P.crowd * crowd;
              if (sc > bsc) { best = cc; bsc = sc; }
            }
            tgt[i] = best; tpick[i] = t;
          }
          var dl = tgt[i] - lane[i];
          if (Math.abs(dl) > 0.02) { var mv = (dl > 0 ? 1 : -1) * Math.min(Math.abs(dl), P.lat * P.path_sp); if (clear(i, lane[i] + mv)) lane[i] += mv; }
          continue;
        }
        var vSame = 1e9;                                                    // 同じ進路の前にいる馬の最も遅い速さ
        for (var kq = 0; kq < n; kq++) if (kq !== i && Math.abs(lane[kq] - laneBefore) < P.gapl && sBefore < s[kq]) vSame = Math.min(vSame, v[kq]);
        var sameAhead = !settle && jn >= 0 && s[jn] - s[i] < P.look * BL && vSame < vd - 0.3;
        var want = fan || (blk && !settle) || sameAhead;
        if (want && s[i] > 30) {
          var here = room(i, lane[i]), spurtNow = D - s[i] <= P.spurt + 100, LATs = P.lat * (spurtNow ? P.lat_sp : 1.0), cand;
          if (spurtNow) cand = [LATs, -LATs].filter(function (dd) { return room(i, lane[i] + dd * 3) >= here; });
          else cand = [P.lat, -P.lat].filter(function (dd) { return room(i, lane[i] + dd * 7) > here + BL; });
          for (var c2 = 0; c2 < cand.length; c2++) if (clear(i, lane[i] + cand[c2])) { lane[i] += cand[c2]; break; }
        } else if (s[i] < D - P.spurt) {                                    // 空いていれば内へ（直線では寄らない）
          var stp = P.lat * (s[i] < firstS ? P.inward_early : 1.0);
          if (lane[i] > 0.05 && clear(i, Math.max(0, lane[i] - stp))) lane[i] = Math.max(0, lane[i] - stp);
        }
      }
      var ord2 = [];                                                          // 毎コマの最後: 同じ進路で前後が1馬身の9割より近い2頭は、後ろの馬を横へ押し出す（まれな食い違いの安全策）
      for (var b1 = 0; b1 < n; b1++) ord2.push(b1);
      ord2.sort(function (x, y) { return s[y] - s[x] || x - y; });
      for (var b2 = 0; b2 < n; b2++) for (var b3 = b2 + 1; b3 < n; b3++) {
        var ia = ord2[b2], ib = ord2[b3];
        if (isNaN(ft[ib]) && Math.abs(lane[ia] - lane[ib]) < P.gapl && s[ia] - s[ib] < 0.9 * BL) {   // 横へ少し押し出す（無理なら前の馬より遅くして自然に離す）
          var sd = lane[ib] >= lane[ia] ? 1 : -1, nl = lane[ib] + sd * 0.14, busy = false;
          for (var b4 = 0; b4 < n; b4++) if (b4 !== ib && b4 !== ia && Math.abs(lane[b4] - nl) < P.gapl && Math.abs(s[b4] - s[ib]) < BL) { busy = true; break; }
          if (nl >= 0 && nl <= 20 && !busy) lane[ib] = nl; else v[ib] = Math.min(v[ib], Math.max(0, v[ia] - 0.5));
        }
      }
      frames.push(H.map(function (h, k8) { return [s[k8], lane[k8]]; }));
      if (ft.every(function (x) { return !isNaN(x); }) && t >= Math.max.apply(null, ft) + 2.5) break;
    }
    var fin = {};
    H.forEach(function (h, k9) { fin[h.u] = { t: isNaN(ft[k9]) ? 1e9 : ft[k9], v: v[k9] }; });
    return { frames: frames, dt: DT, T: frames.length * DT, fin: fin, ft: ft };
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
    var st = { t: 0, playing: false, speed: 2, follow: mobile, goal: 'v9', mode: 'goal', sel: null, last: 0, sl: null };
    var physOK = !!(rp.phys && rp.horses.every(function (h) { return typeof h.T === 'number'; }));
    var runSim = function () { return st.mode === 'phys' && physOK ? simulatePhys(rp, g, course, st.sl) : simulate(rp, g, st.goal, st.sl); };
    var K = runSim();
    var slipOf = {}; rp.horses.forEach(function (h) { slipOf[h.u] = h.slip; });
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
      '<button type="button" class="rp-slip">出遅れを抽選</button><button type="button" class="rp-slip-off" hidden>出遅れなしに戻す</button>' +
      '<label class="rp-goal-l">ゴールの並び <select class="rp-goal"><option value="v9">総合点（勝つ確率）の順</option><option value="time">材料から予想した時計の順</option></select></label>' +
      (physOK ? '<label class="rp-mode-l">動き <select class="rp-mode"><option value="goal">予想の並びへ向かう</option><option value="phys">物理で走らせる（試験）</option></select></label>' : '') + '</div>' +
      '<svg class="rp-elev" viewBox="0 0 1000 90" role="img" aria-label="コースの高低"></svg></div>' +
      '<div class="rp-board"><div class="rp-board-h">いまの順番（予想）</div><ol class="rp-list"></ol></div></div>' +
      '<div class="note rp-note">' + esc(course.name) + '（一周' + course.circ + 'm・直線' + course.straight + 'm・高低差' + course.elev + 'm' +
      (rp.course_guess ? '・内回り/外回りは推定' : '') + '）　予想ペース: ' + tag +
      '（先頭が残り600mに着くまで 予想' + rp.pace.pred.toFixed(1) + '秒／標準' + rp.pace.base.toFixed(1) + '秒）<br>' +
      '※ 各馬の過去の位置取りと予想の時計から作った<b>参考の動き</b>で、実際のレースの映像ではありません。' +
      '最初のコーナーまでは展開予想図の隊列、残り600mは各馬の材料（持ちタイム・前半と上がりの速さ・経験したペース・位置取りの履歴・騎手と調教師の強さ・調教）から予想した時計の順、ゴールは総合点（勝つ確率）の順を目標に動きます（間隔は過去のレースの典型的な差）。' +
      '「ゴールの並び」で、材料から予想した時計の順にも切り替えられます。' +
      (physOK ? '「物理で走らせる（試験）」は、着順や位置の目標を入れずに、各馬の能力（材料から予想した時計）・テンの速さ・脚質だけで走らせます。' +
        '隊列・ペース・並走・外を回す距離・詰まり・着順は、走った結果で決まります（前が詰まれば抜けない、外を回れば長く走る、速く走れば末脚の余力が減る）。まだ試験中の動きです。' : '') +
      '先頭の速さはコースの典型的なラップの緩急、前が詰まった馬は1馬身以上空いた所にしか動けない（外へ持ち出すか前が空くのを待つ）ため、目標の順とずれることがあります。' +
      '「出遅れを抽選」は、各馬の過去の出遅れ率（最初のコーナーでいつもより大きく後ろになった割合）で出遅れる馬をくじ引きし、その馬はスタートが0.5秒遅れて最初のコーナーで頭数の約半分後ろから走ります（押すたびに引き直し）。' +
      '⚠は出遅れ率が20%以上の馬（全体は約13%）。' +
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
               '<span class="rp-mk">' + esc(marks[u]) + '</span><span class="rp-nm">' + esc(names[u] || '') +
               (st.sl && st.sl[u] ? '<span class="rp-slipped">出遅れ</span>' : (slipOf[u] >= 0.2 ? '<span class="rp-slipw" title="出遅れ率 ' + Math.round(slipOf[u] * 100) + '%">⚠</span>' : '')) +
               '</span><span class="rp-gap">' + gap + '</span></li>';
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
    $('.rp-goal').addEventListener('change', function () { st.goal = this.value; K = runSim(); draw(); });
    if (physOK) $('.rp-mode').addEventListener('change', function () {
      st.mode = this.value; $('.rp-goal').disabled = st.mode === 'phys'; K = runSim(); st.t = 0; play(false); draw();
    });
    var reslip = function (sl) {
      st.sl = sl; K = runSim(); st.t = 0; play(false); draw();
      var us = sl ? Object.keys(sl).map(Number).sort(function (a, b) { return a - b; }) : [];
      $('.rp-slip').textContent = sl ? (us.length ? '出遅れ: ' + us.join('・') + '番（引き直す）' : '出遅れなし（引き直す）') : '出遅れを抽選';
      $('.rp-slip-off').hidden = !sl;
    };
    $('.rp-slip').addEventListener('click', function () {
      var sl = {}; rp.horses.forEach(function (h) { if (Math.random() < (h.slip === undefined ? 0.13 : h.slip)) sl[h.u] = true; });
      reslip(sl);
    });
    $('.rp-slip-off').addEventListener('click', function () { reslip(null); });
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
