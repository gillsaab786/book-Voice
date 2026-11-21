"""BookVoice app icons: 4 designs x every accent colour (keep ACCENTS in sync with src/ui/kit.tsx).

Run: python3 tools/make_icons.py  ->  assets/icons/<Design><Accent>.png (iOS, full square)
                                      assets/icons/<Design><Accent>-fg.png (Android adaptive foreground)
and src/ui/iconList.ts + the expo-alternate-app-icons entries in app.json.
"""
import json, math, os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)
S, K = 1024, 2
N = S * K
ACCENTS = [('Amber', '#FF9F0A'), ('Cyanogen', '#00D4F5'), ('Teal', '#2EE6A6'), ('Rose', '#FF375F'), ('Purple', '#BF5AF2'),
           ('Blue', '#0A84FF'), ('Gold', '#FFD60A'), ('Green', '#30D158'), ('Sunset', '#FF6A3D')]
DESIGNS = ['Wave', 'Listen', 'Glass', 'Moon']

def rgb(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
def mix(a, b, t): return tuple(int(round(a[i]*(1-t)+b[i]*t)) for i in range(3))

def bg(top=(22, 22, 26), bot=(2, 2, 4)):
    g = Image.new('RGB', (1, N))
    for y in range(N): g.putpixel((0, y), mix(top, bot, y/(N-1)))
    return g.resize((N, N)).convert('RGBA')

def book(d, cx, cy, w, h, fill, gap=0.02):
    # two pages of an open book, slightly lifted at the outer corners
    g = N*gap
    d.polygon([(cx-g, cy-h*0.42), (cx-w, cy-h*0.5), (cx-w, cy+h*0.5), (cx-g, cy+h*0.58)], fill=fill)
    d.polygon([(cx+g, cy-h*0.42), (cx+w, cy-h*0.5), (cx+w, cy+h*0.5), (cx+g, cy+h*0.58)], fill=fill)

def bars(d, cx, cy, heights, step, width, fill):
    n = len(heights)
    for i, hh in enumerate(heights):
        x = cx + (i-(n-1)/2)*step
        d.rounded_rectangle([x-width/2, cy-hh/2, x+width/2, cy+hh/2], radius=width/2, fill=fill)

def glow(layer, r=40):
    return layer.filter(ImageFilter.GaussianBlur(r*K/2))

def design(name, acc, transparent=False):
    a = rgb(acc)
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0)) if transparent else bg()
    fx = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    c = N/2
    if name == 'Wave':
        book(d, c, c+N*0.02, N*0.30, N*0.40, a+(255,))
        bars(d, c, c+N*0.03, [N*x for x in (0.09, 0.15, 0.21, 0.25, 0.17, 0.11)], N*0.075, N*0.034, (8, 8, 10, 255))
    elif name == 'Listen':
        # headphones around a closed book spine
        d.arc([c-N*0.30, c-N*0.30, c+N*0.30, c+N*0.30], 200, 340, fill=a+(255,), width=int(N*0.05))
        for sx in (-1, 1):
            d.rounded_rectangle([c+sx*N*0.30-N*0.065, c-N*0.03, c+sx*N*0.30+N*0.065, c+N*0.20], radius=N*0.05, fill=a+(255,))
        d.rounded_rectangle([c-N*0.15, c-N*0.13, c+N*0.15, c+N*0.25], radius=N*0.03, fill=(245, 245, 247, 255))
        d.rectangle([c-N*0.15, c-N*0.13, c-N*0.11, c+N*0.25], fill=mix(a, (0, 0, 0), 0.25)+(255,))
        bars(d, c+N*0.02, c+N*0.06, [N*x for x in (0.06, 0.12, 0.16, 0.10)], N*0.05, N*0.024, mix(a, (0, 0, 0), 0.15)+(255,))
    elif name == 'Glass':
        # frosted glass tile with a glowing wave ring (liquid glass look)
        ring = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        rd.ellipse([c-N*0.25, c-N*0.25, c+N*0.25, c+N*0.25], fill=a+(255,))
        im.alpha_composite(glow(ring, 90))
        tile = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        td.rounded_rectangle([c-N*0.31, c-N*0.31, c+N*0.31, c+N*0.31], radius=N*0.12, fill=(255, 255, 255, 46), outline=(255, 255, 255, 110), width=int(N*0.006))
        im.alpha_composite(tile)
        bars(d, c, c, [N*x for x in (0.08, 0.16, 0.26, 0.32, 0.22, 0.13, 0.07)], N*0.065, N*0.03, (255, 255, 255, 245))
    elif name == 'Moon':
        # crescent moon + stars: stories at night
        m = Image.new('L', (N, N), 0)
        md = ImageDraw.Draw(m)
        md.ellipse([c-N*0.25, c-N*0.33, c+N*0.25, c+N*0.17], fill=255)
        md.ellipse([c-N*0.12, c-N*0.42, c+N*0.34, c+N*0.04], fill=0)
        moon = Image.new('RGBA', (N, N), a+(255,))
        moon.putalpha(m)
        im.alpha_composite(glow(moon, 60))
        im.alpha_composite(moon)
        for (x, y, r) in ((0.22, -0.24, 0.022), (0.30, -0.08, 0.014), (0.10, -0.34, 0.012)):
            d.ellipse([c+N*x-N*r, c+N*y-N*r, c+N*x+N*r, c+N*y+N*r], fill=(255, 255, 255, 235))
        book(d, c, c+N*0.29, N*0.20, N*0.13, (245, 245, 247, 255), gap=0.012)
    if name in ('Wave', 'Listen'):
        im.alpha_composite(glow(fx, 50).point(lambda v: v*0.55))
    im.alpha_composite(fx)
    return im.resize((S, S), Image.LANCZOS)

names = []
for dname in DESIGNS:
    for aname, hexv in ACCENTS:
        n = f'{dname}{aname}'
        names.append((n, dname, aname, hexv))
        design(dname, hexv).convert('RGB').save(os.path.join(OUT, f'{n}.png'), optimize=True)
        fg = design(dname, hexv, transparent=True)
        canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        small = fg.resize((int(S*0.72), int(S*0.72)), Image.LANCZOS)
        canvas.alpha_composite(small, ((S-small.width)//2, (S-small.height)//2))
        canvas.save(os.path.join(OUT, f'{n}-fg.png'), optimize=True)

# main icon = WaveAmber
design('Wave', '#FF9F0A').convert('RGB').save(os.path.join(ROOT, 'assets', 'icon.png'))

# src/ui/iconList.ts
with open(os.path.join(ROOT, 'src', 'ui', 'iconList.ts'), 'w') as f:
    f.write('// Generated by tools/make_icons.py\n')
    f.write('export const ICONS: { name: string; design: string; accent: string; img: any }[] = [\n')
    for n, dname, aname, _ in names:
        f.write(f"  {{ name: '{n}', design: '{dname}', accent: '{aname}', img: require('../../assets/icons/{n}.png') }},\n")
    f.write('];\n')

# app.json plugin entry
p = os.path.join(ROOT, 'app.json')
j = json.load(open(p))
plugins = [x for x in j['expo']['plugins'] if not (isinstance(x, list) and x[0] == 'expo-alternate-app-icons') and x != 'expo-alternate-app-icons']
plugins.append(['expo-alternate-app-icons', [
    {'name': n, 'ios': f'./assets/icons/{n}.png', 'android': {'foregroundImage': f'./assets/icons/{n}-fg.png', 'backgroundColor': '#050507'}}
    for n, *_ in names]])
j['expo']['plugins'] = plugins
json.dump(j, open(p, 'w'), indent=2)
print(len(names), 'icons')
