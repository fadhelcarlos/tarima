"""Builds src/songs/youtube.json: one embeddable karaoke video per song (pro channels first)."""
import json, re, sys, time, urllib.parse, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9'}
SONGS = [
    # (artist, title, genre)
    ('Maná', 'Labios compartidos', 'Rock en español'), ('Maná', 'Clavado en un bar', 'Rock en español'), ('Maná', 'Oye mi amor', 'Rock en español'),
    ('Maná', 'En el muelle de San Blas', 'Rock en español'), ('Maná', 'Rayando el sol', 'Rock en español'), ('Maná', 'Vivir sin aire', 'Rock en español'),
    ('Maná', 'Mariposa traicionera', 'Rock en español'), ('Enanitos Verdes', 'Lamento boliviano', 'Rock en español'), ('Enanitos Verdes', 'La muralla verde', 'Rock en español'),
    ('Enanitos Verdes', 'Luz de día', 'Rock en español'), ('Enanitos Verdes', 'Por el resto', 'Rock en español'), ('Enanitos Verdes', 'Tus viejas cartas', 'Rock en español'),
    ('Soda Stereo', 'De música ligera', 'Rock en español'), ('Hombres G', 'Devuélveme a mi chica', 'Rock en español'), ('Los Prisioneros', 'El baile de los que sobran', 'Rock en español'),
    ('Caifanes', 'La negra Tomasa', 'Rock en español'), ('Café Tacvba', 'Eres', 'Rock en español'), ('Elefante', 'Así es la vida', 'Rock en español'),
    ('Mecano', 'Hijo de la luna', 'Pop'), ('La Oreja de Van Gogh', 'Rosas', 'Pop'), ('Sin Bandera', 'Entra en mi vida', 'Pop'), ('Reik', 'Yo quisiera', 'Pop'),
    ('Shakira', 'Ojos así', 'Pop'), ('Juanes', 'A Dios le pido', 'Pop'), ('Chayanne', 'Torero', 'Pop'), ('Luis Miguel', 'La incondicional', 'Baladas'),
    ('Juan Gabriel', 'Querida', 'Baladas'), ('Rocío Dúrcal', 'Amor eterno', 'Baladas'), ('Camilo Sesto', 'Vivir así es morir de amor', 'Baladas'),
    ('Selena', 'Como la flor', 'Clásicos'), ('Vicente Fernández', 'El rey', 'Clásicos'), ('Queen', 'Bohemian Rhapsody', 'In English'),
    ('Bon Jovi', "Livin' on a Prayer", 'In English'), ('Journey', "Don't Stop Believin'", 'In English'), ('Gloria Gaynor', 'I Will Survive', 'In English'),
    ('ABBA', 'Dancing Queen', 'In English'), ('Oasis', 'Wonderwall', 'In English'), ('The Killers', 'Mr. Brightside', 'In English'),
]
PRO = ['karafun', 'sing king', 'party tyme', 'zoom karaoke', 'karaoke version', 'stingray']

def search(q):
    url = 'https://www.youtube.com/results?search_query=' + urllib.parse.quote(q)
    h = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode('utf-8', 'ignore')
    m = re.search(r'var ytInitialData = (\{.*?\});</script>', h)
    out = []
    def walk(o):
        if isinstance(o, dict):
            if 'videoRenderer' in o:
                v = o['videoRenderer']
                out.append({
                    'id': v['videoId'],
                    'title': ''.join(r.get('text', '') for r in v.get('title', {}).get('runs', [])),
                    'channel': ''.join(r.get('text', '') for r in v.get('ownerText', {}).get('runs', [])),
                    'duration': v.get('lengthText', {}).get('simpleText', ''),
                    'views': int(re.sub(r'\D', '', v.get('viewCountText', {}).get('simpleText', '0') or '0') or 0),
                })
            for x in o.values(): walk(x)
        elif isinstance(o, list):
            for x in o: walk(x)
    if m: walk(json.loads(m.group(1)))
    return out

def embeddable(vid):
    url = 'https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(f'https://www.youtube.com/watch?v={vid}')
    try:
        urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read()
        return True
    except Exception:
        return False

catalog = []
for artist, title, genre in SONGS:
    try:
        res = search(f'{artist} {title} karaoke')
    except Exception as e:
        print('search failed', artist, title, e); continue
    def score(r):
        t, c = r['title'].lower(), r['channel'].lower()
        if 'karaoke' not in t and 'karaoke' not in c: return -1
        if any(w in t for w in ['cover', 'reaction', 'en vivo', 'live', 'tutorial']): return -1
        s = min(r['views'], 5_000_000) / 5_000_000
        if any(p in c for p in PRO): s += 2
        if title.lower().split()[0] not in t: s -= 3
        return s
    ranked = sorted([r for r in res if score(r) > 0], key=score, reverse=True)
    pick = None
    for r in ranked[:5]:
        if embeddable(r['id']):
            pick = r; break
        time.sleep(0.3)
    if pick:
        catalog.append({'artist': artist, 'title': title, 'genre': genre, 'videoId': pick['id'], 'channel': pick['channel'], 'duration': pick['duration']})
        print(f"OK  {artist} - {title}: {pick['id']} [{pick['channel']}] {pick['duration']} {pick['views']:,}")
    else:
        print(f'--  {artist} - {title}: no embeddable karaoke found')
    time.sleep(0.6)
json.dump(catalog, open('src/songs/youtube.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(catalog), 'songs')
