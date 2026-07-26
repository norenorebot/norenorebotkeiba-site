/* ============================================================================
   app.js — 予想サイト 共通ロジック(fetch + レンダリング)
   方針: 判断は format_prediction.py v2 が data.json に焼き込み済み。
         ここは「表示するだけ」。判定・集計・買い目の再発明はしない(指示書§0)。
   ============================================================================ */
'use strict';

var DATA = 'data/';

/* 場別ガイダンス §4.5確定値(運用ルールブック 2026-07-16)。
   出典: format_prediction.py L61-71 VENUE_GUIDANCE と同値(表示専用に転記)。 */
var VENUE_MAP = {
  '京': ['◎', 'いつもの買い方でOK（55件・単勝回収103%）'],
  '東': ['◎', '特に馬連が good（回収117%）'],
  '福': ['◎', '単勝回収105%（参考記録）'],
  '小': ['○', '悪くない傾向'],
  '阪': ['○', '悪くない傾向'],
  '中': ['△', '慎重に・本命は少なめに（中山向けの数字。中京は目安なし）']
};

/* ---------- 小道具 ---------- */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pct(x) { return (x === null || x === undefined) ? '—' : (x * 100).toFixed(1) + '%'; }
function num(x, d) { d = (d === undefined) ? 0 : d; return (x === null || x === undefined) ? '—' : Number(x).toFixed(d); }
function signed(x) { if (x === null || x === undefined) return '—'; var v = Number(x); return (v >= 0 ? '+' : '') + v.toFixed(0); }
function dist(x) { return (x === null || x === undefined) ? '' : String(Math.round(Number(x))); }

function plainState(s) {
  if (s === 'V27欠測') return '時計データ不足';
  return s || '';
}
function verdictClass(v) {
  if (!v) return '';
  if (v.indexOf('勝負') >= 0) return 'v-shoubu';
  if (v.indexOf('見送り') >= 0) return 'v-miokuri';
  return 'v-shincho';
}

function loadJSON(url) {
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error(url + ' が読めません (' + r.status + ')');
    return r.json();
  });
}

/* ---------- やさしい言葉への変換(サイト表示専用・本体/変換層は無改変) ----------
   方針: 競馬用語(複勝・馬連・軸・人気・オッズ)はそのまま。
         システム/統計の専門用語だけ中高生にも分かる言葉へ。 */
var SOFTEN = [
  ['gap食い違い', '評価が食い違い'],
  ['gap一致', '評価が一致'],
  ['聖杯発火でも', '特別サインが出ても'],
  ['聖杯発火', '特別サイン点灯'],
  ['聖杯', '特別サイン'],
  ['格差シグナル', '実力差サイン'],
  ['標準形馬連3点', 'いつもの馬連3点'],
  ['標準形', 'いつもの'],
  ['MC2-4位', '予想の2〜4番手'],
  ['MC順位', '予想順位'],
  ['損失最小化の実績あり', '負けを小さく抑えた実績あり'],
  ['損失最小化実績なし', '負けを抑えた実績はまだなし'],
  ['損失最小化', '負けを小さく抑える'],
  ['的中用', '当てにいく用'],
  ['クラス注記', 'クラス補足'],
  ['gap感度最大', '強さ・時計の差がいちばん効く'],
  ['gap鈍い・割引', '強さ・時計の差が効きにくいので低めに見る'],
  ['gap鈍い', '強さ・時計の差が効きにくい'],
  ['勝負56.5%の軸', '1対1なら勝てる割合56.5%の軸'],
  ['本命サイズ半分', '本命の点数を半分に'],
  ['複勝単独は未実測', '複勝だけの成績はまだ測っていない'],
  ['全買い方最良', '全部の買い方でいちばん良い'],
  ['配当妙味', '配当のうまみ'],
  ['妙味', 'うまみ'],
  ['小サイズ', '少なめ'],
  ['サイズ小', '少なめ'],
  ['サイズ半分', '半分に'],
  ['F5', 'まぐれ除き'],
  ['Elo/V27', '「強さ」と「持ち時計」'],
  ['小標本', '件数が少ない'],
  ['場別ガイダンス', '競馬場ごとの傾向'],
  ['シグナル', 'システムのサイン'],
  ['較正フォールバック', 'ものさし合わせが未完了'],
  ['フォールバック', '予備の判定'],
  ['頑健性確認', 'ブレにくさの確認'],
  ['未シード', '乱数を固定していない'],
  ['厳密再現', '完全な再現'],
  ['再生成', '作り直し'],
  ['N基準色', '件数による色分け'],
  ['ベタ買い', '毎回買い'],
  ['§6モニタ', '引き続き見張り'],
  ['モニタ', '見張り'],
  ['判断軸', '判断のよりどころ'],
  ['1段階割引', '1ランク低く見る'],
  ['物差し', '目安'],
  ['推奨なしを明示=判断支援', '「買わない」も大事な判断'],
  ['遡及', '過去に当てはめた']
];
function soften(s) {
  if (s === null || s === undefined) return s;
  var out = String(s);
  SOFTEN.forEach(function (p) { out = out.split(p[0]).join(p[1]); });
  return out;
}

/* ☔鬼神化該当馬(重・不良で一変する条件を満たした馬)を data.json から取る。
   ※本体では Rule0 発火ブロック内のコンソール出力のみで、prob_log/seihai_log に
     記録が無い(2026-07-26 調査)。よって現状この配列は常に空＝道悪行は表示されない。
     本体が Rule0 発火をログに出すようになれば、data.json に kishin が入り自動で表示される。 */
function kishinHorses(d) {
  var k = (d.race || {}).kishin || d.kishin;
  if (!k) return [];
  return (Array.isArray(k) ? k : [k]).filter(Boolean);
}

/* 判定理由を「構造化データ」からやさしい日本語で組み立てる(元の判定文は詳細に残す) */
function plainReason(d) {
  var v = (d.verdict || {}).value || '';
  var g = d.gap || {}, se = d.seihai || {};
  if (v.indexOf('見送り') >= 0) {
    if (g.state === '食い違い')
      return '「強さ」で上位の馬と「持ち時計」で上位の馬がバラバラです。こういうレースは当てにくいので、買わずに見送ります。';
    return '本命のオッズが8〜15倍あたりで、うまみが小さいと判断しました。今回は見送ります。';
  }
  if (v.indexOf('勝負') >= 0) {
    return '「強さ」で見ても「持ち時計」で見ても同じ上位2頭。特別な条件もそろっていて、自信のある一戦です。';
  }
  // ⚠️慎重 — レースの見立て(gap由来)と、特別サイン(独立軸)は別物。
  // 慎重なのに買い目が出るのは矛盾ではないので、後半で「ただし…」と繋いで整合させる。
  var head;
  if (g.v27_missing) head = '過去の「持ち時計」データが足りず、レースとしてははっきり判断できませんでした';
  else if (g.state === '一致') head = '「強さ」と「持ち時計」の上位2頭は同じですが、レースとしての狙いどころはもう一歩です';
  else head = 'レースとしては、はっきりした狙い目がありません';

  if (se.fired) {
    // 聖杯発火時: 買い目が出る理由を明示して矛盾に見せない
    return head + '。ただし ◎' + esc(se.axis || '本命') +
           ' に特別サインが点灯しているため、下記を<b>控えめのサイズで</b>。';
  }
  return head + '。控えめにします。';
}

/* gapの1行をやさしく */
function plainGap(g) {
  if (!g) return '';
  if (g.v27_missing) return '見方: 「強さ」の開き ' + num(g.elo_gap_top2, 1) + ' ／ 「持ち時計」はデータ不足で今回は測れず';
  var word = g.state === '一致' ? '同じ2頭が上位（一致）' : g.state === '食い違い' ? '上位がバラバラ（食い違い）' : esc(g.state);
  return '見方: 「強さ」の開き ' + num(g.elo_gap_top2, 1) + ' ／ 「持ち時計」の開き ' + num(g.v27_gap_top2, 1) + ' → <b>' + word + '</b>';
}

/* 正式場名(中山/中京の取り違えが目で分かるように必ず出す) */
var CODE_TO_NAME = {
  '東': '東京', '中': '中山', '京': '京都', '阪': '阪神', '名': '中京',
  '札': '札幌', '函': '函館', '福': '福島', '新': '新潟', '小': '小倉'
};
function venueLabel(d) {
  var h = d.header || {}, r = d.race || {};
  if (r.venue_name) return r.venue_name;
  return CODE_TO_NAME[(h.venue || '').charAt(0)] || h.venue || '';
}
/* 「7/25(土) 中京11R」の形に組み立てる */
function raceTitle(d) {
  var h = d.header || {}, r = d.race || {};
  var ymd = String(r.date || h.date || '');
  var head = '';
  var m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    var wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(ymd + 'T00:00:00').getDay()];
    head = Number(m[2]) + '/' + Number(m[3]) + '(' + wd + ') ';
  }
  return head + venueLabel(d) + (r.no ? ' ' + r.no + 'R' : '');
}

/* ---------- 結論カード(ブロック1 + 折りたたみ2/3) ---------- */
function renderVerdictCard(d) {
  var h = d.header || {}, v = d.verdict || {}, se = d.seihai || {}, g = d.gap || {};
  var vg = d.venue_guidance || {};
  var r = d.race || {};
  var vcls = verdictClass(v.value);
  var course = esc(h.surface) + dist(h.distance);
  var title = esc(raceTitle(d)) + '　' + course + ' ' + esc(h.race_class);
  var vm = VENUE_MAP[(h.venue || '').charAt(0)];
  var vgLabel = vm ? (vm[0] + ' ' + vm[1]) : ((vg.mark || '—') + ' ' + soften(vg.note || '目安なし'));

  var html = '';
  html += '<div class="verdict-block">';
  html += '<div class="rid">▼ ' + title + '　<span class="note">[' + esc(venueLabel(d)) + ': ' + esc(vgLabel) + ']</span></div>';
  html += '<div class="line">判定: <span class="' + vcls + '">' + esc(v.value) + '</span></div>';
  // plainReason は動的部分に esc 済みの安全なHTMLを返す(強調と馬名を含むため二重エスケープしない)
  html += '<div class="line">' + plainReason(d) + '</div>';

  if (se.fired) {
    var u = se.is_ultimate ? '🌈特別サイン(最上位)' : '🌈特別サイン';
    html += '<div class="line"><span class="seihai">' + u + '点灯: ◎' + esc(se.axis) + '</span>' +
            (se.skills_str ? ' <span class="note">' + esc(se.skills_str) + '</span>' : '') + '</div>';
  }

  html += '<div class="bet">買い目:</div><ul>';
  (d.bets || []).forEach(function (b) { html += '<li>' + esc(soften(b)) + '</li>'; });
  html += '</ul>';
  if ((d.bet_notes || []).length) {
    html += '<div class="note">';
    (d.bet_notes || []).forEach(function (n) { html += '※ ' + esc(soften(n)) + '<br>'; });
    html += '</div>';
  }
  // やめる目安(8〜15倍帯は検証済みの死角)。ただし🚫見送りのレースでは
  // そもそも買わないので「買う条件」は出さない。
  if (v.value && v.value.indexOf('見送り') < 0) {
    html += '<div class="line note">やめる目安: 本命のオッズが8〜15倍なら買わない</div>';
  }

  // 当日チェック — 検証済みの物差しだけを、該当する時だけ出す。
  //   ・馬体重±10kg は削除(休み明け等で日常的に起き、検証済みの物差しでもないため雑音)
  //   ・オッズ8〜15倍は「やめる目安」と重複するため削除(情報自体は上に残っている)
  //   ・道悪は ☔鬼神化該当馬がいる時だけ表示(該当馬名も出す)
  // 項目が1つも無ければ欄ごと出さない。
  var checks = [];
  var kishin = kishinHorses(d);
  if (kishin.length) {
    checks.push('☐馬場が重・不良に悪化したら <b>' + kishin.map(esc).join('・') +
                '</b> に注意（道悪(みちわる)で一変する条件を満たしています）');
  }
  if (checks.length) {
    html += '<div class="checklist">⏰ 当日チェック: ' + checks.join('　') + '</div>';
  }

  /* ブロック2【根拠】折りたたみ */
  html += '<details><summary>くわしい根拠を見る（各馬の点数・強さと時計の見方）</summary>';
  html += '<div class="note">' + plainGap(g) + '</div>';
  html += renderHorsesTable(d.horses || []);
  html += renderLearningProfile(d.learning_profile || {});

  /* ブロック3【詳細】深折りたたみ */
  html += '<details><summary>さらに専門的な内訳（上級者向け）</summary>';
  html += renderDetail(d, v.reason);
  html += '</details>';
  html += '</details>';

  html += '</div>';
  return html;
}

function renderHorsesTable(rows) {
  // 死んでいる列は出さない: オッズが全行空ならオッズ列ごと省く
  var hasOdds = rows.some(function (r) { return r.odds !== null && r.odds !== undefined; });
  var hasSwap = rows.some(function (r) { return r.swap; });
  // 調教は「このシステムで唯一 独立した価値が検証済みの軸」なので、該当馬がいれば列を出す
  var hasChokyo = rows.some(function (r) { return r.chokyo; });

  // 印の並び(レース全体の評価順)と表の並び(勝つ確率順)は一致しないので先に断る
  var html = '<div class="note">印はレース全体の評価順、表は勝つ確率の高い順に並べています' +
             '（順番が前後することがあります）。</div>';
  html += '<div class="tablewrap"><table>';
  html += '<tr><th>印</th><th>馬名</th>' + (hasChokyo ? '<th>調教</th>' : '') +
          '<th class="num">勝つ確率</th><th class="num">3着内に入る率(推定)</th>' +
          '<th class="num">実力の点数</th><th class="num">前日の総合点</th><th class="num">前日の上げ下げ</th>' +
          (hasOdds ? '<th class="num">オッズ</th>' : '') + '</tr>';
  rows.forEach(function (r) {
    var sw = r.swap ? ' ⇅' : '';
    // 脚質は不明なことが多い(運用日はparquet未収録)。不明なら括弧ごと出さない
    var style = (r.style && r.style !== '—') ? '(' + esc(r.style) + ')' : '';
    html += '<tr>';
    html += '<td class="c">' + esc(r.mark || '') + '</td>';
    html += '<td>' + esc(r.name) + style + sw + '</td>';
    if (hasChokyo) html += '<td class="seihai">' + esc(r.chokyo || '') + '</td>';
    html += '<td class="num">' + pct(r.mc_win) + '</td>';
    html += '<td class="num">' + pct(r.top3_est) + '</td>';
    html += '<td class="num">' + num(r.jitsuryoku) + '</td>';
    html += '<td class="num">' + num(r.zenjitsu) + '</td>';
    html += '<td class="num">' + signed(r.adjust) + '</td>';
    if (hasOdds) html += '<td class="num">' + (r.odds === null || r.odds === undefined ? '—' : num(r.odds, 1)) + '</td>';
    html += '</tr>';
  });
  html += '</table></div>';
  if (hasSwap) {
    html += '<div class="note">⇅ = 実力の順位と前日の総合点の順位が入れ替わっている馬</div>';
  }
  return html;
}

function renderLearningProfile(lp) {
  if (!lp || !lp.available) return '<div class="note">計算のクセ: このレース用のデータがありません</div>';
  var parts = (lp.systems || []).map(function (s) {
    if (s.pinned) return esc(s.label) + '[固定' + num(s.pin, 1) + ']';
    return esc(s.label) + s.bars;
  });
  var html = '<div class="learn-profile">📊 <b>このレースの計算のクセ</b>（' + esc(lp.cell) + '・作成日' + esc(lp.build_date) + '）<br>';
  html += '<span class="bars">　' + parts.join('　') + '</span><br>';
  html += '<span class="note">※ バーが多い＝その項目を大きく計算に使った、というだけの目安です。' +
          '数字の大小が「当たりやすさ」を保証するものではありません。</span></div>';
  return html;
}

function renderDetail(d, rawReason) {
  var se = d.seihai || {}, g = d.gap || {}, c = d.calib || {};
  var html = '<div class="note">';
  html += '<span style="color:#555">このブロックは開発用の専門的な内訳です（読み飛ばしてOK）。</span><br>';
  if (rawReason) html += 'システムの元の判定文: ' + esc(rawReason) + '<br>';
  if (se.fired) {
    html += 'バフ内訳: C(調教)=' + num(se.c_buff, 1) + ' / P(展開)=' + num(se.p_buff, 1) +
            ' / B(枠)=' + num(se.b_buff, 1) + ' / 素Eloランク=' + esc(se.raw_elo_rank) + '<br>';
  }
  html += 'gap内訳: Elo上位2=' + esc((g.elo_top2 || []).join('・')) + ' / V27上位2=' +
          (g.v27_missing ? '欠測(' + esc(g.v27_reason || '') + ')' : esc((g.v27_top2 || []).join('・'))) +
          ' / overlap=' + esc(g.overlap) + '<br>';
  html += '較正: ' + (c.using_calibrated_mc ? '較正温度T=' + num(c.calibrated_temp, 3) + ' 適用' :
          'フォールバック(素MC・calib_ok_30R=' + esc(c.calib_ok_30R) + ', n=' + esc(c.calib_sample_n) + ')') + '<br>';
  html += '</div>';
  return html;
}

/* ---------- トップ(最新予想) ---------- */
function initLatest() {
  var el = document.getElementById('latest');
  loadJSON(DATA + 'index.json').then(function (idx) {
    setUpdated(idx.generated_at);
    var latest = idx.latest_date;
    var todays = (idx.races || []).filter(function (r) {
      return (r.race_date || r.date) === latest;
    });
    if (!todays.length) { el.innerHTML = '<p>まだ予想がありません。</p>'; return; }
    // 当日の進行は1Rからなので、場ごとに R番号の昇順で並べる(番組表と同じ読み順)
    todays.sort(function (a, b) {
      var va = String(a.venue_name || a.venue || ''), vb = String(b.venue_name || b.venue || '');
      if (va !== vb) return va < vb ? -1 : 1;
      return (a.race_no || 99) - (b.race_no || 99);
    });
    document.getElementById('latest-date').textContent = '最新予想日: ' + latest + '(' + todays.length + 'レース)';
    // 各レースの data.json を取得して結論カードを縦に並べる
    return Promise.all(todays.map(function (r) { return loadJSON(DATA + 'archive/' + r.file); }))
      .then(function (list) {
        el.innerHTML = list.map(renderVerdictCard).join('');
      });
  }).catch(function (e) { el.innerHTML = '<p>読み込みエラー: ' + esc(e.message) + '</p>'; });
}

/* ---------- 成績ページ ---------- */
function nColor(color) {
  if (color === 'gray_参考外') return 'n-gray';
  if (color === 'light_傾向') return 'n-light';
  return 'n-normal';
}
function cell(c) {
  if (!c || c.n === 0) return '<td class="num n-gray">—</td>';
  var roi = (c.roi === null ? '—' : c.roi + '%');
  var f5 = (c.f5_roi === null || c.f5_roi === undefined ? '' : ' <span class="note">まぐれ除き ' + c.f5_roi + '%</span>');
  var hit = (c.hit_rate === null ? '—' : c.hit_rate + '%');
  return '<td class="num ' + nColor(c.color) + '">' + hit + ' / ' + roi + f5 +
         '<br><span class="note">N=' + c.n + '</span></td>';
}
function renderSeriesTable(series, unitLabel) {
  if (!series || series.available === false) {
    return '<p class="note">' + esc((series && series.reason) || 'データ無し') + '</p>';
  }
  var byYear = series.by_year || {};
  var years = Object.keys(byYear).sort();
  var months = [];
  for (var m = 1; m <= 12; m++) months.push(m);
  var html = '<div class="tablewrap"><table>';
  html += '<caption>' + esc(soften(series.series)) + '（当たった率 / 回収率・件数つき）</caption>';
  html += '<tr><th>年</th><th class="num">年計</th>';
  months.forEach(function (m) { html += '<th class="num">' + m + '月</th>'; });
  html += '</tr>';
  years.forEach(function (y) {
    var yr = byYear[y];
    html += '<tr class="year-total"><th>' + esc(y) + '</th>' + cell(yr.year_total);
    months.forEach(function (m) { html += cell((yr.months || {})[m]); });
    html += '</tr>';
  });
  // 夏合算(6-8月)行
  var summer = series.summer_6_8 || {};
  if (Object.keys(summer).length) {
    html += '<tr><th>夏(6-8月)</th><td class="num note">下記</td>';
    // 夏行は年ごとに月列を潰して1セルにまとめる(小標本モニタ)
    html += '<td class="num" colspan="12">';
    html += Object.keys(summer).sort().map(function (y) {
      var s = summer[y];
      return y + ': ' + (s.hit_rate === null ? '—' : s.hit_rate + '%') + ' / ' + (s.roi === null ? '—' : s.roi + '%') + '(N=' + s.n + ')';
    }).join('　');
    html += '</td></tr>';
  }
  html += '</table></div>';
  if (series.summer_weak_flag) {
    html += '<p class="frozen-note">⚠️ 夏(6-8月)が沈んでいます → 聖杯を1段階割引を検討(§6モニタ)。</p>';
  }
  return html;
}
function renderVenueMap() {
  var html = '<div class="tablewrap"><table>';
  html += '<caption>競馬場ごとの傾向（2026-07-16 時点）</caption>';
  html += '<tr><th>競馬場</th><th>評価</th><th>傾向・注意</th></tr>';
  var order = ['京', '東', '福', '阪', '小', '中'];
  order.forEach(function (v) {
    var g = VENUE_MAP[v];
    html += '<tr><td>' + v + '</td><td class="c">' + esc(g[0]) + '</td><td>' + esc(g[1]) + '</td></tr>';
  });
  html += '<tr><td>他ローカル</td><td class="c">—</td><td>物差し無し(控えめ)</td></tr>';
  html += '</table></div>';
  return html;
}
function initStats() {
  var el = document.getElementById('stats');
  loadJSON(DATA + 'stats.json').then(function (st) {
    setUpdated(st.generated_at);
    var fk = st.seihai_fukusho || {};
    var um = st.hyojun_umaren || {};
    var html = '';
    html += '<h2>「特別サイン」の本番成績（自動でたまります）</h2>';
    html += '<p class="note">配当が分かった ' + esc(fk.coverage_matched) + ' 件で集計（サイン点灯は全 ' + esc(fk.fired_total) + ' 件）。</p>';
    html += renderSeriesTable(fk, '100円');
    html += '<h2>馬連3点（軸＋2〜4番人気の予想馬）</h2>';
    html += renderSeriesTable(um, '300円');
    html += '<h2>競馬場ごとの傾向</h2>';
    html += renderVenueMap();
    html += '<h2>大事な注意（必ず読んでください）</h2><div class="frozen-note"><ul>';
    (st.frozen_notes || []).forEach(function (n) { html += '<li>' + esc(soften(n)) + '</li>'; });
    html += '</ul>';
    html += '<details><summary>正式な注記（原文）</summary><ul>';
    (st.frozen_notes || []).forEach(function (n) { html += '<li>' + esc(n) + '</li>'; });
    if (st.coverage_note) html += '<li>' + esc(st.coverage_note) + '</li>';
    html += '</ul></details></div>';
    el.innerHTML = html;
  }).catch(function (e) { el.innerHTML = '<p>読み込みエラー: ' + esc(e.message) + '</p>'; });
}

/* ---------- アーカイブ ---------- */
function initArchive() {
  var el = document.getElementById('archive');
  loadJSON(DATA + 'index.json').then(function (idx) {
    setUpdated(idx.generated_at);
    var html = '<div class="tablewrap"><table>';
    html += '<tr><th>レース日</th><th>競馬場</th><th class="c">R</th><th>コース・クラス</th>' +
            '<th>判定</th><th>サイン</th><th>強さ×時計</th><th>結果</th><th></th></tr>';
    (idx.races || []).forEach(function (r, i) {
      var vcls = verdictClass(r.verdict);
      html += '<tr>';
      html += '<td>' + esc(r.race_date || r.date) + '</td>';
      html += '<td>' + esc(r.venue_name || CODE_TO_NAME[(r.venue || '').charAt(0)] || r.venue) + '</td>';
      html += '<td class="c">' + (r.race_no ? esc(r.race_no) + 'R' : '—') + '</td>';
      html += '<td>' + esc(r.surface) + dist(r.distance) + ' ' + esc(r.race_class) + '</td>';
      html += '<td class="' + vcls + '">' + esc(r.verdict) + '</td>';
      html += '<td class="c">' + (r.seihai_fired ? '🌈' : '') + '</td>';
      html += '<td>' + esc(plainState(r.gap_state)) + '</td>';
      html += '<td class="c">' + esc(r.result_status) + '</td>';
      html += '<td><a href="#" data-file="' + esc(r.file) + '" class="detail-link">詳細</a></td>';
      html += '</tr>';
      html += '<tr id="row-' + i + '"><td colspan="9" class="detail-slot"></td></tr>';
    });
    html += '</table></div>';
    el.innerHTML = html;
    // 詳細リンク: クリックで data.json を取得しインライン展開
    var links = el.querySelectorAll('.detail-link');
    Array.prototype.forEach.call(links, function (a, i) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var slot = document.getElementById('row-' + i).querySelector('.detail-slot');
        if (slot.innerHTML) { slot.innerHTML = ''; return; }
        loadJSON(DATA + 'archive/' + a.getAttribute('data-file'))
          .then(function (d) { slot.innerHTML = renderVerdictCard(d); })
          .catch(function (e) { slot.innerHTML = '<span class="note">読み込み失敗: ' + esc(e.message) + '</span>'; });
      });
    });
  }).catch(function (e) { el.innerHTML = '<p>読み込みエラー: ' + esc(e.message) + '</p>'; });
}

/* ---------- 共通: 最終更新表示 ---------- */
function setUpdated(ts) {
  var el = document.getElementById('updated');
  if (el && ts) el.textContent = '最終更新: ' + String(ts).replace('T', ' ');
}
