"""Fabrique le personnage 3D de l'app (assets/corps.bin) :
1. proportions mesurées sur les photos (tools/ajuster_corps.py) ;
2. maillage affiné (triangles ≤ 9 mm) puis lissé, pour pouvoir sculpter ;
3. deux sculptures : MAINTENANT (gras, pecs, ventre, poignées d'amour…)
   et OBJECTIF (ventre plat, abdos, pecs et épaules dessinés).
L'app passe de l'une à l'autre selon la progression du poids.

Usage : python3 tools/sculpter_corps.py tools/avatar-source.glb assets/corps.bin
"""
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from ajuster_corps import ajuster, lire  # noqa: E402

SEUIL = 0.009  # longueur max d'arête (m) après affinage


# ---------- affinage : découpe des arêtes trop longues (maillage conforme) ----------
def affiner(P, T, seuil, zone):
    P = [tuple(p) for p in P]
    tris = [tuple(t) for t in T]
    for _ in range(6):
        Pa = np.array(P)
        edges = {}
        for t in tris:
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                k = (a, b) if a < b else (b, a)
                if k not in edges:
                    edges[k] = None
        longues = [k for k in edges if np.linalg.norm(Pa[k[0]] - Pa[k[1]]) > seuil and zone(Pa[k[0]]) and zone(Pa[k[1]])]
        if not longues:
            break
        mid = {}
        for a, b in longues:
            mid[(a, b)] = len(P)
            P.append(tuple((Pa[a] + Pa[b]) / 2))
        nouv = []
        for t in tris:
            m = []
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                k = (a, b) if a < b else (b, a)
                m.append(mid.get(k))
            a, b, c = t
            mab, mbc, mca = m
            n = sum(x is not None for x in m)
            if n == 0:
                nouv.append(t)
            elif n == 3:
                nouv += [(a, mab, mca), (mab, b, mbc), (mca, mbc, c), (mab, mbc, mca)]
            elif n == 1:
                if mab is not None:
                    nouv += [(a, mab, c), (mab, b, c)]
                elif mbc is not None:
                    nouv += [(a, b, mbc), (a, mbc, c)]
                else:
                    nouv += [(a, b, mca), (mca, b, c)]
            else:  # 2 arêtes coupées
                if mab is None:
                    nouv += [(a, b, mbc), (a, mbc, mca), (mca, mbc, c)]
                elif mbc is None:
                    nouv += [(a, mab, mca), (mab, b, c), (mab, c, mca)]
                else:
                    nouv += [(a, mab, c), (mab, b, mbc), (mab, mbc, c)]
        tris = nouv
    return np.array(P), np.array(tris, dtype=np.int64)


def lisser(P, T, iters, bloque):
    """Lissage de Taubin (ne fait pas maigrir le modèle)."""
    n = len(P)
    rows = np.concatenate([T[:, 0], T[:, 1], T[:, 2], T[:, 1], T[:, 2], T[:, 0]])
    cols = np.concatenate([T[:, 1], T[:, 2], T[:, 0], T[:, 0], T[:, 1], T[:, 2]])
    deg = np.bincount(rows, minlength=n).astype(float)
    deg[deg == 0] = 1
    P = P.copy()
    for i in range(iters):
        for lam in (0.5, -0.53):
            acc = np.zeros_like(P)
            np.add.at(acc, rows, P[cols])
            L = acc / deg[:, None] - P
            L[bloque] = 0
            P = P + lam * L
    return P


def normales(P, T):
    N = np.zeros_like(P)
    f = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    for k in range(3):
        np.add.at(N, T[:, k], f)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def ecrire(Pnow, Pgoal, T, parts, sortie):
    allP = np.vstack([Pnow, Pgoal])
    mn, mx = allP.min(0), allP.max(0)
    q = lambda X: np.round((X - mn) / (mx - mn) * 65535).astype(np.uint16)
    hdr = struct.pack("<4sIIIII", b"CORP", 2, len(Pnow), T.size, len(parts), 0) + struct.pack("<6f", *mn, *mx)
    pt = b"".join(struct.pack("<II", a, c) for a, c in parts)
    open(sortie, "wb").write(hdr + pt + q(Pnow).tobytes() + q(Pgoal).tobytes() + T.astype(np.uint32).tobytes())


def preparer(source):
    P, I, parts = lire(source)
    P = ajuster(P)
    T = I.reshape(-1, 3)
    n0 = parts[0][1]
    corps = T[(T < n0).all(1)]
    autres = T[~(T < n0).all(1)]
    zone = lambda p: 0.25 < p[1] < 1.52  # torse, bras, jambes (pas la tête ni les pieds)
    Pc, Tc = affiner(P[:n0], corps, SEUIL, zone)
    nouveaux = np.arange(len(Pc)) >= n0
    # lissage : uniquement dans la zone affinée, bords et tête bloqués
    bloque = ~((Pc[:, 1] > 0.3) & (Pc[:, 1] < 1.48))
    Pc = lisser(Pc, Tc, 6, bloque)
    # torse : on efface les petits reliefs du modèle d'origine (on resculpte tout)
    torse = (Pc[:, 1] > 0.98) & (Pc[:, 1] < 1.42) & (np.abs(Pc[:, 0]) < 0.17)
    Pc = lisser(Pc, Tc, 14, ~torse)
    # on remet les autres parties (cheveux, barbe, boxer, ceinture) derrière
    decal = len(Pc) - n0
    P2 = np.vstack([Pc, P[n0:]])
    autres = autres + decal
    T2 = np.vstack([Tc, autres])
    parts2 = [(0, len(Pc))] + [(a + decal, c) for a, c in parts[1:]]
    return P2, T2, parts2


if __name__ == "__main__":
    from sculpture import sculpter  # noqa: E402

    P, T, parts = preparer(sys.argv[1])
    Pnow, Pgoal = sculpter(P, T, parts)
    ecrire(Pnow, Pgoal, T, parts, sys.argv[2])
    print("ok", len(P), "sommets", len(T), "triangles")
