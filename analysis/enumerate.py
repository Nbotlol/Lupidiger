"""Exhaustive analysis of the 4x5 / 4-mine scoring game."""
from itertools import combinations
from collections import Counter, defaultdict

R, C = 4, 5
N = R * C

def idx(r, c): return r * C + c

def neighbors(i):
    r, c = divmod(i, C)
    out = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            rr, cc = r + dr, c + dc
            if 0 <= rr < R and 0 <= cc < C:
                out.append(idx(rr, cc))
    return out

NB = [neighbors(i) for i in range(N)]

def score_of(k):
    if k == 0: return 1, 'G'
    if k <= 2: return 5, 'B'
    return 20, 'R'

placements = list(combinations(range(N), 4))
print("placements:", len(placements))

totals = Counter()
min_p = None
best = []
color_tot = Counter()
for mines in placements:
    ms = set(mines)
    tot = 0
    cs = Counter()
    for i in range(N):
        if i in ms:
            continue
        k = sum(1 for j in NB[i] if j in ms)
        s, col = score_of(k)
        tot += s
        cs[col] += 1
    totals[tot] += 1
    if min_p is None or tot < min_p[0]:
        min_p = (tot, mines, dict(cs))
    best.append((tot, mines, dict(cs)))

print("min total over safe cells:", min_p)
print("max total:", max(t for t, _, _ in best))
vals = sorted(totals.items())
print("distribution (total: count):")
print(vals)
print("mean total:", sum(t * c for t, c in totals.items()) / len(placements))

# count placements with total <= 30
bad = [b for b in best if b[0] <= 30]
print("placements with total <= 30:", len(bad))
for b in bad[:5]:
    print(b)

# how many placements where clicking ALL safe cells does NOT reach 30
# also: distribution of the number of blue/red/green safe cells
agg = Counter()
for tot, ms, cs in best:
    agg[(cs.get('G',0), cs.get('B',0), cs.get('R',0))] += 1
print("\n(G,B,R) combos:", len(agg))
for k, v in agg.most_common(20):
    print(k, v)
