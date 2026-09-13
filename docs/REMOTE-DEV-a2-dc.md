# ทำงาน 9router บน a2-dc

เครื่อง dev remote คือ `a2-dc` (hostname `a2`, macOS 15.6.1, node v22.22.0, npm 10.9.4).
repo อยู่ที่ `/Users/a2/Documents/Github/9router`

## เข้าเครื่อง

```bash
dc 9router          # ssh + tmux attach session ชื่อ "9router"
cd 9router          # ← ต้อง cd เอง, dc พาไปแค่ Documents/Github
```

`dc` (`~/.zshrc:27`) ทำแค่:
```
ssh -t a2-dc tmux new-session -A -s "$1" -c /Users/a2/Documents/Github
```
ชื่อ session = argument ตัวแรก ไม่เกี่ยวกับ folder ใดๆ `-A` = attach ถ้ามีอยู่แล้ว ไม่งั้นสร้างใหม่

## remote ชื่อไม่เหมือนเครื่อง local — ระวัง

| | local (เครื่อง jintawat) | a2-dc |
|---|---|---|
| fork ของเรา | `infi` | `origin` |
| upstream decolua | `origin` | `upstream` |

**ที่ a2-dc `origin` = fork ของเรา** ดังนั้น `git push origin` บน a2-dc ปลอดภัย
แต่ถ้าเคยชินจาก local จะสลับกัน เช็ค `git remote -v` ก่อนทุกครั้งที่ push

## pull งานที่ push ไว้

```bash
cd /Users/a2/Documents/Github/9router
git fetch origin
git checkout fix/responses-re2-schema-sanitize
```

## setup ครั้งแรก

```bash
npm install                       # root deps (ต้องทำก่อน tests เสมอ)
cd tests && npm install && cd ..  # vitest
cp .env.example .env              # แล้วแก้ค่าตาม "secrets" ข้างล่าง
```

## รัน

```bash
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
# dashboard: /dashboard   API: /v1
```

## test

```bash
cd tests && npx vitest run                                  # ทั้งหมด
cd tests && npx vitest run translator/schema-re2-sanitize.test.js  # ไฟล์เดียว
```

suite ไม่ได้เขียวหมดบน checkout สะอาด (~938 pass / ~64 fail เป็นปกติ)
ตัดสิน regression ด้วย `tests/__baseline__/verify-no-regression.mjs` ไม่ใช่ผลรันดิบ
รายละเอียดว่าตัวไหนแดงเป็นปกติอยู่ใน `CLAUDE.md`

## secrets — ย้ายมือ ไม่ commit

`.gitignore:37` มี `.env*` อยู่แล้ว secrets ทุกตัว**ไม่เคยอยู่ใน git** ต้องย้ายเอง
ดูขั้นตอนที่ `docs/REMOTE-DEV-secrets.md`

สรุปสั้น: ของอยู่ 2 ที่
1. `.env` ใน repo — ค่า config
2. `~/.9router/` — state ตอน runtime (`jwt-secret`, `machine-id`, `auth/cli-secret`, `db/data.sqlite`)

**a2-dc ยังไม่มี `~/.9router/` เลย** ถ้าไม่ copy ไป server จะสร้างใหม่ให้ = account/key ที่เคย OAuth ไว้หายหมด

## เรื่องที่ต้องรู้ก่อนทำงานต่อ

- **OAuth เพิ่ม account จากเครื่องอื่นไม่ได้** — `src/shared/components/OAuthModal.js:300` สร้าง
  `redirect_uri` จาก `window.location.port` คือ localhost ของ**เบราว์เซอร์** ไม่ใช่ของ server
  เปิด `http://10.x.x.x:20128/dashboard` จาก laptop → callback วิ่งกลับมาที่ laptop ที่ไม่มีอะไรรันอยู่
  วิธีแก้: `ssh -L 20128:localhost:20128 a2-dc` แล้วเปิด `http://localhost:20128/dashboard`
- **`REQUIRE_API_KEY` ใน `.env` ไม่มีใครอ่าน** — ทั้ง repo เจอที่เดียวคือ `.env.example:19`
  ค่าจริงคือ `requireApiKey` ใน sqlite (`src/lib/db/repos/settingsRepo.js:27`, default `true`) ตั้งจาก dashboard
- **DB ไม่ได้เข้ารหัส** — `grep -rn "encrypt" src/lib/db/` ไม่เจออะไรเลย
  `data.sqlite` เก็บ OAuth token เป็น plaintext ระวังตอน copy / backup
