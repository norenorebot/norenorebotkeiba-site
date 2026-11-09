/* 訪問者カウンター（平成の無料カウンター風・合計／今日／昨日）。2026-11-10〜
   数字は GoatCounter の公開カウンター（TOTAL.json）から読むだけ。外部のスクリプト・画像は使わない。
   GoatCounter の日付は世界標準時なので、今日・昨日は日本時間の朝9時に切り替わる。数字は向こうで最大4時間ため置き
   （同じ時間帯の訪問者は同じ合計を見るので、キリ番の表示はしない）。 */
(function () {
  var el = document.getElementById('kiriban');
  if (!el || !window.fetch) return;
  var BASE = 'https://norenorebot.goatcounter.com/counter/TOTAL.json';
  function ymd(d) { return d.toISOString().slice(0, 10); }   // 世界標準時の日付
  var now = new Date(), yst = new Date(now.getTime() - 86400000);
  function get(q) {
    return fetch(BASE + q, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { return parseInt(String(j.count).replace(/[^\d]/g, ''), 10) || 0; });
  }
  function led(n, w) {
    var s = String(n); while (s.length < w) s = '0' + s;
    return '<span class="led">' + s + '</span>';
  }
  Promise.all([get(''), get('?start=' + ymd(now) + '&end=' + ymd(now)), get('?start=' + ymd(yst) + '&end=' + ymd(yst))])
    .then(function (v) {
      el.innerHTML =
        '<div class="kb-row">合計 ' + led(v[0], 6) + '</div>' +
        '<div class="kb-row">今日 ' + led(v[1], 3) + '　昨日 ' + led(v[2], 3) + '</div>';
      el.hidden = false;
    })
    .catch(function () { /* 読めない時は何も出さない */ });
})();
