// Remove the dark-blue (#111827-ish) background from the logo image.
// Flood-fill from the edges so interior dark colors (face void, tunic) survive.
const sharp = require("sharp");
const fs = require("fs");

const SRC = "C:/Users/HP/Downloads/Gemini_Generated_Image_pslbbjpslbbjpslb.png";
const OUT = "public/logo.png";

function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

(async () => {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  // Sample background from the four corners.
  const at = (x, y) => [data[(y * W + x) * C], data[(y * W + x) * C + 1], data[(y * W + x) * C + 2]];
  const corners = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)];
  const bg = corners.reduce(
    (acc, c) => acc.map((v, i) => v + c[i] / corners.length),
    [0, 0, 0]
  );
  console.log("bg sample:", bg.map(Math.round));

  const TOL = 42; // color distance from bg to still count as background
  const removed = new Uint8Array(W * H); // 1 = background, to be made transparent
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (removed[i]) return;
    // Only expand through pixels close to the background color.
    if (colorDist(at(x, y), bg) > TOL) return;
    removed[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }

  while (queue.length) {
    const i = queue.pop();
    const x = i % W;
    const y = Math.floor(i / W);
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  let count = 0;
  for (let i = 0; i < W * H; i++) {
    if (removed[i]) {
      data[i * C + 3] = 0; // alpha
      count++;
    }
  }
  console.log("removed pixels:", count, "of", W * H, "=", (100 * count / (W * H)).toFixed(1) + "%");

  // Feather: for surviving pixels adjacent to removed ones, blend their alpha
  // down a touch so the medallion edge isn't a hard staircase.
  const edge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (removed[i]) continue;
      const isEdge =
        (x > 0 && removed[i - 1]) ||
        (x < W - 1 && removed[i + 1]) ||
        (y > 0 && removed[i - W]) ||
        (y < H - 1 && removed[i + W]);
      if (isEdge) edge[i] = 1;
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (edge[i]) data[i * C + 3] = Math.min(data[i * C + 3], 180);
  }

  fs.mkdirSync("public", { recursive: true });
  await sharp(data, { raw: { width: W, height: H, channels: C } })
    .trim() // crop transparent margins
    .png()
    .toFile(OUT);
  const out = sharp(OUT).metadata();
  console.log("wrote", OUT, "->", (await out).width, "x", (await out).height);
})();
