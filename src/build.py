import re, hashlib, shutil, os, sys
src = open('player.html', encoding='utf8').read()
# DJ console lives in separate files and is inlined into the single-page build
for ph, fn in (('/*DJ_CSS*/', 'dj.css'), ('<!--DJ_HTML-->', 'dj.html'), ('/*DJ_JS*/', 'dj.js'),
               ('/*SCAN_JS*/', 'scan.js'), ('/*PERSON_JS*/', 'person.js'), ('/*ED_CSS*/', 'ed.css'), ('<!--ED_HTML-->', 'ed.html'), ('/*ED_JS*/', 'ed.js')):
    assert ph in src, ph
    src = src.replace(ph, open(fn, encoding='utf8').read())
ver = sys.argv[1] if len(sys.argv) > 1 else '1'
h = hashlib.sha1(src.encode()).hexdigest()[:6]
version = f'{ver}.{h}'
os.makedirs('../public', exist_ok=True)
head = '''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#08090b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
'''
# split existing head-ish part from body markup at first <div class="wrap">
i = src.index('<div class="wrap">')
headpart, body = src[:i], src[i:]
headpart = headpart.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
reset = '<style>body{margin:0}img{max-width:100%}</style>\n'
html = head + headpart + reset + '</head>\n<body>\n' + body.replace('__APP_VERSION__', version) + '\n</body>\n</html>\n'
open('../public/index.html', 'w', encoding='utf8').write(html)
sw = open('pwa-src/sw.js', encoding='utf8').read().replace('__APP_VERSION__', version)
open('../public/sw.js', 'w', encoding='utf8').write(sw)
for f in ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']:
    shutil.copy('pwa-src/' + f, '../public/' + f)
open('../public/_headers', 'w').write('/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n/manifest.webmanifest\n  Content-Type: application/manifest+json\n  Cache-Control: no-cache\n')
print('built', version)
