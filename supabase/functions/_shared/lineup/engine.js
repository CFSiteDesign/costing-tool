// lineup-engine.js: reference layout engine for the Mad Monkey WEEKLY LINEUP poster.
// Pure JS, no dependencies. lineupView(week, "post"|"story", colourwayKey) returns every size, position and colour the renderer needs.
// ANTON / MONT are advance widths in em (Anton 400, Montserrat 900) taken from the Google Fonts files, used to fit names without a browser.
// ASSETS holds the Claude Design canvas upload paths: swap them for your own logo and ALL IN sticker URLs.

// ===== Mad Monkey WEEKLY LINEUP engine: week data -> poster layout =====
var ANTON={" ":0.234,"A":0.485,"B":0.479,"C":0.474,"D":0.493,"E":0.412,"F":0.399,"G":0.485,"H":0.499,"I":0.227,"J":0.466,"K":0.472,"L":0.397,"M":0.746,"N":0.498,"O":0.486,"P":0.472,"Q":0.494,"R":0.477,"S":0.461,"T":0.396,"U":0.474,"V":0.469,"W":0.712,"X":0.484,"Y":0.446,"Z":0.41,"0":0.494,"1":0.331,"2":0.494,"3":0.494,"4":0.494,"5":0.494,"6":0.494,"7":0.494,"8":0.494,"9":0.494,"'":0.214,"’":0.232,"-":0.311,"–":0.311,"&":0.52,"+":0.355,":":0.242,".":0.229,",":0.236,"!":0.229,"?":0.492,"/":0.405,"(":0.291,")":0.291,"\"":0.429,"#":0.546,"%":1.057,"@":0.864,"$":0.462,"€":0.525,"£":0.474,"¥":0.463,"₱":0.509,"₫":0.509,"₭":0.509,"₹":0.509,"*":0.452};
var MONT={" ":0.3,"A":0.806,"B":0.773,"C":0.737,"D":0.826,"E":0.673,"F":0.644,"G":0.769,"H":0.804,"I":0.35,"J":0.574,"K":0.765,"L":0.617,"M":0.954,"N":0.804,"O":0.848,"P":0.743,"Q":0.848,"R":0.745,"S":0.657,"T":0.654,"U":0.784,"V":0.786,"W":1.206,"X":0.762,"Y":0.71,"Z":0.687,"0":0.692,"1":0.418,"2":0.608,"3":0.614,"4":0.712,"5":0.619,"6":0.661,"7":0.645,"8":0.678,"9":0.661,"'":0.254,"’":0.304,"-":0.39,"–":0.5,"&":0.777,"+":0.62,":":0.304,".":0.304,",":0.304,"!":0.314,"?":0.606,"/":0.44,"(":0.381,")":0.381,"\"":0.489,"#":0.74,"%":0.917,"@":1.037,"$":0.657,"€":0.828,"£":0.694,"¥":0.77,"₱":0.896,"₫":0.705,"₭":0.828,"₹":0.728,"*":0.473};
var BLACK='#0a0a0a', BONE='#f5efe2', PAPER='#ffffff';
var ASSETS={logoBlack:"black",logoWhite:"white",allIn:"allin"}; // logoSrc says which wordmark; the renderer supplies the real images
// Colour tokens. background = poster ground, rowFill = day rows, display = outlined type on the ground,
// accent = outlined type + devices on the rows, outline = outline/shadow/ink, stickerText = text in black label stickers.
var COLOURWAYS={
  'orange-yellow':{background:'#ff6600',rowFill:'#ffc000',display:'#ffc000',accent:'#ff6600',outline:BLACK,stickerText:PAPER,logo:'black'},
  'blue-lime':{background:'#0081f7',rowFill:'#ccff01',display:'#ccff01',accent:'#0081f7',outline:BLACK,stickerText:PAPER,logo:'black'},
  'pink-cyan':{background:'#ff01aa',rowFill:'#00fef3',display:'#00fef3',accent:'#ff01aa',outline:BLACK,stickerText:PAPER,logo:'black'},
  'purple-yellow':{background:'#ab00ff',rowFill:'#ffc000',display:'#ffc000',accent:'#ab00ff',outline:BLACK,stickerText:PAPER,logo:'white'},
  'retro':{background:BONE,rowFill:BONE,display:BONE,accent:BONE,outline:BLACK,stickerText:BONE,logo:'black'}
};
var FORMATS={post:{W:1080,H:1350,top:34,bottom:26},story:{W:1080,H:1920,top:250,bottom:300}};
var G={side:40,headH:226,headHTight:196,gapHB:18,gapBR:16,gapRF:16,footH:70,rowGap:10,padY:10,border:3,dayW:188,dayGap:18,padX:20,emptyH:44,minRowH:76,colGap:24};
var ROW_FS=[0,54,44,38,34,31,29], BAND_FS=[0,40,36,33,31,29,28,27,26], FLOORS=[[26,24,18],[22,20,16],[18,16,14]]; // [row name, band name, time/price] minimum px per tier
var KEY_MULT=1.28, NAME_LH=0.95, TRACK=-0.02, KEY_TRACK=0.02;

function tw(str,table,track){var w=0;for(var i=0;i<str.length;i++){var c=table[str[i]];w+=(c==null?0.5:c)+track;}return w;}
function antonW(s,fs,track){return tw(s,ANTON,track==null?TRACK:track)*fs*1.02;}
function montW(s,fs){return tw(s,MONT,0.01)*fs*1.02;}
function clean(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
function wrapWords(text,maxW,fs,track){
  var words=text.split(' '),lines=[],cur='';
  for(var i=0;i<words.length;i++){
    if(antonW(words[i],fs,track)>maxW) return null;
    var t=cur?cur+' '+words[i]:words[i];
    if(antonW(t,fs,track)<=maxW) cur=t; else {lines.push(cur);cur=words[i];}
  }
  if(cur) lines.push(cur);
  return lines;
}
// Names: 1 line (shrink up to 12%), else 2 balanced lines (shrink up to 22%). Never breaks inside a word.
function fitName(text,room,f,track){
  var fs;
  for(fs=f;fs>=Math.floor(f*0.88);fs--) if(antonW(text,fs,track)<=room) return {fs:fs,lines:[text]};
  var words=text.split(' ');
  for(fs=f;fs>=Math.floor(f*0.78);fs--){
    var best=null;
    for(var i=1;i<words.length;i++){
      var a=words.slice(0,i).join(' '),b=words.slice(i).join(' ');
      var m=Math.max(antonW(a,fs,track),antonW(b,fs,track));
      if(m<=room&&(!best||m<best.m)) best={m:m,lines:[a,b]};
    }
    if(best) return {fs:fs,lines:best.lines};
  }
  fs=Math.floor(f*0.78);
  return {fs:fs,lines:wrapWords(text,room,fs,track)||[text]};
}
function fmtPrice(p,cur){
  if(p==null||p==='') return '';
  var n=Number(p); if(isNaN(n)) return clean(p).toUpperCase();
  if(n===0) return 'FREE';
  if(n%1) return (cur||'')+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); // cents stay "12.50", not "12.5"
  return (cur||'')+n.toLocaleString('en-US');
}
function timeKey(t){
  if(!t) return 9999;
  var m=/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/i.exec(t);
  if(!m) return 9998;
  var h=(+m[1])%12; if(/pm/i.test(m[3])) h+=12; return h*60+(+(m[2]||0));
}
function normItems(list,cur){
  return (list||[]).map(function(it,i){
    var time=clean(it.time).toUpperCase().replace(/\s+/g,'');
    return {name:clean(it.name).toUpperCase(),time:time,price:fmtPrice(it.price,cur),sig:!!it.signature,key:!!it.key,t:timeKey(time),i:i};
  }).filter(function(it){return it.name;}).sort(function(a,b){
    if(a.key!==b.key) return a.key?-1:1; return (a.t-b.t)||(a.i-b.i);
  });
}
function measureItem(it,f,colW,metaMin){
  var tf=Math.max(metaMin,Math.round(f*0.5)), pf=tf;
  var timeW=it.time?Math.ceil(montW(it.time,tf)):0;
  var padX=Math.round(pf*0.6), padV=Math.max(2,Math.round(pf*0.15));
  var pillW=it.price?Math.ceil(montW(it.price,pf)+padX*2+6):0, pillH=it.price?Math.round(pf+padV*2+6):0;
  var metaGap=Math.round(tf*0.55);
  var metaW=timeW+(timeW&&pillW?metaGap:0)+(pillW?pillW+3:0);
  var burst=it.sig?Math.round(f*0.74):0, burstGap=it.sig?Math.round(f*0.2):0;
  var room=colW-burst-burstGap-(metaW?metaW+Math.round(f*0.45):0);
  var fit=fitName(it.name,room,f,it.key?KEY_TRACK:TRACK);
  var nameH=Math.round(fit.lines.length*fit.fs*NAME_LH);
  return {it:it,fs:fit.fs,lines:fit.lines,tf:tf,pf:pf,padX:padX,pillH:pillH,metaGap:metaGap,metaW:metaW,burst:burst,burstGap:burstGap,h:Math.max(nameH,pillH)};
}
function layoutItems(items,base,itemsW,allowKey,maxCols,metaMin){
  var n=items.length;
  var key=allowKey&&n>1&&items[0].key?items[0]:null;
  var rest=key?items.slice(1):items;
  var cols=maxCols>1&&n>=4?2:1;
  var colW=cols===2?Math.floor((itemsW-G.colGap)/2):itemsW;
  var gap=Math.max(4,Math.round(base*0.2));
  var blocks=[], h=0;
  if(key){var k=measureItem(key,Math.round(base*KEY_MULT),itemsW,metaMin);blocks.push({mt:0,cols:[{w:itemsW,gap:gap,items:[k]}]});h+=k.h;}
  if(rest.length){
    var per=Math.ceil(rest.length/cols), colList=[], colH=0;
    for(var c=0;c<cols;c++){
      var ms=rest.slice(c*per,(c+1)*per).map(function(it){return measureItem(it,base,colW,metaMin);});
      if(!ms.length) continue;
      var ch=ms.reduce(function(a,m){return a+m.h;},0)+gap*(ms.length-1);
      colH=Math.max(colH,ch); colList.push({w:colW,gap:gap,items:ms});
    }
    var mt=key?Math.round(gap*1.3):0;
    blocks.push({mt:mt,cols:colList}); h+=mt+colH;
  }
  return {h:h,blocks:blocks,cols:cols};
}
function layoutHeader(week,cw,headH){
  var name=clean(week.hostel).toUpperCase()||'HOSTEL', dates=clean(week.dates).toUpperCase();
  var nameEm=antonW(name,1), subEm=Math.max(antonW('WHAT’S ON',1),antonW('THIS WEEK',1));
  var subF=Math.min(80,Math.floor((headH-40)/2.4)), subW=Math.ceil(subEm*subF);
  var nameF=Math.min(Math.floor((headH-8)/0.92),Math.floor((cw-subW-28)/nameEm));
  var side=nameF>=150;
  if(!side){subF=Math.round(headH*0.24);nameF=Math.min(Math.floor((headH-subF*0.92-12)/0.92),Math.floor(cw/nameEm));}
  var spare=side?cw-Math.ceil(nameEm*nameF)-28-subW-24:0;
  var burst=spare>=170?Math.min(spare,headH-10,230):0;
  return {side:side,name:name,dates:dates,nameF:nameF,subF:subF,burst:burst,burstFs:Math.round(burst*0.17),dateFs:side?Math.round(subF*0.4):Math.round(subF*0.5)};
}
function layoutLineup(week,format,colourway){
  var F=FORMATS[format]||FORMATS.post, C=COLOURWAYS[colourway]||COLOURWAYS['orange-yellow'];
  var cw=F.W-G.side*2, cur=week.currency||'', contentH=F.H-F.top-F.bottom;
  var itemsW=cw-G.border*2-G.padX*2-G.dayW-G.dayGap;
  var band=normItems(week.everyDay,cur);
  var days=(week.days||[]).slice(0,7).map(function(d){return {day:clean(d.day).toUpperCase().slice(0,3),date:clean(d.date),items:normItems(d.items,cur)};});
  var floor=FLOORS[0];
  function rowNat(d,s){
    if(!d.items.length) return {h:G.emptyH,L:null};
    var L=layoutItems(d.items,Math.max(floor[0],Math.round(ROW_FS[Math.min(d.items.length,6)]*s)),itemsW,true,1,floor[2]);
    return {h:Math.max(G.minRowH,L.h+G.padY*2+G.border*2+4),L:L};
  }
  function bandNat(s){
    if(!band.length) return {h:0,L:null};
    var L=layoutItems(band,Math.max(floor[1],Math.round(BAND_FS[Math.min(band.length,8)]*Math.min(s,1.1))),itemsW,false,2,floor[2]);
    var one=band.length===1&&L.blocks[0].cols[0].items[0].lines.length===1;
    return {h:Math.max(one?64:G.minRowH+8,L.h+G.padY*2+12),L:L,one:one};
  }
  function total(s,headH){
    var b=bandNat(s), rows=days.map(function(d){return rowNat(d,s);});
    var sum=rows.reduce(function(a,r){return a+r.h;},0)+G.rowGap*Math.max(0,days.length-1);
    var avail=contentH-headH-G.gapHB-(b.h?b.h+G.gapBR:0)-G.gapRF-G.footH;
    return {fits:sum<=avail,sum:sum,avail:avail,band:b,rows:rows};
  }
  function solve(headH){
    if(total(1.2,headH).fits) return 1.2;
    var lo=0.5,hi=1.2; for(var i=0;i<18;i++){var mid=(lo+hi)/2; if(total(mid,headH).fits) lo=mid; else hi=mid;} return lo;
  }
  var headH=G.headH, s=solve(headH), tier=0;
  if(s<0.75){headH=G.headHTight;s=solve(headH);}
  while(!total(s,headH).fits&&tier<FLOORS.length-1){tier++;floor=FLOORS[tier];s=solve(headH);}
  var T=total(s,headH), k=T.sum>0?Math.max(1,T.avail/T.sum):1;
  var bandOut=null;
  if(T.band.h){
    var lf=T.band.one?Math.min(46,Math.floor(G.dayW/antonW('EVERY DAY',1))):Math.min(58,Math.floor(G.dayW/antonW('EVERY',1)),Math.round((T.band.h-G.padY*2-8)/2/0.92));
    bandOut={h:T.band.h,L:T.band.L,one:T.band.one,labelFs:lf};
  }
  var rows=days.map(function(d,i){
    var r=T.rows[i], h=Math.floor(r.h*k), empty=!d.items.length;
    var dayFs=empty?Math.min(34,Math.round(h*0.62)):Math.min(78,Math.round((h-G.border*2-16)*0.86));
    return {h:h,empty:empty,day:d.day,date:d.date,dayFs:dayFs,stickerFs:Math.max(15,Math.round(dayFs*(empty?0.5:0.3))),L:r.L};
  });
  return {F:F,C:C,s:s,tier:tier,overfull:!T.fits,itemsW:itemsW,header:layoutHeader(week,cw,headH),headH:headH,band:bandOut,rows:rows};
}
// ----- flatten the layout into values the template binds -----
function itemView(m,ctx){
  var it=m.it;
  return {text:m.lines.join('\n'),fs:m.fs,key:it.key&&ctx.keyable,plain:!(it.key&&ctx.keyable),nameColor:ctx.name,accent:ctx.accent,ol:ctx.ol,
    sig:it.sig,burst:m.burst,burstGap:m.burstGap,burstFill:ctx.accent,burstLine:ctx.ol,minH:m.h,
    hasTime:!!it.time,time:it.time,tf:m.tf,timeColor:ctx.name,
    hasPrice:!!it.price,price:it.price,pf:m.pf,pillH:m.pillH,pillLH:m.pillH-6,padX:m.padX,pillFill:ctx.accent,pillText:ctx.ol,pillShadow:ctx.pillShadow,
    hasMeta:!!(it.time||it.price),metaGap:m.metaGap,metaML:Math.round(m.fs*0.3)};
}
function blocksView(L,ctx){
  return L.blocks.map(function(b){return {mt:b.mt,cols:b.cols.map(function(c){return {w:c.w,gap:c.gap,items:c.items.map(function(m){return itemView(m,ctx);})};})};});
}
function lineupView(week,format,colourway){
  var L=layoutLineup(week||{},format,colourway), C=L.C, F=L.F, hd=L.header;
  var rowCtx={name:C.outline,accent:C.accent,ol:C.outline,pillShadow:C.outline,keyable:true};
  var bandCtx={name:C.display,accent:C.accent,ol:C.outline,pillShadow:C.display,keyable:false};
  var list=[];
  if(L.band) list.push({mt:0,h:L.band.h,isBand:true,isDay:false,isEmpty:false,hasItems:true,fill:C.outline,line:C.outline,shadow:'6px 6px 0 '+C.display,
    label:L.band.one?'EVERY DAY':'EVERY\nDAY',labelFs:L.band.labelFs,labelColor:C.display,itemsW:L.itemsW,blocks:blocksView(L.band.L,bandCtx)});
  L.rows.forEach(function(r,i){
    var mt=list.length?(i===0?G.gapBR:G.rowGap):0;
    list.push({mt:mt,h:r.h,isBand:false,isDay:!r.empty,isEmpty:r.empty,hasItems:!r.empty,
      fill:r.empty?'transparent':C.rowFill,line:C.outline,shadow:r.empty?'none':'6px 6px 0 '+C.outline,
      day:r.day,date:r.date,dayFs:r.dayFs,stickerFs:r.stickerFs,dayFill:C.accent,ol:C.outline,stickerText:C.stickerText,
      itemsW:L.itemsW,blocks:r.L?blocksView(r.L,rowCtx):[]});
  });
  var sp=hd.dates.indexOf(' ');
  var story=F.H>1500;
  return {W:F.W,H:F.H,bg:C.background,top:F.top,bottom:F.bottom,fit:Math.round(L.s*100)/100,tier:L.tier,overfull:L.overfull,
    deco:story?[{size:440,x:720,y:-200,r:8}].map(   /* Charlie 18 Nov: one starburst, top right (was 3) */function(d){d.fill=C.display;d.line=C.outline;return d;}):[],
    head:{h:L.headH,side:hd.side,stack:!hd.side,name:hd.name,nameF:hd.nameF,subF:hd.subF,display:C.display,ol:C.outline,stickerText:C.stickerText,
      dates:hd.dates,dateFs:hd.dateFs,sticker:!hd.side||!hd.burst,burst:hd.side&&!!hd.burst,burstSize:hd.burst,burstFs:hd.burstFs,
      burstDates:sp>0?hd.dates.slice(0,sp)+'\n'+hd.dates.slice(sp+1):hd.dates},
    rows:list,gapHB:G.gapHB,footH:G.footH,logoSrc:C.logo==='white'?ASSETS.logoWhite:ASSETS.logoBlack,allInSrc:ASSETS.allIn};
}

export { lineupView, layoutLineup, COLOURWAYS, FORMATS, G, ANTON, MONT, antonW, montW };
