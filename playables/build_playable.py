#!/usr/bin/env python3
"""
FAVOR — basic gameplay playable ad builder (design/ads/ADS-V1.md §UA).

One self-contained HTML ≤5MB: the real engine + UI + a pinned 3p deal,
auto-booting to the hero select, ending in PLAY NOW → mraid.open. The GVT
playable laws, ported:

  - Fork `git show HEAD:` sources, never the working tree.
  - Every byte-patch asserts it matched EXACTLY once — a moved seam fails
    the build loudly.
  - An ad creative never shows ad breaks: js/broadcast.js is simply not
    included, and the door gates guard on window.FADS — absent = disarmed
    by construction. The build refuses to inline broadcast.js.
  - Zero external requests: firebase scripts dropped (meta.js falls to
    local mode by design), theme mp3 silenced, update-fetch guarded,
    preboot <link rel=preload> stripped. The QA battery interception-
    proves it.
  - Art rides a PLMAP (path → data URI) + an <img src> shim, sized to the
    PINNED deal: seed 0x20260808 decides every hand, so only the cards
    that can actually appear ship art. Missing art degrades to a blank
    pixel, never a request.
  - Rotation shell: portrait containers get the landscape game in a
    90°-rotated srcdoc iframe (coords natively coherent inside).

    python3 playables/build_playable.py        (from anywhere)
    → playables/favor-playable.html            (gitignored deliverable)
"""
import base64
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / 'favor-playable.html'
SEED = 0x20260808
DECK_DEPTH = 48      # deck cards that can appear before the CTA (deep margin)
MISS_DEPTH = 6       # mission arts per act
MAX_BYTES = 5 * 1024 * 1024

URL_PLAY = 'https://play.google.com/store/apps/details?id=com.corkscrewgames.favor'
URL_IOS = 'https://apps.apple.com/app/id6790169069'
URL_WEB = 'https://playfavor.net'


def src(path: str) -> str:
    return subprocess.run(['git', 'show', f'HEAD:{path}'], cwd=ROOT, check=True,
                          capture_output=True).stdout.decode('utf-8')


def patch(hay: str, old: str, new: str, label: str, count: int = 1) -> str:
    n = hay.count(old)
    if n != count:
        sys.exit(f'✗ patch "{label}": anchor found {n}× (want {count})')
    return hay.replace(old, new)


# ── 1 · enumerate the pinned deal (node, engine-smoke loader idiom) ────
def enumerate_deal():
    js = r'''
const files = { cards: 'data/cards.js', missions: 'data/missions.js',
                chars: 'data/characters.js', engine: 'engine/gameState.js' };
const { execSync } = require('child_process');
const load = (p) => execSync(`git show HEAD:${p}`, { cwd: process.env.FROOT, maxBuffer: 1 << 26 }).toString();
const w = { FAVOR_DATA: undefined, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
const ctx = { window: w, localStorage: w.localStorage, console };
for (const k of ['cards', 'missions', 'chars', 'engine']) {
  new Function('window', 'localStorage', 'console', load(files[k])).call(ctx, w, w.localStorage, console);
}
const G = w.FavorGame || (typeof FavorGame !== 'undefined' && FavorGame);
if (!G) { console.error('no FavorGame on the fake window'); process.exit(1); }
const g = new G(3);
g.setSeed(__SEED__);
g.loadDecks();
// Acts deal from per-act decks; the CTA fires in act 1-2, but ship act
// depth generously — a blank card face is the one unforgivable frame.
const cards = [];
for (const act of [1, 2, 3]) {
  for (const c of (g.actDecks[act] || []).slice(0, act === 3 ? 6 : __DEPTH__)) if (c.filename) cards.push(c.filename);
}
const missions = [];
for (const act of [1, 2, 3]) {
  for (const m of (g.missionDecks[act] || []).slice(0, __MDEPTH__)) if (m.filename) missions.push(m.filename);
}
for (const m of (g.visibleMissions || [])) if (m.filename) missions.push(m.filename);
console.log(JSON.stringify({ cards: [...new Set(cards)], missions: [...new Set(missions)] }));
'''
    js = (js.replace('__SEED__', str(SEED))
            .replace('__MDEPTH__', str(MISS_DEPTH))
            .replace('__DEPTH__', str(DECK_DEPTH)))
    r = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True,
                       env={'PATH': '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', 'FROOT': str(ROOT)})
    if r.returncode != 0:
        sys.exit(f'✗ deal enumerator: {r.stderr.decode()[:800]}')
    return json.loads(r.stdout.decode().strip().splitlines()[-1])


# ── 2 · art: downscale + base64 into PLMAP ─────────────────────────────
def shrink(path: Path, spec: str, quality: int, fmt: str = 'jpg') -> bytes:
    with tempfile.NamedTemporaryFile(suffix=f'.{fmt}', delete=False) as t:
        tmp = Path(t.name)
    subprocess.run(['magick', str(path), '-resize', spec, '-strip', '-quality', str(quality), str(tmp)],
                   check=True, capture_output=True)
    data = tmp.read_bytes()
    tmp.unlink()
    return data


def build_plmap(deal):
    plmap, spent = {}, 0

    def put(rel: str, data: bytes, mime: str):
        nonlocal spent
        plmap[rel] = f'data:{mime};base64,' + base64.b64encode(data).decode()
        spent += len(plmap[rel])

    def put_img(rel: str, spec: str, q: int):
        p = ROOT / rel
        if not p.exists():
            print(f'  ⚠ missing {rel}')
            return
        fmt = 'png' if p.suffix.lower() == '.png' else 'jpg'
        put(rel, shrink(p, spec, q, fmt), 'image/png' if fmt == 'png' else 'image/jpeg')

    for f in deal['cards']:
        put_img(f'assets/cards/regular/{f}', '224x336', 58)
    for f in deal['missions']:
        put_img(f'assets/cards/missions/{f}', '200x300', 55)
    put_img('assets/cards/backs/Back Card 1_Brown1.jpg', '224x336', 60)
    for h in ['Explorer', 'Knight', 'Bandit', 'Merchant', 'Fisherman']:
        put_img(f'assets/characters/{h}.jpg', '560x', 60)
    put_img('assets/ui/cover.jpg', '360x', 55)
    for p in sorted((ROOT / 'assets/icons').glob('*.png')):
        put_img(f'assets/icons/{p.name}', '72x72', 82)
    print(f'  PLMAP: {len(plmap)} assets, {spent // 1024}KB inlined')
    return plmap


# ── 3 · compose ────────────────────────────────────────────────────────
FONT_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')


def inline_fonts(css: str) -> str:
    """The one external request in the shipped css is the Google Fonts
    @import — an ad creative may not phone anyone, so the latin-subset
    woff2s ride inline. Cached in playables/.fontcache for offline builds."""
    import urllib.request
    m = re.search(r"@import url\('(https://fonts\.googleapis\.com/css2[^']+)'\);", css)
    if not m:
        sys.exit('✗ font @import not found (did the css change?)')
    cache = Path(__file__).resolve().parent / '.fontcache'
    cache.mkdir(exist_ok=True)

    def fetch(url: str, binary=False):
        key = cache / (re.sub(r'[^A-Za-z0-9]+', '_', url)[-120:] + ('.bin' if binary else '.txt'))
        if key.exists():
            return key.read_bytes() if binary else key.read_text()
        req = urllib.request.Request(url, headers={'User-Agent': FONT_UA})
        data = urllib.request.urlopen(req, timeout=30).read()
        key.write_bytes(data)
        return data if binary else data.decode('utf-8')

    sheet = fetch(m.group(1))
    blocks = re.findall(r'/\* ([a-z-]+) \*/\s*(@font-face \{[^}]+\})', sheet)
    faces = []
    for subset, block in blocks:
        if subset != 'latin':
            continue
        # Cinzel Decorative appears twice, both with a 'Cinzel' fallback —
        # not worth three faces of budget.
        if 'Cinzel Decorative' in block:
            continue
        u = re.search(r'url\((https://fonts\.gstatic\.com[^)]+)\)', block)
        if not u:
            continue
        woff = fetch(u.group(1), binary=True)
        datauri = 'data:font/woff2;base64,' + base64.b64encode(woff).decode()
        faces.append(block.replace(u.group(1), datauri))
    if len(faces) < 6:
        sys.exit(f'✗ only {len(faces)} latin font faces inlined — sheet shape changed?')
    total = sum(len(f) for f in faces)
    print(f'  fonts: {len(faces)} latin faces inlined ({total // 1024}KB)')
    return css.replace(m.group(0), '\n'.join(faces))


def rewrite_css_urls(css: str, plmap):
    def sub(m):
        raw = m.group(1).strip('\'"')
        key = raw.lstrip('./')
        key = key[key.find('assets/'):] if 'assets/' in key else key
        if key in plmap:
            return f'url({plmap[key]})'
        if key.startswith('assets/'):
            return 'none'
        return m.group(0)
    return re.sub(r'url\(([^)]+)\)', sub, css)


def build():
    deal = enumerate_deal()
    print(f'  deal: {len(deal["cards"])} cards, {len(deal["missions"])} missions')
    plmap = build_plmap(deal)

    html = src('index.html')

    # The preboot rival script fires a <link rel=preload> request — strip the
    # whole inline block (unique markers: ROSTER table + preload append).
    m = re.search(r'<script>\s*\(function \(\) \{\s*var ROSTER.*?</script>', html, re.S)
    if not m:
        sys.exit('✗ preboot rival script not found')
    html = html.replace(m.group(0), '<!-- preboot stripped (playable) -->')

    # CSS: inline style.css + melee.css (urls rewritten); drop tutorial.css.
    for css_path in ['css/style.css', 'css/melee.css']:
        tag = re.search(rf'<link rel="stylesheet" href="{css_path}\?v=\d+">', html)
        if not tag:
            sys.exit(f'✗ css tag not found: {css_path}')
        css = src(css_path)
        if css_path == 'css/style.css':
            css = inline_fonts(css)
        css = rewrite_css_urls(css, plmap)
        html = html.replace(tag.group(0), f'<style>\n{css}\n</style>')
    html = patch(html, re.search(r'<link rel="stylesheet" href="css/tutorial\.css\?v=\d+">', html).group(0),
                 '<!-- tutorial.css dropped -->', 'tutorial css')

    # Scripts: firebase dropped; the included set inlines in index order.
    html = re.sub(r'<script defer src="https://www\.gstatic\.com[^"]+"></script>',
                  '<!-- firebase dropped (local mode by design) -->', html)
    include = ['data/cards.js', 'data/missions.js', 'data/characters.js',
               'data/achievements.js', 'data/deeds.js', 'data/playbook.js',
               'engine/gameState.js', 'js/ai.js', 'js/telemetry.js', 'js/melee.js',
               'js/ui.js', 'js/sfx.js', 'js/tablefx-pts.js', 'js/tablefx.js',
               'js/meta.js', 'js/achievements.js', 'js/deeds.js',
               'js/settings.js', 'js/modes.js']
    exclude = ['js/ambient.js', 'js/almanac.js', 'js/mp.js', 'js/tutorial.js', 'js/broadcast.js']
    for p in include:
        tag = re.search(rf'<script defer src="{p}\?v=\d+"></script>', html)
        if not tag:
            sys.exit(f'✗ script tag not found: {p}')
        body = src(p)

        if p == 'js/sfx.js':
            body = patch(body, "const THEME_SRC = 'assets/audio/favor_take_r2.mp3';",
                         "const THEME_SRC = '';", 'theme src')
            body = patch(body, 'function themeStart() {',
                         'function themeStart() { if (!THEME_SRC) return;', 'theme guard')
        if p == 'js/meta.js':
            body = patch(body, "const res = await fetch('index.html', { cache: 'no-store' });",
                         "if (window.PLAYABLE) return; const res = await fetch('index.html', { cache: 'no-store' });",
                         'update fetch guard')
        if p == 'js/ui.js':
            body = patch(body, 'const rngSeed = Math.floor(Math.random() * 0x7fffffff) || 1;',
                         'const rngSeed = window.PLAYABLE ? %d : (Math.floor(Math.random() * 0x7fffffff) || 1);' % SEED,
                         'seed pin')
        body = body.replace('location.reload()', '(window.PLEND ? window.PLEND() : location.reload())')
        html = html.replace(tag.group(0), f'<script>\n{body}\n</script>')
    for p in exclude:
        tag = re.search(rf'<script defer src="{p}\?v=\d+"></script>', html)
        if tag:
            html = html.replace(tag.group(0), f'<!-- {p} dropped -->')

    if 'broadcast.js?v=' in html or 'src="js/' in html:
        leftover = re.findall(r'<script defer src="[^"]+"', html)
        sys.exit(f'✗ un-inlined scripts remain: {leftover}')

    # Static <img src="assets/…"> tags request at PARSE time — before any
    # shim exists. Rewrite them in the markup itself (PLMAP or blank px).
    PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

    def static_src(m2):
        key = m2.group(1)
        # NEVER touch JS template literals riding in inlined script source —
        # `src="assets/x/${expr}"` must stay code (the runtime rew() owns it).
        if '${' in key or '`' in key:
            return m2.group(0)
        return f'src="{plmap.get(key, PX)}"'
    html, n_static = re.subn(r'src="(assets/[^"?]+)(?:\?v=\d+)?"', static_src, html)
    print(f'  static img srcs rewritten: {n_static}')

    # PL head shim: flag + PLMAP + <img src> interceptor + FMP stub + storage
    # guard + telemetry off — FIRST thing in <head>.
    shim = ('<link rel="icon" href="data:,">\n'
            '<script>\n'
            'window.PLAYABLE=1;\n'
            "try{localStorage.setItem('favorTelemetryOff','1');localStorage.removeItem('favorSoloSave');}catch(e){\n"
            "  var __m={};try{Object.defineProperty(window,'localStorage',{value:{getItem:k=>(k in __m?__m[k]:null),"
            "setItem:(k,v)=>{__m[k]=String(v);},removeItem:k=>{delete __m[k];},clear:()=>{__m={};}}});}catch(e2){}\n"
            '}\n'
            'window.FMP=undefined;\n'
            'window.PLMAP=' + json.dumps(plmap) + ';\n'
            "window.PLPX='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';\n"
            '(function(){\n'
            "  const norm=s=>{s=String(s||'').split('?')[0];const i=s.indexOf('assets/');return i>=0?s.slice(i):s;};\n"
            "  const look=v=>{if(/^data:/.test(v))return v;const k=norm(v);return k.startsWith('assets/')?(PLMAP[k]||PLPX):v;};\n"
            "  const d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');\n"
            '  Object.defineProperty(HTMLImageElement.prototype,\'src\',{get(){return d.get.call(this);},set(v){d.set.call(this,look(v));}});\n'
            '  // innerHTML is where FAVOR renders — rewrite asset paths IN THE\n'
            '  // STRING so a fetchable relative URL never reaches the parser\n'
            '  // (an observer swap wins the paint but loses the request race).\n'
            '  const rew=s=>String(s)\n'
            '    .replace(/src="((?:\\.{0,2}\\/)?assets\\/[^"]*)"/g,(m,p)=>\'src="\'+look(p)+\'"\')\n'
            "    .replace(/src='((?:\\.{0,2}\\/)?assets\\/[^']*)'/g,(m,p)=>\"src='\"+look(p)+\"'\")\n"
            '    .replace(/url\\((["\']?)((?:\\.{0,2}\\/)?assets\\/[^)"\']+)\\1\\)/g,(m,q,p)=>\'url(\'+look(p)+\')\');\n'
            "  const ih=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');\n"
            '  Object.defineProperty(Element.prototype,\'innerHTML\',{get(){return ih.get.call(this);},set(v){ih.set.call(this,rew(v));}});\n'
            '  const ia=Element.prototype.insertAdjacentHTML;\n'
            '  Element.prototype.insertAdjacentHTML=function(p,v){return ia.call(this,p,rew(v));};\n'
            "  const sa=Element.prototype.setAttribute;\n"
            "  Element.prototype.setAttribute=function(k,v){if((k==='src'||k==='style')&&/assets\\//.test(v))v=rew(String(v)).replace(/^((?:\\.{0,2}\\/)?assets\\/.*)$/,m=>look(m));return sa.call(this,k,v);};\n"
            '  const fix=im=>{const s=im.getAttribute&&im.getAttribute(\'src\');if(s&&!/^data:/.test(s)&&/assets\\//.test(s))im.src=look(s);};\n'
            '  new MutationObserver(ms=>{for(const m of ms){\n'
            "    if(m.type==='attributes'&&m.target.tagName==='IMG')fix(m.target);\n"
            "    if(m.addedNodes)m.addedNodes.forEach(n=>{if(n.tagName==='IMG')fix(n);else if(n.querySelectorAll)n.querySelectorAll('img').forEach(fix);});\n"
            "  }}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});\n"
            '})();\n'
            '</script>')
    html = patch(html, '<head>', '<head>\n' + shim, 'head shim')

    # PL boot + CTA layer — after every game script.
    pl = r'''
<style>
  .playable #title-screen { display: none !important; }
  #plNow { position: fixed; top: max(8px, env(safe-area-inset-top)); right: max(10px, env(safe-area-inset-right));
    z-index: 10900; padding: 10px 22px; font: bold 16px Georgia, serif; letter-spacing: 1px;
    color: #2a1f14; background: linear-gradient(180deg, #ffe9ad, #e8c34b 55%, #c9992f);
    border: 2px solid #8a6a1f; border-radius: 40px; cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,.5); animation: plPulse 2.2s ease-in-out infinite; }
  @keyframes plPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
  #plEnd { position: fixed; inset: 0; z-index: 11000; display: none; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    background: radial-gradient(ellipse 70% 50% at 50% 30%, rgba(240,200,110,.14), transparent 70%),
      linear-gradient(180deg, #241a10, #120c06); color: #f0e6d2; font-family: Georgia, serif; }
  #plEnd.on { display: flex; }
  #plEnd .f { color: #c9a84c; font-size: 30px; letter-spacing: 18px; }
  #plEnd h1 { font-size: 88px; letter-spacing: 14px; color: #e8c34b; margin: 12px 0 4px;
    text-shadow: 0 3px 0 #8a6a1f, 0 8px 26px rgba(0,0,0,.7); }
  #plEnd .s { font-size: 20px; letter-spacing: 6px; color: #cdbb92; font-variant: small-caps; }
  #plEnd .pill { margin-top: 40px; padding: 18px 62px; font-size: 30px; font-weight: bold;
    color: #2a1f14; background: linear-gradient(180deg, #ffe9ad, #e8c34b 55%, #c9992f);
    border: 3px solid #8a6a1f; border-radius: 60px; cursor: pointer;
    box-shadow: 0 8px 26px rgba(0,0,0,.6), 0 0 44px rgba(232,195,75,.35);
    animation: plPulse 2s ease-in-out infinite; }
  #plEnd .d { margin-top: 22px; font-size: 17px; letter-spacing: 4px; color: #cdbb92; font-variant: small-caps; }
</style>
<script>
(function () {
  'use strict';
  document.body.classList.add('playable');
  var ENDED = false;

  function storeUrl() {
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'URL_PLAY';
    if (/iphone|ipad|ipod/i.test(ua)) return 'URL_IOS';
    return 'URL_WEB';
  }
  function mraidObj() {
    try { if (window.mraid) return window.mraid; } catch (e) {}
    try { if (window.parent && window.parent.mraid) return window.parent.mraid; } catch (e) {}
    return null;
  }
  function ctaGo() {
    var url = storeUrl(), m = mraidObj();
    window.PLCTA = url;                       // QA spy
    try { if (m && typeof m.open === 'function') { m.open(url); return; } } catch (e) {}
    try { var w = window.open(url, '_blank'); if (w) return; } catch (e) {}
    try { location.href = url; } catch (e) {}
  }
  window.PLEND = function () {
    if (!ENDED) {
      ENDED = true;
      var d = document.createElement('div');
      d.id = 'plEnd';
      d.innerHTML = '<div class="f">⚜</div><h1>FAVOR</h1>'
        + '<div class="s">A Game of Royal Succession</div>'
        + '<button type="button" class="pill">PLAY NOW!</button>'
        + '<div class="d">Download Free</div>';
      d.addEventListener('click', ctaGo);
      document.body.appendChild(d);
    }
    var el = document.getElementById('plEnd');
    if (el) el.classList.add('on');
    return true;
  };

  // Doors into the CTA: the scoring sheet, leaving the table, any reload
  // ask (patched), and a watchdog after the first touch.
  var _sc = window.showScoring;
  if (typeof _sc === 'function') window.showScoring = function () { window.PLEND(); };
  var _cl = window.confirmLeaveGame;
  if (typeof _cl === 'function') window.confirmLeaveGame = function () { window.PLEND(); };
  var armed = false;
  document.addEventListener('pointerdown', function () {
    if (armed || ENDED) return;
    armed = true;
    setTimeout(function () { window.PLEND(); }, 80000);
  }, true);

  // PLAY NOW chip — visible the whole session.
  var chip = document.createElement('button');
  chip.id = 'plNow'; chip.type = 'button'; chip.textContent = 'PLAY NOW!';
  chip.addEventListener('click', ctaGo);
  document.body.appendChild(chip);

  // Deterministic court: offer = first three owned, bots = the next two.
  window.shuffleArray = function (a) { return [...a]; };
  window._mpSkipQueue = true;
  window._noSoloSave = true;

  // Auto-boot: straight to the hero select (the title is hidden).
  var boots = 0;
  var bootIv = setInterval(function () {
    boots++;
    if (typeof window.startGame === 'function' && window.FAVOR_DATA) {
      clearInterval(bootIv);
      try { startGame(); } catch (e) { /* the chip still works */ }
    } else if (boots > 100) { clearInterval(bootIv); }
  }, 100);

  // MRAID etiquette: nothing above needs the SDK, but if it exists we wait
  // for ready+viewable before considering the session "on" (spec manners).
  var m = mraidObj();
  if (m && typeof m.addEventListener === 'function') {
    try { m.addEventListener('error', function () {}); } catch (e) {}
  }
})();
</script>
'''
    pl = pl.replace('URL_PLAY', URL_PLAY).replace('URL_IOS', URL_IOS).replace('URL_WEB', URL_WEB)
    html = patch(html, '</body>', pl + '\n</body>', 'pl layer')

    # ── landscape-wall shell (Wyatt 8/8: "landscape-only… it just displays
    # as a landscape wall in portrait — rotating should do nothing") ──
    # One FIXED 960×445 landscape stage, uniformly SCALED to fit any
    # container — never rotated, never re-laid-out. Portrait = a centered
    # letterboxed wall (wordmark + a quiet rotate hint in the outer chrome);
    # rotating the device only changes the scale factor. Inside the iframe
    # the viewport is always landscape, so the game's own #rotate-gate can
    # never fire and every layout is the phone-landscape one it was made for.
    esc = html.replace('&', '&amp;').replace('"', '&quot;')
    if esc.replace('&quot;', '"').replace('&amp;', '&') != html:
        sys.exit('✗ srcdoc escaping does not round-trip')
    outer = ('<!DOCTYPE html><html><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">'
             '<link rel="icon" href="data:,">'
             '<title>FAVOR</title><style>'
             'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#120c06}'
             '#plStage{position:absolute;left:50%;top:50%;width:960px;height:445px;'
             'transform:translate(-50%,-50%);transform-origin:center center}'
             '#plFrame{border:0;display:block;width:960px;height:445px;background:#120c06}'
             '#plMark,#plHint{position:absolute;left:0;right:0;text-align:center;display:none;'
             'font-family:Georgia,\'Times New Roman\',serif;pointer-events:none}'
             '#plMark{color:#e8c34b;font-weight:bold;letter-spacing:10px;'
             'text-shadow:0 2px 0 #8a6a1f,0 6px 18px rgba(0,0,0,.6)}'
             '#plHint{color:#cdbb92;letter-spacing:3px;font-variant:small-caps;font-size:15px}'
             '@media (orientation:portrait){#plMark,#plHint{display:block}}'
             '</style></head><body>'
             '<div id="plMark">FAVOR</div>'
             f'<div id="plStage"><iframe id="plFrame" srcdoc="{esc}" allow="autoplay"></iframe></div>'
             '<div id="plHint">⟳ rotate for the full table</div>'
             '<script>(function(){var W=960,H=445;var st=document.getElementById("plStage");'
             'function fit(){var w=innerWidth,h=innerHeight;'
             'var s=Math.min(w/W,h/H,1.75);'
             'st.style.transform="translate(-50%,-50%) scale("+s+")";'
             'var top=(h-H*s)/2;'
             'var mk=document.getElementById("plMark"),hi=document.getElementById("plHint");'
             'mk.style.top=Math.max(10,top-Math.min(72,top*0.5))+"px";'
             'mk.style.fontSize=Math.min(46,Math.max(26,Math.round(w*0.085)))+"px";'
             'hi.style.top=Math.min(h-26,top+H*s+16)+"px";}'
             'addEventListener("resize",fit);addEventListener("orientationchange",fit);fit();})();'
             '</script></body></html>')

    OUT.write_text(outer, encoding='utf-8')
    size = OUT.stat().st_size

    # Gates.
    for needle, why in [('www.gstatic.com/firebasejs', 'firebase script survived'),
                        ('src=&quot;js/broadcast.js', 'the ad seam leaked into an ad creative'),
                        ('window.FADS = FADS', 'the ad seam BODY leaked into an ad creative'),
                        ('rel=&quot;preload&quot;', 'a preload request survived')]:
        if needle in outer:
            sys.exit(f'✗ gate: {why}')
    if size > MAX_BYTES:
        sys.exit(f'✗ gate: {size} bytes > {MAX_BYTES}')
    print(f'✅ {OUT.name}: {size / 1024 / 1024:.2f}MB — run playables/qa/pl_battery.mjs')


if __name__ == '__main__':
    build()
