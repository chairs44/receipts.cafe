#!/usr/bin/env python3
import json
import os
import csv
import html
import shutil
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
ARCHIVE_DIR = Path(
    os.environ.get(
        "RECEIPT_DROP_ARCHIVE_DIR",
        "~/Library/Application Support/receipt.cafe/archive",
    )
).expanduser()
MIRROR_DIR = os.environ.get("RECEIPT_DROP_MIRROR_DIR", "").strip()
MIRROR_PATH = Path(MIRROR_DIR).expanduser() if MIRROR_DIR else None
CSV_FIELDS = [
    "id",
    "status",
    "created_at",
    "printed_at",
    "failed_at",
    "message",
    "reason",
    "receipt_text_path",
    "receipt_image_path",
]


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


def archive_slug(item, when=None):
    timestamp = (when or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    compact = timestamp.replace("-", "").replace(":", "").replace("T", "_").replace("Z", "")
    return f"{compact}_{item.get('id', 'unknown')}"


def archive_rel_dir(kind, when=None):
    timestamp = when or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    day = timestamp[:10]
    return Path(kind) / day[:4] / day[5:7] / day[8:10]


def ensure_archive_dirs():
    for rel in ("events", "receipts", "images", "exports"):
        (ARCHIVE_DIR / rel).mkdir(parents=True, exist_ok=True)
    if MIRROR_PATH:
        (MIRROR_PATH / "images").mkdir(parents=True, exist_ok=True)


def append_jsonl(name, record):
    ensure_archive_dirs()
    path = ARCHIVE_DIR / "events" / name
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def write_receipt_text(item, text, printed_at):
    rel = archive_rel_dir("receipts", printed_at) / f"{archive_slug(item, printed_at)}.txt"
    path = ARCHIVE_DIR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return rel


def write_receipt_svg(item, text, printed_at):
    lines = text.rstrip("\n").splitlines()
    width = 384
    line_height = 22
    top = 28
    height = max(180, top * 2 + line_height * len(lines))
    body = []
    for index, line in enumerate(lines):
        y = top + index * line_height
        body.append(
            f'<text x="192" y="{y}" text-anchor="middle">{html.escape(line)}</text>'
        )
    svg = "\n".join([
        '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="%s" viewBox="0 0 384 %s">' % (height, height),
        '<rect width="384" height="%s" fill="#fbfaf4"/>' % height,
        '<g font-family="Menlo, Consolas, monospace" font-size="18" fill="#111">',
        *body,
        "</g>",
        "</svg>",
        "",
    ])
    rel = archive_rel_dir("images", printed_at) / f"{archive_slug(item, printed_at)}.svg"
    path = ARCHIVE_DIR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")
    mirror_archive_file(rel)
    return rel


def update_csv(row):
    ensure_archive_dirs()
    path = ARCHIVE_DIR / "exports" / "receipt-cafe-log.csv"
    exists = path.exists()
    with path.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerow({field: row.get(field, "") for field in CSV_FIELDS})
    mirror_archive_file(Path("exports") / "receipt-cafe-log.csv", mirror_name="receipt-cafe-log.csv")


def mirror_archive_file(rel, mirror_name=None):
    if not MIRROR_PATH:
        return
    source = ARCHIVE_DIR / rel
    if not source.exists():
        return
    target = MIRROR_PATH / (mirror_name or rel)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    except Exception as exc:
        print(f"archive mirror error for {rel}: {exc}", flush=True)


def archive_claimed(item):
    append_jsonl("claimed.jsonl", {
        "status": "claimed",
        "claimed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "item": item,
    })


def archive_printed(item, text):
    printed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    text_rel = write_receipt_text(item, text, printed_at)
    image_rel = write_receipt_svg(item, text, printed_at)
    record = {
        "id": item.get("id", ""),
        "status": "printed",
        "created_at": item.get("createdAt", ""),
        "printed_at": printed_at,
        "message": item.get("message", ""),
        "receipt_text_path": str(text_rel),
        "receipt_image_path": str(image_rel),
    }
    append_jsonl("printed.jsonl", record)
    update_csv(record)


def archive_failed(item, reason, requeued=True):
    failed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    record = {
        "id": item.get("id", ""),
        "status": "failed_requeued" if requeued else "failed",
        "created_at": item.get("createdAt", ""),
        "failed_at": failed_at,
        "message": item.get("message", ""),
        "reason": reason,
    }
    append_jsonl("failed.jsonl", record)
    update_csv(record)


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
    archive_claimed(item)
    text = render(item)
    try:
        print_text(text)
    except Exception as exc:
        reason = f"{type(exc).__name__}: {exc}"
        print(f"print failed for {item.get('id')}: {reason}", flush=True)
        archive_failed(item, reason)
        try:
            fail(item, reason, raw_item)
        except Exception as fail_exc:
            print(f"fail endpoint error for {item.get('id')}: {fail_exc}", flush=True)
        return

    archive_printed(item, text)
    try:
        ack(item, raw_item)
        print(f"printed, archived, and acked {item.get('id')}", flush=True)
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
