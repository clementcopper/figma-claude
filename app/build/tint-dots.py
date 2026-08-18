"""Give the four flat dots the same vertical gradients Figma's own icon uses.

Each dot is one flat brand colour on a dark background. For every pixel the script works out how
much of the dot is in it — the anti-aliased rim is a blend of dot and background — and puts the
gradient colour back with exactly that coverage, so the edges stay as smooth as they were.
"""
import zlib, struct, pathlib, sys

def load(path):
    d = pathlib.Path(path).read_bytes()
    pos, idat, w, h, color = 8, b'', None, None, None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]; typ = d[pos+4:pos+8]; data = d[pos+8:pos+8+ln]
        if typ == b'IHDR': w, h, _, color = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT': idat += data
        elif typ == b'IEND': break
        pos += 12 + ln
    raw = zlib.decompress(idat); bpp = 4 if color == 6 else 3; stride = w * bpp
    out = bytearray(); prev = bytearray(stride); i = 0
    for _ in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i+stride]); i += stride
        if f == 1:
            for x in range(bpp, stride): line[x] = (line[x] + line[x-bpp]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0; b = prev[x]; c = prev[x-bpp] if x >= bpp else 0
                p = a + b - c; pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line; prev = line
    return w, h, bpp, bytearray(out)

CRC = None
def crc32(buf):
    global CRC
    if CRC is None:
        CRC = []
        for n in range(256):
            c = n
            for _ in range(8): c = 0xEDB88320 ^ (c >> 1) if c & 1 else c >> 1
            CRC.append(c)
    c = 0xFFFFFFFF
    for b in buf: c = CRC[(c ^ b) & 0xFF] ^ (c >> 8)
    return c ^ 0xFFFFFFFF

def save(path, w, h, px):
    stride = w * 4; raw = bytearray()
    for y in range(h):
        raw.append(0); raw += px[y*stride:(y+1)*stride]
    def chunk(t, d):
        body = t.encode() + d
        return struct.pack('>I', len(d)) + body + struct.pack('>I', crc32(body))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    pathlib.Path(path).write_bytes(
        b'\x89PNG\r\n\x1a\n' + chunk('IHDR', ihdr)
        + chunk('IDAT', zlib.compress(bytes(raw), 9)) + chunk('IEND', b''))

SRC, DST = sys.argv[1], sys.argv[2]
w, h, bpp, px = load(SRC)

# Measured from /Applications/Figma.app: each shape carries its own vertical gradient.
GRADIENTS = {
    (0xF2, 0x4E, 0x1E): ((0xFD, 0x36, 0x36), (0xEF, 0x2E, 0x2E)),  # rot
    (0xA2, 0x59, 0xFF): ((0x85, 0x4D, 0xFC), (0x75, 0x41, 0xE5)),  # violett
    (0x0A, 0xCF, 0x83): ((0x23, 0xC8, 0x6F), (0x32, 0xCF, 0x7A)),  # grün
    (0x1A, 0xBC, 0xFE): ((0x17, 0xBD, 0xFF), (0x06, 0xB6, 0xFD)),  # blau
}

def at(x, y):
    o = (y*w + x) * bpp
    return px[o], px[o+1], px[o+2], px[o+3]

# Bounding box per dot, from the flat colour.
boxes = {}
for y in range(h):
    for x in range(w):
        r, g, b, a = at(x, y)
        key = (r, g, b)
        if a > 250 and key in GRADIENTS:
            x0, y0, x1, y1 = boxes.get(key, (x, y, x, y))
            boxes[key] = (min(x0, x), min(y0, y), max(x1, x), max(y1, y))

for key, (x0, y0, x1, y1) in boxes.items():
    print(f'  #{key[0]:02X}{key[1]:02X}{key[2]:02X}  x {x0}–{x1}  y {y0}–{y1}')
    top, bottom = GRADIENTS[key]
    # A couple of pixels of margin, so the anti-aliased rim is included.
    for y in range(max(0, y0-3), min(h, y1+4)):
        t = (y - y0) / max(1, (y1 - y0))
        t = min(1.0, max(0.0, t))
        target = tuple(round(top[i] + (bottom[i]-top[i]) * t) for i in range(3))
        # Local background: a column left of the dots, same row — the body has its own gradient.
        bg = at(150, y)[:3]
        for x in range(max(0, x0-3), min(w, x1+4)):
            o = (y*w + x) * 4
            r, g, b, a = px[o], px[o+1], px[o+2], px[o+3]
            if a == 0:
                continue
            # Coverage: how much of the flat dot colour is in this pixel, per channel, where the
            # channel actually separates dot from background.
            cov, weight = 0.0, 0.0
            for i, (pv, dv, bv) in enumerate(zip((r, g, b), key, bg)):
                span = dv - bv
                if abs(span) < 24:
                    continue
                c = (pv - bv) / span
                cov += max(0.0, min(1.0, c)) * abs(span); weight += abs(span)
            if weight == 0:
                continue
            cov /= weight
            if cov <= 0.004:
                continue
            px[o]   = round(bg[0] + (target[0]-bg[0]) * cov)
            px[o+1] = round(bg[1] + (target[1]-bg[1]) * cov)
            px[o+2] = round(bg[2] + (target[2]-bg[2]) * cov)

save(DST, w, h, px)
print('wrote', DST)
