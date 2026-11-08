/* bocch 動画メーカー：対局の棋譜から、勝った側の視点で曲に合わせた縦型動画を作る。押したときだけ読み込む */
(function(){
if(window.BocchVideo)return;
const BASE=(document.currentScript&&document.currentScript.src||'').replace(/[^\/]*$/,'')||'mv/';
const T=s=>{try{return window.bocchT?window.bocchT(s):s}catch(e){return s}};
function makeRenderer(CV,CFG){const RR={};
const GAME=CFG.moves;const N=GAME.length;const WINNER=CFG.winner||GAME[N-1][0];
const W=1080,H=1920,cv=CV,g=cv.getContext('2d');
const B=60/(CFG.bpm||110);
const LAND=CFG.land; // absolute landing seconds per move (synced to sung words)
const FLY=LAND.map((l,i)=>Math.min(0.32,(i?l-LAND[i-1]:l)*0.45));
const START=LAND.map((l,i)=>l-FLY[i]);
const LT=i=>FLY[i];
RR.TOTAL=CFG.total;
const PHASE=CFG.phase||0;
const TH=Object.assign({light:'#20202a',dark:'#1b1b23',frame:'#121218',line:'#2e2e3a',label:'#6b6b7a',bg:'dark',particles:true},CFG.theme||{});
/* ---------- rules ---------- */
const nb=(b,i)=>{const r=i/6|0,c=i%6;let n=0;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const R=r+dr,C=c+dc;if(R>=0&&R<6&&C>=0&&C<6&&b[R*6+C])n++}return Math.min(n,4)};
const boards=[];{let b=Array(36).fill(0);for(let c=0;c<6;c++){b[c]=2;b[30+c]=1}boards.push(b.slice());for(const [p,f,t] of GAME){b[t]=b[f];b[f]=0;boards.push(b.slice())}}
function reaches(b){const o=[];for(let i=0;i<36;i++){const p=b[i];if(!p)continue;const gr=p===1?0:5;if((i/6|0)===gr)continue;const n=nb(b,i);if(!n)continue;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const R=(i/6|0)+dr*n,C=i%6+dc*n;if(R<0||R>5||C<0||C>5)continue;if(R===gr&&!b[R*6+C])o.push([i,R*6+C,p])}}return o}
/* ---------- helpers ---------- */
const cl=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),ease=x=>{x=cl(x);return x*x*(3-2*x)},eout=x=>{x=cl(x);return 1-Math.pow(1-x,3)},
 back=x=>{x=cl(x);const c1=2.2,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2)};
const CS=160,BX=(W-6*CS)/2,BY=620;const FLIP=WINNER===2;const VC=i=>FLIP?5-(i%6):(i%6),VR=i=>FLIP?5-(i/6|0):(i/6|0); // white's view: board rotated 180°
const cx=i=>BX+VC(i)*CS+CS/2,cy=i=>BY+VR(i)*CS+CS/2,sx=i=>BX+VC(i)*CS,sy=i=>BY+VR(i)*CS;
const rnd=s=>{const x=Math.sin(s*127.1+311.7)*43758.5453;return x-Math.floor(x)};
const ORANGE='#ff8a3d',BLUE='#5fb2ff',RED='#ff2d3d',CYAN='#38f0ff',PURPLE='#c45cff',GOLD='#ffd166';
/* ---------- telops ---------- */
const COL={ORANGE,BLUE,RED,CYAN,PURPLE,GOLD,YELLOW:'#ffef5a',rainbow:'rainbow'};
const TEL=CFG.tel.map(x=>({...x,col:x.col?COL[x.col]:undefined,col2:x.col2?COL[x.col2]:undefined,flash:x.flash?COL[x.flash]:undefined}));
const BADGE={};for(const k in (CFG.badge||{}))BADGE[k]=[CFG.badge[k][0],COL[CFG.badge[k][1]]];
const ZOOM=CFG.zoom||{};const SHAKE=new Set(CFG.shake||[]);const SEQ=new Set(CFG.seq||[]);const SH=[...[...SHAKE].map(k=>({t:LAND[k-1],i:GAME[k-1][2]})),...(CFG.boom||[]).map(b=>({t:b[0],i:b[1]}))];const BL=(CFG.blunder||0)-1,ISO=(CFG.iso||0)-1;
/* ---------- drawing primitives ---------- */
function fitFont(txt,font,size,maxW){g.font=font.replace('S',size);let w=g.measureText(txt).width;if(w>maxW){size=Math.floor(size*maxW/w);g.font=font.replace('S',size)}return size}
function outlined(txt,x,y,font,size,fill,stroke,sw,glow,maxW){size=fitFont(txt,font,size,maxW||W-60);g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
 if(glow){g.save();g.shadowColor=glow;g.shadowBlur=size*0.45;g.fillStyle=glow;g.fillText(txt,x,y);g.restore()}
 g.strokeStyle=stroke;g.lineWidth=sw;g.strokeText(txt,x,y);g.fillStyle=fill;g.fillText(txt,x,y)}
function arrow(x1,y1,x2,y2,p,col,w){if(p<=0)return;const x=x1+(x2-x1)*p,y=y1+(y2-y1)*p;const a=Math.atan2(y2-y1,x2-x1);const hl=w*3.0;
 g.save();g.strokeStyle=col;g.fillStyle=col;g.lineCap='round';g.shadowColor=col;g.shadowBlur=26;g.lineWidth=w;
 g.beginPath();g.moveTo(x1,y1);g.lineTo(x-Math.cos(a)*hl*0.8,y-Math.sin(a)*hl*0.8);g.stroke();
 g.beginPath();g.moveTo(x,y);g.lineTo(x-Math.cos(a-0.45)*hl,y-Math.sin(a-0.45)*hl);g.lineTo(x-Math.cos(a+0.45)*hl,y-Math.sin(a+0.45)*hl);g.closePath();g.fill();g.restore()}
function reticle(i,col,t,a){const x=cx(i),y=cy(i),s=CS*0.46*(1+0.08*Math.sin(t*14)),L=26;g.save();g.globalAlpha=a*(0.55+0.45*(Math.sin(t*18)>0?1:0.35));g.strokeStyle=col;g.lineWidth=7;g.shadowColor=col;g.shadowBlur=18;
 for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){g.beginPath();g.moveTo(x+sx*s,y+sy*(s-L));g.lineTo(x+sx*s,y+sy*s);g.lineTo(x+sx*(s-L),y+sy*s);g.stroke()}
 g.globalAlpha*=0.18;g.fillStyle=col;g.fillRect(x-s,y-s,2*s,2*s);g.restore()}
function stone(x,y,p,n,sc,glow){const r=CS*0.40*sc;g.save();
 g.shadowColor='rgba(0,0,0,.7)';g.shadowBlur=24*sc;g.shadowOffsetY=10*sc;
 const gr=g.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r);
 if(p===1){gr.addColorStop(0,'#4a4a52');gr.addColorStop(0.55,'#17171b');gr.addColorStop(1,'#050506')}else{gr.addColorStop(0,'#ffffff');gr.addColorStop(0.6,'#e4dccb');gr.addColorStop(1,'#a8a090')}
 g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,7);g.fill();g.restore();
 if(TH.outline){g.save();g.strokeStyle=TH.outline;g.lineWidth=3*sc;g.beginPath();g.arc(x,y,r,0,7);g.stroke();g.restore()}
 if(glow){g.save();g.strokeStyle=glow[0];g.globalAlpha=glow[1];g.lineWidth=8;g.shadowColor=glow[0];g.shadowBlur=30;g.beginPath();g.arc(x,y,r+7,0,7);g.stroke();g.restore()}
 g.save();g.font=`700 ${Math.round(70*sc)}px Outfit`;g.textAlign='center';g.textBaseline='middle';g.fillStyle=p===1?'#f3e7c9':'#16130f';g.fillText(String(n),x,y+4*sc);g.restore()}
function badge(x,y,txt,col,a){if(a<=0)return;const s=back(a);g.save();g.translate(x,y);g.scale(s,s);g.shadowColor=col;g.shadowBlur=24;g.fillStyle=col;g.beginPath();g.arc(0,0,44,0,7);g.fill();
 g.shadowBlur=0;g.lineWidth=5;g.strokeStyle='#fff';g.stroke();g.font='62px Bebas';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#fff';g.fillText(txt,0,4);g.restore()}
function xmark(i,a){if(a<=0)return;const x=cx(i),y=cy(i),s=CS*0.28*back(a);g.save();g.globalAlpha=cl(a*2);g.fillStyle='rgba(255,30,50,.22)';g.fillRect(x-CS/2+6,y-CS/2+6,CS-12,CS-12);
 g.strokeStyle=RED;g.lineWidth=14;g.lineCap='round';g.shadowColor=RED;g.shadowBlur=20;g.beginPath();g.moveTo(x-s,y-s);g.lineTo(x+s,y+s);g.moveTo(x+s,y-s);g.lineTo(x-s,y+s);g.stroke();g.restore()}
/* ---------- camera ---------- */
const WIDE=[W/2,BY+3*CS,1];
function frameSq(sq,zmax){if(!sq||!sq.length)return WIDE;const xs=sq.map(cx),ys=sq.map(cy);const M=CS*0.95;
 const w=Math.max(...xs)-Math.min(...xs)+2*M,h=Math.max(...ys)-Math.min(...ys)+2*M;let z=Math.min(W/w,1250/h,zmax||2.3);z=Math.max(1,z);
 let x=(Math.max(...xs)+Math.min(...xs))/2,y=(Math.max(...ys)+Math.min(...ys))/2;
 const hw=W/(2*z),hh=520/z,x0=BX-40,x1=BX+6*CS+40,y0=BY-40,y1=BY+6*CS+40;
 x=(x1-x0<2*hw)?W/2:Math.max(x0+hw,Math.min(x1-hw,x));y=(y1-y0<2*hh)?BY+3*CS:Math.max(y0+hh,Math.min(y1-hh,y));return [x,y,z]}
const CAM=(CFG.cam||[]).slice().sort((a,b)=>a.t-b.t).map(k=>({...k,tg:frameSq(k.sq,k.z)}));
function camAt(t){let cur=WIDE;for(let k=0;k<CAM.length;k++){const K=CAM[k];if(t<K.t)break;const te=Math.min(t,k+1<CAM.length?CAM[k+1].t:1e9);const a=K.d?eout((te-K.t)/K.d):1;
 cur=[cur[0]+(K.tg[0]-cur[0])*a,cur[1]+(K.tg[1]-cur[1])*a,cur[2]+(K.tg[2]-cur[2])*a]}return cur}
/* ---------- particles ---------- */
const PT=[];for(let k=0;k<70;k++)PT.push([rnd(k*3.1)*W,rnd(k*7.7)*H,0.4+rnd(k*1.3)*1.6,rnd(k*9.1)]);
/* ---------- words ---------- */
const WORDS=CFG.words||[];const HOT=new Set(CFG.hot||[]);
/* ---------- frame ---------- */
RR.renderAt=function(t){
 g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.fillStyle='#050507';g.fillRect(0,0,W,H);
 // ----- background (theme) -----
 if(TH.bg==='grad'){const gr=g.createLinearGradient(0,0,0,H);gr.addColorStop(0,TH.bg1||'#0b1630');gr.addColorStop(1,TH.bg2||'#02040a');g.fillStyle=gr;g.fillRect(0,0,W,H)}
 else{const gr=g.createRadialGradient(W/2,BY+3*CS,100,W/2,BY+3*CS,1100);gr.addColorStop(0,TH.bg1||'#1d1430');gr.addColorStop(1,TH.bg2||'#050308');g.fillStyle=gr;g.fillRect(0,0,W,H)}
 if(TH.bg==='speed'){const k=Math.floor(t*12);g.save();g.translate(W/2,BY+3*CS);for(let i=0;i<90;i++){const a=rnd(i*7.3+k)*Math.PI*2,w=0.004+rnd(i*3.1+k)*0.012,r0=520+rnd(i+k*1.7)*160;g.fillStyle=TH.lineCol||'rgba(255,255,255,.55)';g.beginPath();g.moveTo(Math.cos(a-w)*r0,Math.sin(a-w)*r0);g.lineTo(Math.cos(a)*1500,Math.sin(a)*1500);g.lineTo(Math.cos(a+w)*r0,Math.sin(a+w)*r0);g.fill()}g.restore()}
 if(TH.bg==='aura'){const cxx=W/2,cyy=BY+3*CS;g.save();for(let q=0;q<3;q++){const rr=560+q*50+20*Math.sin(t*3+q);g.strokeStyle=TH.auraCol||'#a24dff';g.globalAlpha=0.45-q*0.1;g.lineWidth=40-q*10;g.shadowColor=TH.auraCol||'#a24dff';g.shadowBlur=60;g.beginPath();g.arc(cxx,cyy,rr,0,7);g.stroke()}
  const k=Math.floor(t*8);g.globalAlpha=0.9;g.lineWidth=4;g.strokeStyle='#e7c8ff';g.shadowBlur=30;for(let b=0;b<3;b++){let a=rnd(k*5+b)*Math.PI*2,r=600;g.beginPath();g.moveTo(cxx+Math.cos(a)*r,cyy+Math.sin(a)*r);for(let s2=0;s2<8;s2++){a+=(rnd(k*13+b*7+s2)-0.5)*0.25;r+=40+rnd(k+s2*3+b)*40;g.lineTo(cxx+Math.cos(a)*r,cyy+Math.sin(a)*r)}g.stroke()}g.restore()}
 if(TH.particles)for(const [px,py,sp,ph] of PT){const y=((py-t*60*sp)%H+H)%H,x=px+Math.sin(t*0.8+ph*6)*20;g.globalAlpha=0.25+0.35*Math.abs(Math.sin(t*2+ph*9));g.fillStyle=ph>0.6?'#ff5a7a':'#8a6cff';g.fillRect(x,y,3*sp,10*sp)}g.globalAlpha=1;
 // move state
 let mv=-1;for(let i=0;i<N;i++)if(t>=START[i])mv=i; // current/last move index
 const landT=mv>=0?START[mv]+LT(mv):-1, landed=mv>=0&&t>=landT;
 const bd=landed?boards[mv+1]:boards[Math.max(0,mv)];
 // ----- camera (zoom + shake) -----
 let [zx,zy,zs]=camAt(t);
 // beat pulse in the chorus + slow breathing drift
 if((CFG.pulse||[]).some(r=>t>=r[0]&&t<r[1])){const bu=(((t-PHASE)%B)+B)%B/B;zs*=1+(CFG.pulseAmp??0.03)*Math.exp(-bu*7)}
 zs*=1+(CFG.drift??0.012)*Math.sin(t*0.9);
 let shx=0,shy=0,shock=null;
 for(const S_ of SH){const t0=S_.t,u=t-t0;if(u>=0&&u<0.7){const amp=34*Math.exp(-u*6);shx+=(rnd(Math.floor(t*60))-0.5)*2*amp;shy+=(rnd(Math.floor(t*60)+9)-0.5)*2*amp;}if(u>=0&&u<1.0)shock={i:S_.i,u}}
 g.save();g.translate(W/2+shx,BY+3*CS+shy);g.scale(zs,zs);g.translate(-zx,-zy);
 // ----- board -----
 g.save();g.shadowColor='rgba(0,0,0,.8)';g.shadowBlur=60;g.fillStyle=TH.frame;g.fillRect(BX-24,BY-24,6*CS+48,6*CS+48);g.restore();
 const FL=TH.flip&&CFG.flipT&&t>=CFG.flipT&&t<CFG.flipT+(TH.flipDur||1.4);const LC=FL?TH.flip[0]:TH.light,DC=FL?TH.flip[1]:TH.dark;
 for(let i=0;i<36;i++){const r=i/6|0,c=i%6;g.fillStyle=(r+c)%2?DC:LC;g.fillRect(BX+c*CS,BY+r*CS,CS,CS)}
 g.strokeStyle=TH.line;g.lineWidth=2;for(let k=0;k<=6;k++){g.beginPath();g.moveTo(BX+k*CS,BY);g.lineTo(BX+k*CS,BY+6*CS);g.stroke();g.beginPath();g.moveTo(BX,BY+k*CS);g.lineTo(BX+6*CS,BY+k*CS);g.stroke()}
 // goal edges
 g.save();g.shadowBlur=20;g.shadowColor=BLUE;g.fillStyle=BLUE;g.fillRect(BX,BY-14,6*CS,6);g.shadowColor=ORANGE;g.fillStyle=ORANGE;g.fillRect(BX,BY+6*CS+8,6*CS,6);g.restore();
 g.font='34px Bebas';g.fillStyle=TH.label;g.textAlign='center';g.textBaseline='middle';
 for(let c=0;c<6;c++)g.fillText(String(6-c),BX+c*CS+CS/2,BY-44);for(let r=0;r<6;r++)g.fillText('FEDCBA'[r],BX-46,BY+r*CS+CS/2);
 // last move squares
 if(mv>=0){const [p,f,to]=GAME[mv];const col=p===1?ORANGE:BLUE;const a=landed?Math.max(0.35,1-(t-landT)*0.8):0.6;
  g.save();g.globalAlpha=0.16*a;g.fillStyle=col;g.fillRect(sx(f),sy(f),CS,CS);g.globalAlpha=0.28*a;g.fillRect(sx(to),sy(to),CS,CS);g.restore();
  if(mv===BL&&landed){const u=t-landT;g.save();g.globalAlpha=Math.min(0.75,u*4)*(0.75+0.25*Math.sin(t*12));g.fillStyle=RED;g.shadowColor=RED;g.shadowBlur=40;g.fillRect(sx(to),sy(to),CS,CS);g.restore()}}
 // ----- reach arrows + reticles (settled board) -----
 const R=landed||mv<0?reaches(bd):[];
 const seq=mv>=0&&SEQ.has(mv+1);
 R.forEach((r,q)=>{const col=r[2]===1?ORANGE:BLUE;const ST=CFG.seqT&&CFG.seqT[mv+1];const t0=ST?(ST[Math.min(q,ST.length-1)]):landT+0.05+q*0.06;const u=t-t0;if(u<0)return;const p=eout(u/0.16);
  reticle(r[1],r[2]===1?RED:BLUE,t,cl(u/0.1));
  const x1=cx(r[0]),y1=cy(r[0]),x2=cx(r[1]),y2=cy(r[1]);const L=Math.hypot(x2-x1,y2-y1);const ux=(x2-x1)/L,uy=(y2-y1)/L;
  arrow(x1+ux*58,y1+uy*58,x2-ux*22,y2-uy*22,p,col,16);
  if(u<0.25){g.save();g.globalAlpha=1-u/0.25;g.fillStyle='#fff';g.beginPath();g.arc(x2,y2,30+u*200,0,7);g.fill();g.restore()}});
 // ----- isolation (move 35) -----
 if(mv===ISO&&landed){const s=GAME[ISO][2];const u=t-landT;
  g.save();g.globalAlpha=Math.min(0.8,u*3)*(0.7+0.3*Math.sin(t*10));g.fillStyle=RED;g.shadowColor=RED;g.shadowBlur=50;g.fillRect(sx(s),sy(s),CS,CS);g.restore();
  const ring=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const R2=(s/6|0)+dr,C=s%6+dc;if(R2>=0&&R2<6&&C>=0&&C<6&&!bd[R2*6+C])ring.push(R2*6+C)}
  ring.forEach((i,k)=>xmark(i,(u-0.5-k*B*0.5)/0.25));
  if(u>0.5+ring.length*B*0.5){const a=cl((u-0.5-ring.length*B*0.5)/0.3);g.save();g.globalAlpha=a;g.strokeStyle=RED;g.lineWidth=10;g.setLineDash([22,14]);g.lineDashOffset=-t*80;g.shadowColor=RED;g.shadowBlur=24;
   const r0=Math.max(0,VR(s)-1),c0=Math.max(0,VC(s)-1),r1=Math.min(5,VR(s)+1),c1=Math.min(5,VC(s)+1);g.strokeRect(BX+c0*CS+6,BY+r0*CS+6,(c1-c0+1)*CS-12,(r1-r0+1)*CS-12);g.restore()}}
 // ----- stones -----
 const movingTo=mv>=0&&!landed?GAME[mv][1]:-1;
 for(let i=0;i<36;i++){if(!bd[i]||i===movingTo)continue;let glow=null;
  if(mv>=0&&landed&&i===GAME[mv][2]){const u=t-landT;glow=[bd[i]===1?ORANGE:BLUE,Math.max(0,1-u*1.2)]}
  if(mv>=0&&landed&&i!==GAME[mv][2]){const pb=boards[mv];if(pb[i]&&nb(pb,i)!==nb(bd,i)){const u=t-landT;if(u<1)glow=['#fff',0.8*(1-u)]}}
  if(mv===ISO&&landed&&i===GAME[ISO][2])glow=[RED,0.9];
  let sc=1;if(mv>=0&&landed&&i===GAME[mv][2]){const u=t-landT;sc=1+0.12*Math.exp(-u*10)*Math.cos(u*30)}
  stone(cx(i),cy(i),bd[i],nb(bd,i),sc,glow)}
 // moving stone
 if(mv>=0&&!landed){const [p,f,to]=GAME[mv];const u=(t-START[mv])/LT(mv);const e=ease(u);const x=cx(f)+(cx(to)-cx(f))*e,y=cy(f)+(cy(to)-cy(f))*e;
  const col=p===1?ORANGE:BLUE;g.save();for(let k=1;k<=6;k++){const e2=ease(u-k*0.05);if(e2<=0)break;g.globalAlpha=0.12*(7-k)/6;g.fillStyle=col;g.beginPath();g.arc(cx(f)+(cx(to)-cx(f))*e2,cy(f)+(cy(to)-cy(f))*e2,CS*0.36,0,7);g.fill()}g.restore();
  stone(x,y,p,nb(boards[mv],f),1+0.18*Math.sin(Math.PI*cl(u)),[col,0.8])}
 // landing ring
 if(mv>=0&&landed){const u=t-landT;if(u<0.6){const to=GAME[mv][2];g.save();g.globalAlpha=0.8*(1-u/0.6);g.strokeStyle=GAME[mv][0]===1?ORANGE:BLUE;g.lineWidth=8;g.beginPath();g.arc(cx(to),cy(to),CS*0.42+u*260,0,7);g.stroke();g.restore()}}
 // shockwave
 if(shock){const x=cx(shock.i),y=cy(shock.i),u=shock.u;g.save();g.globalAlpha=1-u;g.strokeStyle='#fff';g.lineWidth=26*(1-u)+2;g.shadowColor=CYAN;g.shadowBlur=40;g.beginPath();g.arc(x,y,40+u*900,0,7);g.stroke();
  g.globalAlpha=0.6*(1-u);g.strokeStyle=CYAN;g.lineWidth=12;g.beginPath();g.arc(x,y,40+u*600,0,7);g.stroke();g.restore()}
 // badges
 if(mv>=0&&landed&&BADGE[mv+1]){const to=GAME[mv][2];const [txt,col]=BADGE[mv+1];badge(cx(to)+CS*0.38,cy(to)-CS*0.38,txt,col,(t-landT)/0.35)}
 // win: goal row glow
 if(mv===N-1&&landed&&!CFG.draw){const u=t-landT;const row=WINNER===1?0:5,WC=WINNER===1?ORANGE:BLUE;for(let c=0;c<6;c++){const i=row*6+c;g.save();g.globalAlpha=Math.min(0.35,u*0.5)*(bd[i]===WINNER?2:1);g.fillStyle=WC;g.shadowColor=WC;g.shadowBlur=40;g.fillRect(sx(i),sy(i),CS,CS);g.restore()}
  for(let c=0;c<6;c++){const i=row*6+c;if(bd[i]===WINNER)stone(cx(i),cy(i),WINNER,nb(bd,i),1,[GOLD,0.9])}}
 g.restore(); // camera
 // ----- screen flashes -----
 for(const T of TEL)if(T.flash){const u=t-T.t;if(u>=0&&u<0.5){g.fillStyle=T.flash;g.globalAlpha=0.45*(1-u/0.5);g.fillRect(0,0,W,H);g.globalAlpha=1}}
 for(const S_ of SH){const u=t-S_.t;if(u>=0&&u<0.25){g.fillStyle='#fff';g.globalAlpha=0.35*(1-u/0.25);g.fillRect(0,0,W,H);g.globalAlpha=1}}
 // ----- sung word (one word at a time, ChessMakta style) -----
 {let Wd=null;for(const w of WORDS){if(t>=w[0])Wd=w;else break}
  if(Wd&&t<Wd[1]+0.45){const u=t-Wd[0];const hot=HOT.has(Wd[2].toLowerCase().replace(/[^a-z']/g,''));
   // place near the action: last landing square in screen space
   let fy=1450;if(mv>=0){const to=GAME[mv][2];const sy_=(cy(to)-zy)*zs+BY+3*CS;fy=sy_<1000?sy_+CS*zs*0.95:sy_-CS*zs*0.95;fy=Math.max(470,Math.min(1600,fy))}
   const pop=back(u/0.14);g.save();g.translate(W/2,fy);g.scale(0.6+0.4*pop,0.6+0.4*pop);g.globalAlpha=cl(u/0.05)*cl((Wd[1]+0.45-t)/0.12);
   outlined(Wd[2].toUpperCase(),0,0,'Spx Bebas',hot?210:170,hot?'#38f0ff':'#ffe14a','#000',22,hot?'rgba(56,240,255,.55)':'rgba(255,225,74,.35)',980);g.restore()}}
 // ----- full-screen cut-in (climax) -----
 for(const C of (CFG.cutin||[])){const u=t-C.t;if(u<0||u>=(C.d||1.0))continue;const D=C.d||1.0;
  g.save();g.globalAlpha=Math.min(1,u/0.06)*(1-Math.max(0,(u-D+0.2)/0.2));
  const gr=g.createLinearGradient(0,0,W,H);gr.addColorStop(0,C.c1||'#ff3b30');gr.addColorStop(1,C.c2||'#ffcc00');g.fillStyle=gr;g.fillRect(0,0,W,H);
  g.globalAlpha*=0.25;for(let i=0;i<40;i++){g.fillStyle='#fff';const yy=rnd(i*9.1+Math.floor(t*20))*H;g.fillRect(0,yy,W,4+rnd(i)*10)}g.globalAlpha/=0.25;
  const s=1+0.5*Math.exp(-u*9);g.translate(W/2,H/2);g.scale(s,s);g.rotate(-0.06);
  const lines=C.text.split('\n');lines.forEach((L,q)=>{outlined(L,0,(q-(lines.length-1)/2)*230,'Spx Bebas',260,'#ffffff','#000',26,'rgba(0,0,0,.4)',1000)});g.restore()}
 // move counter
 if(mv>=0){g.save();g.font='44px Bebas';g.textAlign='left';g.textBaseline='middle';g.fillStyle='#8a8a99';g.fillText(`MOVE ${mv+1} / ${N} · ${GAME[mv][0]===1?'BLACK':'WHITE'}`,BX,1640);g.restore()}
 // end fade
 g.fillStyle='#000';g.globalAlpha=cl((t-(RR.TOTAL-0.8))/0.8);g.fillRect(0,0,W,H);g.globalAlpha=1;
};

return RR;}

const NB=(b,i)=>{const r=i/6|0,c=i%6;let n=0;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const R=r+dr,C=c+dc;if(R>=0&&R<6&&C>=0&&C<6&&b[R*6+C])n++}return Math.min(n,4)};
function REACH(b){const o=[];for(let i=0;i<36;i++){const p=b[i];if(!p)continue;const gr=p===1?0:5;if((i/6|0)===gr)continue;const n=NB(b,i);if(!n)continue;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const R=(i/6|0)+dr*n,C=i%6+dc*n;if(R<0||R>5||C<0||C>5)continue;if(R===gr&&!b[R*6+C])o.push([i,R*6+C,p])}}return o}
function parseKifu(txt){
  txt=txt.trim();let L=null;
  try{const j=JSON.parse(txt);L=Array.isArray(j)?j:(j.log||j.moves)}catch(e){}
  if(!L){const toks=txt.match(/[1-6][a-f]\s*[-→>]\s*[1-6][a-f]/gi)||[];const sq=s=>('abcdef'.indexOf(s[1].toLowerCase()))*6+(+s[0]-1);L=toks.map(t=>{const m=t.match(/([1-6][a-f])\s*[-→>]\s*([1-6][a-f])/i);return [sq(m[1]),sq(m[2])]})}
  if(!L||!L.length)throw new Error('棋譜を読み取れませんでした');
  // normalize to [p,f,t] and validate by replay
  let b=Array(36).fill(0);for(let c=0;c<6;c++){b[c]=2;b[30+c]=1}
  const out=[];let p=1;
  for(const m of L){let f,t;if(m.length>=3&&(m[0]===1||m[0]===2)&&m.length!==2&&!(m.length===4&&typeof m[3]==='number'&&m[0]>2)){if(m.length===4&&(m[0]===1||m[0]===2)&&m[1]<36&&m[2]<36){[,f,t]=m}else if(m.length===3){[,f,t]=m}else{[f,t]=m}}else{[f,t]=m}
    if(b[f]!==p){ // maybe [f,t,...] format
      [f,t]=m;if(b[f]!==p)throw new Error(`${out.length+1}手目が盤面と合いません`)}
    b[t]=b[f];b[f]=0;out.push([p,f,t]);p=3-p}
  return out}
function analyze(moves,W0){
  const n=moves.length;const W=(W0===1||W0===2)?W0:moves[n-1][0],O=3-W;const boards=[];let b=Array(36).fill(0);for(let c=0;c<6;c++){b[c]=2;b[30+c]=1}boards.push(b.slice());
  for(const [p,f,t] of moves){b[t]=b[f];b[f]=0;boards.push(b.slice())}
  const goal=p=>p===1?0:5,arr=(bd,p)=>[0,1,2,3,4,5].filter(c=>bd[goal(p)*6+c]===p).length;
  const ev={};let prevO=0,prevW=0,firstArr=0;const iso=(bd,p)=>{let k=0;for(let i=0;i<36;i++)if(bd[i]===p&&(i/6|0)!==goal(p)&&NB(bd,i)===0)k++;return k};let pz=0;
  for(let k=1;k<=n;k++){const bd=boards[k],[p]=moves[k-1];const R=REACH(bd);const rW=new Set(R.filter(r=>r[2]===W).map(r=>r[1])).size,rO=R.filter(r=>r[2]===O).length;const e=[];
    if(!firstArr&&arr(bd,O)>0&&arr(bd,W)===0){firstArr=k;e.push('oppfirst')}
    if(p===W&&rO>prevO)e.push('bait');if(p===W&&rW>=2)e.push('multi');if(p===O&&rW>prevW)e.push('induce');
    const z=iso(bd,O);if(z>pz)e.push('bocchi');pz=z;
    if(e.length)ev[k]=e;prevO=rO;prevW=R.filter(r=>r[2]===W).length}
  const fin=n>=4?n-2:n;const finReach=new Set(REACH(boards[fin]).filter(r=>r[2]===W).map(r=>r[1])).size;
  return {n,W,boards,ev,fin,finReach,firstArr}}
const THEMES={
 A:{light:'#ece6fb',dark:'#8b7bd8',frame:'#2a2340',line:'#00000022',label:'#b9b0e0',bg:'dark',bg1:'#1a1430',bg2:'#040308',outline:'#3b3355',particles:false},
 B:{light:'#f8e6d8',dark:'#df9583',frame:'#3a2420',line:'#00000022',label:'#e9b9aa',bg:'speed',bg1:'#120a0a',bg2:'#000',outline:'#5a3a33',particles:false},
 C:{light:'#f1e8d2',dark:'#3f9f95',frame:'#10302e',line:'#00000022',label:'#9fd6cf',bg:'grad',bg1:'#0d1b33',bg2:'#020409',outline:'#2c4d4a',particles:true,flip:['#ffffff','#2f6bff']},
 D:{light:'#fbe4ef',dark:'#e48db3',frame:'#3a1730',line:'#00000022',label:'#f3b6d0',bg:'aura',bg1:'#1b0c26',bg2:'#030106',outline:'#5a2d48',particles:false},
 E:{light:'#20202a',dark:'#1b1b23',frame:'#121218',line:'#2e2e3a',label:'#6b6b7a',bg:'dark',particles:true}};
function plan(moves,track,themeKey,camMode,end){camMode=camMode||'mid';end=end||{};
  const A=analyze(moves,end.win===0?(end.me===1||end.me===2?end.me:1):end.win);const {n,fin,W,boards,ev}=A;if(n<1)throw new Error('手数が少なすぎます');
  const B=60/track.bpm,PH=track.phase;const GB=B>=0.5?B:2*B;const beat=t=>PH+Math.round((t-PH)/GB)*GB;
  const L=Array(n+1).fill(null);
  if(n<4){ /* 1〜3手の短い対局：最後の手を決め手の拍に置き、前の手は2拍ずつさかのぼる */
    for(let k=n;k>=1;k--)L[k]=Math.max(0.6+(k-1)*0.6,track.winT-(n-k)*Math.max(2*GB,1.2))}
  else{L[n]=track.winT;L[fin]=track.finT;L[n-1]=beat((track.finT+track.winT)/2);
  if(!(L[n-1]>L[fin]+0.8&&L[n-1]<L[n]-0.8))L[n-1]=(L[fin]+L[n])/2;
  const key=k=>ev[k]&&ev[k].some(x=>x!=='multi'||true);
  const t0=0.6,t1=track.finT,m=fin;let cand;
  for(const wk of [2.4,1.8,1.3,1.0]){const wt=[];for(let q=0;q<m;q++)wt.push(q>0&&key(q)?wk:1);const cs=[0];for(const w of wt)cs.push(cs[cs.length-1]+w);
    cand=cs.map(c=>t0+(t1-t0)*c/cs[m]);const gaps=cand.slice(1).map((x,i)=>x-cand[i]);if(Math.min(...gaps)>=0.55||wk===1.0)break}
  for(let j=1;j<m;j++){const tb=beat(cand[j]);L[j]=(tb-(L[j-1]??t0)>=0.5&&tb<t1-0.5)?tb:cand[j]}
  {const seg=[t0];for(let j=1;j<m;j++)seg.push(L[j]);seg.push(t1);if(Math.min(...seg.slice(1).map((x,i)=>x-seg[i]))<0.45)for(let j=1;j<m;j++)L[j]=cand[j]}}
  const LAND=L.slice(1);
  // camera: punch-ins like bocch_mv_white_v1 (opponent's first arrival, first bait/bocchi)
  const cam=[];const used=[];const startOf=k=>LAND[k-1]-Math.min(0.32,(LAND[k-1]-(k>1?LAND[k-2]:0))*0.45);
  const want=[];if(A.firstArr)want.push(A.firstArr);for(const k of Object.keys(ev).map(Number))if(k<fin&&ev[k].some(x=>x==='bait'||x==='bocchi')&&!want.includes(k)){want.push(k);break}
  for(const k of want.sort((a,b)=>a-b)){const t=LAND[k-1]-0.12;const nx=k<n?startOf(k+1):1e9;const h=Math.min(4*B,nx-t-0.95);if(h<0.6)continue;cam.push({t:+t.toFixed(3),sq:[moves[k-1][2]],z:1.42,d:0.22},{t:+(t+h).toFixed(3),sq:null,d:0.8})}
  if(camMode==='calm'){cam.length=0}
  else if(camMode==='wild'){ /* 激しい：k1のカメラワーク。手の間が短いところは寄らずに待つ（行ったり来たりしない） */
    cam.length=0;cam.push({t:0,sq:[14,15,20,21],z:2.0,d:0});
    const KEY=new Set([fin,n,n-1]);if(A.firstArr)KEY.add(A.firstArr);for(const k in ev)if(ev[k].some(x=>x==='bait'||x==='bocchi'))KEY.add(+k);
    const goal=p=>p===1?0:5,arrived=(bd,p)=>[0,1,2,3,4,5].some(c=>bd[goal(p)*6+c]===p);
    for(let i=0;i<n;i++){const m=i+1,[pp,f,t]=moves[i],prev=i?LAND[i-1]:0,gap=LAND[i]-prev,nextGap=i+1<n?LAND[i+1]-LAND[i]:9,key=KEY.has(m);
      if(key||gap>=1.0){const fly=Math.min(0.32,gap*0.45);cam.push({t:+Math.max(prev+0.05,LAND[i]-fly-0.3).toFixed(3),sq:[f,t],z:key?2.3:1.5,d:0.28})}
      if(key||nextGap>=1.3){const R=REACH(boards[m]);const sq=[...new Set(R.flatMap(r=>[r[0],r[1]]))];cam.push({t:+(LAND[i]+0.12).toFixed(3),sq:sq.length?sq:[t],z:key?2.3:1.6,d:0.4})}}
    for(const pl of [1,2]){for(let m=1;m<n-1;m++){if(arrived(boards[m],pl)){cam.push({t:+(LAND[m-1]+0.15).toFixed(3),sq:[moves[m-1][2]],z:2.5,d:0.3});break}}}
    for(let i=1;i<n;i++)if(LAND[i]-LAND[i-1]>4.5)cam.push({t:+(LAND[i-1]+1.6).toFixed(3),sq:null,d:Math.min(3,LAND[i]-LAND[i-1]-2.2)});
    if(n>=4&&fin>=1)cam.push({t:+(LAND[fin-1]-1.6).toFixed(3),sq:[moves[fin-1][1]],z:2.6,d:0.6});
    const W=A.W,arr=[0,1,2,3,4,5].map(c=>goal(W)*6+c).filter(x=>boards[n][x]===W);
    cam.push({t:+(track.winT-0.1).toFixed(3),sq:arr,z:2.2,d:0.6},{t:+(track.winT+1.1).toFixed(3),sq:null,d:1.2})}
  const badge={};if(n>=4&&moves[fin-1][0]===W)badge[fin]=['!!','CYAN'];for(const k in ev)if(+k<fin&&ev[k].includes('bait'))badge[k]=['!?','PURPLE'];
  const th=themeKey==='rand'?'ABCD'[Math.floor(Math.random()*4)]:themeKey;
  /* 決着の形：ゴール到着以外（投了・時間切れ・動けない・引き分け）は最後に一言出す */
  const why=String(end.why||''),drawn=end.win===0;let tag='';
  if(drawn)tag='DRAW';else if(/投了/.test(why))tag='RESIGNS';else if(/時間切れ/.test(why))tag='TIME OUT';else if(/動けなく/.test(why))tag='NO MOVES';
  else{const gl=W===1?0:5;let k=0;for(let c=0;c<6;c++)if(boards[n][gl*6+c]===W)k++;if(k<2)tag='WIN'}
  const cutin=tag?[{t:+(L[n]+0.9).toFixed(3),d:1.4,text:tag,c1:drawn?'#5b6b8c':W===1?'#ff7a1a':'#2f8bff',c2:drawn?'#232d43':'#121826'}]:[];
  /* 短い対局は曲の途中から始める（最初の手の3秒前、最低でも決め所の6秒前から） */
  const start=n<4?Math.max(0,Math.min(L[1]-3,track.winT-6)):0;
  const cfg={start,winner:W,draw:end.win===0,cutin,bpm:track.bpm,phase:PH,pulseAmp:0,drift:0,moves,land:LAND,total:track.end,tel:[],badge,shake:camMode==='calm'?[]:[fin,n],boom:[],blunder:0,iso:0,seqT:n>=4?{[fin]:track.seq}:{},pulse:[[track.finT,track.winT]],cam,words:track.words,hot:['home','three','four','two','lanes','lane','move','over','done','mistake','first','block'],theme:THEMES[th],flipT:track.finT};
  return {cfg,A,theme:th}}

const THN={A:'ラベンダー',B:'サーモン',C:'ティール',D:'ピンク',E:'ダーク'};
let TRACKS=null,ready=null;
function load(){if(ready)return ready;
  const css=document.createElement('style');css.textContent=`
#bmv{position:fixed;inset:0;z-index:9999;background:#121826;color:#eef2fa;font-family:"Noto Sans JP",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:max(12px,env(safe-area-inset-top)) 16px max(14px,env(safe-area-inset-bottom));box-sizing:border-box;overflow-y:auto;font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif}
#bmv .top{width:100%;max-width:420px;display:flex;align-items:center;justify-content:space-between}
#bmv h3{margin:0;font-size:17px;font-weight:800}
#bmv .x{background:none;border:none;color:#9aa6c0;min-height:0;font-size:15px;padding:8px;cursor:pointer}
#bmv canvas{height:min(56vh,640px);width:auto;max-width:100%;aspect-ratio:9/16;border-radius:18px;background:#000;display:block;flex:none}
#bmv .opt{width:100%;max-width:420px;display:grid;grid-template-columns:1fr 1fr;gap:8px}
#bmv label{font-size:12px;color:#9aa6c0;font-weight:700;display:block;margin-bottom:3px}
#bmv select{width:100%;background:#1a2234;color:#eef2fa;border:1px solid rgba(200,215,240,.18);border-radius:12px;padding:10px;font-size:14px}
#bmv .row{width:100%;max-width:420px;display:flex;gap:8px}
#bmv .row button{flex:1;background:#232d43;color:#eef2fa;border:0;border-radius:999px;padding:12px;min-height:50px;font-size:15px;font-weight:800;cursor:pointer}
#bmv .row button.main{background:linear-gradient(180deg,#cfe3fb,#a9cdf7);color:#0f1a30;border:none;font-weight:900}
#bmv button:disabled{opacity:.45;cursor:default}
#bmv .bar{width:100%;max-width:420px;height:6px;background:#232d43;border-radius:99px;overflow:hidden;flex:none}#bmv .bar i{display:block;height:100%;width:0;background:#a9cdf7;border-radius:99px}
#bmv .msg{width:100%;max-width:420px;font-size:13px;color:#9aa6c0;min-height:18px;line-height:1.6;text-align:center}`;
  document.head.appendChild(css);
  const ff=[new FontFace('Bebas','url('+BASE+'bebas.ttf)'),new FontFace('Outfit','url('+BASE+'outfit.ttf)',{weight:'700'})];
  ready=Promise.all([fetch(BASE+'tracks.json?v=1').then(r=>r.json()).then(j=>{TRACKS=j}),...ff.map(f=>f.load().then(x=>document.fonts.add(x)).catch(()=>{}))]);
  return ready}
let UI=null,ST=null;
function el(h){const d=document.createElement('div');d.innerHTML=h;return d.firstElementChild}
function bgm(off){window.BOCCH_MV=off?1:0;try{window.bgmTick&&window.bgmTick()}catch(e){}}
function close(){if(!UI)return;if(ST&&ST.src){try{ST.src.stop()}catch(e){}}if(ST)ST.stop=1;if(ST&&ST.rec&&ST.rec.state!=='inactive')try{ST.rec.stop()}catch(e){}
  UI.remove();UI=null;bgm(false)}
function okLog(log){try{return log&&log.length?parseKifu(JSON.stringify(log)):null}catch(e){return null}}
async function open(o){
  const mv=okLog(o&&o.log||[]);if(!mv){alert(T('この対局は動画にできません'));return}const END={win:o.win,why:o.why,me:o.me};
  close();bgm(true);
  UI=el(`<div id="bmv" role="dialog" aria-modal="true"><div class="top"><h3>${T('動画を作る')}</h3><button class="x" id="bmvX">${T('閉じる')} ✕</button></div>
<canvas id="bmvCv" width="1080" height="1920"></canvas>
<div class="opt"><div><label for="bmvTh">${T('見た目')}</label><select id="bmvTh"></select></div><div><label for="bmvCam">${T('カメラ')}</label><select id="bmvCam"><option value="wild">${T('激しい')}</option><option value="mid">${T('普通')}</option><option value="calm">${T('大人しい')}</option></select></div></div>
<div class="row"><button id="bmvPrev">▶ ${T('プレビュー')}</button><button id="bmvMake" class="main">${T('動画を作る')}</button></div>
<div class="bar"><i id="bmvProg"></i></div><div class="msg" id="bmvMsg">${T('読み込み中…')}</div>
<div class="row" id="bmvOut" hidden><button id="bmvSave" class="main">${T('保存')}</button><button id="bmvShare">${T('共有')}</button></div></div>`);
  document.body.appendChild(UI);const q=id=>UI.querySelector('#'+id),CV=q('bmvCv'),msg=t=>{q('bmvMsg').textContent=t};
  q('bmvX').onclick=close;
  q('bmvPrev').disabled=q('bmvMake').disabled=true;
  try{await load()}catch(e){msg(T('読み込めませんでした'));return}
  if(!UI)return;
  /* 曲は手数で自動に選ぶ：決め手までを1手およそ1.2秒で見せられる曲（短い対局は短い曲、長い対局は長い曲） */
  const want=mv.length<4?0:0.6+(mv.length-2)*1.2,df=TRACKS.map((t,i)=>[Math.abs(t.finT-want),i]).sort((a,b)=>a[0]-b[0]),near=df.filter(d=>d[0]<=Math.max(7,df[0][0]+3));
  const TI=near[Math.floor(Math.random()*near.length)][1],thPick='ABCD'[Math.floor(Math.random()*4)];
  for(const k of 'ABCDE'){const op=document.createElement('option');op.value=k;op.textContent=T(THN[k]);q('bmvTh').appendChild(op)}q('bmvTh').value=thPick;{let c='mid';try{c=localStorage.getItem('bocch-mvcam')||'mid'}catch(e){}q('bmvCam').value=c}
  let P=null,RR=null,blob=null,busy=false,ac=null;const AB={};
  const build=()=>{blob=null;q('bmvOut').hidden=true;P=plan(mv,TRACKS[TI],q('bmvTh').value,q('bmvCam').value,END);RR=makeRenderer(CV,P.cfg);RR.renderAt((P.cfg.start||0)+0.01)};
  const safe=()=>{try{build();msg(T(END.win===0?'曲に合わせた縦型動画を作ります':'勝った側の視点で、曲に合わせた縦型動画を作ります'))}catch(e){msg(T('動画を作れませんでした'))}};
  q('bmvTh').onchange=()=>{if(!busy)safe()};q('bmvCam').onchange=()=>{try{localStorage.setItem('bocch-mvcam',q('bmvCam').value)}catch(e){}if(!busy)safe()};
  safe();q('bmvPrev').disabled=q('bmvMake').disabled=false;
  async function audio(i){ac=ac||new AudioContext();if(!AB[i])AB[i]=await fetch(BASE+TRACKS[i].file).then(r=>r.arrayBuffer()).then(b=>ac.decodeAudioData(b));return AB[i]}
  const LB={bmvPrev:'▶ '+T('プレビュー'),bmvMake:T('動画を作る')};let curBtn=null;
  function stopRun(){if(!ST||ST.stop)return;ST.stop=1;try{ST.src&&ST.src.stop()}catch(e){}if(ST.rec&&ST.rec.state!=='inactive')try{ST.rec.stop()}catch(e){}q('bmvProg').style.width='0%';RR.renderAt((P.cfg.start||0)+0.01);msg(T('止めました'))}
  async function run(record){if(busy){if(curBtn===(record?'bmvMake':'bmvPrev'))stopRun();return}busy=true;const me=UI;curBtn=record?'bmvMake':'bmvPrev';q('bmvPrev').disabled=q('bmvMake').disabled=q('bmvTh').disabled=q('bmvCam').disabled=true;
    {const b=q(curBtn);b.disabled=false;b.textContent='■ '+T(record?'やめる':'止める')}
    ST={};try{safe();msg(T('読み込み中…'));const buf=await audio(TI);if(UI!==me)return;await ac.resume();
      const src=ac.createBufferSource();src.buffer=buf;ST.src=src;let chunks=[],mime='';
      if(record){const dest=ac.createMediaStreamDestination();src.connect(dest);
        const types=['video/mp4;codecs=avc1.42E01F,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'];mime=types.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
        const ms=new MediaStream([...CV.captureStream(30).getVideoTracks(),...dest.stream.getAudioTracks()]);ST.rec=new MediaRecorder(ms,mime?{mimeType:mime,videoBitsPerSecond:6e6}:{});ST.rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);ST.rec.start(500);
        msg(T('録画中…終わるまでこの画面を開いたままにしてください'))}else msg('');
      src.connect(ac.destination);const S0=P.cfg.start||0,t0=ac.currentTime+0.15;src.start(t0,S0);const TT=RR.TOTAL;
      await new Promise(res=>{const loop=()=>{if(ST.stop){res();return}const t=ac.currentTime-t0+S0;RR.renderAt(Math.max(S0,Math.min(t,TT)));q('bmvProg').style.width=Math.min(100,Math.max(0,(t-S0)/(TT-S0)*100))+'%';if(t>=TT){res();return}requestAnimationFrame(loop)};loop()});
      if(ST.stop)return;try{src.stop()}catch(e){}RR.renderAt(Math.min(TT,TRACKS[TI].winT+1));
      if(ST.rec){await new Promise(r=>{ST.rec.onstop=r;ST.rec.stop()});blob=new Blob(chunks,{type:(mime||'video/webm').split(';')[0]});q('bmvOut').hidden=false;msg(T('できました。保存か共有を押してください。'))}
      else msg('');
    }catch(e){msg(T('動画を作れませんでした'))}
    finally{busy=false;curBtn=null;if(UI===me){q('bmvPrev').disabled=q('bmvMake').disabled=q('bmvTh').disabled=q('bmvCam').disabled=false;q('bmvPrev').textContent=LB.bmvPrev;q('bmvMake').textContent=LB.bmvMake}}}
  q('bmvPrev').onclick=()=>run(false);q('bmvMake').onclick=()=>run(true);
  const fname=()=>'bocch_'+new Date().toISOString().slice(0,19).replace(/\D/g,'')+'.'+(blob.type.includes('mp4')?'mp4':'webm');
  q('bmvSave').onclick=()=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fname();document.body.appendChild(a);a.click();a.remove();msg(T('保存しました'))};
  q('bmvShare').onclick=async()=>{if(!blob)return;const f=new File([blob],fname(),{type:blob.type});
    if(navigator.canShare&&navigator.canShare({files:[f]})){try{await navigator.share({files:[f],text:'#bocch'})}catch(e){}}else msg(T('この端末では共有に対応していないので、保存してから投稿してください。'))};
}
window.BocchVideo={open,ok:l=>!!okLog(l)};
})();
