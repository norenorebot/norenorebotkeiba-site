/* Mobile latest-race navigator. Reuses existing cards and their original data.
   No forecast, archive or statistics changes. See docs/race-picker-handover.md.
   2026-09-27: desktop (641px+) uses the same picker as a two-column view:
   left = day summary + race grid (sticky), right = the selected race card.
   Without a #race-N hash the first race with bets (else the first race) is shown. */
(function () {
  'use strict';
  window.initRacePicker = function (el, data) {
    var mobile = window.matchMedia('(max-width: 640px)');
    var cards = Array.prototype.slice.call(el.querySelectorAll('.verdict-block'));
    if (cards.length !== data.length || !cards.length) return;
    var overview = document.createElement('div');
    overview.className = 'race-overview';
    var summary = el.querySelector('.day-summary');
    el.insertBefore(overview, el.firstChild);
    if (summary) overview.appendChild(summary);
    var picker = document.createElement('div');
    picker.className = 'race-picker';
    overview.appendChild(picker);
    var venues = [], entries = [], scrollY = 0, origin = null, selected = -1, btnOf = {};
    data.forEach(function (d, i) {
      // Formal name already rendered by the existing site. Metadata is authoritative.
      var r = d.race || {}, venue = r.venue_name || (d.header || {}).venue || '場名不明';
      if (venues.indexOf(venue) < 0) venues.push(venue);
      entries.push({venue:venue, no:Number(r.no), i:i});
    });
    // East/West/third venue stays side by side; never interpret this as start-time order.
    var order = ['中山','東京','阪神','京都','中京','札幌','函館','福島','新潟','小倉'];
    venues.sort(function (a,b) {
      var x=order.indexOf(a), y=order.indexOf(b);
      return (x<0?99:x)-(y<0?99:y) || a.localeCompare(b);
    });
    function button(label, action) {
      var b=document.createElement('button'); b.type='button'; b.textContent=label;
      b.addEventListener('click',action); return b;
    }
    function choose(i, trigger) {
      if (selected < 0) {scrollY=window.scrollY; origin=trigger;}
      history.pushState(null,'','#race-'+i);
      sync(true);
    }
    function back() {
      history.pushState(null,'',location.pathname+location.search);
      sync(true);
    }
    var h=document.createElement('h2'); h.textContent='レースを選ぶ';picker.appendChild(h);
    var note=document.createElement('p');note.className='note';
    note.textContent='押すと予想を表示。薄クリームは買い目あり。「未掲載」は予想のない枠です。発走時刻順ではありません。';picker.appendChild(note);
    var table=document.createElement('table');table.className='race-grid';
    table.setAttribute('aria-label','開催場とR番号でレースを選ぶ');
    var head=table.createTHead().insertRow();
    ['R'].concat(venues).forEach(function(v){var th=document.createElement('th');th.scope='col';th.textContent=v;head.appendChild(th);});
    var body=table.createTBody();
    for(var n=1;n<=12;n++) {
      var row=body.insertRow(), th=document.createElement('th');th.scope='row';th.textContent=n+'R';row.appendChild(th);
      venues.forEach(function(v){
        var td=row.insertCell();
        var matches=entries.filter(function(e){return e.venue===v && e.no===n;});
        if(!matches.length){td.textContent='未掲載';td.className='race-absent';return;}
        matches.forEach(function(e){
          var buy=!cards[e.i].classList.contains('vb-skip');
          var b=button(buy?'買い目あり':'見送り',function(){choose(e.i,b);});
          b.className=buy?'race-buy':''; btnOf[e.i]=b;
          b.setAttribute('aria-label',v+' '+e.no+'R '+b.textContent);
          td.appendChild(b);
        });
      });
    }
    picker.appendChild(table);
    // Legacy races without a valid R remain accessible; do not invent numbers.
    entries.filter(function(e){return !Number.isInteger(e.no)||e.no<1||e.no>12;}).forEach(function(e){
      var b=button(e.venue+' R番号未登録の予想 '+(e.i+1),function(){choose(e.i,b);});picker.appendChild(b);
    });
    cards.forEach(function(card,i){
      var top=button('← レース一覧に戻る',back);top.className='race-return';card.insertBefore(top,card.firstChild);
      var nav=document.createElement('div');nav.className='race-other';
      entries.filter(function(e){return e.i!==i&&e.no===entries[i].no&&e.venue!==entries[i].venue;}).forEach(function(e){
        nav.appendChild(button(e.venue+' '+e.no+'Rを見る',function(){choose(e.i,null);}));
      });card.appendChild(nav);
      var bottom=button('← レース一覧に戻る',back);bottom.className='race-return';card.appendChild(bottom);
    });
    function defaultRace() {
      for(var i=0;i<cards.length;i++) if(!cards[i].classList.contains('vb-skip')) return i;
      return 0;
    }
    function sync(move) {
      var m=location.hash.match(/^#race-(\d+)$/), next=m?Number(m[1]):-1;
      if(next>=cards.length)next=-1;
      if(!mobile.matches&&next<0) next=defaultRace();      // desktop always shows one race on the right
      var previous=selected;selected=next;
      el.classList.toggle('race-desk',!mobile.matches);
      el.classList.toggle('race-detail-mode',mobile.matches&&selected>=0);
      cards.forEach(function(c,i){c.classList.toggle('race-selected',i===selected);});
      Object.keys(btnOf).forEach(function(k){btnOf[k].classList.toggle('race-cur',Number(k)===selected);});
      if(!mobile.matches){
        // desktop: keep the grid where it is; bring the card top into view if it is above the viewport
        if(move&&previous!==selected&&cards[selected]){var top=cards[selected].getBoundingClientRect().top; if(top<0) window.scrollBy(0,top-8);}
        return;
      }
      if(!move)return;
      if(selected>=0){
        cards[selected].scrollIntoView({block:'start'});
        cards[selected].querySelector('.race-return').focus({preventScroll:true});
      } else if(previous>=0){
        window.scrollTo(0,scrollY);
        if(origin)origin.focus({preventScroll:true});
      }
    }
    el.addEventListener('click',function(ev){
      var a=ev.target.closest('a[href^="#race-"]');
      if(!a||ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;
      var m=a.getAttribute('href').match(/^#race-(\d+)$/);
      if(m&&Number(m[1])<cards.length){ev.preventDefault();choose(Number(m[1]),a);}
    });
    el.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&mobile.matches&&selected>=0)back();});
    window.addEventListener('popstate',function(){sync(true);});
    window.addEventListener('hashchange',function(){sync(true);});
    mobile.addEventListener('change',function(){sync(false);});
    el.classList.add('race-picker-ready');
    sync(true);
  };
})();
