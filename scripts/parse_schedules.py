"""
parse_schedules.py
==================
Reads two Arabic-language schedule text files:
  - "schedules old buidling.txt"   (المبنى القديم)
  - "schedules new building.txt"   (المبنى الجديد)

Extracts every room with its capacity and weekly availability windows,
then uploads the data to Firebase Firestore in three collections:

  rooms           - one document per room
  fixedSchedules  - one document per (room x day x time-slot)
  importSessions  - one document recording this import run

Run from the project root:
    python scripts/parse_schedules.py [--dry-run] [--semester 2024-2025-S2]

Requirements (install into .venv):
    pip install firebase-admin python-dotenv
"""

import os
import re
import sys
import json
import uuid
import hashlib
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 output on Windows (avoids cp1252 crash when printing Arabic)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# -- 0. Locate project root (one level above this script) ---------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# -- 1. Load .env.local -------------------------------------------------------
try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env.local")
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass  # python-dotenv not installed; rely on OS env vars

# -- 2. Arabic day-name helpers -----------------------------------------------
WEEKDAY_MAP = {
    "السبت":    0,
    "الاحد":    1,
    "الاثنين":  2,
    "الثلاثاء": 3,
    "الاربعاء": 4,
    "الخميس":   5,
    "الجمعة":   6,
}

# Raw (un-normalised) variants that also need to map
WEEKDAY_MAP_RAW = {
    "السبت":    0,
    "الأحد":    1,
    "الاثنين":  2,
    "الإثنين":  2,
    "الثلاثاء": 3,
    "الأربعاء": 4,
    "الخميس":   5,
    "الجمعة":   6,
}

DEFAULT_START = "08:30"
DEFAULT_END   = "14:30"
EVENING_START = "14:30"
EVENING_END   = "20:30"
FULLDAY_START = "08:30"
FULLDAY_END   = "20:30"


def norm(text):
    """Normalise Arabic text for matching."""
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[اأإآ]", "ا", text)
    text = re.sub(r"ة", "ه", text)
    text = re.sub(r"ى", "ي", text)
    text = re.sub(r"\u0640", "", text)   # tatweel
    return text


def parse_time_range(text):
    """Return (start, end) 24-h strings from Arabic time description, or None."""
    time_re = re.compile(
        r"(\d{1,2}:\d{2})\s*([صمظ]|صباحاً?|مساءً?|مساءاً?|ظهراً?|ظهر)?",
        re.UNICODE,
    )
    matches = time_re.findall(text)
    if len(matches) < 2:
        return None

    def to24(hm, merid):
        h, m = map(int, hm.split(":"))
        merid = (merid or "").strip()
        if merid in ("م", "مساءً", "مساء", "مساءاً"):
            if h != 12:
                h += 12
        elif merid in ("ص", "صباحاً", "صباح"):
            if h == 12:
                h = 0
        elif merid in ("ظ", "ظهراً", "ظهر"):
            if h < 12:
                h += 12
        return f"{h:02d}:{m:02d}"

    return to24(*matches[0]), to24(*matches[1])


def expand_range(d1, d2):
    """All day indices from d1 to d2 inclusive (wrapping Sat=0 … Fri=6)."""
    result = []
    d = d1
    for _ in range(8):
        result.append(d)
        if d == d2:
            break
        d = (d + 1) % 7
    return result


def parse_days_field(field):
    """
    Parse the days/hours column and return list of
    (dayOfWeek:int, startTime:str, endTime:str).
    """
    field = field.strip()
    results = []
    seen = set()

    # Build a regex alternation of all raw day names (longest first)
    day_names_sorted = sorted(WEEKDAY_MAP_RAW.keys(), key=len, reverse=True)
    day_alt = "|".join(re.escape(d) for d in day_names_sorted)

    # Split the field into clauses at each day-name boundary
    # so "...الخميس: 8:30 - 8:30 مساءً" becomes its own segment
    segments = re.split(r"(?=(?:" + day_alt + r"))", field)
    segments = [s.strip() for s in segments if s.strip()]

    for seg in segments:
        # Determine time window for this segment
        tr = parse_time_range(seg)
        if tr:
            start_t, end_t = tr
        elif norm("مسائي") in norm(seg) or norm("مسائياً") in norm(seg):
            start_t, end_t = EVENING_START, EVENING_END
        elif norm("يوم كامل") in norm(seg):
            start_t, end_t = FULLDAY_START, FULLDAY_END
        else:
            start_t, end_t = DEFAULT_START, DEFAULT_END

        # Check for "X إلى Y" range
        range_m = re.search(r"(" + day_alt + r")\s+إلى\s+(" + day_alt + r")", seg)
        if range_m:
            d1 = WEEKDAY_MAP_RAW[range_m.group(1)]
            d2 = WEEKDAY_MAP_RAW[range_m.group(2)]
            for d in expand_range(d1, d2):
                key = (d, start_t, end_t)
                if key not in seen:
                    results.append(key)
                    seen.add(key)
            continue

        # Otherwise collect individual day names
        day_hits = re.findall(r"(" + day_alt + r")", seg)
        for dname in day_hits:
            d = WEEKDAY_MAP_RAW[dname]
            key = (d, start_t, end_t)
            if key not in seen:
                results.append(key)
                seen.add(key)

    return [{"dayOfWeek": d, "startTime": s, "endTime": e} for d, s, e in results]


# -- 3. File parser -----------------------------------------------------------

def parse_schedule_file(filepath, building):
    """
    Parse one schedule .txt file.
    Returns list of room dicts with keys:
        roomCode, roomName, roomType, capacity, building, slots
    """
    for enc in ("utf-8-sig", "utf-8", "utf-16"):
        try:
            text = Path(filepath).read_text(encoding=enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        text = Path(filepath).read_text(errors="replace")

    rooms = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        parts = line.split(",", 2)
        if len(parts) < 3:
            continue

        room_raw, cap_raw, days_raw = parts[0].strip(), parts[1].strip(), parts[2].strip()

        # Skip header row
        if room_raw in ("القاعة/المعمل", "الاسم", "القاعة", "الاسم/الكود"):
            continue

        # Skip section-header lines (capacity not a number)
        try:
            capacity = int(cap_raw)
        except ValueError:
            continue

        room_name = room_raw

        # Room type
        if any(kw in room_name for kw in ["معمل", "مختبر"]):
            room_type = "lab"
        else:
            room_type = "classroom"

        # Extract alphanumeric code
        code_m = re.search(r"([A-Za-z]?\d{2,4}[A-Za-z]?)", room_name)
        room_code = code_m.group(1) if code_m else room_name

        slots = parse_days_field(days_raw)

        rooms.append({
            "roomCode": room_code,
            "roomName": room_name,
            "roomType": room_type,
            "capacity": capacity,
            "building": building,
            "slots":    slots,
        })

    return rooms


# -- 4. Firebase upload -------------------------------------------------------

def init_firebase():
    import firebase_admin
    from firebase_admin import credentials, firestore as fb_firestore

    if firebase_admin._apps:
        return fb_firestore.client()

    # Priority 1: JSON key file in project root
    json_files = sorted(PROJECT_ROOT.glob("classroom-managment*.json"))
    if json_files:
        cred = credentials.Certificate(str(json_files[0]))
        print(f"   Service account: {json_files[0].name}")
    else:
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if not raw:
            raise RuntimeError(
                "No Firebase service account found.\n"
                "Place the JSON key file in the project root or set "
                "FIREBASE_SERVICE_ACCOUNT in .env.local"
            )
        cred = credentials.Certificate(json.loads(raw.replace("\\\\n", "\n").replace("\\n", "\n")))
        print("   Service account: from FIREBASE_SERVICE_ACCOUNT env var")

    firebase_admin.initialize_app(cred)
    return fb_firestore.client()


def upload_to_firestore(rooms_data, semester_id, dry_run=False):
    session_id  = str(uuid.uuid4())
    imported_at = datetime.now(timezone.utc).isoformat()

    room_docs     = []
    schedule_docs = []

    for room in rooms_data:
        room_id = f"{room['building']}_{room['roomCode']}"
        room_docs.append((room_id, {
            "name":     room["roomName"],
            "code":     room["roomCode"],
            "capacity": room["capacity"],
            "building": room["building"],
            "type":     room["roomType"],
            "source":   "txt-import",
        }))

        for slot in room["slots"]:
            raw_key  = f"{room_id}|{semester_id}|{slot['dayOfWeek']}|{slot['startTime']}|{slot['endTime']}"
            sched_id = hashlib.md5(raw_key.encode()).hexdigest()
            schedule_docs.append((sched_id, {
                "roomId":          room_id,
                "dayOfWeek":       slot["dayOfWeek"],
                "startTime":       slot["startTime"],
                "endTime":         slot["endTime"],
                "source":          "txt-import",
                "recurring":       True,
                "semesterId":      semester_id,
                "importSessionId": session_id,
                "disabled":        False,
            }))

    checksum = hashlib.md5("|".join(sorted(s for s, _ in schedule_docs)).encode()).hexdigest()
    session_doc = {
        "fileName":       "schedules old buidling.txt + schedules new building.txt",
        "importedAt":     imported_at,
        "checksum":       checksum,
        "semesterId":     semester_id,
        "totalSchedules": len(schedule_docs),
    }

    if dry_run:
        print("\n" + "=" * 60)
        print("DRY RUN - nothing written to Firebase")
        print("=" * 60)
        print(f"  Session  : {session_id}")
        print(f"  Semester : {semester_id}")
        print(f"  Rooms    : {len(room_docs)}")
        print(f"  Schedules: {len(schedule_docs)}")
        print("\nSample rooms (first 5):")
        for rid, rdoc in room_docs[:5]:
            print(f"  [{rid}] {rdoc}")
        print("\nSample schedules (first 5):")
        for sid, sdoc in schedule_docs[:5]:
            print(f"  [{sid}] {sdoc}")
        return {"rooms": len(room_docs), "schedules": len(schedule_docs), "session": session_id}

    db = init_firebase()
    BATCH = 490

    # Rooms (merge=True preserves manual edits)
    for i in range(0, len(room_docs), BATCH):
        b = db.batch()
        for rid, rdoc in room_docs[i:i+BATCH]:
            b.set(db.collection("rooms").document(rid), rdoc, merge=True)
        b.commit()
    print(f"   Upserted {len(room_docs)} rooms.")

    # Delete old schedules for this semester (use filter= kwarg to avoid deprecation warning)
    from google.cloud.firestore_v1 import FieldFilter
    old = list(
        db.collection("fixedSchedules")
          .where(filter=FieldFilter("semesterId", "==", semester_id))
          .stream()
    )
    for i in range(0, len(old), BATCH):
        b = db.batch()
        for doc in old[i:i+BATCH]:
            b.delete(doc.reference)
        b.commit()
    print(f"   Deleted {len(old)} old schedule docs.")

    # Write new schedules
    for i in range(0, len(schedule_docs), BATCH):
        b = db.batch()
        for sid, sdoc in schedule_docs[i:i+BATCH]:
            b.set(db.collection("fixedSchedules").document(sid), sdoc)
        b.commit()
    print(f"   Wrote {len(schedule_docs)} fixedSchedule docs.")

    # Import session
    db.collection("importSessions").document(session_id).set(session_doc)
    print(f"   Recorded importSession [{session_id}].")

    return {"rooms": len(room_docs), "schedules": len(schedule_docs), "session": session_id}


# -- 5. Entry point -----------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Parse Arabic schedule .txt files and upload to Firebase Firestore."
    )
    ap.add_argument("--semester",  default="2024-2025-S2",
                    help="Semester ID string (default: 2024-2025-S2)")
    ap.add_argument("--dry-run",   action="store_true",
                    help="Parse and preview without writing to Firebase")
    ap.add_argument("--old-file",  default=str(PROJECT_ROOT / "schedules old buidling.txt"),
                    help="Path to old-building schedule file")
    ap.add_argument("--new-file",  default=str(PROJECT_ROOT / "schedules new building.txt"),
                    help="Path to new-building schedule file")
    args = ap.parse_args()

    for p in (args.old_file, args.new_file):
        if not Path(p).exists():
            print(f"ERROR: File not found: {p}", file=sys.stderr)
            sys.exit(1)

    print(f"Parsing: {Path(args.old_file).name}")
    old_rooms = parse_schedule_file(args.old_file, "old")
    print(f"  -> {len(old_rooms)} rooms found")

    print(f"Parsing: {Path(args.new_file).name}")
    new_rooms = parse_schedule_file(args.new_file, "new")
    print(f"  -> {len(new_rooms)} rooms found")

    all_rooms = old_rooms + new_rooms
    print(f"\nTotal: {len(all_rooms)} rooms\n")

    # Pretty summary table
    print(f"{'Code':<12} {'Building':<10} {'Type':<12} {'Cap':>4}  {'Slots':>6}")
    print("-" * 50)
    for r in all_rooms:
        print(f"{r['roomCode']:<12} {r['building']:<10} {r['roomType']:<12} {r['capacity']:>4}  {len(r['slots']):>6}")

    print(f"\nUploading to Firestore (semester={args.semester}) ...")
    result = upload_to_firestore(all_rooms, args.semester, dry_run=args.dry_run)
    print(f"\nDone! rooms={result['rooms']}, schedules={result['schedules']}")
    print(f"Session ID: {result['session']}")


if __name__ == "__main__":
    main()
