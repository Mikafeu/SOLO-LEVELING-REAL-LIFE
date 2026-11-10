"""Ajuste le modèle 3D aux proportions mesurées sur les photos (face + profil)
et l'écrit au format compact de l'app (assets/corps.bin).

Usage : python3 tools/ajuster_corps.py avatar.glb assets/corps.bin

Les rapports ci-dessous viennent de la comparaison photo / rendu du modèle
à la même échelle (sommet du crâne et entrejambe alignés).
"""
import json
import struct
import sys

import numpy as np

# ---- rapports mesurés (photo / modèle) ----
PROFIL = {
    # hauteur (m) : (largeur torse, profondeur avant, profondeur arrière)
    1.42: (1.00, 1.00, 1.00),
    1.32: (1.06, 1.12, 1.04),   # poitrine plus projetée, dos plus large
    1.22: (1.07, 1.10, 1.02),
    1.12: (1.10, 1.16, 1.00),   # ventre
    1.04: (1.08, 1.16, 0.96),
    0.96: (0.95, 1.04, 0.85),   # hanches / fessiers plus fins
    0.88: (0.93, 0.97, 0.88),
}
JAMBES = 0.86        # cuisses / jambes plus fines et plus serrées (x)
JAMBES_Z = 0.92
BRAS_ANGLE = np.radians(4.5)  # bras plus près du corps
TETE = 0.92          # tête un peu plus petite
# demi-largeur du torse (au-delà = bras), mesurée sur le rendu de face
LIMITE_BRAS = [(1.33, 0.165), (1.29, 0.162), (1.13, 0.178), (1.01, 0.21), (0.88, 0.223), (0.80, 0.23)]


def lire(chemin):
    b = open(chemin, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20 : 20 + jl])
    binc = b[20 + jl + 8 :]

    def acc(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        n = {"SCALAR": 1, "VEC3": 3}[a["type"]]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a["componentType"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        x = np.frombuffer(binc, dtype=dt, count=a["count"] * n, offset=o)
        return x.reshape(-1, n) if n > 1 else x

    P, I, parts, off = [], [], [], 0
    for p in j["meshes"][0]["primitives"]:
        pos = acc(p["attributes"]["POSITION"]).astype(np.float64)
        P.append(pos)
        I.append(acc(p["indices"]).astype(np.int64) + off)
        parts.append((off, len(pos)))
        off += len(pos)
    return np.vstack(P), np.concatenate(I), parts


def interp(table, y):
    ys = np.array(sorted(table))
    vals = np.array([table[k] for k in ys])
    return np.stack([np.interp(y, ys, vals[:, i]) for i in range(vals.shape[1])], 1)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def ajuster(P):
    P = P.copy()
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    torse = (y > 0.85) & (y < 1.25) & (np.abs(x) < 0.15)
    cz = z[torse].mean()

    # --- bras : poids 0 → 1 selon la position ---
    lim = np.interp(y, [a for a, _ in LIMITE_BRAS[::-1]], [b for _, b in LIMITE_BRAS[::-1]])
    bras = (np.abs(x) > lim) & (y > 0.6) & (y < 1.45)
    wb = bras * (1 - smooth(1.30, 1.44, y))

    # --- torse ---
    f = interp(PROFIL, y)
    wt = (1 - wb) * smooth(0.80, 0.90, y) * (1 - smooth(1.40, 1.50, y))
    sx = 1 + (f[:, 0] - 1) * wt
    front = z > cz
    sz = np.where(front, f[:, 1], f[:, 2])
    sz = 1 + (sz - 1) * wt
    nx = x * sx
    nz = cz + (z - cz) * sz

    # --- jambes ---
    wl = 1 - smooth(0.78, 0.92, y)
    nx = nx * (1 + (JAMBES - 1) * wl)
    nz = cz + (nz - cz) * (1 + (JAMBES_Z - 1) * wl)

    # --- bras : rotation vers le corps autour de l'épaule ---
    for s in (-1, 1):
        m = (wb > 0) & (np.sign(x) == s)
        px, py = s * 0.19, 1.44
        a = -s * BRAS_ANGLE * wb[m]
        dx, dy = nx[m] - px, y[m] - py
        # le bras suit aussi l'élargissement du torse à sa hauteur
        nx[m] = px + dx * np.cos(a) - dy * np.sin(a)
        y_new = py + dx * np.sin(a) + dy * np.cos(a)
        P[m, 1] = y_new
    # --- tête ---
    wh = smooth(1.50, 1.58, y)
    hz = z[(y > 1.6)].mean()
    k = 1 + (TETE - 1) * wh
    nx = nx * k
    nz = nz + (hz - nz) * (1 - k)
    P[:, 1] = np.where(wh > 0, 1.55 + (P[:, 1] - 1.55) * k, P[:, 1])
    P[:, 0], P[:, 2] = nx, nz
    return P


def ecrire(P, I, parts, sortie):
    mn, mx = P.min(0), P.max(0)
    q = np.round((P - mn) / (mx - mn) * 65535).astype(np.uint16)
    hdr = struct.pack("<4sIIIII", b"CORP", 1, len(P), len(I), len(parts), 0) + struct.pack("<6f", *mn, *mx)
    pt = b"".join(struct.pack("<II", a, c) for a, c in parts)
    open(sortie, "wb").write(hdr + pt + q.tobytes() + I.astype(np.uint16).tobytes())


if __name__ == "__main__":
    P, I, parts = lire(sys.argv[1])
    ecrire(ajuster(P), I, parts, sys.argv[2])
    print("ok", len(P), "sommets")
