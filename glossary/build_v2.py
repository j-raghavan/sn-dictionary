"""Build cumulative spoiler-gated DCC glossaries for sn-dictionary.

Layer N = everything revealed in Books 1..N. Install all, enable exactly one.
Outputs: out/DCC-Book-N/  (StarDict: .ifo .idx .dict.dz .syn + meta.json)
"""
import gzip, html, json, os, re, struct, sys, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from model import BOOKS
from gods import GODS
from races import RACES
from orgs import ORGS
from chars import CHARS

TITLES = {1: "Dungeon Crawler Carl", 2: "Carl's Doomsday Scenario", 3: "The Dungeon Anarchist's Cookbook",
          4: "The Gate of the Feral Gods", 5: "The Butcher's Masquerade", 6: "The Eye of the Bedlam Bride",
          7: "This Inevitable Ruin", 8: "A Parade of Horribles"}
BLOCK = {"ai", "rust", "fang", "null", "sac", "guide", "manager", "bk", "the ai", "dong", "paz",
         "nothing", "the nothing", "crest", "prism", "the prism", "dream", "sacs", "grays", "the grays",
         "formidable", "victory", "samantha"}  # see ALLOW below
ALLOW = {"samantha", "the nothing", "the prism", "the grays", "paz", "dong"}  # distinctive enough to keep
OUT = os.path.join(HERE, "out")


def norm(w):
    w = unicodedata.normalize("NFC", w)
    for a, b in {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "}.items():
        w = w.replace(a, b)
    return w.strip().lower()


def esc(t):
    t = html.escape(t, quote=False)
    t = t.replace("&lt;br&gt;", "<br>")
    for ent in ("rarr", "larr"):
        t = t.replace(f"&amp;{ent};", f"&{ent};")
    return t


def all_entries():
    seen, out = {}, []
    for grp in (GODS, RACES, ORGS, CHARS):
        for e in grp:
            k = norm(e.head)
            if k in seen:
                raise SystemExit(f"duplicate headword {e.head!r}")
            seen[k] = e
            out.append(e)
    return out


def render(e, n):
    tag = lambda b: f"<font color=\"#888888\">[{b}]</font>"
    parts = [f"<b>{esc(e.head)}</b> &mdash; <i>{esc(e.cat_at(n))}</i>"]
    for b, t in sorted(e.facts_upto(n), key=lambda x: x[0]):
        parts.append(f"{tag(b)} {esc(t)}")
    rel = e.rel_upto(n)
    if rel:
        parts.append("<b>Relations:</b> " + " ".join(f"{tag(b)} {esc(t)}" for b, t in sorted(rel, key=lambda x: x[0])))
    al = [a for a in e.aliases_upto(n) if norm(a) != norm(e.head)]
    if al:
        parts.append("<i>Also:</i> " + esc(", ".join(dict.fromkeys(al))))
    books = sorted({b for b, _ in e.facts_upto(n)} | {b for b, _ in rel})
    parts.append("<i>Books:</i> " + ", ".join(f"{b} {BOOKS[b]}" for b in books) +
                 f" &mdash; <i>safe through Book {n}</i>")
    return "<br>".join(parts)


def sort_key(w):
    b = w.encode("utf-8")
    return (bytes(c + 32 if 65 <= c <= 90 else c for c in b), b)


def key_entry(n):
    body = (f"<b>DCC books</b> &mdash; <i>Glossary key</i><br>"
            f"This dictionary is <b>safe through Book {n}: {esc(TITLES[n])}</b>. It contains nothing first revealed in a later book.<br>"
            "Each line is tagged with the book that first reveals it:<br>" +
            "<br>".join(f"[{b}] {esc(TITLES[b])}" for b in range(1, 9)) +
            "<br>Enable only one DCC dictionary at a time in the plugin settings: the one for the last book you finished.")
    return body


def build_layer(entries, n):
    name = f"DCC thru Book {n}"
    folder = os.path.join(OUT, f"DCC-Book-{n}")
    os.makedirs(folder, exist_ok=True)
    live = [e for e in entries if e.facts_upto(n) and e.head != "DCC books"]
    rows = [(e.head, render(e, n), e) for e in live]
    rows.append(("DCC books", key_entry(n), None))
    rows.sort(key=lambda r: sort_key(r[0]))
    heads = {norm(r[0]) for r in rows}
    syn, sk, skipped = [], set(), []
    for i, (h, _, e) in enumerate(rows):
        al = e.aliases_upto(n) if e else ["Dungeon Crawler Carl series", "DCC key"]
        for a in al:
            k = norm(a)
            if not k or (k in BLOCK and k not in ALLOW):
                skipped.append((a, h, "blocked")); continue
            if k in heads or k in sk:
                if k != norm(h):
                    skipped.append((a, h, "collision"))
                continue
            sk.add(k); syn.append((a, i))
    syn.sort(key=lambda s: sort_key(s[0]))
    d, idx, off = bytearray(), bytearray(), 0
    for h, body, _ in rows:
        b = body.encode("utf-8")
        idx += h.encode("utf-8") + b"\0" + struct.pack(">II", off, len(b))
        d += b; off += len(b)
    sb = bytearray()
    for w, i in syn:
        sb += w.encode("utf-8") + b"\0" + struct.pack(">I", i)
    base = os.path.join(folder, f"dcc-book{n}")
    open(base + ".idx", "wb").write(idx)
    open(base + ".syn", "wb").write(sb)
    with gzip.open(base + ".dict.dz", "wb", compresslevel=9) as f:
        f.write(bytes(d))
    ifo = ("StarDict's dict ifo file\nversion=3.0.0\n"
           f"bookname={name}\nwordcount={len(rows)}\nsynwordcount={len(syn)}\nidxfilesize={len(idx)}\n"
           "idxoffsetbits=32\nsametypesequence=h\n"
           "author=Compiled from the novels by Matt Dinniman\n"
           f"description=Dungeon Crawler Carl glossary, spoiler-safe through Book {n} ({TITLES[n]})\n")
    open(base + ".ifo", "w", encoding="utf-8", newline="\n").write(ifo)
    json.dump({"name": name, "language": "en"}, open(os.path.join(folder, "meta.json"), "w"), indent=2)
    # plain-text dump for auditing
    with open(os.path.join(OUT, f"audit-book{n}.txt"), "w", encoding="utf-8") as f:
        for h, body, _ in rows:
            f.write(h + "\t" + re.sub("<[^>]+>", " ", html.unescape(body)) + "\n")
        for w, i in syn:
            f.write(w + "\t=> " + rows[i][0] + "\n")
    return len(rows), len(syn), len(d), skipped


def main():
    entries = all_entries()
    for n in range(1, 9):
        r, s, b, sk = build_layer(entries, n)
        print(f"Book {n}: headwords={r} aliases={s} bytes={b} skipped={len(sk)}")
        if n == 8:
            for a, h, why in sk:
                print(f"   skipped {a!r} on {h!r} ({why})")


if __name__ == "__main__":
    main()
