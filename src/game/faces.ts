// 乗客アイコン（正面ちびフェイス）。100×100 の座標で描いて縮める
/* eslint-disable */
import type { Kind } from './state.ts';
const INK='#222',SKIN='#F6D2B0',WHITE='#FFFDF6';
export const FACE_BG: Record<Kind,string> = {old:'#B9B0A2',kid:'#E9B23E',sal:'#5C7FB8',stu:'#8299E0',sumo:'#F0C9A0',vip:'#B98ADB',bride:'#F4B6C8',carp:'#E9A23E',tour:'#7EC8E3'};
function P(c: CanvasRenderingContext2D){return {
 c, circ(x: any, y: any, r: any, f: any, s: any=INK, w: any=4){c.beginPath();c.arc(x,y,r,0,7);if(f){c.fillStyle=f;c.fill()}if(s){c.strokeStyle=s;c.lineWidth=w;c.stroke()}},
 ell(x: any, y: any, rx: any, ry: any, f: any, s: any=INK, w: any=4, a0: any=0, a1: any=7){c.beginPath();c.ellipse(x,y,rx,ry,0,a0,a1);if(f){c.fillStyle=f;c.fill()}if(s){c.strokeStyle=s;c.lineWidth=w;c.stroke()}},
 poly(pts: any, f: any, s: any=INK, w: any=4){c.beginPath();pts.forEach((p: number[],i: number)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();if(f){c.fillStyle=f;c.fill()}if(s){c.strokeStyle=s;c.lineWidth=w;c.lineJoin='round';c.stroke()}},
 rr(x: any, y: any, w: any, h: any, r: any, f: any, s: any=INK, lw: any=4){c.beginPath();c.roundRect(x,y,w,h,r);if(f){c.fillStyle=f;c.fill()}if(s){c.strokeStyle=s;c.lineWidth=lw;c.stroke()}},
 line(pts: any, s: any=INK, w: any=4){c.beginPath();pts.forEach((p: number[],i: number)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.strokeStyle=s;c.lineWidth=w;c.lineCap='round';c.lineJoin='round';c.stroke()},
}}
// ---------- A: 正面ちびフェイス ----------
function faceA(c: CanvasRenderingContext2D,k: Kind,col: string){const g=P(c);
 g.circ(50,50,47,col,INK,5);
 c.save();c.beginPath();c.arc(50,50,45,0,7);c.clip();
 // shoulders
 const shirt=({old:'#8A7B66',kid:'#E2553F',sal:'#2E3A55',stu:'#1F2433',sumo:SKIN,vip:'#3B2A55',bride:WHITE,carp:'#5C6C7A',tour:'#F7E26B'} as Record<Kind,string>)[k];
 g.ell(50,104,40,26,shirt);
 if(k==='sal'){g.poly([[44,80],[56,80],[53,100],[47,100]],'#D84B3B',INK,3)}
 if(k==='stu'){g.circ(50,86,2.5,'#E9C04A',null);g.circ(50,95,2.5,'#E9C04A',null)}
 if(k==='sumo'){g.ell(50,104,44,28,SKIN)}
 const big=k==='kid'?29:k==='sumo'?31:26, hy=k==='kid'?54:52;
 // back hair / veil
 if(k==='bride'){g.poly([[22,40],[78,40],[88,95],[12,95]],'#FFFFFF',INK,3)}
 if(k==='old'){g.ell(24,52,8,10,'#EEE',INK,3);g.ell(76,52,8,10,'#EEE',INK,3)}
 // head
 const rx=k==='sumo'?big+4:big; g.ell(50,hy,rx,big,SKIN,INK,4);
 // hair / hats
 if(k==='kid'){g.poly([[22,50],[26,30],[34,36],[40,22],[50,32],[60,20],[66,34],[76,28],[78,50],[70,40],[30,40]],'#3A2A1E',INK,3)}
 if(k==='sal'){g.poly([[24,52],[26,32],[50,24],[76,32],[76,48],[60,36],[46,40],[30,42]],'#1E1E1E',INK,3)}
 if(k==='stu'){g.poly([[23,50],[25,38],[75,38],[77,50],[70,44],[30,44]],'#1E1E1E',INK,3);g.rr(23,22,54,18,6,'#1F2433');g.rr(18,36,48,7,3,'#111');g.circ(50,30,3.5,'#E9C04A',null)}
 if(k==='sumo'){g.poly([[20,50],[22,32],[50,26],[78,32],[80,50],[70,38],[30,38]],'#1E1E1E',INK,3);g.ell(50,22,9,6,'#1E1E1E',INK,3)}
 if(k==='vip'){g.poly([[24,46],[28,32],[72,32],[76,46],[66,38],[34,38]],'#C9A15A',INK,3);g.poly([[30,30],[30,14],[40,22],[50,8],[60,22],[70,14],[70,30]],'#F2C94C',INK,3);g.circ(50,22,2.5,'#E04848',null)}
 if(k==='bride'){g.poly([[26,48],[28,34],[50,28],[72,34],[74,48],[64,38],[36,38]],'#5A3A2A',INK,3);g.poly([[34,30],[42,22],[50,26],[58,22],[66,30]],'#DCE7F2',INK,3);g.ell(26,38,6,4,'#F28BA8',INK,2)}
 if(k==='carp'){g.poly([[24,50],[26,34],[74,34],[76,50],[66,40],[34,40]],'#1E1E1E',INK,3);g.rr(23,34,54,9,4,'#FFFFFF',INK,3);g.ell(78,38,6,4,'#FFFFFF',INK,3);g.ell(82,44,4,5,'#FFFFFF',INK,2)}
 if(k==='tour'){g.ell(50,36,40,9,'#E9D58A',INK,3);g.ell(50,30,22,14,'#E9D58A',INK,3,Math.PI,0);g.rr(28,28,44,6,2,'#E25A5A',null);g.ell(72,32,5,4,'#FFFFFF',INK,2)}
 if(k==='old'){g.line([[34,34],[40,30]],'#ddd',3)}
 // face
 const ey=hy+2;
 if(k==='vip'||k==='tour'){g.rr(28,ey-7,20,12,4,'#111',INK,2);g.rr(52,ey-7,20,12,4,'#111',INK,2);g.line([[48,ey-3],[52,ey-3]],INK,3);g.line([[32,ey-4],[38,ey-6]],'#888',2)}
 else if(k==='old'){g.circ(39,ey,7,null,INK,3);g.circ(61,ey,7,null,INK,3);g.line([[46,ey],[54,ey]],INK,3);g.line([[36,ey],[42,ey]],INK,3);g.line([[58,ey],[64,ey]],INK,3)}
 else if(k==='sal'){g.line([[34,ey],[44,ey+1]],INK,3.5);g.line([[56,ey+1],[66,ey]],INK,3.5);g.ell(72,ey-10,3,5,'#7EC8E3',INK,2)}
 else if(k==='sumo'){g.line([[34,ey-2],[44,ey+1]],INK,4);g.line([[56,ey+1],[66,ey-2]],INK,4);g.line([[32,ey-10],[44,ey-8]],INK,4);g.line([[56,ey-8],[68,ey-10]],INK,4)}
 else if(k==='bride'){g.line([[34,ey],[44,ey]],INK,3);g.ell(39,ey,5,4,null,INK,3,Math.PI,0);g.ell(61,ey,5,4,null,INK,3,Math.PI,0)}
 else {g.circ(39,ey,k==='kid'?5:4,INK,null);g.circ(61,ey,k==='kid'?5:4,INK,null);g.circ(40.5,ey-1.5,1.5,'#fff',null);g.circ(62.5,ey-1.5,1.5,'#fff',null)}
 // cheeks & mouth
 g.ell(31,ey+9,5,3,'rgba(240,120,120,.45)',null);g.ell(69,ey+9,5,3,'rgba(240,120,120,.45)',null);
 const my=ey+14;
 if(k==='kid'){g.ell(50,my,7,6,'#C2413A',INK,3,0,Math.PI);g.line([[43,my],[57,my]],INK,3);g.rr(58,ey+4,10,6,2,'#F2D6A0',INK,2)}
 else if(k==='old'){g.ell(44,my-2,7,4,'#EEE',INK,2);g.ell(56,my-2,7,4,'#EEE',INK,2)}
 else if(k==='sal'){g.line([[44,my+1],[50,my-1],[56,my+1]],INK,3)}
 else if(k==='vip'){g.line([[38,my-3],[46,my-1],[50,my-3],[54,my-1],[62,my-3]],INK,3.5);g.ell(50,my+3,5,2.5,null,INK,2.5,0,Math.PI)}
 else if(k==='sumo'){g.line([[42,my],[58,my]],INK,4)}
 else {g.ell(50,my-2,6,4,null,INK,3,0,Math.PI)}
 c.restore();
}

const cache = new Map<string, HTMLCanvasElement>();
export function faceIcon(kind: Kind, px: number): HTMLCanvasElement {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const key = kind + ':' + px + ':' + dpr;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(px * dpr);
  const c = cv.getContext('2d')!;
  c.scale(cv.width / 100, cv.height / 100);
  faceA(c, kind, FACE_BG[kind]);
  cache.set(key, cv);
  return cv;
}
