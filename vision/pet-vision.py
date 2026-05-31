"""
宠物视觉识别 — YOLOv8 预训练模型 + 行为推断
USB 摄像头 → 品种检测 → 行为识别 → Bridge API 上报
"""
import cv2, time, json, urllib.request
from ultralytics import YOLO
from collections import deque

BRIDGE = 'http://localhost:3000/api/data'

# 初始化 YOLOv8（首次自动下载预训练模型 ~6MB）
print('Loading YOLOv8n...')
model = YOLO('yolov8n.pt')

# 动物类别（COCO dataset）
ANIMALS = {
    15: '猫', 16: '狗', 17: '马', 18: '羊', 19: '牛',
    20: '大象', 21: '熊', 22: '斑马', 23: '长颈鹿'
}

# 行为推断用历史位置
track = deque(maxlen=30)  # 最近 30 帧位置
last_report = 0
camera = cv2.VideoCapture(0)

while True:
    ret, frame = camera.read()
    if not ret:
        print('摄像头未找到')
        time.sleep(3)
        continue

    results = model(frame, verbose=False)[0]

    pet_type = ''
    behavior = ''
    bbox = None

    for box in results.boxes:
        cls_id = int(box.cls[0])
        if cls_id in ANIMALS:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            track.append((cx, cy))
            pet_type = ANIMALS[cls_id]
            bbox = (x1, y1, x2, y2)
            break  # 只取第一个检测到的动物

    # 行为推断：基于位置变化
    if len(track) >= 10:
        dx = track[-1][0] - track[0][0]
        dy = track[-1][1] - track[0][1]
        dist = (dx * dx + dy * dy) ** 0.5
        if dist < 15:
            behavior = '睡觉/休息'
        elif dist < 60:
            behavior = '舔毛/小动'
        else:
            behavior = '走动/活动'
    elif pet_type:
        behavior = '观察中...'

    # 每 2 秒上报
    now = time.time()
    if now - last_report >= 2 and pet_type:
        data = {'vision_type': pet_type, 'vision_behavior': behavior}
        try:
            req = urllib.request.Request(BRIDGE, data=json.dumps(data).encode(),
                headers={'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=2)
            print(f'{pet_type} | {behavior}')
        except: pass
        last_report = now

    # 显示
    if bbox:
        x1, y1, x2, y2 = bbox
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame, f'{pet_type} {behavior}', (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    cv2.imshow('Pet Vision', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

camera.release()
cv2.destroyAllWindows()
