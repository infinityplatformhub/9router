# ย้าย secrets ไป a2-dc (มือ, ไม่ผ่าน git)

secrets **ไม่เคยอยู่ใน git** — `.gitignore:37` มี `.env*` ดังนั้น clone ปลายทางจะไม่มีอะไรเลย
เอกสารนี้คือขั้นตอนย้ายมือ อ่านทั้งไฟล์ก่อนรัน

## ของที่ต้องย้าย

| ที่อยู่ (local) | คืออะไร | ต้องย้ายไหม |
|---|---|---|
| `<repo>/.env` | config ตอน build/run | ใช่ ถ้ามี |
| `~/.9router/jwt-secret` | 64B เซ็น session cookie | ใช่ ถ้าอยากให้ login เดิมใช้ได้ (แต่ `JWT_SECRET` ใน `.env` ชนะไฟล์นี้ — `dashboardSession.js:12`) |
| `~/.9router/machine-id` | 64B ผูก API key กับเครื่อง | **ดูหมายเหตุ** |
| `~/.9router/auth/cli-secret` | 64B ให้ CLI คุยกับ server | ใช่ ถ้าใช้ CLI |
| `~/.9router/db/data.sqlite` | ~20MB — account, OAuth token, API key, usage | ใช่ ถ้าไม่อยาก OAuth ใหม่ทั้งหมด |

ทั้ง 3 ไฟล์ `-rw-------` (600) — รักษา permission ตอนย้ายด้วย

## ⚠️ อ่านก่อนรันอะไร

**1. `data.sqlite` ไม่ได้เข้ารหัส** — `grep -rn "encrypt" src/lib/db/` ไม่เจออะไรเลย
OAuth token ทุกตัวเป็น plaintext ในไฟล์นี้ ถ้าหลุดคือหลุดทุก account
ห้ามวางไว้ที่ `/tmp` ห้ามส่งผ่าน channel ที่ไม่เข้ารหัส ใช้ `scp` (ssh) เท่านั้น

**2. copy ทับ = ทับของเดิมที่ปลายทาง** ตอนนี้ a2-dc ยังไม่มี `~/.9router/` เลย จึงปลอดภัย
แต่ถ้ารันซ้ำรอบสอง**หลังจาก**ใช้งานที่ a2-dc ไปแล้ว จะทับ state ที่นั่นทิ้ง — script ข้างล่าง backup ให้ก่อน

**3. ปิด server ทั้งสองฝั่งก่อน copy sqlite** copy ไฟล์ sqlite ตอนมีคนเขียนอยู่ = ได้ไฟล์พัง
เช็ค: `ps aux | grep -i 9router`

**4. `machine-id` — ตัดสินใจก่อน** `apiKeysRepo.js:28` ผูก API key เข้ากับ `machineId`
- copy ไป = API key เดิมใช้ได้ต่อที่ a2-dc **แต่สองเครื่องจะมี machine-id เดียวกัน**
  ถ้ารันพร้อมกันทั้งคู่ usage/key จะปนกัน
- ไม่ copy = a2-dc สร้างใหม่ ต้องออก API key ใหม่ที่นั่น แต่แยกกันสะอาด

ถ้า a2-dc จะมาแทนเครื่อง local → copy
ถ้าจะรันคู่ขนาน → **อย่า copy** ปล่อยให้สร้างใหม่

## ขั้นตอน

### 1. ปิด server ทั้งสองฝั่ง

```bash
ps aux | grep -i "9router\|20128" | grep -v grep
ssh a2-dc 'ps aux | grep -i "9router\|20128" | grep -v grep'
```
เจออะไรให้ปิดก่อน

### 2. สร้าง dir ปลายทาง + backup ถ้ามีของเดิม

```bash
ssh a2-dc 'if [ -d ~/.9router ]; then
  cp -a ~/.9router ~/.9router.bak.$(date +%Y%m%d-%H%M%S) && echo "backed up"
fi
mkdir -p ~/.9router/auth ~/.9router/db
chmod 700 ~/.9router ~/.9router/auth'
```

### 3. copy ทีละไฟล์ (`-p` รักษา permission)

```bash
cd /Users/jintawattuitemwong/Documents/GitHub/9router

# .env — ถ้ามี
[ -f .env ] && scp -p .env a2-dc:/Users/a2/Documents/Github/9router/.env

# secrets
scp -p ~/.9router/jwt-secret       a2-dc:'~/.9router/jwt-secret'
scp -p ~/.9router/auth/cli-secret  a2-dc:'~/.9router/auth/cli-secret'

# machine-id — ข้ามถ้าจะรันคู่ขนาน (ดูหมายเหตุ 4)
scp -p ~/.9router/machine-id       a2-dc:'~/.9router/machine-id'

# sqlite — ตัวใหญ่สุด ~20MB
scp -p ~/.9router/db/data.sqlite   a2-dc:'~/.9router/db/data.sqlite'
```

### 4. ตรวจ

```bash
ssh a2-dc 'ls -la ~/.9router ~/.9router/auth ~/.9router/db'
```
ต้องเห็น `-rw-------` บน 3 ไฟล์ secret

เทียบ checksum ว่าไฟล์ไม่เพี้ยน:
```bash
shasum -a256 ~/.9router/db/data.sqlite
ssh a2-dc 'shasum -a256 ~/.9router/db/data.sqlite'
```
สองค่าต้องตรงกัน

### 5. เช็คว่า sqlite อ่านได้จริง

```bash
ssh a2-dc 'sqlite3 ~/.9router/db/data.sqlite "PRAGMA integrity_check;"'
```
ต้องได้ `ok`

## ถ้าจะไม่ copy sqlite

ก็ได้ — server จะ migrate สร้าง schema ใหม่ให้เอง (`src/lib/db/migrations/001-initial.js`
เป็น `CREATE TABLE IF NOT EXISTS` ล้วน) แต่ต้อง OAuth ทุก account ใหม่ ซึ่งติดปัญหา
redirect_uri ข้างล่าง

## OAuth ที่ a2-dc — ต้องใช้ tunnel

`OAuthModal.js:300` สร้าง `redirect_uri = http://localhost:<port>/callback` จาก
`window.location.port` คือ localhost ของ**เบราว์เซอร์** ไม่ใช่ของ server
เปิด dashboard ผ่าน IP ตรงๆ แล้ว OAuth จะ callback กลับมาที่เครื่องตัวเองที่ไม่มีอะไรรันอยู่

```bash
ssh -L 20128:localhost:20128 a2-dc
# แล้วเปิด http://localhost:20128/dashboard บนเบราว์เซอร์เครื่องตัวเอง
```
พอ tunnel แล้ว localhost ของเบราว์เซอร์กับของ server เป็นตัวเดียวกัน flow ทำงานปกติ
