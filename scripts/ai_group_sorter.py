"""
ai_group_sorter.py - Интеллектуальный анализатор и отбор серий групповых фотографий (Коллаж)
для VINETKA Photo Sorter на базе алгоритмов VINETKA AI Workflow.

Запуск:
  python ai_group_sorter.py --shoot-dir "D:/дизайн/1ә обр 6000" --exclude-frames "6652,6657,6662"
"""

import sys
import os
import re
import json
import argparse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, List, Optional

from PIL import Image, ImageOps
import numpy as np
import cv2

# Настройка UTF-8 для stdout/stderr
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

CATEGORY_LABELS = {
    "GENERAL_CLASS": "1. Общая фотография",
    "BOYS": "2. Только мальчики",
    "GIRLS": "3. Только девочки",
    "SMALL_GROUP": "4. Дополнительная группа",
    "EXTRA_PORTRAITS": "5. Портреты / Одиночные",
    "DO_NOT_USE": "6. Не использовать"
}

def extract_frame_num(filename: str) -> int:
    m = re.findall(r'\d+', Path(filename).name)
    return int(m[-1]) if m else 0

def analyze_photo_file(p: Path, face_xml: str, eye_xml: str) -> Dict[str, Any]:
    num = extract_frame_num(p.name)
    try:
        face_cascade = cv2.CascadeClassifier(face_xml)
        eye_cascade = cv2.CascadeClassifier(eye_xml)

        with Image.open(p) as im:
            exif = im._getexif() or {}
            # 36867 = DateTimeOriginal
            t_str = exif.get(36867) or exif.get(306)
            dt = datetime.strptime(t_str, "%Y:%m:%d %H:%M:%S") if t_str else None
            t = ImageOps.exif_transpose(im)
            w, h = t.size
            is_vert = h > w
            t.thumbnail((600, 600))
            gray = cv2.cvtColor(np.array(t), cv2.COLOR_RGB2GRAY)
            
            faces = face_cascade.detectMultiScale(gray, 1.15, 3, minSize=(18, 18))
            lap = float(cv2.Laplacian(gray, cv2.CV_64F).var())

            total_eyes = 0
            for (fx, fy, fw, fh) in faces:
                roi = gray[fy:fy+fh, fx:fx+fw]
                eyes = eye_cascade.detectMultiScale(roi, 1.1, 3, minSize=(10, 10))
                total_eyes += len(eyes)

            # Расчет комплексного балла (резкость + открытые глаза)
            score = min(100.0, (lap / 250.0) * 100.0)
            if len(faces) >= 3 and total_eyes >= len(faces):
                score += 15.0

            return {
                "name": p.name,
                "path": str(p),
                "frame_num": num,
                "dt": dt.isoformat() if dt else None,
                "is_vert": is_vert,
                "faces_count": len(faces),
                "eyes_count": total_eyes,
                "sharpness": round(lap, 1),
                "score": round(score, 1),
                "width": w,
                "height": h
            }
    except Exception as e:
        return {
            "name": p.name,
            "path": str(p),
            "frame_num": num,
            "dt": None,
            "is_vert": False,
            "faces_count": 0,
            "eyes_count": 0,
            "sharpness": 0.0,
            "score": 0.0,
            "width": 0,
            "height": 0,
            "error": str(e)
        }

def run_sorter(shoot_dir_str: str, exclude_frames: List[int], max_workers: int = 6):
    shoot_dir = Path(shoot_dir_str)
    if not shoot_dir.exists():
        print(json.dumps({"ok": False, "error": f"Папка не найдена: {shoot_dir}"}), flush=True)
        return

    # Поиск файлов каскадов
    base_dir = Path(__file__).resolve().parent.parent
    face_xml = base_dir / "models" / "haarcascades" / "haarcascade_frontalface_default.xml"
    eye_xml = base_dir / "models" / "haarcascades" / "haarcascade_eye.xml"
    if not face_xml.exists() or not eye_xml.exists():
        # Fallback на D:\haarcascades
        face_xml = Path(r"D:\haarcascades\haarcascade_frontalface_default.xml")
        eye_xml = Path(r"D:\haarcascades\haarcascade_eye.xml")

    # Ищем все фото
    valid_exts = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
    all_files = [f for f in shoot_dir.iterdir() if f.is_file() and f.suffix.lower() in valid_exts]
    
    # Фильтруем портреты, уже занятые в списке
    exclude_set = set(exclude_frames)
    candidates = [f for f in all_files if extract_frame_num(f.name) not in exclude_set]
    candidates.sort(key=lambda x: extract_frame_num(x.name))

    total = len(candidates)
    if total == 0:
        print(json.dumps({"ok": True, "total_candidates": 0, "series": []}), flush=True)
        return

    frames_data = []
    processed = 0

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(analyze_photo_file, p, str(face_xml), str(eye_xml)) for p in candidates]
        for f in futures:
            res = f.result()
            frames_data.append(res)
            processed += 1
            if processed % 5 == 0 or processed == total:
                pct = int((processed / total) * 100)
                print(json.dumps({"type": "progress", "current": processed, "total": total, "percent": pct}), flush=True)

    frames_data.sort(key=lambda x: x["frame_num"])

    # Кластеризация на серии (Bursts)
    raw_bursts: List[List[Dict[str, Any]]] = []
    curr_burst: List[Dict[str, Any]] = []

    for f in frames_data:
        if not curr_burst:
            curr_burst.append(f)
            continue

        prev = curr_burst[-1]
        t_curr = datetime.fromisoformat(f["dt"]) if f.get("dt") else None
        t_prev = datetime.fromisoformat(prev["dt"]) if prev.get("dt") else None
        time_gap = (t_curr - t_prev).total_seconds() if t_curr and t_prev else 999
        frame_gap = f["frame_num"] - prev["frame_num"]
        face_jump = abs(f["faces_count"] - prev["faces_count"])

        orient_change = (f["is_vert"] != prev["is_vert"] and (f["faces_count"] >= 2 or prev["faces_count"] >= 2))
        is_break = orient_change or time_gap > 35 or frame_gap > 3 or (face_jump >= 6 and time_gap > 12)

        if is_break:
            raw_bursts.append(curr_burst)
            curr_burst = [f]
        else:
            curr_burst.append(f)

    if curr_burst:
        raw_bursts.append(curr_burst)

    # Категоризация серий и выбор лучших дублей
    series_list = []
    small_counter = 1
    general_counter = 1
    boys_counter = 0
    girls_counter = 0

    for idx, burst in enumerate(raw_bursts, 1):
        avg_faces = sum(x["faces_count"] for x in burst) / len(burst)
        max_faces = max(x["faces_count"] for x in burst)
        vert_count = sum(1 for x in burst if x["is_vert"])
        is_vert = vert_count > (len(burst) / 2)
        orientation_str = "Вертикальная" if is_vert else "Горизонтальная"

        # Лучший кадр: максимум лиц, открытых глаз, резкости
        best_frame = max(burst, key=lambda x: (x["faces_count"], x["eyes_count"], x["sharpness"]))

        if max_faces <= 1 and is_vert:
            cat = "EXTRA_PORTRAITS"
            label = "Дополнительный портрет / Одиночный"
        elif max_faces >= 16 or avg_faces >= 14.0:
            cat = "GENERAL_CLASS"
            label = f"Общая фотография класса (серия {general_counter})"
            general_counter += 1
        elif 11 <= max_faces <= 16 and not is_vert and boys_counter < 2:
            cat = "BOYS"
            boys_counter += 1
            label = f"Подгруппа: Мальчики (серия {boys_counter})"
        elif 5 <= max_faces <= 9 and not is_vert and len(burst) >= 4 and girls_counter < 2:
            cat = "GIRLS"
            girls_counter += 1
            label = f"Подгруппа: Девочки (серия {girls_counter})"
        else:
            cat = "SMALL_GROUP"
            label = f"Малая группа / друзья (серия {small_counter})"
            small_counter += 1

        series_id = f"group_s{idx:02d}"
        range_str = f"{burst[0]['name']}..{burst[-1]['name']}" if len(burst) > 1 else burst[0]['name']

        # Включаем в экспорт по умолчанию все группы с 2+ лицами
        include_in_export = (cat != "DO_NOT_USE" and max_faces >= 2)

        series_list.append({
            "series_id": series_id,
            "category": cat,
            "category_label": label,
            "frame_range": range_str,
            "frame_count": len(burst),
            "avg_faces": round(avg_faces, 1),
            "max_faces": max_faces,
            "orientation": orientation_str,
            "recommended_frame": best_frame["name"],
            "chosen_frame": best_frame["name"],
            "best_metrics": {
                "faces": best_frame["faces_count"],
                "eyes": best_frame["eyes_count"],
                "sharpness": best_frame["sharpness"],
                "score": best_frame["score"]
            },
            "include_in_export": include_in_export,
            "frames": burst
        })

    result = {
        "ok": True,
        "type": "result",
        "shoot_dir": str(shoot_dir),
        "total_candidates": total,
        "total_series": len(series_list),
        "categories": CATEGORY_LABELS,
        "series": series_list
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VINETKA AI Group Photo Sorter")
    parser.add_argument("--shoot-dir", required=True, help="Путь к папке фотографий")
    parser.add_argument("--exclude-frames", default="", help="Номера кадров для исключения через запятую")
    parser.add_argument("--workers", type=int, default=6, help="Количество потоков")
    args = parser.parse_args()

    excludes = []
    if args.exclude_frames:
        for x in args.exclude_frames.split(","):
            x = x.strip()
            if x.isdigit():
                excludes.append(int(x))

    run_sorter(args.shoot_dir, excludes, args.workers)
