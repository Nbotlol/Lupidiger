"""Exact optimal-play solver (maximise win probability) for the game.

Rules: 4x5, 4 mines, click mine = lose, safe cell scores 1/5/20 by adjacent
count (0 / 1-2 / 3-4), reach >30 to win, must keep playing until then.
First click: every cell is a legal first click (no safe-first-click rule) --
we compute the exact optimal win probability from the empty board.
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

memo = {}
nodes = 0
t0 = time.time()

def V(mask, counts, cons, score):
    """cons: tuple of indices of placements consistent with observations."""
    global nodes
    if score > 30:
        return 1.0
    key = (mask, counts)
    hit = memo.get(key)
    if hit is not None:
        return hit
    nodes += 1
    avail = [i for i in range(N) if not (mask >> i) & 1]
    if not avail:
        memo[key] = 0.0
        return 0.0
    total = len(cons)
    best = 0.0
    for m in avail:
        buckets = {}
        for p in cons:
            if (P[p] >> m) & 1:
                continue                      # clicking m would hit a mine
            c = CNT[p][m]
            buckets.setdefault(c, []).append(p)
        safe_n = sum(len(b) for b in buckets.values())
        if safe_n == 0:
            continue
        # optimistic bound: if even a perfect continuation cannot beat best, skip
        val = 0.0
        for c, sub in buckets.items():
            val += (len(sub) / total) * V(mask | (1 << m), counts + (c,), tuple(sub), score + SCORE[c])
        if val > best:
            best = val
            if best > 0.999999:
                break
    memo[key] = best
    return best

if __name__ == "__main__":
    prior = tuple(range(len(P)))
    best_cell = None
    best_val = -1
    for m in range(N):
        buckets = {}
        for p in prior:
            if (P[p] >> m) & 1:
                continue
            c = CNT[p][m]
            buckets.setdefault(c, []).append(p)
        total = len(prior)
        val = 0.0
        for c, sub in buckets.items():
            val += (len(sub) / total) * V(1 << m, (c,), tuple(sub), SCORE[c])
        r, cc = divmod(m, C)
        print(f"first click ({r},{cc}): win prob {val:.6f}   states={nodes}  t={time.time()-t0:.1f}s", flush=True)
        if val > best_val:
            best_val, best_cell = val, m
    print("BEST first click:", divmod(best_cell, C), "P(win) =", best_val, "states:", nodes, "time:", time.time()-t0)
