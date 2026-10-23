"""
Price bridge: a running MetaTrader 5 terminal -> JSON lines on stdout (read by src/feed/Mt5LocalFeed.ts).

Windows only (the MetaTrader5 package talks to the terminal over IPC). The terminal must be open and
logged in; this script never logs in, never stores credentials and never sends orders.

stdout (one JSON object per line):
  {"type":"ready","spec":{...},"account":{...}}
  {"type":"tick","msc":<server-time ms>,"bid":..,"ask":..}
  {"type":"status","connected":true|false}
  {"type":"history","id":..,"bars":[{"t":<server-time s>,"o":..,"h":..,"l":..,"c":..}]}
  {"type":"error","message":"..."}
stdin:
  {"id":1,"cmd":"history","n":200}     # last n closed M15 bars
"""
import argparse
import json
import sys
import threading
import time

import MetaTrader5 as mt5

out_lock = threading.Lock()


def emit(obj):
    with out_lock:
        sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def init(path):
    ok = mt5.initialize(path) if path else mt5.initialize()
    if not ok:
        emit({"type": "error", "message": f"mt5.initialize failed: {mt5.last_error()}"})
    return ok


def spec_of(symbol):
    s = mt5.symbol_info(symbol)
    a = mt5.account_info()
    if s is None or a is None:
        return None, None
    spec = {
        "symbol": s.name,
        "contractSize": s.trade_contract_size,
        "minVolume": s.volume_min,
        "maxVolume": s.volume_max,
        "volumeStep": s.volume_step,
        "digits": s.digits,
        "point": s.point,
        "stopsLevel": s.trade_stops_level,
        "swapLong": s.swap_long,
        "swapShort": s.swap_short,
        "leverage": a.leverage,
    }
    # trade_mode: 0 demo, 1 contest, 2 real
    account = {"login": a.login, "server": a.server, "company": a.company, "tradeMode": a.trade_mode}
    return spec, account


def commands(symbol):
    for line in sys.stdin:
        try:
            req = json.loads(line)
            if req.get("cmd") == "history":
                # pos 1 skips the M15 bar that is still forming.
                rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 1, int(req.get("n", 200)))
                bars = [] if rates is None else [
                    {"t": int(r["time"]), "o": float(r["open"]), "h": float(r["high"]), "l": float(r["low"]), "c": float(r["close"])}
                    for r in rates
                ]
                emit({"type": "history", "id": req.get("id"), "bars": bars})
        except Exception as e:  # keep the bridge alive; the Node side times out the request
            emit({"type": "error", "message": f"command failed: {e}"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--path", default="")
    ap.add_argument("--poll-ms", type=int, default=50)
    args = ap.parse_args()

    while not init(args.path):
        time.sleep(5)
    if not mt5.symbol_select(args.symbol, True):
        emit({"type": "error", "message": f"symbol {args.symbol} not available: {mt5.last_error()}"})
        sys.exit(3)
    spec, account = spec_of(args.symbol)
    if spec is None:
        emit({"type": "error", "message": f"symbol_info/account_info failed: {mt5.last_error()}"})
        sys.exit(3)
    emit({"type": "ready", "spec": spec, "account": account})
    threading.Thread(target=commands, args=(args.symbol,), daemon=True).start()

    last = mt5.symbol_info_tick(args.symbol)
    last_msc = int(last.time_msc) if last else 0
    sent_at_last = 0  # ticks already emitted that share last_msc
    if last and last.bid > 0 and last.ask > 0:
        emit({"type": "tick", "msc": last_msc, "bid": last.bid, "ask": last.ask})
        sent_at_last = 1
    connected = None
    next_status = 0.0

    while True:
        now = time.monotonic()
        if now >= next_status:
            info = mt5.terminal_info()
            c = bool(info and info.connected)
            if c != connected:
                connected = c
                emit({"type": "status", "connected": c})
            next_status = now + 1.0

        # Every bid/ask change since the last one we sent, so M1/M15 highs and lows are complete.
        ticks = mt5.copy_ticks_from(args.symbol, last_msc // 1000, 5000, mt5.COPY_TICKS_INFO)
        if ticks is None:
            emit({"type": "error", "message": f"copy_ticks_from failed: {mt5.last_error()}"})
            mt5.shutdown()
            time.sleep(2)
            init(args.path)
            continue
        same = 0
        for t in ticks:
            msc = int(t["time_msc"])
            if msc < last_msc:
                continue
            if msc == last_msc:
                same += 1
                if same <= sent_at_last:
                    continue
            bid, ask = float(t["bid"]), float(t["ask"])
            if bid <= 0 or ask <= 0:
                continue
            emit({"type": "tick", "msc": msc, "bid": bid, "ask": ask})
            if msc == last_msc:
                sent_at_last += 1
            else:
                last_msc, sent_at_last, same = msc, 1, 1
        time.sleep(args.poll_ms / 1000)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    finally:
        mt5.shutdown()
