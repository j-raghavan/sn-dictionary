"""Spoiler-layered entry model.

E(head, cat, facts, rel=(), aliases=None)
  facts   : list of (book, text)   - the book in which the fact is first revealed
  rel     : list of (book, text)   - relation lines, same tagging
  aliases : {book: [alias, ...]}   - the book in which the alias/name first appears
A headword appears in layer N only if it has at least one fact with book <= N.
"""

BOOKS = {1: "DCC", 2: "Doomsday", 3: "Cookbook", 4: "Feral Gods", 5: "Masquerade",
         6: "Bedlam Bride", 7: "Inevitable Ruin", 8: "Parade"}


class Entry:
    def __init__(self, head, cat, facts, rel=(), aliases=None):
        self.head, self.cat = head, cat
        self.facts, self.rel = list(facts), list(rel)
        self.aliases = aliases or {}
        for b, t in self.facts + self.rel:
            assert b in BOOKS and isinstance(t, str) and t, (head, b, t)
        for b in self.aliases:
            assert b in BOOKS, (head, b)
        assert self.facts, head

    def cat_at(self, n):
        if isinstance(self.cat, str):
            return self.cat
        ok = [c for b, c in sorted(self.cat) if b <= n]
        return ok[-1] if ok else sorted(self.cat)[0][1]

    @property
    def intro(self):
        return min(b for b, _ in self.facts)

    def facts_upto(self, n):
        return [(b, t) for b, t in self.facts if b <= n]

    def rel_upto(self, n):
        return [(b, t) for b, t in self.rel if b <= n]

    def aliases_upto(self, n):
        return [a for b, al in sorted(self.aliases.items()) if b <= n for a in al]


def E(head, cat, facts, rel=(), aliases=None):
    return Entry(head, cat, facts, rel, aliases)
