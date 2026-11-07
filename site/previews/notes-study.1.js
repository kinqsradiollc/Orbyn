(function(){var r=document.documentElement;function f(){r.style.setProperty('--s',(innerWidth/572).toFixed(5))}f();addEventListener('resize',f)})();(function(){var r=document.documentElement,V=/^(light|dark|dim)$/;
function th(v){if(!V.test(v))return;document.querySelectorAll('.app,.phone,.pvl').forEach(function(a){a.dataset.th=v});window.__cur=v}
var st;try{st=localStorage.getItem('orbyn-th')}catch(e){}
th(st||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.type==='orbyn-theme')th(d.value)});
window.__th=th;})();
