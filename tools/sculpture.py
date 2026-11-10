"""Sculpture du corps : déplacements le long des normales (en mètres).
Chaque forme = (x, y, demi-largeur, demi-hauteur, côté, amplitude[, symétrique]) ;
côté : 'av' (devant), 'ar' (derrière), 'ext' (vers l'extérieur), 'tout'.
Les formes MAINTENANT reprennent ce qu'on voit sur les photos (face, profil, dos) ;
les formes OBJECTIF dessinent le corps visé (≈ 86 kg, sec).
"""
import numpy as np

from sculpter_corps import normales

MAINTENANT = [
    # poitrine : pecs avec du gras, un peu tombants
    (0.090, 1.335, 0.085, 0.060, "av", 0.014),
    (0.095, 1.305, 0.070, 0.032, "av", 0.008),
    (0.070, 1.385, 0.070, 0.030, "av", 0.004),    # haut de la poitrine
    (0.100, 1.282, 0.075, 0.014, "av", -0.003),   # pli sous les pecs
    (0.105, 1.322, 0.009, 0.008, "av", 0.0018),   # tétons
    (0.000, 1.330, 0.012, 0.060, "av", -0.004),   # creux du sternum
    # ventre : rond, surtout sous le nombril, qui déborde sur l'élastique
    (0.000, 1.190, 0.110, 0.060, "av", 0.010),
    (0.000, 1.090, 0.140, 0.100, "av", 0.030),
    (0.000, 1.030, 0.120, 0.035, "av", 0.010),
    (0.000, 1.100, 0.011, 0.011, "av", -0.012),   # nombril
    (0.000, 1.088, 0.020, 0.006, "av", -0.003),   # petit pli sous le nombril
    # poignées d'amour et bas du dos
    (0.165, 1.040, 0.050, 0.050, "ext", 0.015),
    (0.120, 1.050, 0.060, 0.050, "ar", 0.010),
    (0.000, 1.080, 0.120, 0.070, "ar", 0.006),
    # épaules et bras assez costauds
    (0.215, 1.400, 0.045, 0.050, "tout", 0.008),
    (0.225, 1.270, 0.040, 0.080, "tout", 0.007),
    # cuisses, fessiers
    (0.090, 0.700, 0.070, 0.120, "tout", 0.006),
    (0.070, 0.900, 0.080, 0.080, "ar", 0.004),
]

OBJECTIF = [
    # pecs fermes au bord bien dessiné
    (0.095, 1.345, 0.075, 0.050, "av", 0.012),
    (0.100, 1.298, 0.080, 0.010, "av", -0.006),
    (0.000, 1.340, 0.010, 0.070, "av", -0.006),
    (0.105, 1.332, 0.007, 0.007, "av", 0.002),
    # ventre plat
    (0.000, 1.080, 0.130, 0.090, "av", -0.012),
    (0.000, 1.097, 0.009, 0.009, "av", -0.006),
    # abdos : 6 blocs, ligne blanche, intersections
    (0.032, 1.205, 0.024, 0.022, "av", 0.0065),
    (0.032, 1.150, 0.024, 0.022, "av", 0.0065),
    (0.032, 1.095, 0.024, 0.024, "av", 0.0055),
    (0.000, 1.140, 0.007, 0.100, "av", -0.006),
    (0.000, 1.177, 0.060, 0.006, "av", -0.004),
    (0.000, 1.122, 0.060, 0.006, "av", -0.004),
    # ligne en V (bas du ventre vers l'aine)
    (0.105, 1.060, 0.012, 0.020, "av", -0.004),
    (0.085, 1.030, 0.012, 0.020, "av", -0.004),
    (0.065, 1.000, 0.012, 0.020, "av", -0.003),
    # obliques et dentelés
    (0.140, 1.120, 0.030, 0.060, "ext", 0.003),
    (0.135, 1.250, 0.020, 0.012, "ext", 0.002),
    (0.135, 1.225, 0.020, 0.012, "ext", 0.002),
    # plus de poignées d'amour
    (0.165, 1.040, 0.050, 0.050, "ext", -0.008),
    (0.000, 1.080, 0.120, 0.070, "ar", -0.004),
    # épaules, bras, dos en V
    (0.215, 1.400, 0.045, 0.050, "tout", 0.013),
    (0.225, 1.290, 0.035, 0.050, "av", 0.008),    # biceps
    (0.230, 1.270, 0.035, 0.070, "ar", 0.007),    # triceps
    (0.160, 1.270, 0.040, 0.080, "ext", 0.006),   # dorsaux
    (0.090, 0.700, 0.060, 0.110, "tout", 0.003),
]


def affiner_silhouette(P):
    """Même affinage que la cible de poids de l'hologramme (taille, ventre, hanches…)."""
    P = P.copy()
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    torse = (y > 0.9) & (y < 1.25) & (np.abs(x) < 0.17)
    cx, cz = x[torse].mean(), z[torse].mean()
    ax = np.abs(x - cx)
    t = np.clip((0.26 - ax) / (0.26 - 0.15), 0, 1)
    tor = t * t * (3 - 2 * t)
    g = lambda c, s: np.exp(-(((y - c) / s) ** 2))
    k = 0.025 + tor * (0.11 * g(1.02, 0.17) + 0.04 * g(1.30, 0.14) + 0.06 * g(0.86, 0.12)) + 0.05 * g(0.62, 0.16) + 0.035 * g(1.58, 0.08)
    front = np.where(z > cz, 1.35, 0.8)
    P[:, 0] = cx + (x - cx) * (1 - k)
    P[:, 2] = cz + (z - cz) * (1 - k * front)
    return P


def champ(P, N, formes):
    d = np.zeros(len(P))
    x, y = P[:, 0], P[:, 1]
    for f in formes:
        cx, cy, rx, ry, cote, amp = f[:6]
        for sx in ((-1, 1) if cx != 0 else (1,)):
            g = np.exp(-(((x - sx * cx) / rx) ** 2 + ((y - cy) / ry) ** 2))
            if cote == "av":
                w = np.clip(N[:, 2], 0, 1)
            elif cote == "ar":
                w = np.clip(-N[:, 2], 0, 1)
            elif cote == "ext":
                w = np.clip(sx * N[:, 0], 0, 1) if cx != 0 else np.abs(N[:, 0])
            else:
                w = 1.0
            d += amp * g * w
    return d


def sculpter(P, T, parts):
    n0 = parts[0][1]
    Tb = T[(T < n0).all(1)]
    out = []
    for formes, base in ((MAINTENANT, P), (OBJECTIF, affiner_silhouette(P))):
        Q = base.copy()
        N = normales(Q[:n0], Tb)
        Q[:n0] += N * champ(Q[:n0], N, formes)[:, None]
        # cheveux / barbe / boxer suivent le corps : on les laisse comme la base
        out.append(Q)
    return out
