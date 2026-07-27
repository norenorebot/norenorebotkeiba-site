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

/* ---------- 表示ラベルを「行動」に揃える(2026-07-26・表示層のみ) ----------
   data.json の verdict.value は判定の“由来”(gapシグナル)を表すため、
   「⚠️慎重 かつ 買い目なし」が最多になる(7/26は32本中25本)。読み手の行動は
   🚫見送りと同じ「買わない」なのに、ラベルが買い目の有無と一致せず
   「結局どれを買うのか」が一目で分からない。
   そこで表示だけを (verdict.value, 買い目の有無) から導出し直す。
   data.json のスキーマ・verdict は一切変更しない(既存アーカイブにも遡及して効く)。
   採点(reconcile_results.py)は bet_tier 基準なので、この変更の影響を受けない。 */
function hasBet(betTier) {
  return !!betTier && betTier !== 'none';
}
/* 買わない理由の2種を区別する。🚫見送りは gap食い違い のときだけ本体が出す判定。 */
function isGapDisagree(verdictValue, gapState) {
  return String(verdictValue || '').indexOf('見送り') >= 0 || gapState === '食い違い';
}
/* → {label, cls, kind}。kind: 'bet'(買い目あり) / 'disagree' / 'nosignal' */
function actionVerdict(verdictValue, betTier, gapState) {
  if (hasBet(betTier)) {
    return { label: verdictValue, cls: verdictClass(verdictValue), kind: 'bet' };
  }
  return {
    label: '🚫見送り', cls: 'v-miokuri',
    kind: isGapDisagree(verdictValue, gapState) ? 'disagree' : 'nosignal'
  };
}
function actionVerdictOf(d) {
  return actionVerdict((d.verdict || {}).value,
                       (d.verdict || {}).bet_tier,
                       (d.gap || {}).state);
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
  var av = actionVerdictOf(d);
  // 買い目が無いレースは、理由文の側で「バラバラ(危険サイン)」と「条件不足」を区別する。
  if (av.kind === 'disagree') {
    return '「強さ」と「持ち時計」の上位馬がバラバラです（検証済みの危険サイン）。こういうレースは当てにくいので、買わずに見送ります。';
  }
  if (av.kind === 'nosignal') {
    return '買う条件がそろっていません。無理に買わず、このレースは見送ります。';
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

/* ---------- 結果表示(reconcile_results.py が書いた result ブロック) ---------- */
/* 予想は「その時点の記録」として凍結し、結果はここにだけ足す。
   買い目なし(見送り)のレースは「◎が何着だったか」を参考として出すだけで、
   的中・回収の文言は出さない(回収率にも入らない)。 */
var TIER_LABEL = {
  seihai_fukusho: '複勝',
  gap_fukusho: '複勝',
  seihai_umaren: '馬連3点'
};
function renderResultLine(d) {
  var res = d.result;
  if (!res) return '';
  if (res.status !== '確定') {
    // res.reason は内部診断用の文言なのでそのまま出さない(「最新 20260719 < 20260726」等)。
    return '<div class="result-line pending">結果: <b>結果待ち</b>' +
           ' <span class="note">（着順・払戻のデータが届きしだい、自動で入ります）</span></div>';
  }
  var b = res.bet || {};
  var rk = (b.axis_rank === null || b.axis_rank === undefined) ? null : b.axis_rank;
  var axisTxt = '◎' + esc(b.axis || '') + ' ' + (rk === null ? '着順なし' : rk + '着');

  if (b.hit === null || b.hit === undefined) {
    // 買い目なし＝見送り。降りた判断の事後確認(参考)であり、買い目ではない。
    return '<div class="result-line ref">結果: ' + axisTxt +
           ' <span class="note">（買い目なしのレース＝見送った判断の事後確認です。成績には入れていません）</span></div>';
  }
  var label = TIER_LABEL[b.tier] || '買い目';
  var money = (b.hit ? '　払戻 ' + Math.round(b.payout) + '円（' + Math.round(b.cost) + '円買って）'
                     : '　' + Math.round(b.cost) + '円ハズレ');
  return '<div class="result-line ' + (b.hit ? 'hit' : 'miss') + '">結果: ' + axisTxt +
         ' → <b>' + label + (b.hit ? '的中' : 'ハズレ') + '</b>' + money + '</div>';
}

/* ---------- 結論カード(ブロック1 + 折りたたみ2/3) ---------- */
function renderVerdictCard(d) {
  var h = d.header || {}, v = d.verdict || {}, se = d.seihai || {}, g = d.gap || {};
  var vg = d.venue_guidance || {};
  var r = d.race || {};
  var av = actionVerdictOf(d);          // 表示ラベルは「行動」基準(買い目の有無で決まる)
  var course = esc(h.surface) + dist(h.distance);
  var title = esc(raceTitle(d)) + '　' + course + ' ' + esc(h.race_class);
  var vm = VENUE_MAP[(h.venue || '').charAt(0)];
  var vgLabel = vm ? (vm[0] + ' ' + vm[1]) : ((vg.mark || '—') + ' ' + soften(vg.note || '目安なし'));

  var html = '';
  html += '<div class="verdict-block">';
  html += '<div class="rid">▼ ' + title + '　<span class="note">[' + esc(venueLabel(d)) + ': ' + esc(vgLabel) + ']</span></div>';
  html += '<div class="line">判定: <span class="' + av.cls + '">' + esc(av.label) + '</span></div>';
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
  html += renderResultLine(d);
  if ((d.bet_notes || []).length) {
    html += '<div class="note">';
    (d.bet_notes || []).forEach(function (n) { html += '※ ' + esc(soften(n)) + '<br>'; });
    html += '</div>';
  }
  // やめる目安(8〜15倍帯は検証済みの死角)。買い目が無いレースでは
  // そもそも買わないので出さない(表示ラベルが🚫見送りなのに買う条件を出すと矛盾する)。
  if (av.kind === 'bet') {
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
  html += '<details><summary>くわしい数字（競馬に詳しい方向け）</summary>';
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
          '<th class="num">実力の点数</th><th class="num">前日の総合点</th>' +
          '<th class="num">調教・展開などの上げ下げ</th>' +
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
  html += '<div class="note">「調教・展開などの上げ下げ」＝ 調教の動き・想定される展開・' +
          '枠順と脚質の相性・騎手や厩舎の傾向などをまとめて点数化した増減です。</div>';
  if (hasSwap) {
    html += '<div class="note">⇅ = 実力の順位と前日の総合点の順位が入れ替わっている馬</div>';
  }
  return html;
}

/* 学習プロファイルの見出し(cell)は内部表記
   「{場コード1文字}{芝/ダ}{距離}・{TIER}」 で来る(format_prediction._learning_profile)。
   TIER は format_prediction._get_tier_local の戻り値で、実データに出る race_class
   (未勝利 / 1勝 / 2勝 / 3勝 / OP / オープン / 重賞名)では次のとおり(2026-07-27 実測):
     MAIDEN   ← 未勝利・新馬
     STANDARD ← 1勝・2勝
     ELITE    ← 3勝・OP・オープン・G1/G2/G3
   UNKNOWN も戻り値にあるため、未知の値はそのまま出す(勝手に言い換えない)。 */
var TIER_JA = {
  'MAIDEN': '未勝利・新馬クラスのデータ',
  'STANDARD': '1〜2勝クラスのデータ',
  'ELITE': '3勝クラス〜オープン・重賞のデータ',
  'UNKNOWN': 'クラス区分なしのデータ'
};
function plainCell(cell) {
  var s = String(cell || '');
  var i = s.lastIndexOf('・');
  if (i < 0) return esc(s);
  var head = s.slice(0, i), tier = s.slice(i + 1);
  // 先頭1文字の場コードを正式名に(中/名 の取り違えが目で分かるように)
  var full = CODE_TO_NAME[head.charAt(0)];
  if (full) head = full + ' ' + head.slice(1);
  return esc(head) + '・' + esc(TIER_JA[tier] || tier);
}

function renderLearningProfile(lp) {
  if (!lp || !lp.available) return '<div class="note">計算のクセ: このレース用のデータがありません</div>';
  var parts = (lp.systems || []).map(function (s) {
    if (s.pinned) return esc(s.label) + '[固定' + num(s.pin, 1) + ']';
    return esc(s.label) + s.bars;
  });
  var html = '<div class="learn-profile">📊 <b>このレースの計算のクセ</b>（' + plainCell(lp.cell) +
             '・作成日' + esc(lp.build_date) + '）<br>';
  html += '<span class="bars">　' + parts.join('　') + '</span><br>';
  html += '<span class="note">※ バーが多い＝その項目を大きく計算に使った、というだけの目安です。' +
          '数字の大小が「当たりやすさ」を保証するものではありません。</span></div>';
  return html;
}

/* くわしい数字(競馬に詳しい方向け)。
   以前は開発用の生値(較正温度T・bet_tier・overlap 等)を並べていたが、開こうとする
   読み手に価値が薄いので平文に入れ替えた(2026-07-27)。内部識別子は出さない。 */
function renderDetail(d, rawReason) {
  var se = d.seihai || {}, g = d.gap || {};
  var html = '<div class="note">';

  // 「強さ」「持ち時計」の上位2頭と、その重なり(旧 gap内訳)
  var eloTop = (g.elo_top2 || []).map(esc).join('・');
  html += '「強さ」上位2頭 = ' + (eloTop || '—');
  if (g.v27_missing) {
    html += '　／　「持ち時計」= 測れず（' + esc(soften(g.v27_reason || 'データ不足')) + '）<br>';
  } else {
    html += '　／　「持ち時計」上位2頭 = ' + ((g.v27_top2 || []).map(esc).join('・') || '—') +
            '　／　重なり ' + esc(g.overlap) + '頭<br>';
    html += '<span style="color:#555">2頭とも同じ＝評価が一致、0頭＝食い違い（食い違いは買いません）。</span><br>';
  }

  // 特別サインが点いた時だけ、その中身(加点の内訳)を出す
  if (se.fired) {
    html += '特別サインの加点: 調教 ' + signed(se.c_buff) + ' ／ 展開 ' + signed(se.p_buff) +
            ' ／ 枠 ' + signed(se.b_buff) +
            '　（実力の点数での順位: ' + esc(se.raw_elo_rank) + '番手）<br>';
  }

  // 判定ラベルを置き換えている事実は隠さない(1行だけ・平文)
  html += '<span style="color:#555">※判定の表示は買い目の有無に合わせています。</span>';
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
/* 2ブロック構成(指示書§7): 上=前向き実績(このサイトに載せた予想の結果)、
   下=過去データ(遡及バックテスト)。価値が高い順に並べ、合算はしない。
   前向きは当面 N が一桁なので、N基準の色分けが誤読を防ぐ命綱。 */
var RETRO_NOTE = '<p class="frozen-note">※ この表は<b>過去データ（遡及）での成績</b>です。' +
                 'このサイトに載せた予想の結果は、上の「前向き実績」に入っています。両者は合算しません。</p>';

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
/* 前向き実績(運用) — stats_forward.json。N と F5 を必ず併記し、N基準色を適用する。 */
function fwdCell(c) {
  if (!c || !c.n) return '<td class="num n-gray">—<br><span class="note">N=0</span></td>';
  var roi = (c.roi === null ? '—' : c.roi + '%');
  var f5 = (c.f5_roi === null || c.f5_roi === undefined ? '—' : c.f5_roi + '%');
  return '<td class="num ' + nColor(c.color) + '">' + (c.hit_rate === null ? '—' : c.hit_rate + '%') +
         ' / ' + roi + '<br><span class="note">まぐれ除き ' + f5 + '・N=' + c.n + '</span></td>';
}
function renderForward(fw) {
  if (!fw) {
    return '<p class="note">前向き実績はまだありません（結果の突合が未実行）。</p>';
  }
  var s = fw.series || {};
  var keys = ['seihai_fukusho', 'seihai_umaren', 'gap_fukusho'];
  var html = '';
  html += '<p class="note">' + esc(fw.period_from) + ' 以降に<b>このサイトに載せた予想</b>だけを、' +
          '公開した買い目のまま採点しています（あとから買い目を変えることはしません）。' +
          '結果が確定した分のみ集計。<b>結果待ち ' + esc(fw.pending) + ' 件</b>。</p>';
  html += '<div class="tablewrap"><table>';
  html += '<caption>前向き実績（当たった率 / 回収率・件数つき）</caption>';
  html += '<tr><th>買い方</th><th class="num">全件</th><th class="num">8〜15倍を除いた分</th></tr>';
  keys.forEach(function (k) {
    var v = s[k];
    if (!v) return;
    html += '<tr><th>' + esc(soften(v.label)) + '</th>' + fwdCell(v.all) + fwdCell(v.rule_8_15) + '</tr>';
  });
  html += '</table></div>';

  var allN = keys.reduce(function (a, k) { return a + ((s[k] && s[k].all && s[k].all.n) || 0); }, 0);
  if (allN < 10) {
    html += '<p class="frozen-note">⚠️ 件数がまだ ' + allN + ' 件です（10件未満＝<b>参考外</b>）。' +
            'この数字で良し悪しを判断できる段階ではありません。表のグレーは「参考外」を表しています。</p>';
  }
  var sr = fw.skipped_reference || {};
  if (sr.n) {
    // 見送りは理由で分けて出す。「危険サインを避けた」と「条件が出なかった」は
    // 追跡したいことが違うので混ぜない。
    var line = function (o, lab) {
      if (!o || !o.n) return '';
      return '<li>' + lab + ' ' + esc(o.n) + ' 件 — 本命が3着以内だったのは ' +
             esc(o.axis_top3) + ' 件（うち1着 ' + esc(o.axis_win) + ' 件）</li>';
    };
    html += '<p class="note">見送ったレース ' + esc(sr.n) + ' 件の事後確認（参考）:</p>';
    // 内訳(gap_disagree/no_signal)は新しい stats_forward.json にしか無い。
    // 古い版を配信している間は内訳が空になり見出しだけ残るので、合算値に落とす。
    var breakdown = line(sr.gap_disagree, '上位馬がバラバラで見送り') +
                    line(sr.no_signal, '買う条件が不足で見送り');
    html += '<ul class="note">' +
            (breakdown || line(sr, '見送り（理由の内訳なし）')) + '</ul>';
    html += '<p class="note"><b>これは買っていないので、上の回収率には入れていません。</b></p>';
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
  // 前向き(stats_forward.json)は未生成のこともあるので、無ければ null で続行する。
  Promise.all([
    loadJSON(DATA + 'stats.json'),
    loadJSON(DATA + 'stats_forward.json').catch(function () { return null; })
  ]).then(function (arr) {
    var st = arr[0], fw = arr[1];
    setUpdated(st.generated_at);
    var fk = st.seihai_fukusho || {};
    var um = st.hyojun_umaren || {};
    var html = '';
    // ── 上: 前向き実績(このサイトに載せた予想の結果) ──
    html += '<h2>前向き実績（このサイトに載せた予想の結果）</h2>';
    html += renderForward(fw);
    // ── 下: 過去データ(遡及バックテスト) ──
    html += '<h2>過去データでの成績（遡及）</h2>';
    html += RETRO_NOTE;
    html += '<h3>「特別サイン」の成績</h3>';
    html += '<p class="note">配当が分かった ' + esc(fk.coverage_matched) + ' 件で集計（サイン点灯は全 ' + esc(fk.fired_total) + ' 件）。</p>';
    html += renderSeriesTable(fk, '100円');
    html += '<h3>馬連3点（軸＋2〜4番人気の予想馬）</h3>';
    html += renderSeriesTable(um, '300円');
    html += '<h2>競馬場ごとの傾向</h2>';
    html += renderVenueMap();
    html += '<h2>大事な注意（必ず読んでください）</h2><div class="frozen-note"><ul>';
    (st.frozen_notes || []).forEach(function (n) { html += '<li>' + esc(soften(n)) + '</li>'; });
    html += '</ul>';
    html += '<details><summary>正式な注記（原文）</summary><ul>';
    (st.frozen_notes || []).forEach(function (n) { html += '<li>' + esc(n) + '</li>'; });
    ((fw && fw.notes) || []).forEach(function (n) { html += '<li>【前向き】' + esc(n) + '</li>'; });
    if (st.coverage_note) html += '<li>' + esc(st.coverage_note) + '</li>';
    html += '</ul></details></div>';
    el.innerHTML = html;
  }).catch(function (e) { el.innerHTML = '<p>読み込みエラー: ' + esc(e.message) + '</p>'; });
}

/* ---------- アーカイブ ---------- */
/* 一覧の「結果」列。買い目なし(hit=null)は着順だけ出し、的中/ハズレとは書かない。 */
function archiveResult(r) {
  if (r.result_status !== '確定') return '結果待ち';
  var rk = (r.result_axis_rank === null || r.result_axis_rank === undefined) ? null : r.result_axis_rank;
  var head = '◎' + (rk === null ? '—' : rk + '着');
  if (r.result_bet_hit === true) return head + ' 的中 ' + Math.round(r.result_payout) + '円';
  if (r.result_bet_hit === false) return head + ' ハズレ';
  return head + '（参考）';
}
function initArchive() {
  var el = document.getElementById('archive');
  loadJSON(DATA + 'index.json').then(function (idx) {
    setUpdated(idx.generated_at);
    var html = '<div class="tablewrap"><table>';
    html += '<tr><th>レース日</th><th>競馬場</th><th class="c">R</th><th>コース・クラス</th>' +
            '<th>判定</th><th>サイン</th><th>強さ×時計</th><th>結果</th><th></th></tr>';
    (idx.races || []).forEach(function (r, i) {
      // 一覧の判定も「行動」基準に揃える(index.json に bet_tier / gap_state がある)
      var av = actionVerdict(r.verdict, r.bet_tier, r.gap_state);
      html += '<tr>';
      html += '<td>' + esc(r.race_date || r.date) + '</td>';
      html += '<td>' + esc(r.venue_name || CODE_TO_NAME[(r.venue || '').charAt(0)] || r.venue) + '</td>';
      html += '<td class="c">' + (r.race_no ? esc(r.race_no) + 'R' : '—') + '</td>';
      html += '<td>' + esc(r.surface) + dist(r.distance) + ' ' + esc(r.race_class) + '</td>';
      html += '<td class="verdict-cell ' + av.cls + '">' + esc(av.label) +
              (av.kind === 'disagree' ? '<br><span class="note">バラバラ</span>'
             : av.kind === 'nosignal' ? '<br><span class="note">条件不足</span>' : '') + '</td>';
      html += '<td class="c">' + (r.seihai_fired ? '🌈' : '') + '</td>';
      html += '<td>' + esc(plainState(r.gap_state)) + '</td>';
      html += '<td class="c">' + esc(archiveResult(r)) + '</td>';
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
