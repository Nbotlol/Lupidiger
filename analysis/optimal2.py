"""Exact optimal-play value, corrected memo keys.

State is (set of revealed cells, their numbers) -> canonical key uses the
numbers ordered by cell index, never by click order.

Runs only the requested first cells.
"""
import sys, time
from itertools import combinations

R, C = 4, 5
N = R * C
K = 4

NB = []
for i in range(N):
    r, c = divmod(i, C)
    s = 0
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            rr, cc = r + dr, c + dc
            if 0 <= rr < R and 0 <= cc < C:
                s |= 1 << (rr * C + cc)
    NB.append(s)

P = [sum(1 << i for i in m) for m in combinations(range(N), K)]
CNT = [tuple(bin(pm & NB[i]).count("1") for i in range(N)) for pm in P]
SCORE = (1, 5, 5, 20, 20)
FULL = (1 << N) - 1

memo = {}
nodes = 0
t0 = time.time()


def key_of(mask, counts_by_cell):
    # counts_by_cell: dict cell->count ; canonical ordering by cell index
    return (mask, tuple(counts_by_cell[i] for i in range(N) if (mask >> i) & 1))


def V(mask, cbc, cons, score):
    """cbc: dict cell -> revealed number. cons: tuple of consistent placement ids."""
    global nodes
    if score > 30:
        return 1.0
    k = key_of(mask, cbc)
    hit = memo.get(k)
    if hit is not None:
        return hit
    nodes += 1
    total = len(cons)
    best = 0.0
    for m in range(N):
        if (mask >> m) & 1:
            continue
        buckets = {}
        safe_n = 0
        for p in cons:
            if (P[p] >> m) & 1:
                continue
            c = CNT[p][m]
            b = buckets.get(c)
            if b is None:
                buckets[c] = [p]
            else:
                b.append(p)
            safe_n += 1
        if safe_n == 0:
            continue
        val = 0.0
        for c, sub in buckets.items():
            cbc[m] = c
            val += (len(sub) / total) * V(mask | (1 << m), cbc, tuple(sub), score + SCORE[c])
            del cbc[m]
        if val > best:
            best = val
            if best >= 0.9999999:
                break
    memo[k] = best
    return best


def first_click_value(m):
    cons = tuple(p for p in range(len(P)) if not (P[p] >> m) & 1)
    buckets = {}
    for p in cons:
        buckets.setdefault(CNT[p][m], []).append(p)
    total = len(P)
    val = 0.0
    for c, sub in buckets.items():
        val += (len(sub) / total) * V(1 << m, {m: c}, tuple(sub), SCORE[c])
    return val


if __name__ == "__main__":
    cells = [int(x) for x in sys.argv[1:]] or [0, 1, 6, 7]
    for m in cells:
        v = first_click_value(m)
        r, c = divmod(m, C)
        print(f"first ({r},{c}): P(win) = {v:.6f}   conditional-on-safe = {v/0.8:.6f}"
              f"   states={nodes} t={time.time()-t0:.1f}s", flush=True)
