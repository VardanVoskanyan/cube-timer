// Scramble generation and a sticker-level 3x3 cube model used to draw the scramble.
// Coordinates: x = right, y = up, z = front; each coordinate is -1, 0 or 1.

const FACES = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};
const FACE_NAMES = Object.keys(FACES);
const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const SUFFIXES = ["", "'", "2"];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Random-move scramble: never turns the same face twice in a row, and never
// three moves on one axis in a row (e.g. "R L R"), which would cancel out.
function generateScramble(length = 20) {
  const faces = [];
  while (faces.length < length) {
    const f = randomItem(FACE_NAMES);
    const last = faces[faces.length - 1];
    const prev = faces[faces.length - 2];
    if (f === last) continue;
    if (last && prev && AXIS[f] === AXIS[last] && AXIS[last] === AXIS[prev]) continue;
    faces.push(f);
  }
  return faces.map((f) => f + randomItem(SUFFIXES)).join(" ");
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// Rotate v by -90° about axis n (clockwise when looking at the face from outside).
function rotateCW(v, n) {
  const c = cross(n, v);
  const d = dot(n, v);
  return [-c[0] + n[0] * d, -c[1] + n[1] * d, -c[2] + n[2] * d];
}

function solvedCube() {
  const stickers = [];
  for (const face of FACE_NAMES) {
    const n = FACES[face];
    const free = [0, 1, 2].filter((i) => n[i] === 0);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const pos = [...n];
        pos[free[0]] = a;
        pos[free[1]] = b;
        stickers.push({ pos, normal: [...n], color: face });
      }
    }
  }
  return stickers;
}

function applyMove(stickers, move) {
  const n = FACES[move[0]];
  const turns = move[1] === "2" ? 2 : move[1] === "'" ? 3 : 1;
  for (const s of stickers) {
    if (dot(s.pos, n) !== 1) continue;
    for (let t = 0; t < turns; t++) {
      s.pos = rotateCW(s.pos, n);
      s.normal = rotateCW(s.normal, n);
    }
  }
}

function applyScramble(scramble) {
  const cube = solvedCube();
  for (const m of scramble.split(/\s+/).filter(Boolean)) applyMove(cube, m);
  return cube;
}

// Face grid position (row, col) as the face appears in the standard unfolded net:
//        U
//    L   F   R   B
//        D
function faceCell(s) {
  const [x, y, z] = s.pos;
  const [nx, ny, nz] = s.normal;
  if (ny === 1) return { face: "U", row: z + 1, col: x + 1 };
  if (ny === -1) return { face: "D", row: 1 - z, col: x + 1 };
  if (nz === 1) return { face: "F", row: 1 - y, col: x + 1 };
  if (nz === -1) return { face: "B", row: 1 - y, col: 1 - x };
  if (nx === 1) return { face: "R", row: 1 - y, col: 1 - z };
  return { face: "L", row: 1 - y, col: z + 1 };
}

// Returns { U: [[c,c,c],[...],[...]], ... } with color letters per face.
function cubeNet(scramble) {
  const net = {};
  for (const f of FACE_NAMES) net[f] = [[], [], []];
  for (const s of applyScramble(scramble)) {
    const { face, row, col } = faceCell(s);
    net[face][row][col] = s.color;
  }
  return net;
}
