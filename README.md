# XAU Zone Trader

ระบบเทรด XAUUSDm (Exness Standard) จากโซน CME — Claude วางแผนวันละครั้ง, โค้ดที่ตายตัวเป็นคนเทรด

```
plan.json (Claude /plan) → Validator → Signal Engine (M15 Reject/Break) → Risk Gateway → Shadow | MetaAPI → Journal (SQLite) → Dashboard
```

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env          # ใส่ METAAPI_TOKEN, METAAPI_ACCOUNT_ID (+ Telegram ถ้าต้องการ)
npm run web:build             # build หน้า dashboard ครั้งแรก
npm run shadow                # รัน shadow กับราคาจริง → http://localhost:3000
```

### Windows: ราคาจาก MT5 บนเครื่อง (ไม่ใช้ MetaAPI)

```bat
pip install -r bridge/requirements.txt
:: เปิด MT5 ล็อกอินบัญชี Exness ทิ้งไว้ แล้ว
npm run shadow:mt5            :: หรือใส่ FEED=mt5 ใน .env แล้ว npm run shadow
```

`bridge/mt5_bridge.py` อ่านราคาอย่างเดียว ไม่ล็อกอินเอง ไม่เก็บรหัส ไม่ส่งออเดอร์ (live ยังต้องใช้ MetaAPI) —
MT5 ต้องเปิดอยู่ตลอด ถ้าปิด/หลุด ระบบจะไม่มีราคาและพยายามต่อใหม่ทุก 5 วินาที · ปิด sleep ของ Windows ด้วย ·
เวลาใน MT5 เป็นเวลาเซิร์ฟเวอร์ ระบบลบ `serverUtcOffsetHours` ออก ถ้า log บอกว่าเวลาเพี้ยน ให้แก้ค่านี้ก่อนเทรดต่อ

ทุกเช้า (ก่อนลอนดอนเปิด): เปิด Claude Code ในโฟลเดอร์นี้ → `/plan` พร้อมแนบข้อมูล QuikStrike (OI, intraday volume, IV) + ราคา GC และ XAUUSDm
→ ได้ `config/plans/YYYY-MM-DD.json` ที่ผ่าน `npm run plan:check` แล้ว ระบบโหลดเองเมื่อแท่ง M15 ถัดไปปิด

หลังตลาดปิด: `/review` เพื่อสรุปวัน → `data/reviews/YYYY-MM-DD.md`

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run shadow` | ราคาจริงจาก MetaAPI, ออเดอร์จำลอง (ShadowBroker) |
| `npm run shadow:mt5` | เหมือนกัน แต่ราคาจาก MT5 ที่เปิดอยู่บนเครื่อง (Windows) |
| `npm run live -- --confirm=real-money` | ออเดอร์จริง — **ถูกปฏิเสธจนกว่า shadow ผ่าน go-live gates ทุกข้อ** |
| `npm run backtest -- --data=<M1.csv> [--from= --to=]` | replay แผนที่บันทึกไว้บนข้อมูล M1 (เฉพาะวันที่มีไฟล์แผน) |
| `npm run replay -- --data=<M1.csv> [--plans=dir] [--delay=50]` | เล่นข้อมูลย้อนหลังผ่านระบบเต็มพร้อม dashboard (เดโม/ทดสอบ UI) |
| `npm run plan:check -- <date> [--price=]` | ตรวจไฟล์แผน (strict: ทุกโซนต้องผ่าน) |
| `npm run golive:check` | ดู go-live gates จากผล shadow |
| `npm run unkill -- --mode=shadow\|live` | ปลด kill switch (ทำได้จากเครื่องเท่านั้น) |
| `npm run day:report -- <date>` | JSON ของวันนั้น (ใช้โดย `/review`) |
| `npm run check` | typecheck + tests + build เว็บ |

ข้อมูล M1: MT5 → View → Symbols → Bars → Export (ไฟล์ tab-separated มี `<SPREAD>`) หรือ CSV `time,open,high,low,close[,spread]` (เวลา UTC)

## หน่วยและต้นทุน

- **1 pt = $1 ของราคาทอง** — 0.01 lot × 1 pt = $1 (contract 100 oz)
- BUY เข้าที่ ask ออกที่ bid, SELL กลับกัน; SL จ่าย slippage `slSlippage` (0.2) เสมอ; แท่งที่แตะทั้ง SL และ TP นับเป็น SL
- Spread ใน backtest ใช้ค่าที่วัดจริง (p75 ต่อชั่วโมงจาก shadow/live) ถ้ามี ไม่งั้นใช้ `defaultSpread`
- ตอนเริ่ม shadow/live ระบบเทียบ `config/broker_profile.json` กับ spec จริงใน MT5 — ค่า critical ไม่ตรง (symbol, contract, lot step, digits) = ไม่ยอมเริ่ม

## Risk Gateway (`config/risk.json`)

ทุกออเดอร์ผ่านจุดเดียว: kill switch → equity floor → ใกล้ปิดสุดสัปดาห์ → ข่าว (ปฏิทินโหลดไม่ได้ = ไม่เทรด) → spread → cooldown หลัง SL (ทั้งสองฝั่ง) → ลิมิตรายวัน → จำนวน position → ห้ามเพิ่มไม้ฝั่งที่ขาดทุน → SL/TP ถูกฝั่ง → SL ≤ 10 pts → R:R ≥ 1.5 → lot 0.01 คงที่ → ขาดทุนรวมวันนี้ + ความเสี่ยงไม้นี้ ≤ $20 → margin

ระบบปิดทุกออเดอร์เองเมื่อ equity < $60 (kill switch) และก่อนตลาดปิดวันศุกร์ 60 นาที

## หมายเหตุ

- ปฏิทินข่าวใช้ ForexFactory weekly JSON (ไม่ใช่ feed ทางการ) — backtest ไม่มีข่าวย้อนหลัง ใช้ได้แค่ `newsBlackout` ในไฟล์แผน
- `weekendClose` (ศ. 20:55 UTC) และ `serverUtcOffsetHours` (0) ใน broker profile ยังไม่ได้ยืนยันกับบัญชีจริง — ตรวจใน MT5 ก่อนรันยาว
- `npm audit` แจ้งช่องโหว่ใน dependency ของ `metaapi.cloud-sdk` (axios, crypto-js, lodash) — ห้าม `npm audit fix --force` เพราะอาจทำ SDK พัง; อัปเดต SDK เมื่อมีเวอร์ชันใหม่
