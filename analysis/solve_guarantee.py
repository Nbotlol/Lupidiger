"""Exact worst-case (adversarial / information-theoretic) solvability search.

Rules modelled:
  * 4x5 board, exactly 4 mines.
  * Player clicks cells one at a time. Clicking a mine = immediate loss.
  * Safe cell scores: 0 adjacent mines -> 1, 1-2 -> 5, 3-4 -> 20.
  * score > 30  => win (stop immediately).
  * The player only learns the adjacency number of a revealed cell.
  * First click is guaranteed safe by design (mines avoid it).

Question: does a strategy exist that wins for EVERY mine layout?
"""
import sys
from itertools import combinations
from functools import lru_cache

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
print("placements", len(P), file=sys.stderr)

# counts[p][i] = adjacent mines of cell i under placement p (only valid for safe i)
CNT = []
for pm in P:
    row = []
    for i in range(N):
        row.append(bin(pm & NB[i]).count("1"))
    CNT.append(row)

SCORE = {0: 1, 1: 5, 2: 5, 3: 20, 4: 20}

def solve_all():
    """Return dict first_cell -> True/False (guaranteed win) and stats."""
    results = {}
    nodemap = {}

    def search(revealed_mask, cons, score):
        """cons: tuple of placement indices still consistent (all match revealed counts)."""
        if score > 30:
            return True
        key = (revealed_mask, cons)
        hit = nodemap.get(key)
        if hit is not None:
            return hit

        # safe moves: cells not in revealed_mask that are safe in EVERY consistent placement
        cand = 0
        unrevealed = ((1 << N) - 1) & ~revealed_mask
        if not cons:
            nodemap[key] = False
            return False
        common_safe = unrevealed
        for p in cons:
            common_safe &= ~P[p]
            if not common_safe:
                break
        ok = False
        if common_safe:
            # optional ordering: try corners/edges first
            cells = [i for i in range(N) if common_safe >> i & 1]
            cells.sort(key=lambda i: bin(NB[i]).count("1"))
            for m in cells:
                # observation buckets: count -> subset of placements
                buckets = {}
                for p in cons:
                    buckets.setdefault(CNT[p][m], []).append(p)
                branch_ok = True
                for cnt, sub in buckets.items():
                    if not search(revealed_mask | (1 << m), tuple(sub), score + SCORE[cnt]):
                        branch_ok = False
                        break
                if branch_ok:
                    ok = True
                    break
        nodemap[key] = ok
        return ok

    for first in range(N):
        cons = tuple(p for p in range(len(P)) if not (P[p] >> first) & 1)
        # dedupe observation buckets for first click (needed because score only matters,
        # but consistency depends on the actual count -> must branch)
        buckets = {}
        for p in cons:
            buckets.setdefault(CNT[p][first], []).append(p)
        ok = True
        for cnt, sub in buckets.items():
            if not search(1 << first, tuple(sub), SCORE[cnt]):
                ok = False
                break
        results[first] = ok
        print("first cell", divmod(first, C), "guaranteed win:", ok,
              "| nodes", len(nodemap), file=sys.stderr)
        sys.stderr.flush()
    return results

if __name__ == "__main__":
    res = solve_all()
    print(res)
