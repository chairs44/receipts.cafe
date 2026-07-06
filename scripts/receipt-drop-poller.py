#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError


URL = os.environ.get("RECEIPT_DROP_URL", "").rstrip("/")
TOKEN = os.environ.get("RECEIPT_DROP_TOKEN", "")
INTERVAL = int(os.environ.get("RECEIPT_DROP_INTERVAL", "30"))
PRINTER = os.environ.get("RECEIPT_DROP_PRINTER", "EPSON_TM_T88V")
PRINT_MODE = os.environ.get("RECEIPT_DROP_PRINT_MODE", "ssh")
SSH_HOST = os.environ.get("RECEIPT_DROP_SSH_HOST", "ds-mbp")
REQUIRE_USB = os.environ.get("RECEIPT_DROP_REQUIRE_USB", "1") != "0"
USB_MATCH = os.environ.get("RECEIPT_DROP_USB_MATCH", "TM-T88V EPSON")


def center(text, width=32):
    return "\n".join(line.center(width) for line in text.splitlines())


def wrap(text, width=32):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def render(item):
    lines = [
        center("RECEIPT.CAFE"),
        "-" * 32,
        *wrap(item["message"]),
        "-" * 32,
        center(item["createdAt"][:16].replace("T", " ")),
        "",
        "",
    ]
    return "\n".join(lines)


def post_json(path, body):
    req = Request(
        f"{URL}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def poll():
    return post_json("/api/poll", {})


def ack(item, raw_item=None):
    return post_json("/api/ack", {"item": item, "rawItem": raw_item})


def fail(item, reason, raw_item=None, requeue=True):
    return post_json(
        "/api/fail",
        {
            "item": item,
            "rawItem": raw_item,
            "reason": reason,
            "requeue": requeue,
        },
    )


def printer_online():
    result = subprocess.run(
        ["lpstat", "-p", PRINTER, "-a", PRINTER],
        capture_output=True,
        text=True,
    )
    output = f"{result.stdout}\n{result.stderr}".lower()
    queue_ready = (
        result.returncode == 0
        and "accepting requests" in output
        and "disabled" not in output
        and "not accepting" not in output
    )
    if not queue_ready:
        return False

    if not REQUIRE_USB:
        return True

    usb = subprocess.run(
        ["ioreg", "-p", "IOUSB", "-l", "-w0"],
        capture_output=True,
        text=True,
    )
    usb_output = f"{usb.stdout}\n{usb.stderr}".lower()
    return usb.returncode == 0 and all(
        term.lower() in usb_output for term in USB_MATCH.split()
    )


def send_heartbeat(online):
    post_json(
        "/api/heartbeat",
        {
            "printerOnline": online,
            "printer": PRINTER,
        },
    )


def print_text(text):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as f:
        f.write(text)
        temp = Path(f.name)
    try:
        if PRINT_MODE == "local":
            subprocess.run(["lp", "-d", PRINTER, str(temp)], check=True)
        else:
            remote = f"/tmp/receipt-drop-{temp.name}"
            subprocess.run(["scp", str(temp), f"{SSH_HOST}:{remote}"], check=True)
            subprocess.run(
                ["ssh", SSH_HOST, f"lp -d {PRINTER} {remote}; status=$?; rm -f {remote}; exit $status"],
                check=True,
            )
    finally:
        temp.unlink(missing_ok=True)


def print_and_ack(item, raw_item=None):
    try:
        print_text(render(item))
    except Exception as exc:
        reason = f"{type(exc).__name__}: {exc}"
        print(f"print failed for {item.get('id')}: {reason}", flush=True)
        try:
            fail(item, reason, raw_item)
        except Exception as fail_exc:
            print(f"fail endpoint error for {item.get('id')}: {fail_exc}", flush=True)
        return

    try:
        ack(item, raw_item)
        print(f"printed and acked {item.get('id')}", flush=True)
    except Exception as ack_exc:
        print(f"ack endpoint error for {item.get('id')}: {ack_exc}", flush=True)


def main():
    if not URL or not TOKEN:
        raise SystemExit("Set RECEIPT_DROP_URL and RECEIPT_DROP_TOKEN.")
    while True:
        try:
            online = printer_online()
            try:
                send_heartbeat(online)
            except URLError as exc:
                print(f"heartbeat error: {exc}", flush=True)

            if not online:
                print(f"{PRINTER} is offline; leaving queued messages in Redis.", flush=True)
                time.sleep(INTERVAL)
                continue

            data = poll()
            item = data.get("item")
            if item:
                print_and_ack(item, data.get("rawItem"))
                time.sleep(8)
            else:
                time.sleep(INTERVAL)
        except Exception as exc:
            print(f"poll error: {exc}", flush=True)
            time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
