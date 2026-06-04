"""
宠物实时识别 — DeepLabCut SuperAnimal 39关键点 + 品种分类 + 行为推断
用法: python pet-vision.py [视频|图片]  (不传参数用摄像头)
环境: D:/temp/dlc-env/Scripts/python
"""
import cv2, sys, torch, math, time, os, numpy as np
from collections import deque
from PIL import Image
from deeplabcut.pose_estimation_pytorch import superanimal_analyze_images
from ultralytics import YOLO
from torchvision import models, transforms

SRC = sys.argv[1] if len(sys.argv) > 1 else None
IS_IMAGE = bool(SRC and SRC.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')))
IS_VIDEO = bool(SRC and not IS_IMAGE)
TMP = 'D:/temp/superanimal'
os.makedirs(os.path.join(TMP, 'output'), exist_ok=True)

ANIMALS = {15: 'Cat', 16: 'Dog'}

# ---- ImageNet labels ----
import urllib.request
IMAGENET = []
try:
    with urllib.request.urlopen('https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt') as f:
        IMAGENET = [l.decode().strip() for l in f.readlines()]
except: pass

# ---- Init models ----
print('[1/3] YOLOv8n...')
detector = YOLO('yolov8n.pt')

print('[2/3] MobileNetV3...')
classifier = models.mobilenet_v3_small(weights='DEFAULT').eval()
preprocess = transforms.Compose([
    transforms.Resize(256), transforms.CenterCrop(224), transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

def classify_breed(crop_bgr):
    if crop_bgr.size == 0: return ''
    img = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))
    t = preprocess(img).unsqueeze(0)
    with torch.no_grad():
        cid = classifier(t).argmax(-1).item()
    return IMAGENET[cid] if cid < len(IMAGENET) else f'class_{cid}'

def run_superanimal(img_path):
    """Run SuperAnimal on an image file, return keypoints array (N,39,3) or None"""
    try:
        r = superanimal_analyze_images(
            images=[img_path], superanimal_name='superanimal_quadruped',
            model_name='rtmpose_s', detector_name='fasterrcnn_mobilenet_v3_large_fpn',
            device='cpu', max_individuals=1, out_folder=os.path.join(TMP, 'output')
        )
        kpts = r[os.path.abspath(img_path)]['bodyparts']  # shape (N,39,3) float32
        if isinstance(kpts, np.ndarray) and kpts.shape[0] > 0:
            return kpts
    except Exception as e:
        pass
    return None

# 加载训练好的行为分类模型
BEHAVIOR_MODEL = None
def _load_model():
    global BEHAVIOR_MODEL
    if BEHAVIOR_MODEL is None:
        import pickle
        try:
            with open('D:/temp/pet_behavior_model.pkl', 'rb') as f:
                BEHAVIOR_MODEL = pickle.load(f)
            print(f'  Behavior model loaded (3 classes)')
        except:
            print('  WARNING: No behavior model found, using fallback rules')
    return BEHAVIOR_MODEL

def infer_behavior(prev_kpts, curr_kpts, w, h):
    """基于39关键点+ML分类器推断行为"""
    if curr_kpts is None: return '无数据', 0, 0
    pts = curr_kpts[0]  # (39,3)

    valid = pts[pts[:, 2] > 0.3]
    if len(valid) < 5: return '关键点不足', 0, 0

    # 运动速度
    movement = 0
    if prev_kpts is not None:
        pp = prev_kpts[0]
        common = sum(1 for i in range(39) if pts[i][2] > 0.3 and pp[i][2] > 0.3)
        if common > 5:
            dx = sum(abs(pts[i][0] - pp[i][0]) + abs(pts[i][1] - pp[i][1])
                     for i in range(39) if pts[i][2] > 0.3 and pp[i][2] > 0.3)
            movement = dx / common

    # 运动状态判定
    if movement > 60: return 'Running/Playing', 0, movement
    if movement > 20: return 'Walking', 0, movement

    # 静态姿态：用训练好的ML模型
    model = _load_model()
    if model is not None:
        features = np.column_stack([pts[:, 0] / w, pts[:, 1] / h, pts[:, 2]]).flatten().reshape(1, -1)
        pred = model.predict(features)[0]
        # 算一个简单的置信度
        probs = model.predict_proba(features)[0]
        conf = max(probs)
        b = {'standing': 'Standing', 'sitting': 'Sitting', 'lying': 'Lying/Resting'}.get(pred, pred)
        return b, conf, movement

    # 回退：简单规则
    height_ratio = (max(p[1] for p in pts if p[2] > 0.3) -
                    sum(p[1] for p in pts[[5,9,13,17]] if p[2] > 0.3) / max(1, sum(1 for i in [5,9,13,17] if pts[i][2] > 0.3))) / max(h, 1)
    return 'Standing' if height_ratio > 0.3 else 'Sitting' if height_ratio > 0.1 else 'Lying/Resting', height_ratio, movement

def draw_kpts(frame, pts, thr=0.3):
    """在帧上画39关键点"""
    colors = [(0,255,0),(255,0,0),(0,0,255),(255,255,0),(255,0,255)]
    for i, (x, y, c) in enumerate(pts):
        if c > thr and x > 0:
            cv2.circle(frame, (int(x), int(y)), 3, colors[min(i//8, 4)], -1)
    # 简化骨架连线：相邻关键点
    for i in range(len(pts)-1):
        if pts[i][2] > thr and pts[i+1][2] > thr and pts[i][0] > 0 and pts[i+1][0] > 0:
            cv2.line(frame, (int(pts[i][0]), int(pts[i][1])),
                     (int(pts[i+1][0]), int(pts[i+1][1])), (180,180,180), 1)
    return frame

# ================== Main ==================
if IS_IMAGE:
    print(f'Analyzing: {SRC}')
    frame = cv2.imread(SRC)
    if frame is None:
        print('Cannot read image'); sys.exit(1)
    h, w = frame.shape[:2]

    # YOLO + breed
    for box in detector(frame, verbose=False)[0].boxes:
        cid = int(box.cls[0])
        if cid not in ANIMALS: continue
        x1,y1,x2,y2 = map(int, box.xyxy[0])
        breed = classify_breed(frame[y1:y2, x1:x2])
        cv2.rectangle(frame, (x1,y1), (x2,y2), (0,255,0), 2)
        # label goes later with behavior

    # SuperAnimal
    kpts = run_superanimal(SRC)
    behavior = ''
    if kpts is not None:
        behavior, hr, mv = infer_behavior(None, kpts, w, h)
        frame = draw_kpts(frame, kpts[0])
        print(f'Behavior: {behavior} | Height ratio: {hr:.3f}')

    # Add labels
    for box in detector(frame, verbose=False)[0].boxes:
        cid = int(box.cls[0])
        if cid not in ANIMALS: continue
        x1,y1,x2,y2 = map(int, box.xyxy[0])
        breed = classify_breed(frame[y1:y2, x1:x2])
        label = f'{ANIMALS[cid]} | {breed}'
        if behavior: label += f' | {behavior}'
        cv2.putText(frame, label, (x1,y1-8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)

    out = SRC.rsplit('.',1)[0] + '_analyzed.jpg'
    cv2.imwrite(out, frame)
    print(f'Saved: {out}')
    cv2.imshow('Result', frame); cv2.waitKey(0); cv2.destroyAllWindows()

elif IS_VIDEO:
    print(f'Analyzing video: {SRC}')
    cap = cv2.VideoCapture(SRC)
    vid_fps = cap.get(cv2.CAP_PROP_FPS) or 25
    total_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval = max(1, int(vid_fps * 0.5))
    print(f'{total_f/vid_fps:.0f}s @ {vid_fps:.0f}fps, sampling every {interval} frames')

    prev, fc, det_count = None, 0, 0
    behaviors = []
    ftmp = os.path.join(TMP, 'vframe.jpg')

    while True:
        ret, frame = cap.read()
        if not ret: break
        fc += 1
        if fc % interval != 0: continue

        cv2.imwrite(ftmp, frame)
        kpts = run_superanimal(ftmp)
        if kpts is not None:
            b, hr, mv = infer_behavior(prev, kpts, frame.shape[1], frame.shape[0])
            prev = kpts
            behaviors.append(b)
            det_count += 1
            print(f'  {fc/vid_fps:.1f}s: {b} | h={hr:.3f} mv={mv:.1f}')
        else:
            print(f'  {fc/vid_fps:.1f}s: no detection')

    cap.release()
    if behaviors:
        from collections import Counter
        print(f'\n=== Summary ({det_count} samples) ===')
        for b, c in Counter(behaviors).most_common():
            print(f'  {b}: {c}x ({c/det_count*100:.0f}%)')

else:
    print('Camera mode. Press Q to quit.')
    print('[3/3] Loading SuperAnimal (first run downloads ~200MB)...')
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    fc, prev, breed, last_b, fps_cnt, fps_t, fps_v = 0, None, '', 0, 0, time.time(), 0
    ftmp = os.path.join(TMP, 'cam.jpg')

    while True:
        ret, frame = cap.read()
        if not ret: continue
        fc += 1; fps_cnt += 1
        if time.time() - fps_t >= 1:
            fps_v = fps_cnt; fps_cnt = 0; fps_t = time.time()

        # Display even when not processing
        cv2.putText(frame, f'FPS: {fps_v}', (5,20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,255), 1)
        cv2.imshow('Pet Vision', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break

        if fc % 20 != 0: continue  # ~0.7s interval

        cv2.imwrite(ftmp, frame)
        kpts = run_superanimal(ftmp)
        if kpts is None: continue

        b, hr, mv = infer_behavior(prev, kpts, frame.shape[1], frame.shape[0])
        prev = kpts
        frame = draw_kpts(frame, kpts[0])

        # YOLO breed
        pet, bbox = '', None
        for box in detector(frame, verbose=False)[0].boxes:
            cid = int(box.cls[0])
            if cid not in ANIMALS: continue
            pet = ANIMALS[cid]
            x1,y1,x2,y2 = map(int, box.xyxy[0])
            bbox = (x1,y1,x2,y2)
            if time.time() - last_b > 5:
                breed = classify_breed(frame[y1:y2, x1:x2])
                last_b = time.time()
            break

        if bbox:
            x1,y1,x2,y2 = bbox
            cv2.rectangle(frame, (x1,y1), (x2,y2), (0,255,0), 2)
            cv2.putText(frame, f'{pet} | {breed} | {b}', (x1,y1-8),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)
        print(f'  {pet} | {breed} | {b}')

    cap.release()
    cv2.destroyAllWindows()
