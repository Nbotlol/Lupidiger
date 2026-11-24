"""Descriptive statistics: first-click values, how fast 30 points is reachable."""
from itertools import combinations
from collections import Counter

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

print("=== first-click value distribution by cell type ===")
for i in range(N):
    r, c = divmod(i, C)
    deg = bin(NB[i]).count("1")
    cnt = Counter(CNT[p][i] for p in range(len(P)))
    exp = sum(SCORE[k] * v for k, v in cnt.items()) / len(P)
    major = "corner" if deg == 3 else ("edge" if deg == 5 else "inner")
    print(f"({r},{c}) {major:6s} deg={deg}  E[score]={exp:5.2f}  " +
          " ".join(f"k{k}:{cnt[k]*100/len(P):5.1f}%" for k in range(5) if cnt[k]))

print("\n=== speed: fewest clicks to exceed 30, assuming perfect knowledge ===")
steps = Counter()
for pi, pm in enumerate(P):
    ms = {i for i in range(N) if (pm >> i) & 1}
    vals = sorted((SCORE[CNT[pi][i]] for i in range(N) if i not in ms), reverse=True)
    s = 0
    for k, v in enumerate(vals, 1):
        s += v
        if s > 30:
            steps[k] += 1
            break
print("clicks needed:", sorted(steps.items()))
print("mean clicks:", sum(k * v for k, v in steps.items()) / len(P))

print("\n=== score after revealing the k best cells (perfect knowledge) ===")
for k in range(1, 9):
    tot = []
    for pi, pm in enumerate(P):
        ms = {i for i in range(N) if (pm >> i) & 1}
        vals = sorted((SCORE[CNT[pi][i]] for i in range(N) if i not in ms), reverse=True)
        tot.append(sum(vals[:k]))
    print(f"k={k}: mean {sum(tot)/len(tot):6.2f}  min {min(tot):3d}  "
          f"P(>30)={100*sum(1 for t in tot if t > 30)/len(tot):5.1f}%")
