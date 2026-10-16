"""
face_quality_engine.py - Движок компьютерного зрения для VINETKA Photo Sorter:
1. Классификация пола Ұл / Қыз (Hybrid: казахские окончания, база имен + Face AI InsightFace)
2. Детекция и оценка качества лиц на базе OpenCV YuNet (глаза, взгляд, улыбка, резкость, поворот)
3. Автоматический отбор лучшего кадра в сериях (Bursts)
4. Генерация визуальной отладочной разметки (AI DEBUG overlay)
"""

import sys
import os
import re
import io
import json
import math
import base64
import argparse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import threading
from typing import Dict, Any, List, Optional, Tuple

from PIL import Image, ImageOps
import numpy as np
import cv2
import onnxruntime as ort

# Настройка UTF-8 для stdout/stderr на Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Базовые пути
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
MODELS_DIR = PROJECT_DIR / "models"

YUNET_MODEL = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
DET_FACE_MODEL = MODELS_DIR / "det_face.onnx"
GENDERAGE_MODEL = MODELS_DIR / "genderage.onnx"

# ==============================================================================
# 1. БАЗА КАЗАХСКИХ И РАСПРОСТРАНЕННЫХ ИМЕН И ОКОНЧАНИЙ
# ==============================================================================
FEMALE_NAMES = {
    # Казахские женские имена
    "інкәр", "инкар", "амира", "кәусар", "каусар", "зере", "халида", "ділда", "дильда",
    "айзере", "томирис", "әмина", "амина", "нұрай", "нурай", "айша", "аружан",
    "мәдина", "мадина", "аяла", "назерке", "айым", "айлин", "аяулым", "әсел", "асель",
    "дария", "алтынай", "айгерім", "айгерим", "динара", "жанель", "рамина", "айкөркем",
    "інжу", "фатима", "дана", "адина", "жамиля", "сабина", "мәлика", "малика",
    "аянат", "райана", "жания", "жәнел", "айсана", "көркем", "айғаным", "айлуна",
    "інжумаржан", "сезім", "нұрайым", "айлана", "асылым", "медина", "жансая",
    "баян", "анар", "гүлнар", "карлығаш", "қарлығаш", "назгүл", "айгүл", "жанар",
    "мөлдір", "молдир", "әлия", "алия", "сымбат", "гульназ", "жадыра", "әсем",
    "гүлім", "айдана", "акбота", "ақбота", "құралай", "айтолқын", "марал", "балнұр",
    "жұлдыз", "гауһар", "гаухар", "айша", "ақерке", "шұғыла", "салтанат", "еңлік",
    # Русские и интернациональные женские имена
    "анна", "мария", "елена", "ольга", "татьяна", "наталья", "ирина", "светлана",
    "екатерина", "виктория", "анастасия", "дарья", "полина", "алиса", "софия",
    "софья", "ксения", "валерия", "александра", "евгения", "вероника", "кристина"
}

MALE_NAMES = {
    # Казахские мужские имена
    "айсұлтан", "айсултан", "нұрислам", "нурислам", "әлихан", "алихан", "әмір", "амир",
    "алдияр", "омар", "динмұхаммед", "дінмұхаммед", "расул", "мансұр", "мансур",
    "бейбарыс", "арсен", "ислам", "санджар", "санжар", "алинұр", "алинур", "ернұр",
    "ернур", "асылбек", "байбатыр", "мұхаммедали", "мухаммедали", "әміре", "амире",
    "кемел", "бағдат", "багдат", "шархан", "ерғазы", "ергазы", "аслан", "қуатбек",
    "куатбек", "қуаныш", "куаныш", "берік", "берик", "бекболат", "бахытбек", "бахыт",
    "ербол", "сағынай", "сагынай", "серік", "серик", "дәулет", "даулет", "жанат",
    "нұрсұлтан", "нурсултан", "әлібек", "алибек", "қыдырбай", "кыдырбай", "азамат",
    "дастан", "ербол", "темірлан", "темирлан", "мақсат", "максат", "батырхан",
    # Русские и интернациональные мужские имена
    "александр", "максим", "михаил", "артем", "артём", "иван", "даниил", "дмитрий",
    "кирилл", "марк", "тимур", "роман", "никита", "андрей", "владимир", "сергей"
}

FEMALE_SUFFIXES = ("ова", "ева", "ина", "қызы", "кызы", "ovna", "evna", "қизи")
MALE_SUFFIXES = ("ұлы", "улы", "ов", "ев", "ин", "вич", "uly", "ov", "ev", "оглы")

# ==============================================================================
# 2. КЛАССИФИКАТОР ПОЛА (HYBRID: RULES + FACE AI)
# ==============================================================================
class HybridGenderClassifier:
    def __init__(self):
        self.det_sess = None
        self.ga_sess = None
        self._init_models()

    def _init_models(self):
        try:
            if DET_FACE_MODEL.exists() and GENDERAGE_MODEL.exists():
                opts = ort.SessionOptions()
                opts.inter_op_num_threads = 2
                opts.intra_op_num_threads = 2
                self.det_sess = ort.InferenceSession(str(DET_FACE_MODEL), sess_options=opts, providers=['CPUExecutionProvider'])
                self.ga_sess = ort.InferenceSession(str(GENDERAGE_MODEL), sess_options=opts, providers=['CPUExecutionProvider'])
                self.input_size = (640, 640)
                self._feat_stride_fpn = [8, 16, 32]
                self.num_anchors = 2
                self.det_thresh = 0.5
        except Exception as e:
            # Модели опциональны — текстовые правила работают автономно
            pass

    def _generate_anchors(self, height, width):
        anchor_centers = []
        for stride in self._feat_stride_fpn:
            num_grid_w = width // stride
            num_grid_h = height // stride
            grid_y, grid_x = np.mgrid[:num_grid_h, :num_grid_w]
            anchor_center = np.stack((grid_x, grid_y), axis=-1).reshape(-1, 2)
            anchor_center = (anchor_center * stride).astype(np.float32)
            if self.num_anchors > 1:
                anchor_center = np.repeat(anchor_center, self.num_anchors, axis=0)
            anchor_centers.append(anchor_center)
        return anchor_centers

    def detect_face_bbox(self, img_bgr: np.ndarray) -> Optional[np.ndarray]:
        if self.det_sess is None or img_bgr is None or img_bgr.size == 0:
            return None
        im_ratio = float(img_bgr.shape[0]) / img_bgr.shape[1]
        model_ratio = float(self.input_size[1]) / self.input_size[0]
        if im_ratio > model_ratio:
            new_height = self.input_size[1]
            new_width = int(new_height / im_ratio)
        else:
            new_width = self.input_size[0]
            new_height = int(new_width * im_ratio)

        det_scale = float(new_height) / img_bgr.shape[0]
        resized_img = cv2.resize(img_bgr, (new_width, new_height))
        det_img = np.zeros((self.input_size[1], self.input_size[0], 3), dtype=np.uint8)
        det_img[:new_height, :new_width, :] = resized_img

        blob = cv2.dnn.blobFromImage(det_img, 1.0/128.0, self.input_size, (127.5, 127.5, 127.5), swapRB=True)
        net_outs = self.det_sess.run(None, {self.det_sess.get_inputs()[0].name: blob})

        scores_list = net_outs[:3]
        bboxes_list = net_outs[3:6]
        anchor_centers = self._generate_anchors(self.input_size[1], self.input_size[0])

        all_bboxes, all_scores = [], []
        for idx, stride in enumerate(self._feat_stride_fpn):
            scores = scores_list[idx]
            bbox_preds = bboxes_list[idx] * stride
            anchors = anchor_centers[idx]
            pos_inds = np.where(scores >= self.det_thresh)[0]
            if len(pos_inds) == 0: continue

            scores = scores[pos_inds]
            bbox_preds = bbox_preds[pos_inds]
            anchors = anchors[pos_inds]

            x1 = anchors[:, 0] - bbox_preds[:, 0]
            y1 = anchors[:, 1] - bbox_preds[:, 1]
            x2 = anchors[:, 0] + bbox_preds[:, 2]
            y2 = anchors[:, 1] + bbox_preds[:, 3]
            bboxes = np.stack([x1, y1, x2, y2], axis=1) / det_scale
            all_bboxes.append(bboxes)
            all_scores.append(scores)

        if len(all_bboxes) == 0: return None
        all_bboxes = np.vstack(all_bboxes)
        all_scores = np.vstack(all_scores).flatten()

        keep = cv2.dnn.NMSBoxes(all_bboxes.tolist(), all_scores.tolist(), self.det_thresh, 0.4)
        if len(keep) == 0: return None
        idx = keep[0]
        if isinstance(idx, (list, tuple, np.ndarray)): idx = idx[0]
        return all_bboxes[idx]

    def predict_face_gender(self, img_bgr: np.ndarray) -> Tuple[str, float]:
        if self.ga_sess is None or img_bgr is None or img_bgr.size == 0:
            return "unknown", 0.0

        h, w = img_bgr.shape[:2]
        bbox = self.detect_face_bbox(img_bgr)
        if bbox is not None:
            x1, y1, x2, y2 = bbox
            pad_w = (x2 - x1) * 0.15
            pad_h = (y2 - y1) * 0.15
            x1 = max(0, int(x1 - pad_w))
            y1 = max(0, int(y1 - pad_h))
            x2 = min(w, int(x2 + pad_w))
            y2 = min(h, int(y2 + pad_h))
            face_crop = img_bgr[y1:y2, x1:x2]
        else:
            # Центрированный кроп верхней трети
            face_crop = img_bgr[int(h*0.1):int(h*0.65), int(w*0.2):int(w*0.8)]

        if face_crop.size == 0:
            return "unknown", 0.0

        try:
            face_resized = cv2.resize(face_crop, (96, 96))
            face_rgb = cv2.cvtColor(face_resized, cv2.COLOR_BGR2RGB)
            face_blob = np.transpose(face_rgb, (2, 0, 1)).astype(np.float32)
            face_blob = np.expand_dims(face_blob, axis=0)

            res = self.ga_sess.run(None, {'data': face_blob})[0]
            logits = res[0, :2]
            exp_l = np.exp(logits - np.max(logits))
            probs = exp_l / np.sum(exp_l)
            f_prob = float(probs[0])
            m_prob = float(probs[1])

            if f_prob > m_prob:
                return "girl", f_prob
            else:
                return "boy", m_prob
        except Exception:
            return "unknown", 0.0

    def classify_name(self, name_str: str) -> Tuple[Optional[str], float, str]:
        if not name_str:
            return None, 0.0, "empty"

        clean = re.sub(r'[\d\.,\-_—–()]+', ' ', name_str).strip().lower()
        words = clean.split()

        # 1. Сначала проверяем точные окончания фамилии и отчества
        for w in words:
            for suf in FEMALE_SUFFIXES:
                if w.endswith(suf):
                    return "girl", 0.99, f"suffix:{suf}"
            for suf in MALE_SUFFIXES:
                if w.endswith(suf):
                    return "boy", 0.99, f"suffix:{suf}"

        # 2. Проверяем словарные имена
        for w in words:
            if w in FEMALE_NAMES:
                return "girl", 0.98, f"name_dict:{w}"
            if w in MALE_NAMES:
                return "boy", 0.98, f"name_dict:{w}"

        # 3. Эвристика по казахским корням в именах
        male_stems = ("сұлтан", "султан", "бек", "хан", "бай", "батыр", "әлі", "али", "нұр", "нур", "дин", "дін", "жан")
        female_stems = ("гүл", "гул", "ай", "айым", "нұр", "нур", "көркем", "коркем", "әсем", "асем")

        for w in words:
            # Окончания женских имен
            if w.endswith(("гүл", "гул", "айым", "ерке", "көркем")):
                return "girl", 0.90, "stem_female"
            # Окончания мужских имен
            if w.endswith(("бек", "бай", "хан", "сұлтан", "султан", "батыр")):
                return "boy", 0.90, "stem_male"

        return None, 0.0, "unknown"

    def classify_student(self, name: str, photo_path: Optional[str] = None) -> Dict[str, Any]:
        # Шаг 1: Анализ текста ФИО
        rule_gender, rule_conf, rule_source = self.classify_name(name)

        # Если имя четко определило пол с высокой уверенностью (>= 0.95), возвращаем сразу
        if rule_gender and rule_conf >= 0.95:
            return {
                "gender": rule_gender,
                "confidence": rule_conf,
                "source": rule_source,
                "requires_review": False
            }

        # Шаг 2: Face AI по фотографии (если фото доступно)
        ai_gender = "unknown"
        ai_conf = 0.0
        if photo_path and os.path.exists(photo_path):
            try:
                with Image.open(photo_path) as im:
                    t = ImageOps.exif_transpose(im)
                    t.thumbnail((800, 800))
                    img_bgr = cv2.cvtColor(np.array(t), cv2.COLOR_RGB2BGR)
                    ai_gender, ai_conf = self.predict_face_gender(img_bgr)
            except Exception:
                pass

        # Шаг 3: Синтез правил и Face AI
        if rule_gender:
            if ai_gender != "unknown" and rule_gender != ai_gender and ai_conf > 0.85:
                # Конфликт имени и лица! Отправляем на проверку
                return {
                    "gender": rule_gender,
                    "confidence": 0.55,
                    "source": f"conflict(rule:{rule_gender},ai:{ai_gender})",
                    "requires_review": True
                }
            return {
                "gender": rule_gender,
                "confidence": max(rule_conf, ai_conf),
                "source": rule_source if ai_gender == "unknown" else f"{rule_source}+ai",
                "requires_review": False
            }

        if ai_gender != "unknown":
            return {
                "gender": ai_gender,
                "confidence": round(ai_conf, 2),
                "source": "face_ai",
                "requires_review": (ai_conf < 0.70)
            }

        return {
            "gender": "unknown",
            "confidence": 0.0,
            "source": "none",
            "requires_review": True
        }


# ==============================================================================
# 3. АНАЛИЗАТОР КАЧЕСТВА ЛИЦ YUNET (ГЛАЗА, ВЗГЛЯД, УЛЫБКА, РЕЗКОСТЬ)
# ==============================================================================
class YuNetQualityAnalyzer:
    def __init__(self, score_thresh: float = 0.40):
        self.score_thresh = score_thresh
        self.detector = None
        self._init_detector()

    def _init_detector(self):
        if YUNET_MODEL.exists():
            try:
                self.detector = cv2.FaceDetectorYN.create(
                    model=str(YUNET_MODEL),
                    config="",
                    input_size=(320, 320),
                    score_threshold=self.score_thresh,
                    nms_threshold=0.30,
                    top_k=5000
                )
            except Exception as e:
                pass

    def is_available(self) -> bool:
        return self.detector is not None

    def analyze_photo(self, photo_path: str, max_dim: int = 1920, require_group: bool = False) -> Dict[str, Any]:
        p = Path(photo_path)
        if not p.exists():
            return {"ok": False, "error": f"Файл не найден: {photo_path}"}

        try:
            with Image.open(p) as im:
                exif = im._getexif() or {}
                t_str = exif.get(36867) or exif.get(306)
                dt = datetime.strptime(t_str, "%Y:%m:%d %H:%M:%S") if t_str else None

                t = ImageOps.exif_transpose(im)
                orig_w, orig_h = t.size
                is_vert = orig_h > orig_w

                # Масштабируем для оптимальной скорости и точности
                scale = min(1.0, max_dim / max(orig_w, orig_h))
                new_w = int(orig_w * scale)
                new_h = int(orig_h * scale)

                resized = t.resize((new_w, new_h), Image.Resampling.BILINEAR)
                img_bgr = cv2.cvtColor(np.array(resized), cv2.COLOR_RGB2BGR)

            faces_list = []
            if self.detector is not None:
                self.detector.setInputSize((new_w, new_h))
                _, raw_faces = self.detector.detect(img_bgr)
                raw_faces = raw_faces if raw_faces is not None else []
            else:
                raw_faces = []

            # Быстрый фильтр: если отбираем коллажи, а на фото < 2 лиц — пропускаем сразу без тяжелых расчетов
            if require_group and len(raw_faces) < 2:
                return {
                    "ok": True,
                    "name": p.name,
                    "path": str(p),
                    "dt": dt.isoformat() if dt else None,
                    "is_vert": is_vert,
                    "orig_size": [orig_w, orig_h],
                    "faces_count": len(raw_faces),
                    "is_group": False,
                    "overall_score": 0.0,
                    "group_score": 0.0,
                    "group_reason": "Одиночный кадр",
                    "faces": []
                }

            gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
            global_sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

            total_eyes_open = 0
            total_looking_camera = 0
            total_smiling = 0
            face_scores = []

            for f in raw_faces:
                fx, fy, fw, fh = map(int, f[:4])
                re_x, re_y, le_x, le_y, nt_x, nt_y, rm_x, rm_y, lm_x, lm_y = map(int, f[4:14])
                conf = float(f[14])

                # Границы лица с безопасным отступом
                fx = max(0, fx)
                fy = max(0, fy)
                fw = min(new_w - fx, fw)
                fh = min(new_h - fy, fh)

                # Фильтр 1: минимальный физический размер лица
                if fw < 24 or fh < 24:
                    continue

                # Фильтр 2: Биологическая геометрия (глаза выше носа, нос выше рта)
                eyes_y = (re_y + le_y) / 2.0
                mouth_y = (rm_y + lm_y) / 2.0
                nose_y = float(nt_y)
                if not (eyes_y < nose_y < mouth_y):
                    continue

                # Фильтр 3: Глазное расстояние (не меньше 18% ширины лица)
                inter_eye_dist = math.hypot(le_x - re_x, le_y - re_y)
                if inter_eye_dist < (fw * 0.18):
                    continue

                # Фильтр 4: Краевые артефакты (если лицо обрезано границей кадра и низкий скор)
                touches_border = (fx <= 2 or fy <= 2 or (fx + fw) >= (new_w - 2) or (fy + fh) >= (new_h - 2))
                if touches_border and conf < 0.70:
                    continue

                face_roi_gray = gray[fy:fy+fh, fx:fx+fw]
                face_sharpness = float(cv2.Laplacian(face_roi_gray, cv2.CV_64F).var()) if face_roi_gray.size > 0 else 0.0

                # 1. Глаза (Open vs Closed)
                # Расстояние между глазами
                inter_eye_dist = math.hypot(le_x - re_x, le_y - re_y)
                eye_r = max(4, int(inter_eye_dist * 0.16))

                # Оценка открытости правого и левого глаза
                r_eye_open = self._check_eye_open(gray, re_x, re_y, eye_r)
                l_eye_open = self._check_eye_open(gray, le_x, le_y, eye_r)
                both_eyes_open = (r_eye_open and l_eye_open)
                if both_eyes_open:
                    total_eyes_open += 1

                # 2. Взгляд в камеру (Gaze alignment)
                # Положение носа относительно центров глаз:
                if abs(le_x - re_x) > 2:
                    gaze_ratio = (nt_x - min(re_x, le_x)) / abs(le_x - re_x)
                    looking_camera = (0.32 <= gaze_ratio <= 0.68)
                else:
                    looking_camera = True
                if looking_camera:
                    total_looking_camera += 1

                # 3. Улыбка (Smile)
                mouth_width = math.hypot(lm_x - rm_x, lm_y - rm_y)
                smile_ratio = (mouth_width / inter_eye_dist) if inter_eye_dist > 5 else 0.65
                is_smiling = (smile_ratio >= 0.76)
                if is_smiling:
                    total_smiling += 1

                # 4. Наклон головы (Tilt)
                tilt_deg = math.degrees(math.atan2(le_y - re_y, le_x - re_x)) if abs(le_x - re_x) > 1 else 0.0
                tilt_ok = abs(tilt_deg) < 18.0

                # 5. Оценка качества конкретного лица (0..100)
                face_score = 100.0
                penalties = []

                if not both_eyes_open:
                    face_score -= 35.0
                    penalties.append("Көз жұмулы / Закрыты глаза (-35)")

                if not looking_camera:
                    face_score -= 20.0
                    penalties.append("Қарамай тұр / Отвод взгляда (-20)")

                if face_sharpness < 45.0:
                    face_score -= 25.0
                    penalties.append("Бұлыңғыр / Не в фокусе (-25)")
                elif face_sharpness < 100.0:
                    face_score -= 10.0

                if not tilt_ok:
                    face_score -= 10.0
                    penalties.append("Бас қисайған / Наклон головы (-10)")

                if is_smiling:
                    face_score = min(100.0, face_score + 5.0)

                face_score = max(5.0, face_score)
                face_scores.append(face_score)

                # Переводим координаты обратно в исходное разрешение
                faces_list.append({
                    "bbox": [int(fx / scale), int(fy / scale), int(fw / scale), int(fh / scale)],
                    "landmarks": [
                        [int(re_x / scale), int(re_y / scale)],
                        [int(le_x / scale), int(le_y / scale)],
                        [int(nt_x / scale), int(nt_y / scale)],
                        [int(rm_x / scale), int(rm_y / scale)],
                        [int(lm_x / scale), int(lm_y / scale)]
                    ],
                    "confidence": round(conf, 2),
                    "eyes_open": both_eyes_open,
                    "looking_camera": looking_camera,
                    "is_smiling": is_smiling,
                    "sharpness": round(face_sharpness, 1),
                    "score": round(face_score, 1),
                    "penalties": penalties
                })

            # Фильтр относительной площади (отсекаем пуговицы и значки на одежде в портретах)
            if len(faces_list) > 1:
                max_area = max(f["bbox"][2] * f["bbox"][3] for f in faces_list)
                if max_area > (orig_w * orig_h * 0.012):
                    faces_list = [f for f in faces_list if (f["bbox"][2] * f["bbox"][3]) >= max_area * 0.15]

            faces_count = len(faces_list)
            total_eyes_open = sum(1 for f in faces_list if f["eyes_open"])
            total_looking_camera = sum(1 for f in faces_list if f["looking_camera"])
            total_smiling = sum(1 for f in faces_list if f["is_smiling"])
            face_scores = [f["score"] for f in faces_list]
            avg_face_score = (sum(face_scores) / faces_count) if faces_count > 0 else 0.0

            # Итоговый балл фото
            overall_score = 0.0
            if faces_count > 0:
                overall_score = avg_face_score * 0.70 + min(100.0, (global_sharpness / 200.0) * 100.0) * 0.30
                # Штраф за закрытые глаза у кого-либо в групповом кадре
                closed_count = faces_count - total_eyes_open
                if closed_count > 0:
                    overall_score -= (closed_count * 15.0)
            else:
                overall_score = min(100.0, (global_sharpness / 250.0) * 100.0)

            overall_score = max(0.0, min(100.0, overall_score))

            # Специализированная оценка качества для групповых коллажей
            group_score, group_reason = self.compute_group_score(
                faces_count=faces_count,
                eyes_open_count=total_eyes_open,
                looking_camera_count=total_looking_camera,
                sharpness=global_sharpness,
                is_vert=is_vert
            )

            return {
                "ok": True,
                "name": p.name,
                "path": str(p),
                "dt": dt.isoformat() if dt else None,
                "is_vert": is_vert,
                "orig_size": [orig_w, orig_h],
                "faces_count": faces_count,
                "eyes_open_count": total_eyes_open,
                "looking_camera_count": total_looking_camera,
                "smiling_count": total_smiling,
                "sharpness": round(global_sharpness, 1),
                "avg_face_score": round(avg_face_score, 1),
                "overall_score": round(overall_score, 1),
                "group_score": group_score,
                "group_reason": group_reason,
                "faces": faces_list
            }

        except Exception as e:
            return {"ok": False, "name": p.name, "path": str(p), "error": str(e), "overall_score": 0.0, "group_score": 0.0, "faces_count": 0}

    @staticmethod
    def compute_group_score(faces_count: int, eyes_open_count: int, looking_camera_count: int, sharpness: float, is_vert: bool) -> Tuple[float, str]:
        if faces_count < 2:
            return 0.0, "Одиночный кадр"

        # 1. Открытые глаза: +35 за 100% открытые, строгий штраф -15 за каждого моргнувшего ребенка
        eye_ratio = eyes_open_count / faces_count
        closed_count = faces_count - eyes_open_count
        eye_score = (eye_ratio * 35.0) - (closed_count * 15.0)

        # 2. Взгляд в камеру: +25 за всех смотрящих прямо в объектив
        looking_ratio = looking_camera_count / faces_count
        gaze_score = looking_ratio * 25.0

        # 3. Резкость лиц и кадра (до 20 баллов)
        sharp_score = min(20.0, (sharpness / 350.0) * 20.0)

        # 4. Ориентация кадра для выпускного альбома:
        # Для разворота альбома стандартом является горизонтальная альбомная ориентация.
        # Вертикальные кадры с большой группой (>= 4 чел) сильно штрафуются (-20), так как не помещаются по ширине.
        if not is_vert:
            orient_score = 15.0
            orient_text = "көлденең / горизонтальная"
        else:
            orient_text = "тік / вертикальная"
            orient_score = -20.0 if faces_count >= 4 else 0.0

        # 5. Бонус за полноту состава
        group_bonus = min(5.0, faces_count * 0.25)

        total = 10.0 + eye_score + gaze_score + sharp_score + orient_score + group_bonus
        final_score = round(max(0.0, min(100.0, total)), 1)

        # Человекочитаемая причина выбора кадра
        reasons = []
        if closed_count == 0:
            reasons.append(f"барлық көздер ашық ({eyes_open_count}/{faces_count})")
        else:
            reasons.append(f"жабық көздер: {closed_count}")

        if looking_camera_count == faces_count:
            reasons.append("камераға қараған")
        else:
            reasons.append(f"камераға: {looking_camera_count}/{faces_count}")

        reasons.append(orient_text)
        reasons.append(f"анықтығы {round(sharpness)}")

        return final_score, ", ".join(reasons)

    def _check_eye_open(self, gray: np.ndarray, ex: int, ey: int, r: int) -> bool:
        """Проверка открытости глаза по дисперсии градиента/яркости зрачка."""
        h, w = gray.shape[:2]
        x1 = max(0, ex - r)
        y1 = max(0, ey - r)
        x2 = min(w, ex + r)
        y2 = min(h, ey + r)

        eye_patch = gray[y1:y2, x1:x2]
        if eye_patch.size < 9:
            return True

        # Открытый глаз имеет темный зрачок и белую склеру -> высокая вариация яркости
        # Закрытый глаз -> однородное веко телесного цвета -> низкая дисперсия
        std = float(np.std(eye_patch))
        return std > 12.0

    def generate_debug_image(self, photo_path: str, max_dim: int = 1200) -> Optional[str]:
        """Создает изображение с наложенной визуальной отладкой (боксы, лендмарки, баллы)."""
        res = self.analyze_photo(photo_path, max_dim=max_dim)
        if not res.get("ok"):
            return None

        p = Path(photo_path)
        with Image.open(p) as im:
            t = ImageOps.exif_transpose(im)
            scale = min(1.0, max_dim / max(t.size))
            w = int(t.size[0] * scale)
            h = int(t.size[1] * scale)
            resized = t.resize((w, h), Image.Resampling.BILINEAR)
            img_bgr = cv2.cvtColor(np.array(resized), cv2.COLOR_RGB2BGR)

        # Отрисовка каждого лица
        for f in res.get("faces", []):
            bx, by, bw, bh = [int(v * scale) for v in f["bbox"]]
            score = f["score"]

            # Цвет бокса: Зеленый (>=75), Желтый (50-74), Красный (<50)
            if score >= 75:
                color = (46, 204, 113) # Зеленый
            elif score >= 50:
                color = (52, 152, 219) # Голубой/Желтый
            else:
                color = (50, 50, 230) # Красный

            cv2.rectangle(img_bgr, (bx, by), (bx + bw, by + bh), color, 2)

            # Точки лендмарков
            for idx, lm in enumerate(f.get("landmarks", [])):
                lx, ly = int(lm[0] * scale), int(lm[1] * scale)
                pt_color = (0, 255, 255) if idx == 2 else ((255, 255, 0) if idx < 2 else (255, 0, 255))
                cv2.circle(img_bgr, (lx, ly), 3, pt_color, -1)

            # Бейдж с оценкой
            label = f"{int(score)}%"
            if not f.get("eyes_open"):
                label += " [CLOSED]"
            cv2.putText(img_bgr, label, (bx, max(18, by - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Верхняя информационная панель
        banner_h = 36
        banner = np.zeros((banner_h, w, 3), dtype=np.uint8)
        banner[:] = (20, 24, 28)

        txt = f"VINETKA AI: Faces {res['faces_count']} | Eyes OK: {res['eyes_open_count']} | Score: {res['overall_score']}/100"
        cv2.putText(banner, txt, (14, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 255), 2)

        final_img = np.vstack([banner, img_bgr])

        # Кодируем в JPEG base64
        _, enc = cv2.imencode('.jpg', final_img, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        b64 = base64.b64encode(enc.tobytes()).decode('ascii')
        return f"data:image/jpeg;base64,{b64}"


# ==============================================================================
# 4. CLI ИНТЕРФЕЙС ДЛЯ ELECTRON IPC
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="VINETKA AI Vision Engine")
    parser.add_argument("--mode", choices=["gender", "quality", "bursts", "debug-image"], required=True)
    parser.add_argument("--input-json", help="Path to JSON file with input parameters")
    parser.add_argument("--photo", help="Path to single photo for analysis or debug")
    parser.add_argument("--shoot-dir", help="Path to shoot directory for bursts")
    parser.add_argument("--exclude-frames", default="", help="Comma separated frame numbers to exclude")
    args = parser.parse_args()

    # РЕЖИМ 1: КЛАССИФИКАЦИЯ ҰЛ / ҚЫЗ
    if args.mode == "gender":
        clf = HybridGenderClassifier()
        items = []
        if args.input_json and os.path.exists(args.input_json):
            with open(args.input_json, "r", encoding="utf-8") as f:
                items = json.load(f)
        elif not sys.stdin.isatty():
            try:
                items = json.load(sys.stdin)
            except Exception:
                items = []

        results = []
        for it in items:
            name = it.get("name", "")
            photo_path = it.get("photoPath") or it.get("path")
            res = clf.classify_student(name, photo_path)
            res["id"] = it.get("id")
            res["name"] = name
            results.append(res)

        print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))
        return

    # РЕЖИМ 2: АНАЛИЗ ОДНОГО ФОТО
    if args.mode == "quality":
        if not args.photo:
            print(json.dumps({"ok": False, "error": "Missing --photo"}), flush=True)
            return
        qa = YuNetQualityAnalyzer()
        res = qa.analyze_photo(args.photo)
        print(json.dumps(res, ensure_ascii=False))
        return

    # РЕЖИМ 3: AI DEBUG OVERLAY IMAGE
    if args.mode == "debug-image":
        if not args.photo:
            print(json.dumps({"ok": False, "error": "Missing --photo"}), flush=True)
            return
        qa = YuNetQualityAnalyzer()
        img_b64 = qa.generate_debug_image(args.photo)
        if img_b64:
            print(json.dumps({"ok": True, "photo": args.photo, "debug_image": img_b64}))
        else:
            print(json.dumps({"ok": False, "error": "Failed to generate debug image"}))
        return

    # РЕЖИМ 4: ОТБОР ГРУППОВЫХ СЕРИЙ (BURSTS) НА БАЗЕ YUNET
    if args.mode == "bursts":
        shoot_dir = Path(args.shoot_dir) if args.shoot_dir else None
        if not shoot_dir or not shoot_dir.exists():
            print(json.dumps({"ok": False, "error": f"Invalid shoot dir: {args.shoot_dir}"}))
            return

        exclude_set = set()
        if args.exclude_frames:
            for s in args.exclude_frames.split(","):
                s = s.strip()
                if s.isdigit():
                    exclude_set.add(int(s))

        valid_exts = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
        all_files = [f for f in shoot_dir.iterdir() if f.is_file() and f.suffix.lower() in valid_exts]

        def get_frame_num(fn: str) -> int:
            m = re.findall(r'\d+', fn)
            return int(m[-1]) if m else 0

        # Исключаем явные номера портретов из списка учеников
        candidates = [f for f in all_files if get_frame_num(f.name) not in exclude_set]
        candidates.sort(key=lambda x: get_frame_num(x.name))

        total = len(candidates)
        if total == 0:
            print(json.dumps({"ok": True, "total_candidates": 0, "total_series": 0, "series": []}))
            return

        # Изолированный детектор для каждого потока (защита от сбоев многопоточности OpenCV DNN)
        thread_local = threading.local()
        def get_thread_qa():
            if not hasattr(thread_local, 'qa'):
                thread_local.qa = YuNetQualityAnalyzer()
            return thread_local.qa

        def worker_analyze(path):
            qa = get_thread_qa()
            # Быстрое сканирование: если лиц меньше 2, пропускаем тяжелые расчеты
            res = qa.analyze_photo(str(path), max_dim=1024, require_group=True)
            res["frame_num"] = get_frame_num(res.get("name", ""))
            return res

        frames_data = []
        processed = 0

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(worker_analyze, p) for p in candidates]
            for f in futures:
                res = f.result()
                frames_data.append(res)
                processed += 1
                if processed % 10 == 0 or processed == total:
                    pct = int((processed / total) * 100)
                    print(json.dumps({"type": "progress", "current": processed, "total": total, "percent": pct, "stage": "faces"}), flush=True)

        frames_data.sort(key=lambda x: x["frame_num"])
        print(json.dumps({"type": "progress", "percent": 100, "stage": "done"}), flush=True)

        # ЖЕСТКИЙ ФИЛЬТР: оставляем ТОЛЬКО групповые кадры (faces_count >= 2)
        # Одиночные портреты и пустые кадры исключаются из коллажей навсегда!
        group_frames = [f for f in frames_data if f.get("faces_count", 0) >= 2]

        if not group_frames:
            print(json.dumps({"ok": True, "shoot_dir": str(shoot_dir), "total_candidates": total, "total_series": 0, "series": []}, ensure_ascii=False))
            return

        # Кластеризация групповых кадров на настоящие серии дублей
        raw_bursts = []
        curr_burst = []

        for f in group_frames:
            if not curr_burst:
                curr_burst.append(f)
                continue

            prev = curr_burst[-1]
            t_curr = datetime.fromisoformat(f["dt"]) if f.get("dt") else None
            t_prev = datetime.fromisoformat(prev["dt"]) if prev.get("dt") else None
            time_gap = (t_curr - t_prev).total_seconds() if t_curr and t_prev else 999
            frame_gap = f["frame_num"] - prev["frame_num"]
            face_diff = abs(f["faces_count"] - prev["faces_count"])
            orient_diff = (f.get("is_vert") != prev.get("is_vert"))

            # Граница серии: смена ориентации, пауза более 35 сек, пропуск более 5 номеров кадров или сильная разница состава
            is_break = orient_diff or time_gap > 35 or frame_gap > 5 or face_diff > 4

            if is_break:
                raw_bursts.append(curr_burst)
                curr_burst = [f]
            else:
                curr_burst.append(f)

        if curr_burst:
            raw_bursts.append(curr_burst)

        series_list = []
        small_counter = 1
        general_counter = 1
        boys_counter = 0
        girls_counter = 0

        for idx, burst in enumerate(raw_bursts, 1):
            avg_faces = sum(x.get("faces_count", 0) for x in burst) / len(burst)
            max_faces = max(x.get("faces_count", 0) for x in burst)
            vert_count = sum(1 for x in burst if x.get("is_vert"))
            is_vert = vert_count > (len(burst) / 2)
            orientation_str = "Вертикальная" if is_vert else "Горизонтальная"

            # ИНТЕЛЛЕКТУАЛЬНЫЙ ВЫБОР ЛУЧШЕГО КАДРА ИЗ СЕРИИ:
            # Сравниваем дубли по group_score: открытые глаза у всех детей, взгляд в объектив,
            # горизонтальная альбомная компоновка и резкость на лицах!
            best_frame = max(burst, key=lambda x: (x.get("group_score", 0.0), x.get("sharpness", 0.0)))

            if max_faces >= 15 or avg_faces >= 14.0:
                cat = "GENERAL_CLASS"
                label = f"Общая фотография класса (серия {general_counter})"
                general_counter += 1
            elif 9 <= max_faces < 15 and not is_vert and boys_counter < 2:
                cat = "BOYS"
                boys_counter += 1
                label = "Группа: Мальчики"
            elif 9 <= max_faces < 15 and not is_vert and girls_counter < 2:
                cat = "GIRLS"
                girls_counter += 1
                label = "Группа: Девочки"
            else:
                cat = "SMALL_GROUP"
                label = f"Малая группа (серия {small_counter})"
                small_counter += 1

            range_str = f"{burst[0]['name']}..{burst[-1]['name']}" if len(burst) > 1 else burst[0]['name']

            series_list.append({
                "series_id": f"s{str(idx).zfill(2)}",
                "category": cat,
                "category_label": label,
                "frame_range": range_str,
                "frame_count": len(burst),
                "avg_faces": round(avg_faces, 1),
                "max_faces": max_faces,
                "orientation": orientation_str,
                "recommended_frame": best_frame["name"],
                "chosen_frame": best_frame["name"],
                "selection_reason": best_frame.get("group_reason", "Высокое качество композиции"),
                "best_metrics": {
                    "faces": best_frame.get("faces_count", 0),
                    "eyes": best_frame.get("eyes_open_count", 0),
                    "looking_camera": best_frame.get("looking_camera_count", 0),
                    "sharpness": best_frame.get("sharpness", 0.0),
                    "score": best_frame.get("group_score", best_frame.get("overall_score", 0.0)),
                    "orientation": "Вертикальная" if best_frame.get("is_vert") else "Горизонтальная"
                },
                "include_in_export": True,
                "frames": [{
                    "name": fr["name"],
                    "path": fr["path"],
                    "frame_num": fr["frame_num"],
                    "faces_count": fr.get("faces_count", 0),
                    "eyes_open_count": fr.get("eyes_open_count", 0),
                    "looking_camera_count": fr.get("looking_camera_count", 0),
                    "score": fr.get("group_score", fr.get("overall_score", 0.0)),
                    "sharpness": fr.get("sharpness", 0.0),
                    "is_vert": fr.get("is_vert", False)
                } for fr in burst]
            })

        print(json.dumps({
            "ok": True,
            "shoot_dir": str(shoot_dir),
            "total_candidates": total,
            "total_series": len(series_list),
            "series": series_list
        }, ensure_ascii=False))

if __name__ == "__main__":
    main()
