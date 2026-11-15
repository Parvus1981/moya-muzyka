const { chromium } = require('playwright');
const svg = (maskable) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1f26"/><stop offset="1" stop-color="#08090b"/></linearGradient>
<radialGradient id="glow" cx="50%" cy="48%" r="50%"><stop offset="0" stop-color="#ffb224" stop-opacity=".38"/><stop offset="1" stop-color="#ffb224" stop-opacity="0"/></radialGradient>
<radialGradient id="btn" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="#ffd985"/><stop offset=".55" stop-color="#ffb224"/><stop offset="1" stop-color="#d98a00"/></radialGradient>
</defs>
<rect width="512" height="512" ${maskable ? '' : 'rx="112"'} fill="url(#bg)"/>
<circle cx="256" cy="256" r="230" fill="url(#glow)"/>
<g transform="translate(256 256) scale(${maskable ? 0.82 : 1}) translate(-256 -256)">
<circle cx="256" cy="256" r="150" fill="#12141a" stroke="#3b414c" stroke-width="6"/>
<circle cx="256" cy="256" r="126" fill="url(#btn)"/>
<path d="M232 200v112l92-56z" fill="#1a1100"/>
</g></svg>`;
(async () => {
  const b = await chromium.launch();
  const jobs = [['icon-512.png', 512, false], ['icon-192.png', 192, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, false]];
  for (const [name, size, mk] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<body style="margin:0;background:transparent">${svg(mk).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
    await p.screenshot({ path: 'pwa-src/' + name, omitBackground: true });
    await p.close();
  }
  await b.close();
})();
