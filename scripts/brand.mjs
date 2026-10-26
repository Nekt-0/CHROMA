import { writeFileSync, mkdirSync } from 'node:fs';
import { frame } from '../src/render.mjs';
import { demoSweep, reportedSession } from '../src/demo.mjs';

mkdirSync('assets', { recursive: true });
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="640" viewBox="0 0 1600 640" role="img" aria-label="CHROMA. See the signal. Keep the receipt. Solana research terminal.">
<defs>
 <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#28403a"/></pattern>
 <linearGradient id="beam"><stop stop-color="#cfff63"/><stop offset=".5" stop-color="#62e7d6"/><stop offset="1" stop-color="#9682ff"/></linearGradient>
 <radialGradient id="glow"><stop stop-color="#345448" stop-opacity=".4"/><stop offset="1" stop-color="#07110f" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1600" height="640" fill="#07110f"/><rect width="1600" height="640" fill="url(#grid)"/>
<ellipse cx="1280" cy="260" rx="360" ry="300" fill="url(#glow)"/>
<path d="M0 0H1600" stroke="url(#beam)" stroke-width="8"/>
<text x="80" y="79" fill="#98b5a9" font-family="Consolas,'Courier New',monospace" font-size="16" letter-spacing="4">NEKT0 / SOLANA RESEARCH SYSTEM</text>
<text x="72" y="264" fill="#f2f5e9" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="178" letter-spacing="-8">CHROMA</text>
<text x="82" y="338" fill="#cfff63" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="600">See the signal. Keep the receipt.</text>
<text x="84" y="391" fill="#98b5a9" font-family="Consolas,'Courier New',monospace" font-size="19">Eight market checks. One traceable target history.</text>
<g fill="none" stroke-width="2"><path d="M1020 300L1246 112L1468 300L1246 486Z" stroke="#426454"/>
<path d="M1246 112L1246 486M1020 300H1468M1020 300L1357 206L1357 394Z" stroke="#28463b"/>
<path d="M1000 300H1160L1246 210L1332 300L1246 390L1160 300" stroke="url(#beam)" stroke-width="4"/>
<path d="M1332 300L1540 173" stroke="#cfff63"/><path d="M1332 300H1540" stroke="#62e7d6"/><path d="M1332 300L1540 427" stroke="#9682ff"/></g>
<circle cx="1246" cy="300" r="12" fill="#cfff63"/>

<path d="M80 461H1520" stroke="#2b4439"/>
${['01  SCAN', '02  TRACK', '03  PRIORITIZE', '04  RECORD'].map((label, i) => `<text x="${84 + i * 355}" y="520" fill="${i % 2 ? '#f2f5e9' : '#cfff63'}" font-family="Consolas,'Courier New',monospace" font-size="22">${label}</text>`).join('')}
<text x="84" y="590" fill="#648477" font-family="Consolas,'Courier New',monospace" font-size="15">DEMO  /  SCAN  /  TRADE  /  LOCAL RECEIPTS  /  v0.2</text>
</svg>`;
writeFileSync('assets/banner.svg', banner);

function terminalSvg(view, title) {
  const text = frame(demoSweep(), { width: 116, height: 50, view, session: reportedSession });
  const lines = text.split('\n');
  const h = 114 + lines.length * 23;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${h}" viewBox="0 0 1280 ${h}" role="img" aria-label="${escape(title)}">
<rect width="1280" height="${h}" rx="16" fill="#07110f"/>
<rect x="1" y="1" width="1278" height="${h - 2}" rx="16" stroke="#2d463b" fill="none"/>
<path d="M0 57H1280" stroke="#2d463b"/>
<circle cx="29" cy="29" r="6" fill="#ff6f7b"/><circle cx="50" cy="29" r="6" fill="#ffc071"/><circle cx="71" cy="29" r="6" fill="#cfff63"/>
<text x="110" y="35" font-family="Consolas,'Courier New',monospace" font-size="14" fill="#98b5a9">${escape(title)}</text>
${lines.map((line, i) => `<text xml:space="preserve" x="26" y="${92 + i * 23}" font-family="Consolas,'Courier New',monospace" font-size="17" fill="${i < 2 || line.startsWith(' ›') ? '#cfff63' : line.startsWith('─') ? '#2d463b' : /FILTERED|UNKNOWN/.test(line) ? '#ffc071' : '#c4d5cc'}">${escape(line)}</text>`).join('')}
</svg>`;
}
writeFileSync('assets/terminal.svg', terminalSvg('queue', 'CHROMA / reproducible synthetic queue / documentation rendering'));
writeFileSync('assets/session.svg', terminalSvg('session', 'CHROMA / supplied post figures / unverified balance report'));
console.log('Generated banner, terminal and session SVGs.');
