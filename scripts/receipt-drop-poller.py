#!/usr/bin/env python3
import json
import os
import csv
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
RECEIPT_PIXEL_WIDTH = 512
RECEIPT_SIDE_MARGIN = 34
RECEIPT_TOP_MARGIN = 24
RECEIPT_BOTTOM_MARGIN = 24
RECEIPT_TITLE = "WWW.RECEIPTS.CAFE"
RECEIPT_SEPARATOR = "-" * 24
RECEIPT_CONTENT_COLS = len(RECEIPT_SEPARATOR)
RECEIPT_FONT = "/System/Library/Fonts/Monaco.ttf"
TITLE_TRACKING = 3
MESSAGE_CENTER_NUDGE_Y = -4


def receipt_timestamp(item):
    created = item.get("createdAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return created[:16].replace("T", " ")


def load_font(size):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(RECEIPT_FONT, size)
    except Exception:
        return ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", size)


def glyph_width(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def text_width(draw, text, font, tracking=0):
    if not text:
        return 0
    return sum(glyph_width(draw, ch, font) for ch in text) + tracking * (len(text) - 1)


def draw_text(draw, x, y, text, font, tracking=0, darken=True):
    cursor = x
    for ch in text:
        draw.text((cursor, y), ch, font=font, fill=0)
        if darken:
            draw.text((cursor + 1, y), ch, font=font, fill=0)
        cursor += glyph_width(draw, ch, font) + tracking


def draw_center(draw, y, text, font, tracking=0):
    x = (RECEIPT_PIXEL_WIDTH - text_width(draw, text, font, tracking)) // 2
    draw_text(draw, x, y, text, font, tracking=tracking)


def wrap_message_pixels(draw, text, font, max_width):
    words = " ".join(str(text).split()).split(" ")
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if text_width(draw, candidate, font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        piece = ""
        for ch in word:
            test = piece + ch
            if text_width(draw, test, font) <= max_width:
                piece = test
            else:
                if piece:
                    lines.append(piece)
                piece = ch
        current = piece
    if current:
        lines.append(current)
    return lines or [""]


def receipt_layout(item):
    from PIL import Image, ImageDraw

    title_font = load_font(30)
    body_font = load_font(30)
    meta_font = load_font(30)
    scratch = Image.new("L", (RECEIPT_PIXEL_WIDTH, 100), 255)
    draw = ImageDraw.Draw(scratch)
    message_lines = wrap_message_pixels(
        draw,
        item.get("message", ""),
        body_font,
        RECEIPT_PIXEL_WIDTH - RECEIPT_SIDE_MARGIN * 2,
    )
    return title_font, body_font, meta_font, message_lines


def render_receipt_image(item):
    from PIL import Image, ImageDraw

    title_font, body_font, meta_font, message_lines = receipt_layout(item)
    img = Image.new("L", (RECEIPT_PIXEL_WIDTH, 2000), 255)
    draw = ImageDraw.Draw(img)

    y = RECEIPT_TOP_MARGIN
    draw_center(draw, y, RECEIPT_TITLE, title_font, tracking=TITLE_TRACKING)
    top_separator_y = y + 68
    draw_center(draw, top_separator_y, RECEIPT_SEPARATOR, meta_font)

    line_step = 38
    visual_gap = 41
    separator_bbox = draw.textbbox((0, top_separator_y), RECEIPT_SEPARATOR, font=meta_font)
    message_bbox = draw.textbbox((0, 0), message_lines[0], font=body_font)
    message_top_offset = message_bbox[1]
    message_bottom_offset = message_bbox[3]
    message_ink_height = (len(message_lines) - 1) * line_step + (message_bottom_offset - message_top_offset)
    message_y = separator_bbox[3] + visual_gap - message_top_offset + MESSAGE_CENTER_NUDGE_Y

    y = message_y
    for line in message_lines:
        draw_text(draw, RECEIPT_SIDE_MARGIN, y, line, body_font)
        y += line_step

    bottom_separator_top = separator_bbox[3] + visual_gap + message_ink_height + visual_gap
    bottom_separator_y = bottom_separator_top - separator_bbox[1] + top_separator_y
    draw_center(draw, bottom_separator_y, RECEIPT_SEPARATOR, meta_font)
    y = bottom_separator_y + 70
    draw_center(draw, y, receipt_timestamp(item), meta_font)
    y += 38 + RECEIPT_BOTTOM_MARGIN

    cropped = img.crop((0, 0, RECEIPT_PIXEL_WIDTH, y))
    return cropped.point(lambda p: 0 if p < 210 else 255, "1")


def render(item):
    title_font, body_font, meta_font, message_lines = receipt_layout(item)
    lines = [RECEIPT_TITLE, RECEIPT_SEPARATOR, *message_lines, RECEIPT_SEPARATOR, receipt_timestamp(item)]
    return "\n".join(lines) + "\n"


def raster_bytes(img):
    from PIL import Image

    img = img.convert("1")
    width, height = img.size
    if width % 8:
        padded = Image.new("1", (width + (8 - width % 8), height), 1)
        padded.paste(img, (0, 0))
        img = padded
        width, height = img.size
    width_bytes = width // 8
    data = bytearray()
    pixels = img.load()
    for y in range(height):
        for xb in range(width_bytes):
            byte = 0
            for bit in range(8):
                x = xb * 8 + bit
                if pixels[x, y] == 0:
                    byte |= 0x80 >> bit
            data.append(byte)
    return width_bytes, height, bytes(data)


def render_escpos(item):
    img = render_receipt_image(item)
    width_bytes, height, data = raster_bytes(img)
    raw = bytearray()
    raw += b"\x1b@"  # initialize
    raw += b"\x1dv0\x00" + bytes([width_bytes % 256, width_bytes // 256, height % 256, height // 256]) + data
    raw += b"\x1bd\x08"  # feed 8 lines so short receipts clear the cutter
    raw += b"\x1dV\x01"  # partial cut
    return bytes(raw)


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


def write_receipt_png(item, text, printed_at):
    try:
        img = render_receipt_image(item).convert("RGB")
    except Exception as exc:
        print(f"archive png unavailable: {exc}", flush=True)
        return None

    rel = archive_rel_dir("images", printed_at) / f"{archive_slug(item, printed_at)}.png"
    path = ARCHIVE_DIR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
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
    image_rel = write_receipt_png(item, text, printed_at)
    record = {
        "id": item.get("id", ""),
        "status": "printed",
        "created_at": item.get("createdAt", ""),
        "printed_at": printed_at,
        "message": item.get("message", ""),
        "receipt_text_path": str(text_rel),
        "receipt_image_path": str(image_rel or ""),
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


def print_receipt(item):
    with tempfile.NamedTemporaryFile("wb", suffix=".escpos", delete=False) as f:
        f.write(render_escpos(item))
        temp = Path(f.name)
    try:
        if PRINT_MODE == "local":
            subprocess.run(["lp", "-o", "raw", "-d", PRINTER, str(temp)], check=True)
        else:
            remote = f"/tmp/receipt-drop-{temp.name}"
            subprocess.run(["scp", str(temp), f"{SSH_HOST}:{remote}"], check=True)
            subprocess.run(
                ["ssh", SSH_HOST, f"lp -o raw -d {PRINTER} {remote}; status=$?; rm -f {remote}; exit $status"],
                check=True,
            )
    finally:
        temp.unlink(missing_ok=True)


def print_and_ack(item, raw_item=None):
    archive_claimed(item)
    text = render(item)
    try:
        print_receipt(item)
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
