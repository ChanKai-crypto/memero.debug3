#!/usr/bin/env python3
"""
Construit les dictionnaires compacts utilisés par l'« IA dictionnaire »
(routes /api/dict/*) à partir de dictionnaires libres :

  • FreeDict (GPL-2.0+) : fra-eng, eng-fra, spa-eng, eng-ara
    (ara-eng est écarté : trop d'entrées fausses)
  • SUBTLEX-CH (fréquence des mots chinois, via le paquet npm « hanzi ») :
    sert uniquement à classer les traductions chinoises, n'est pas copié.
      https://github.com/freedict/fd-dictionaries
  • OpenRussian / russian-dictionary (CC BY-SA 4.0) : nouns, verbs, adjectives, others
      https://github.com/Badestrand/russian-dictionary
  • CC-CEDICT (CC BY-SA 4.0), via le paquet npm « cc-cedict »
      https://cc-cedict.org

Sortie : data/dicts/<xx>-en.json et data/dicts/en-<xx>.json (xx = fr, es, ar, ru, zh)
         format { "clé normalisée": ["traduction", ...] }
L'anglais sert de langue pivot pour les autres paires (fr→ru = fr→en→ru).

Usage : python3 scripts/build-dicts.py <dossier des sources téléchargées>
"""
import sys, os, re, json, csv, unicodedata
from collections import OrderedDict

SRC = sys.argv[1] if len(sys.argv) > 1 else "dict-src"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "dicts")
MAX_T = 8
RAW_MAX = 40
csv.field_size_limit(10**8)

ARTICLES = {
    "en": ["to ", "a ", "an ", "the "],
    "fr": ["le ", "la ", "les ", "l'", "l’", "un ", "une ", "des ", "se ", "s'"],
    "es": ["el ", "la ", "los ", "las ", "un ", "una ", "se "],
}

def norm(s, lang):
    """Même normalisation que src/utils/dict.js (à garder synchronisées)."""
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace("’", "'")
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s)
    s = re.sub(r"[^\w' -]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -'")
    for a in ARTICLES.get(lang, []):
        if s.startswith(a) and len(s) > len(a) + 1:
            s = s[len(a):]
            break
    return s.strip()

def clean_val(v):
    v = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", str(v))
    v = re.sub(r"\s+", " ", v).strip(" ;,.")
    v = re.sub(r"^\((.*?)\)\s*", "", v)
    return v

class Dict:
    def __init__(self, src, dst):
        self.src, self.dst, self.d = src, dst, OrderedDict()
    def add(self, word, trans):
        k = norm(word, self.src)
        t = clean_val(trans)
        if not k or not t or len(k) > 60 or len(t) > 60: return
        if len(t.split()) > 4: return
        lst = self.d.setdefault(k, [])
        if t not in lst and len(lst) < RAW_MAX: lst.append(t)
    def save(self):
        p = os.path.join(OUT, f"{self.src}-{self.dst}.json")
        with open(p, "w", encoding="utf-8") as f: json.dump(self.d, f, ensure_ascii=False, separators=(",", ":"))
        print(p, len(self.d), "entrées", os.path.getsize(p) // 1024, "Ko")

ENTRY = re.compile(r"<entry\b.*?</entry>", re.S)
ORTH = re.compile(r"<orth>(.*?)</orth>", re.S)
QUOTE = re.compile(r'<cit type="trans"[^>]*>\s*<quote>(.*?)</quote>', re.S)
def unesc(s): return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").strip()

def read_tei(name):
    p = os.path.join(SRC, name + ".tei")
    if not os.path.exists(p): return []
    txt = open(p, encoding="utf-8").read()
    out = []
    for e in ENTRY.findall(txt):
        o = ORTH.findall(e)
        q = QUOTE.findall(e)
        if o and q: out.append((unesc(o[0]), [unesc(x) for x in q]))
    return out

def split_defs(s):
    return [x for x in re.split(r"[;,/]", s) if x.strip()]

def main():
    os.makedirs(OUT, exist_ok=True)
    pairs = {}
    def D(a, b):
        if (a, b) not in pairs: pairs[(a, b)] = Dict(a, b)
        return pairs[(a, b)]
    # FreeDict
    for name, a, b in [("fra-eng", "fr", "en"), ("eng-fra", "en", "fr"), ("spa-eng", "es", "en"), ("eng-ara", "en", "ar")]:
        for w, ts in read_tei(name):
            for t in ts:
                D(a, b).add(w, t); D(b, a).add(t, w)
    # Russe
    for f in ["nouns", "verbs", "adjectives", "others"]:
        p = os.path.join(SRC, f"ru-{f}.csv")
        if not os.path.exists(p): continue
        for row in csv.DictReader(open(p, encoding="utf-8"), delimiter="\t"):
            w = (row.get("bare") or "").strip()
            for t in split_defs(row.get("translations_en") or ""):
                D("ru", "en").add(w, t); D("en", "ru").add(t, w)
    # Chinois (CC-CEDICT)
    p = os.path.join(SRC, "cedict", "package", "data", "all.js")
    if os.path.exists(p):
        data = json.loads(open(p, encoding="utf-8").read().split("export default", 1)[1].strip().rstrip(";"))
        for row in data["all"]:
            trad, simp, pinyin, defs = row[0], row[1], row[2], row[3]
            if re.search(r"[A-Za-z0-9]", simp): continue
            defs = ";".join(defs) if isinstance(defs, list) else str(defs)
            for t in split_defs(defs.replace("/", ";")):
                t = t.strip()
                if re.match(r"^(CL:|variant of|old variant|surname|abbr\.|see |also written|used in|erhua)", t, re.I): continue
                D("zh", "en").add(simp, t); D("en", "zh").add(t, simp)
                if trad != simp: D("zh", "en").add(trad, t)
    # « Fréquence » approximative des caractères chinois : un caractère qui
    # apparaît dans beaucoup de mots du dictionnaire est un caractère courant.
    import math
    from collections import Counter
    zc = Counter()
    if ("zh", "en") in pairs:
        for k in pairs[("zh", "en")].d: zc.update(set(k))
    # Fréquence réelle des mots chinois (SUBTLEX-CH, sous-titres de films),
    # utilisée seulement pour CLASSER les traductions (pas redistribuée).
    zf = {}
    fp = os.path.join(SRC, "zh-freq.tsv")
    if os.path.exists(fp):
        for line in open(fp, encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 2 and parts[1].isdigit(): zf[parts[0]] = int(parts[1])
    def common(t):
        if t in zf: return 10 + math.log(1 + zf[t])
        if not zc or not t: return 0
        return sum(math.log(1 + zc.get(c, 0)) for c in t) / len(t)
    # Classement : pour en→xx, on met d'abord les mots xx dont la PREMIÈRE
    # traduction anglaise est ce mot (sens principal), puis les plus courts.
    for (a, b), d in pairs.items():
        rev = pairs.get((b, a))
        for k, lst in d.d.items():
            def rank(t):
                r = rev.d.get(norm(t, b), []) if rev else []
                pos = next((i for i, x in enumerate(r) if norm(x, a) == k), 20)
                if b == "zh":
                    return (pos > 4, -round(common(t), 1), len(t))
                return (pos, len(r) == 0, len(t))
            lst.sort(key=rank)
            del lst[MAX_T:]
    for d in pairs.values(): d.save()

if __name__ == "__main__":
    main()
