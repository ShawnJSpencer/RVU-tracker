# fake iPhone video frames: Epic list small in a 1080x1920 portrait frame, soft, noisy, JPEG'd, dark surroundings
import sys, numpy as np, random
from PIL import Image, ImageFilter
S = sys.argv[1]
src = Image.open(S + '/epic.jpg').convert('RGB')
out = []
random.seed(1); np.random.seed(1)
for listw in [820, 650, 500]:
  for blur in [0.8, 1.6]:
    for rot in [0, 2.5]:
      W, H = 1080, 1920
      bg = Image.new('RGB', (W, H), (40, 38, 36))
      # monitor bezel + more white screen around the list
      sc = listw / src.width
      im = src.resize((listw, int(src.height * sc)), Image.LANCZOS)
      screen = Image.new('RGB', (int(listw * 1.6), int(im.height * 2.2)), (214, 216, 212))
      screen.paste(im, (int(listw * 0.05), int(im.height * 0.25)))
      if rot: screen = screen.rotate(rot, expand=True, fillcolor=(40, 38, 36))
      # place so the list lands inside the on-screen guide (top 6%-60% of screen ≈ video y 6%..60%)
      gx = int(W * 0.5 - listw * 0.55); gy = int(H * 0.33 - im.height * 0.75)
      bg.paste(screen, (gx - int(listw * 0.05), gy))
      # brightness falloff (screen glow vs dark room)
      a = np.asarray(bg.filter(ImageFilter.GaussianBlur(blur)), dtype=float)
      a += np.random.normal(0, 6, a.shape)
      a = np.clip(a, 0, 255).astype(np.uint8)
      name = f'{S}/sim/f_{listw}_{blur}_{rot}.jpg'
      Image.fromarray(a).save(name, quality=65)
      out.append(name)
print('\n'.join(out))
