(function(){var r=document.documentElement;function f(){r.style.setProperty('--s',(innerWidth/1162).toFixed(5))}f();addEventListener('resize',f)})();(function(){var r=document.documentElement,V=/^(light|dark|dim)$/;
function th(v){if(!V.test(v))return;document.querySelectorAll('.app,.phone,.pvl').forEach(function(a){a.dataset.th=v});window.__cur=v}
var st;try{st=localStorage.getItem('orbyn-th')}catch(e){}
th(st||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.type==='orbyn-theme')th(d.value)});
window.__th=th;})();(function(){
var html=document.documentElement,root=document.getElementById('root'),cur=document.getElementById('cur'),
    rip=document.getElementById('rip'),capEl=document.getElementById('wcap'),seq=document.getElementById('seq'),
    stage=document.getElementById('frames');
var CFG=JSON.parse(document.getElementById('cfg').textContent);
var frs=[].slice.call(stage.querySelectorAll('.wk-fr'));
var orig=frs.map(function(f){return f.innerHTML});
var vis=false,rm=false,waiters=[],tok=0,curF=0,loops=0,CANCEL={};
function S(){return parseFloat(getComputedStyle(html).getPropertyValue('--s'))||1}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function ok(){return vis&&!document.hidden&&!rm}
function gate(){return ok()?Promise.resolve():new Promise(function(r){waiters.push(r)})}
function wake(){if(ok()){var w=waiters;waiters=[];w.forEach(function(r){r()})}}
function T(ms){var t=tok;return sleep(ms).then(gate).then(function(){if(t!==tok)throw CANCEL})}
function norm(t){return t.replace(/\s+/g,' ').trim()}
function q(spec,f,scope){
  scope=scope||frs[f===undefined?curF:f].firstChild;
  var up=null,i=spec.indexOf(' ^');if(i>0){up=spec.slice(i+2);spec=spec.slice(0,i)}
  var out;
  if(spec.indexOf('css=')===0)out=[].slice.call(scope.querySelectorAll(spec.slice(4)));
  else{var ex=spec.indexOf('text==')===0,t=norm(spec.slice(ex?6:5));
    var m=[].slice.call(scope.querySelectorAll('*')).filter(function(e){var x=norm(e.textContent);return ex?x===t:x.indexOf(t)>-1});
    out=m.filter(function(e){return !m.some(function(o){return o!==e&&e.contains(o)})})}
  if(up)out=out.map(function(e){return e.closest(up)}).filter(Boolean);
  return out;
}
function pos(el,ax,ay){var r=el.getBoundingClientRect(),b=root.getBoundingClientRect(),s=S();
  return{x:(r.left+r.width*ax-b.left)/s,y:(r.top+r.height*ay-b.top)/s}}
function move(p){cur.style.transform='translate('+p.x.toFixed(1)+'px,'+p.y.toFixed(1)+'px)';cur.dataset.x=p.x;cur.dataset.y=p.y}
function place(el,p){el.style.transform='translate('+p.x.toFixed(1)+'px,'+p.y.toFixed(1)+'px)'}
function showFrame(i){frs.forEach(function(f,k){f.classList.toggle('on',k===i)});curF=i}
function hide(spec,f){q(spec,f).forEach(function(e){e.classList.add('wk-h');void e.offsetWidth;e.classList.add('wk-t')})}
function reveal(spec,f){q(spec,f).forEach(function(e){e.classList.remove('wk-h')})}
function setCap(n,text){
  capEl.classList.add('o');
  setTimeout(function(){capEl.querySelector('.n').textContent=n;capEl.querySelector('.t').textContent=text;
    var d=capEl.querySelectorAll('.d i');for(var k=0;k<d.length;k++)d[k].classList.toggle('on',k===n-1);capEl.classList.remove('o')},150);
}
var OPS={
  go:function(o){var el=q(o.t,o.f)[o.n||0];if(el)move(pos(el,o.ax==null?.6:o.ax,o.ay==null?.5:o.ay));return T(o.ms||320)},
  click:function(o){var x=cur.dataset.x,y=cur.dataset.y;place(rip,{x:+x,y:+y});
    cur.classList.add('press');rip.firstChild.classList.remove('go');void rip.offsetWidth;rip.firstChild.classList.add('go');
    return T(120).then(function(){cur.classList.remove('press')})},
  show:function(o){showFrame(o.f);return T(o.ms||220)},
  wait:function(o){return T(o.ms)},
  hide:function(o){hide(o.t,o.f);return T(o.ms||0)},
  reveal:function(o){reveal(o.t,o.f);return T(o.ms||160)},
  hl:function(o){q(o.t,o.f).forEach(function(e){e.classList.add('wk-hl')});return T(o.ms||240)},
  unhl:function(o){[].forEach.call(root.querySelectorAll('.wk-hl'),function(e){e.classList.remove('wk-hl')});return Promise.resolve()},
  clone:function(o){var s=q(o.from)[0],d=q(o.into)[0];if(s&&d){var c=s.cloneNode(true);c.classList.add('wk-in');d.replaceWith(c)}return T(o.ms||200)},
  type:function(o){
    var jobs=o.jobs,cps=o.cps||20;
    return Promise.all(jobs.map(function(j){var el=q(j.t)[0];if(!el)return 0;var n=0,t0=tok;
      return T(j.delay||0).then(function(){return new Promise(function(res,rej){
        el.textContent='';var iv=setInterval(function(){if(t0!==tok){clearInterval(iv);rej(CANCEL);return}
          if(!ok())return;n++;el.textContent=j.text.slice(0,n);if(n>=j.text.length){clearInterval(iv);res()}},1000/cps)})})}))
      .then(function(){return T(80)});
  },
  rest:function(o){move({x:CFG.rest[0],y:CFG.rest[1]});return T(o.ms||320)}
};
function applyInit(){CFG.init.forEach(function(o){if(o.op==='hide')hide(o.t,o.f);else if(o.op==='clear'){q(o.t,o.f).forEach(function(e){e.textContent=''})}})}
function retheme(){if(window.__th)window.__th(window.__cur||'light')}
function restoreAll(){frs.forEach(function(f,k){f.innerHTML=orig[k]});retheme();[].forEach.call(root.querySelectorAll('.wk-hl'),function(e){e.classList.remove('wk-hl')})}
async function reset(){
  OPS.unhl({});
  move({x:CFG.rest[0],y:CFG.rest[1]});
  if(curF!==0){showFrame(0);await T(320)}
  else if(CFG.undo){CFG.undo.forEach(function(s){hide(s,0)});await T(260)}
  restoreAll();applyInit();
}
async function loop(){
  var t=tok;
  try{
    for(;;){
      for(var i=0;i<CFG.steps.length;i++){
        var st=CFG.steps[i];html.dataset.step=i+1;await gate();setCap(i+1,st.cap);
        for(var k=0;k<st.ops.length;k++){await gate();await OPS[st.ops[k].op](st.ops[k])}
        await T(st.hold==null?500:st.hold);
      }
      await T(CFG.end||1300);
      await reset();loops++;html.dataset.loops=loops;
      await T(300);
    }
  }catch(e){if(e!==CANCEL)throw e}
}
function post(v){try{parent.postMessage({type:'orbyn-height',value:v},'*')}catch(e){}}
function buildSeq(){
  var W=CFG.w,H=CFG.h;
  seq.innerHTML=CFG.seq.map(function(s,i){
    return '<figure class="wk-s"><div class="wk-sw">'+orig[s.f]+'</div><figcaption><b>'+(i+1)+'</b>'+s.cap+'</figcaption></figure>'}).join('');seq.querySelectorAll('.wk-sw').forEach(function(e){e.style.width=W+'px';e.style.height=H+'px'});
  CFG.seq.forEach(function(s,i){(s.h||[]).forEach(function(sp){var sc=seq.children[i].firstChild;q(sp,0,sc).forEach(function(e){e.classList.add('wk-h')})})});
  retheme();
}
function reportH(){if(!rm)return;var b=root.getBoundingClientRect();post(Math.ceil(b.bottom+(window.scrollY||0))+8)}
function setRM(v){
  if(rm===v&&html.dataset.rmset)return;html.dataset.rmset='1';rm=v;tok++;
  html.classList.toggle('rm',v);
  if(v){restoreAll();buildSeq();html.dataset.wk='reduced';setTimeout(reportH,30);setTimeout(reportH,400)}
  else{seq.innerHTML='';post(0);restoreAll();applyInit();showFrame(0);move({x:CFG.rest[0],y:CFG.rest[1]});html.dataset.wk=vis?'playing':'paused';loop();wake()}
}
var mq=matchMedia('(prefers-reduced-motion: reduce)');
addEventListener('resize',function(){setTimeout(reportH,60)});
addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.type==='orbyn-motion')setRM(!!d.reduce)});
if(mq.addEventListener)mq.addEventListener('change',function(e){setRM(e.matches)});
new IntersectionObserver(function(es){vis=es[es.length-1].isIntersecting;if(!rm)html.dataset.wk=vis?'playing':'paused';if(vis)wake()},{threshold:.12}).observe(root);
document.addEventListener('visibilitychange',wake);
setRM(mq.matches||/[?&]rm=1/.test(location.search));
window.__wk={get:function(){return{step:html.dataset.step,loops:loops,state:html.dataset.wk,frame:curF,rm:rm}},setRM:setRM};
})();
