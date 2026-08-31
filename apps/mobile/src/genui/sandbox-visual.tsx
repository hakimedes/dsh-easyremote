import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { GenuiNode } from './protocol';
import { radii, useTheme } from '../ui/theme';

function serialized(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function page(node: GenuiNode, dark: boolean) {
  const nonce = 'dsh-easyremote-static-engine';
  const foreground = dark ? '#F5F7FA' : '#171A1F';
  const muted = dark ? '#A6AAB4' : '#656B76';
  const surface = dark ? '#181A20' : '#F5F6F8';
  const line = dark ? '#30343D' : '#E5E6EB';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; media-src 'none'; connect-src 'none'; font-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">html,body{margin:0;padding:0;background:transparent;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="c"></canvas><script nonce="${nonce}">'use strict';const input=${serialized(node)};const canvas=document.getElementById('c');const ratio=Math.min(devicePixelRatio||1,2);const width=Math.max(280,innerWidth);const height=${Math.max(180, Math.min(520, typeof node.height === 'number' ? node.height : 280))};canvas.width=width*ratio;canvas.height=height*ratio;canvas.style.height=height+'px';const c=canvas.getContext('2d');c.scale(ratio,ratio);const fg='${foreground}',muted='${muted}',surface='${surface}',rule='${line}',accent='#6D84FF';c.font='13px sans-serif';c.lineWidth=1.5;function txt(s,x,y,color=fg,align='left'){c.fillStyle=color;c.textAlign=align;c.fillText(String(s).slice(0,80),x,y)}function box(label,x,y,w=100,h=42){c.fillStyle=surface;c.strokeStyle=rule;c.beginPath();c.roundRect(x,y,w,h,9);c.fill();c.stroke();txt(label,x+w/2,y+h/2+4,fg,'center')}function arrow(x1,y1,x2,y2,label){c.strokeStyle=muted;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();const a=Math.atan2(y2-y1,x2-x1);c.beginPath();c.moveTo(x2,y2);c.lineTo(x2-8*Math.cos(a-.5),y2-8*Math.sin(a-.5));c.moveTo(x2,y2);c.lineTo(x2-8*Math.cos(a+.5),y2-8*Math.sin(a+.5));c.stroke();if(label)txt(label,(x1+x2)/2,(y1+y2)/2-5,muted,'center')}function chart(){const option=input.option||{};let values=[],labels=[];const series=Array.isArray(option.series)?option.series[0]:null;const raw=series&&Array.isArray(series.data)?series.data:(Array.isArray(input.data)?input.data:[]);raw.slice(0,60).forEach((v,i)=>{if(typeof v==='number'){values.push(v);labels.push(String(i+1))}else if(v&&typeof v==='object'){values.push(Number(v.value)||0);labels.push(String(v.name||v.label||i+1))}});const axis=option.xAxis&&option.xAxis.data;if(Array.isArray(axis))labels=axis.slice(0,values.length).map(String);if(!values.length){txt('No chart data',width/2,height/2,muted,'center');return}const max=Math.max(1,...values.map(Math.abs)),pad=34,plotH=height-72,plotW=width-pad*2;const kind=input.preset||(series&&series.type)||'bar';if(kind==='line'||kind==='area'){c.strokeStyle=accent;c.lineWidth=2;c.beginPath();values.forEach((v,i)=>{const x=pad+i*plotW/Math.max(1,values.length-1),y=height-34-Math.abs(v)/max*plotH;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke()}else if(kind==='pie'){let total=values.reduce((a,b)=>a+Math.abs(b),0),at=-Math.PI/2;values.forEach((v,i)=>{const next=at+Math.PI*2*Math.abs(v)/total;c.fillStyle=['#6D84FF','#59C3C3','#F5B94C','#FF7875','#A78BFA'][i%5];c.beginPath();c.moveTo(width/2,height/2);c.arc(width/2,height/2,Math.min(width,height)*.3,at,next);c.fill();at=next})}else{const slot=plotW/values.length;values.forEach((v,i)=>{const h=Math.abs(v)/max*plotH;c.fillStyle=accent;c.fillRect(pad+i*slot+slot*.18,height-34-h,slot*.64,h);if(values.length<12)txt(labels[i],pad+i*slot+slot/2,height-14,muted,'center')})}}function diagram(){const nodes=Array.isArray(input.nodes)?input.nodes.slice(0,9):[];const positions={};nodes.forEach((n,i)=>{const col=i%2,row=Math.floor(i/2),x=18+col*(width/2),y=26+row*55;positions[n.id]={x:x+48,y:y+21};box(n.label,x,y,Math.min(120,width/2-30),42)});(Array.isArray(input.edges)?input.edges:[]).slice(0,12).forEach(e=>{const a=positions[e.from],b=positions[e.to];if(a&&b)arrow(a.x,a.y,b.x,b.y,e.label)})}function mermaid(){const code=String(input.code||'').split(/\n/).slice(0,30),names=[],edges=[];code.forEach(line=>{const m=line.match(/([\w-]+)(?:\[[^\]]*\])?\s*(?:-->|->>|--|==>)\s*([\w-]+)(?:\[[^\]]*\])?(?::\s*(.*))?/);if(m){if(!names.includes(m[1]))names.push(m[1]);if(!names.includes(m[2]))names.push(m[2]);edges.push([m[1],m[2],m[3]])}});input.nodes=names.map(id=>({id,label:id}));input.edges=edges.map(e=>({from:e[0],to:e[1],label:e[2]}));diagram()}function scene(){txt(input.title||'3D scene',16,20,muted);(Array.isArray(input.meshes)?input.meshes:[]).slice(0,5).forEach((m,i)=>{const x=45+i*(width-80)/Math.max(1,input.meshes.length-1),y=height/2+(i%2)*24;c.fillStyle=m.color||accent;c.strokeStyle=fg;if(m.shape==='sphere'){c.beginPath();c.arc(x,y,24,0,Math.PI*2);c.fill();c.stroke()}else{c.beginPath();c.moveTo(x,y-28);c.lineTo(x+26,y-12);c.lineTo(x+26,y+18);c.lineTo(x,y+32);c.lineTo(x-26,y+18);c.lineTo(x-26,y-12);c.closePath();c.fill();c.stroke()}txt(m.shape,x,height-18,muted,'center')})}if(input.type==='echart')chart();else if(input.type==='mermaid')mermaid();else if(input.type==='scene3d')scene();else diagram();</script></body></html>`;
}

export function SandboxVisual({ node }: { node: GenuiNode }) {
  const theme = useTheme();
  const height = Math.max(180, Math.min(520, typeof node.height === 'number' ? node.height : 280));
  const html = useMemo(() => page(node, theme.isDark), [node, theme.isDark]);
  return <View style={[styles.frame, { height, backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>
    <WebView
      source={{ html }}
      originWhitelist={['about:blank']}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
      scrollEnabled={false}
      overScrollMode="never"
      style={styles.webview}
    />
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
