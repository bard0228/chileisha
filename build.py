#!/usr/bin/env python3
"""
「吃了啥」飲食拆解同步與建置引擎 (build.py)
支援功能：
1. 從 Google 試算表「吃了啥」(1J-x0j28NAYFO6hp1FGoy5IMOX3Vlg6XmA89voImYk14) 同步最新紀錄與目標設定，合併 extra.json 並輸出 public/data.json
2. 支援透過 CLI 直接追加經過使用者確認的拆解飲食項目至 Google 試算表與 extra.json：
   python3 build.py --add-json '[{"date":"2026-11-09","meal":"午餐","food":"白飯","grams":180,"kcal":250,"carb":55,"protein":4.5,"fat":0.5,"sodium":5,"note":"視覺分析","imgs":[]}]'
3. 支援 --sync-drive 將更新後的檔案同步回 Google Drive「鮪魚握壽司」資料夾
4. 支援 --deploy 呼叫 Firebase Hosting 部署
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

TZ_TAIWAN = timezone(timedelta(hours=8))


def get_taiwan_now() -> datetime:
    """取得當下台灣時間 (Asia/Taipei, UTC+8)。"""
    return datetime.now(TZ_TAIWAN)


def get_taiwan_today() -> str:
    """取得當天台灣日期 YYYY-MM-DD。"""
    return get_taiwan_now().strftime("%Y-%m-%d")


def get_taiwan_meal() -> str:
    """依據當前台灣時間自動判定預設餐別。"""
    t = get_taiwan_now().hour + get_taiwan_now().minute / 60.0
    if 5.0 <= t < 10.5:
        return "早餐"
    elif 10.5 <= t < 14.0:
        return "午餐"
    elif 14.0 <= t < 17.0:
        return "點心"
    elif 17.0 <= t < 21.0:
        return "晚餐"
    else:
        return "點心"

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_JSON = PUBLIC_DIR / "data.json"
EXTRA_JSON = BASE_DIR / "extra.json"
CSV_PATH = BASE_DIR / "chilesha.csv"

SPREADSHEET_ID = "1J-x0j28NAYFO6hp1FGoy5IMOX3Vlg6XmA89voImYk14"
DRIVE_FOLDER_ID = "1CoU1vEjEBoXvvcp6CrIpDbzuai-CSaJ4"

# Drive 檔案 ID 對照表（用於回寫雲端硬碟）
DRIVE_FILE_IDS = {
    "app.js": "15IEkdWJgG_IMeoZDxFDywiMVvdAkqXVu",
    "build.py": "1cdxEV13ZoqvIlQEIjGkuKM-ilM87aL5a",
    "data.json": "1rrRGX-HY374M2gEfJKiOw0wPkrFcUD6T",
    "extra.json": "1cxK8cP-t_qQRsnAdaXPaYhZvuXur18-j",
    "index.html": "18VnOMTJmllk1ZIqS9FTY7cnD0UQ96Uve",
    "liquid-glass.css": "1fFazdwpCeJrazfT1KFvo4i7eEZ1Fr0M-",
    "liquid-glass.js": "1wtJ1ohP_VKFGmXdTVt3TTGAhx3PHCuIU",
    "manifest.json": "1uaYyoOaviXKhF-vjxwygBjgwVQ2TBBi5",
    "sw.js": "1jF2A5KKnj7EYVWsGB6Hn4L2bw2h-NubB",
    "icon-192.png": "18aEyDeVoOpSJuomIKHV18ZKgznCQ7VLZ",
    "icon-512.png": "1kaGF9r_-itQjPk1TRBJ7HHYWfIT6Lvpu",
    "icon-192-maskable.png": "1FaseRQivXaSn3xOv4oSTZfaBMaw1OPMb",
    "icon-512-maskable.png": "1Aqu9e01C3NEDnnJtjRiF8sPK8Widxlme",
    "apple-touch-icon.png": "1cDyXYT5hEF4khI3iycOA97sfY3f8tiqx",
    "favicon.png": "1DxJq7zLEi2R5JC0067GLffu9ifgD-kGE"
}


def run_cli(cmd: list[str]) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["ANTIGRAVITY_APP_DATA_DIR"] = "/tmp/appdata"
    env["PATH"] = f"/opt/antigravity/bin:{env.get('PATH', '')}"
    return subprocess.run(cmd, env=env, text=True, capture_output=True)


def num(v) -> float | int:
    if v is None or v == "":
        return 0
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 2)
    except ValueError:
        return 0


THUMBS_DIR = PUBLIC_DIR / "thumbs"
import re
PHOTO_NAME_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2})_(早餐|午餐|晚餐|點心)(?:_(.+))?\.(jpg|jpeg|png)$", re.IGNORECASE)


def sync_drive_photos() -> list[str]:
    """從 Google Drive 資料夾「鮪魚握壽司」中自動同步符合 YYYY-MM-DD_餐別_*.jpg 格式的照片並產生縮圖。"""
    res = run_cli(["gdrive", "readonly", "ls", DRIVE_FOLDER_ID, "--json"])
    if res.returncode != 0:
        return []
    try:
        files = json.loads(res.stdout)
    except Exception:
        return []

    try:
        from PIL import Image, ImageOps
    except ImportError:
        return []

    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = []
    for f in files:
        name = f.get("name", "")
        m = PHOTO_NAME_PATTERN.match(name)
        if not m:
            continue
        date_str, meal_str, desc, ext = m.groups()
        out_name = f"{date_str}_{meal_str}_{desc}.jpg" if desc else f"{date_str}_{meal_str}.jpg"
        out_path = THUMBS_DIR / out_name
        if out_path.exists():
            continue

        tmp_download = Path(f"/tmp/{f['id']}_{name}")
        dl_res = run_cli(["gdrive", "readonly", "download", f["id"], "--out", str(tmp_download)])
        if dl_res.returncode == 0 and tmp_download.exists():
            try:
                with Image.open(tmp_download) as img:
                    img = ImageOps.exif_transpose(img)
                    img.thumbnail((900, 900), Image.Resampling.LANCZOS)
                    img.save(out_path, "JPEG", quality=85, optimize=True)
                    downloaded.append(out_name)
                    print(f"[同步照片] 已從 Google Drive 自動同步並生成縮圖: {out_name}")
            except Exception as e:
                print(f"[警告] 處理 Drive 縮圖失敗 {name}: {e}", file=sys.stderr)
            finally:
                if tmp_download.exists():
                    tmp_download.unlink()
    return downloaded


def process_photos(src_paths: list[str | Path], date_str: str, meal_str: str) -> list[str]:
    """將上傳的食物照片壓縮為高畫質縮圖，存放於 public/thumbs/，回傳檔案名稱清單。"""
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    generated = []
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return generated

    for i, p in enumerate(src_paths):
        p = Path(p)
        if not p.exists():
            continue
        out_name = f"{date_str}_{meal_str}_{i}.jpg"
        out_path = THUMBS_DIR / out_name
        try:
            with Image.open(p) as img:
                img = ImageOps.exif_transpose(img)
                img.thumbnail((900, 900), Image.Resampling.LANCZOS)
                img.save(out_path, "JPEG", quality=85, optimize=True)
                generated.append(out_name)
        except Exception as e:
            print(f"[警告] 處理縮圖失敗 {p}: {e}", file=sys.stderr)
    return generated



BREAKFAST_PRESETS = {
    "一般餐": [
        {"food": "水煮全蛋", "grams": 50, "kcal": 72, "carb": 0.4, "protein": 6.3, "fat": 4.8, "sodium": 70, "note": "一般餐"},
        {"food": "水煮蛋白", "grams": 70, "kcal": 35, "carb": 0.5, "protein": 7.5, "fat": 0.1, "sodium": 115, "note": "一般餐"},
        {"food": "蘋果", "grams": 80, "kcal": 42, "carb": 11, "protein": 0.2, "fat": 0.1, "sodium": 1, "note": "一般餐"},
        {"food": "芭樂", "grams": 80, "kcal": 33, "carb": 8, "protein": 0.6, "fat": 0.4, "sodium": 2, "note": "一般餐"},
        {"food": "藍莓", "grams": 30, "kcal": 17, "carb": 4.3, "protein": 0.2, "fat": 0.1, "sodium": 0, "note": "一般餐"},
        {"food": "無糖無脂優格", "grams": 150, "kcal": 89, "carb": 7.95, "protein": 14.1, "fat": 0, "sodium": 0, "note": "一般餐"},
    ],
    "芝麻餐": [
        {"food": "水煮全蛋", "grams": 50, "kcal": 72, "carb": 0.4, "protein": 6.3, "fat": 4.8, "sodium": 70, "note": "芝麻餐"},
        {"food": "水煮蛋白", "grams": 70, "kcal": 35, "carb": 0.5, "protein": 7.5, "fat": 0.1, "sodium": 115, "note": "芝麻餐"},
        {"food": "蘋果", "grams": 80, "kcal": 42, "carb": 11, "protein": 0.2, "fat": 0.1, "sodium": 1, "note": "芝麻餐"},
        {"food": "芭樂", "grams": 80, "kcal": 33, "carb": 8, "protein": 0.6, "fat": 0.4, "sodium": 2, "note": "芝麻餐"},
        {"food": "藍莓", "grams": 30, "kcal": 17, "carb": 4.3, "protein": 0.2, "fat": 0.1, "sodium": 0, "note": "芝麻餐"},
        {"food": "無糖無脂優格", "grams": 150, "kcal": 89, "carb": 7.95, "protein": 14.1, "fat": 0, "sodium": 0, "note": "芝麻餐"},
        {"food": "有機黑芝麻粉", "grams": 10, "kcal": 59, "carb": 2.2, "protein": 2, "fat": 5.2, "sodium": 1, "note": "芝麻餐"},
    ],
    "燕麥餐": [
        {"food": "水煮全蛋", "grams": 50, "kcal": 72, "carb": 0.4, "protein": 6.3, "fat": 4.8, "sodium": 70, "note": "燕麥餐"},
        {"food": "水煮蛋白", "grams": 70, "kcal": 35, "carb": 0.5, "protein": 7.5, "fat": 0.1, "sodium": 115, "note": "燕麥餐"},
        {"food": "蘋果", "grams": 80, "kcal": 42, "carb": 11, "protein": 0.2, "fat": 0.1, "sodium": 1, "note": "燕麥餐"},
        {"food": "芭樂", "grams": 80, "kcal": 33, "carb": 8, "protein": 0.6, "fat": 0.4, "sodium": 2, "note": "燕麥餐"},
        {"food": "藍莓", "grams": 30, "kcal": 17, "carb": 4.3, "protein": 0.2, "fat": 0.1, "sodium": 0, "note": "燕麥餐"},
        {"food": "無糖無脂優格", "grams": 150, "kcal": 89, "carb": 7.95, "protein": 14.1, "fat": 0, "sodium": 0, "note": "燕麥餐"},
        {"food": "桂格有機大燕麥片", "grams": 46, "kcal": 172, "carb": 30.7, "protein": 5.9, "fat": 1.2, "sodium": 0, "note": "燕麥餐"},
    ],
}


def append_to_gsheet(items: list[dict]) -> None:
    """將確認後的拆解飲食項目 Append 至 Google 試算表「吃了啥」的『紀錄』工作表。"""
    batch_rows = []
    for it in items:
        batch_rows.append([
            str(it.get("date", "")),
            str(it.get("meal") or get_taiwan_meal()),
            str(it.get("food", it.get("name", ""))),
            it.get("grams", "") if it.get("grams") else "",
            num(it.get("kcal", 0)),
            num(it.get("carb", 0)),
            num(it.get("protein", 0)),
            num(it.get("fat", 0)),
            num(it.get("sodium", 0)),
            str(it.get("note", "")),
        ])
    req_file = Path("/tmp/gsheet_append_req.json")
    req_payload = [{"op": "append", "range": "紀錄!A1", "data": batch_rows}]
    req_file.write_text(json.dumps(req_payload, ensure_ascii=False), encoding="utf-8")
    res = run_cli(["gsheets", "mutate", "batch", SPREADSHEET_ID, "-f", str(req_file)])
    if res.returncode != 0:
        print(f"[警告] Google 試算表寫入失敗: {res.stderr}", file=sys.stderr)
    else:
        print(f"[成功] 已將 {len(batch_rows)} 筆拆解紀錄寫入 Google 試算表「吃了啥」！")


def export_latest_csv() -> bool:
    """從 Google 試算表匯出最新 CSV。"""
    res = run_cli(["gdrive", "readonly", "export", SPREADSHEET_ID, str(CSV_PATH), "--format", "csv"])
    return res.returncode == 0 and CSV_PATH.exists()


def rebuild_data_json(pull_sheet: bool = False) -> dict:
    """合併現有 data.json、試算表 CSV 與 extra.json，產生最新 public/data.json。"""
    if pull_sheet:
        export_latest_csv()
        sync_drive_photos()

    # 建立本地 thumbs 檔案庫目錄 (date, meal) -> list of thumb file names
    meal_thumbs: dict[tuple[str, str], list[str]] = {}
    if THUMBS_DIR.exists():
        for p in sorted(THUMBS_DIR.glob("*.jpg")):
            m_match = PHOTO_NAME_PATTERN.match(p.name)
            if m_match:
                d_str, m_str = m_match.group(1), m_match.group(2)
                meal_thumbs.setdefault((d_str, m_str), []).append(p.name)

    existing_data = {"today": "2026-11-08", "goals": [], "refeed": [], "rows": []}
    if DATA_JSON.exists():
        existing_data = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    extra = {"goals": existing_data.get("goals", []), "refeed": existing_data.get("refeed", []), "rows": []}
    if EXTRA_JSON.exists():
        extra = json.loads(EXTRA_JSON.read_text(encoding="utf-8"))

    # 建立既有圖片索引 (date, meal, food) -> imgs（僅保留本地磁碟實際存在的縮圖）
    img_map: dict[tuple[str, str, str], list[str]] = {}
    for r in existing_data.get("rows", []):
        if len(r) > 9 and r[9]:
            img_map[(r[0], r[1], r[2])] = [im for im in r[9] if (THUMBS_DIR / im).exists()]
    for r in extra.get("rows", []):
        if len(r) > 10 and r[10]:
            img_map[(r[0], r[1], r[2])] = [im for im in r[10] if (THUMBS_DIR / im).exists()]

    rows = []
    seen = set()
    meal_seen_first = set()

    if CSV_PATH.exists():
        with CSV_PATH.open("r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for line in reader:
                if len(line) < 9 or not line[0].strip():
                    continue
                d, m, food = line[0].strip(), line[1].strip(), line[2].strip()
                key = (d, m, food)
                meal_key = (d, m)
                imgs = [im for im in img_map.get(key, []) if (THUMBS_DIR / im).exists()]
                if meal_key not in meal_seen_first and meal_key in meal_thumbs:
                    # 自動將符合 YYYY-MM-DD_餐別_*.jpg 的照片掛至該餐別第一項
                    for th in meal_thumbs[meal_key]:
                        if th not in imgs and (THUMBS_DIR / th).exists():
                            imgs.append(th)
                    meal_seen_first.add(meal_key)
                row_item = [
                    d,
                    m,
                    food,
                    num(line[3]),
                    num(line[4]),
                    num(line[5]),
                    num(line[6]),
                    num(line[7]),
                    num(line[8]),
                    imgs,
                ]
                rows.append(row_item)
                seen.add(key)
    else:
        for r in existing_data.get("rows", []):
            rows.append(r)
            seen.add((r[0], r[1], r[2]))


    # 合併 extra.json 中尚未出現的新增列
    for r in extra.get("rows", []):
        key = (r[0], r[1], r[2])
        if key in seen:
            continue
        imgs = r[10] if len(r) > 10 else img_map.get(key, [])
        rows.append([
            r[0],
            r[1],
            r[2],
            num(r[3]),
            num(r[4]),
            num(r[5]),
            num(r[6]),
            num(r[7]),
            num(r[8]),
            imgs,
        ])
        seen.add(key)

    rows.sort(key=lambda r: r[0])
    today = max(max((r[0] for r in rows), default="2026-11-08"), get_taiwan_today())

    out_data = {
        "today": today,
        "goals": extra.get("goals") or existing_data.get("goals", []),
        "refeed": extra.get("refeed") or existing_data.get("refeed", []),
        "rows": rows,
    }
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(json.dumps(out_data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[完成] 共 {len(rows)} 筆紀錄；最新日期 today = {today}")
    return out_data


def format_meal_breakdown(items: list[dict]) -> str:
    """依照使用者指定格式產生當餐合計與各細項純文字。"""
    def fmt(v):
        return int(v) if isinstance(v, (int, float)) and float(v).is_integer() else v

    tot_kcal = round(sum(num(it.get("kcal", 0)) for it in items), 1)
    tot_carb = round(sum(num(it.get("carb", 0)) for it in items), 1)
    tot_prot = round(sum(num(it.get("protein", 0)) for it in items), 1)
    tot_fat = round(sum(num(it.get("fat", 0)) for it in items), 1)
    tot_sod = round(sum(num(it.get("sodium", 0)) for it in items), 1)

    lines = [
        f"當餐合計：熱量 {fmt(tot_kcal)} kcal，碳水 {fmt(tot_carb)} g，蛋白質 {fmt(tot_prot)} g，脂肪 {fmt(tot_fat)} g，鈉 {fmt(tot_sod)} mg  "
    ]
    for it in items:
        food = it.get("food", it.get("name", ""))
        grams = it.get("grams", "")
        g_str = f" {grams}g" if grams else ""
        k = fmt(num(it.get("kcal", 0)))
        c = fmt(num(it.get("carb", 0)))
        p = fmt(num(it.get("protein", 0)))
        f_val = fmt(num(it.get("fat", 0)))
        s = fmt(num(it.get("sodium", 0)))
        lines.append(f"{food}{g_str}，熱量 {k} kcal，碳水 {c} g，蛋白質 {p} g，脂肪 {f_val} g，鈉 {s} mg  ")
    return "\n".join(lines)


def get_daily_summary(date_str: str) -> dict:
    """計算指定日期的當日累計已攝取與剩餘營養素。"""
    if not DATA_JSON.exists():
        rebuild_data_json()
    data = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    
    # 尋找適用目標
    goals = sorted(data.get("goals", []), key=lambda g: g.get("from", ""))
    target_goal = {"kcal": 2240, "carb": 250, "protein": 130, "fat": 80, "sodium": 2400}
    for g in goals:
        if g.get("from", "") <= date_str:
            target_goal = g

    # 累計當日
    day_rows = [r for r in data.get("rows", []) if r[0] == date_str]
    c_kcal = round(sum(r[4] for r in day_rows), 1)
    c_carb = round(sum(r[5] for r in day_rows), 1)
    c_prot = round(sum(r[6] for r in day_rows), 1)
    c_fat = round(sum(r[7] for r in day_rows), 1)
    c_sod = round(sum(r[8] for r in day_rows), 1)

    r_kcal = round(target_goal.get("kcal", 0) - c_kcal, 1)
    r_carb = round(target_goal.get("carb", 0) - c_carb, 1)
    r_prot = round(target_goal.get("protein", 0) - c_prot, 1)
    r_fat = round(target_goal.get("fat", 0) - c_fat, 1)
    r_sod = round(target_goal.get("sodium", 0) - c_sod, 1)

    def rem_str(val, unit, label=""):
        if val >= 0:
            return f"剩餘{label} {val} {unit}"
        return f"超過{label} {abs(val)} {unit}"

    return {
        "date": date_str,
        "consumed": {"kcal": c_kcal, "carb": c_carb, "protein": c_prot, "fat": c_fat, "sodium": c_sod},
        "remaining": {"kcal": r_kcal, "carb": r_carb, "protein": r_prot, "fat": r_fat, "sodium": r_sod},
        "lines": [
            f"今天熱量已 {c_kcal} kcal，{rem_str(r_kcal, 'kcal', '熱量')}  ",
            f"碳水已 {c_carb} g，{rem_str(r_carb, 'g')}  ",
            f"蛋白已 {c_prot} g，{rem_str(r_prot, 'g')}  ",
            f"脂肪已 {c_fat} g，{rem_str(r_fat, 'g')}  ",
            f"鈉已 {c_sod} mg，{rem_str(r_sod, 'mg')}",
        ]
    }

def get_projected_summary(new_items: list[dict], date_str: str) -> dict:
    """即時試算加入新餐點後的當日累計與剩餘營養素（毫秒級本地運算，不依賴網路）。"""
    if not DATA_JSON.exists():
        rebuild_data_json()
    data = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    goals = sorted(data.get("goals", []), key=lambda g: g.get("from", ""))
    target_goal = {"kcal": 2240, "carb": 250, "protein": 130, "fat": 80, "sodium": 2400}
    for g in goals:
        if g.get("from", "") <= date_str:
            target_goal = g

    day_rows = [r for r in data.get("rows", []) if r[0] == date_str]
    c_kcal = round(sum(r[4] for r in day_rows) + sum(num(it.get("kcal", 0)) for it in new_items), 1)
    c_carb = round(sum(r[5] for r in day_rows) + sum(num(it.get("carb", 0)) for it in new_items), 1)
    c_prot = round(sum(r[6] for r in day_rows) + sum(num(it.get("protein", 0)) for it in new_items), 1)
    c_fat = round(sum(r[7] for r in day_rows) + sum(num(it.get("fat", 0)) for it in new_items), 1)
    c_sod = round(sum(r[8] for r in day_rows) + sum(num(it.get("sodium", 0)) for it in new_items), 1)

    r_kcal = round(target_goal.get("kcal", 0) - c_kcal, 1)
    r_carb = round(target_goal.get("carb", 0) - c_carb, 1)
    r_prot = round(target_goal.get("protein", 0) - c_prot, 1)
    r_fat = round(target_goal.get("fat", 0) - c_fat, 1)
    r_sod = round(target_goal.get("sodium", 0) - c_sod, 1)

    def rem_str(val, unit, label=""):
        if val >= 0:
            return f"剩餘{label} {val} {unit}"
        return f"超過{label} {abs(val)} {unit}"

    return {
        "date": date_str,
        "breakdown": format_meal_breakdown(new_items),
        "lines": [
            f"今天熱量已 {c_kcal} kcal，{rem_str(r_kcal, 'kcal', '熱量')}  ",
            f"碳水已 {c_carb} g，{rem_str(r_carb, 'g')}  ",
            f"蛋白已 {c_prot} g，{rem_str(r_prot, 'g')}  ",
            f"脂肪已 {c_fat} g，{rem_str(r_fat, 'g')}  ",
            f"鈉已 {c_sod} mg，{rem_str(r_sod, 'mg')}",
        ]
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="吃了啥 資料同步與建置工具")
    ap.add_argument("--pull", action="store_true", help="先從 Google 試算表拉取最新 CSV")
    ap.add_argument("--add-json", type=str, default="", help="新增確認後的飲食項目 JSON 陣列（同步寫入試算表與 extra.json）")
    ap.add_argument("--preview", action="store_true", help="僅即時試算並印出回覆文字契約（不寫入試算表也不發起網路請求）")
    ap.add_argument("--breakfast", type=str, default="", choices=["一般餐", "芝麻餐", "燕麥餐"], help="快速紀錄固定早餐模式")
    ap.add_argument("--date", type=str, default="", help="指定日期 (YYYY-MM-DD，若未指定則依當天或最新日)")
    ap.add_argument("--summary", type=str, default="", help="取得指定日期的當日已攝取與剩餘統計（例：2026-11-08）")
    ap.add_argument("--deploy", action="store_true", help="部署至 Firebase Hosting")
    args = ap.parse_args()

    items_to_add = []
    target_date = args.date or get_taiwan_today()

    if args.breakfast:
        preset = BREAKFAST_PRESETS.get(args.breakfast, [])
        for item in preset:
            it = dict(item)
            it["date"] = target_date
            it["meal"] = "早餐"
            items_to_add.append(it)

    if args.add_json:
        new_items = json.loads(args.add_json)
        if isinstance(new_items, dict):
            new_items = [new_items]
        items_to_add.extend(new_items)

    if args.preview:
        p = get_projected_summary(items_to_add, target_date)
        print(p["breakdown"])
        print()
        print("\n".join(p["lines"]))
        return

    if items_to_add:
        # 1. 寫入 Google 試算表
        append_to_gsheet(items_to_add)
        # 2. 寫入本地 extra.json
        extra = json.loads(EXTRA_JSON.read_text(encoding="utf-8")) if EXTRA_JSON.exists() else {"goals": [], "refeed": [], "rows": []}
        for it in items_to_add:
            row_entry = [
                str(it.get("date", target_date)),
                str(it.get("meal") or get_taiwan_meal()),
                str(it.get("food", it.get("name", ""))),
                num(it.get("grams", 0)),
                num(it.get("kcal", 0)),
                num(it.get("carb", 0)),
                num(it.get("protein", 0)),
                num(it.get("fat", 0)),
                num(it.get("sodium", 0)),
                str(it.get("note", "")),
            ]
            if it.get("imgs"):
                row_entry.append(it["imgs"])
            extra["rows"].append(row_entry)
        EXTRA_JSON.write_text(json.dumps(extra, ensure_ascii=False), encoding="utf-8")

    rebuild_data_json(pull_sheet=args.pull)

    if items_to_add:
        print("\n" + format_meal_breakdown(items_to_add) + "\n")

    sum_date = args.summary or (target_date if (args.breakfast or args.add_json) else "")
    if sum_date:
        s = get_daily_summary(sum_date)
        print("\n".join(s["lines"]))

    if args.deploy:
        firebase_bin = "/home/antigravity/firebase" if Path("/home/antigravity/firebase").exists() else "firebase"
        subprocess.run(
            [firebase_bin, "deploy", "--only", "hosting", "--project", "iron-ledger-bard"],
            cwd=str(BASE_DIR),
            check=True,
        )


if __name__ == "__main__":
    main()
