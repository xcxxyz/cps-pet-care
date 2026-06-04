"""猫狗姿态分类训练 — 在VS Code终端运行: python train_model.py"""
import csv, os, torch, numpy as np, time
from torch import nn, optim
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms
from datasets import load_dataset
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from collections import Counter

DEVICE = 'cpu'; BATCH = 24; EPOCHS = 60; SAMPLES = 500

print('=== Loading 900 labeled dog images (300/class) ===')
dog_lbl = {}
for fn in os.listdir('D:/temp/labels'):
    if fn.startswith('._') or not fn.endswith('.csv'): continue
    with open(os.path.join('D:/temp/labels', fn), encoding='utf-8') as f:
        for row in csv.DictReader(f):
            dog_lbl[row['id']] = row['label']

dog_ds = load_dataset('stockeh/dog-pose-cv', split='train')
all_imgs, all_labels = [], []
pc = {'standing': 0, 'sitting': 0, 'lying': 0}
for item in dog_ds:
    img_id = item['__key__'].split('/')[-1] + '.jpg'
    lbl = dog_lbl.get(img_id)
    if lbl and lbl in pc and pc[lbl] < SAMPLES:
        img = item['jpg']
        if img.mode == 'RGBA': img = img.convert('RGB')
        all_imgs.append(img); all_labels.append(lbl); pc[lbl] += 1
    if all(v >= SAMPLES for v in pc.values()): break
print(f'Loaded: {Counter(all_labels)}')

M = {'standing': 0, 'sitting': 1, 'lying': 2}
tt = transforms.Compose([
    transforms.RandomResizedCrop(224, scale=(0.7, 1)),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(0.2, 0.2, 0.2),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])
vt = transforms.Compose([
    transforms.Resize(256), transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

class DS(Dataset):
    def __init__(self, idxs, tf): self.idxs, self.tf = idxs, tf
    def __len__(self): return len(self.idxs)
    def __getitem__(self, i):
        idx = self.idxs[i]; return self.tf(all_imgs[idx]), M[all_labels[idx]]

idx_all = list(range(len(all_imgs)))
tr_idx, te_idx = train_test_split(idx_all, test_size=0.3, stratify=all_labels, random_state=42)
tr_ds, te_ds = DS(tr_idx, tt), DS(te_idx, vt)
tr_dl = DataLoader(tr_ds, batch_size=BATCH, shuffle=True)
print(f'Train: {len(tr_ds)}, Test: {len(te_ds)}')

model = models.mobilenet_v3_small(weights='DEFAULT')
model.classifier[3] = nn.Linear(1024, 3)
model = model.to(DEVICE)

opt = optim.AdamW(model.parameters(), lr=0.001)
sch = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)
# 类别加权：lying和sitting较难，给更高权重
class_weights = torch.tensor([1.0, 1.2, 1.3], device=DEVICE)  # standing=1, sitting=1.2, lying=1.3
crit = nn.CrossEntropyLoss(weight=class_weights)

# 同步写日志文件
import sys
LOG = open('D:/temp/training_log.txt', 'a', buffering=1)
def log(msg):
    print(msg, flush=True)
    LOG.write(msg + '\n')
    LOG.flush()
    sys.stdout.flush()

# 测试: 单batch前向传播
log('[TEST] Running one batch to verify...')
test_im, test_lb = next(iter(tr_dl))
test_im, test_lb = test_im.to(DEVICE), test_lb.to(DEVICE)
with torch.no_grad():
    out = model(test_im)
log(f'[TEST] OK - output shape: {out.shape}, sample preds: {out.argmax(1)[:5].tolist()}')

log(f'\n=== Training {EPOCHS} epochs, {len(tr_dl)} batches/epoch ===')
t0 = time.time(); best = 0
for e in range(EPOCHS):
    t_epoch = time.time()
    model.train(); tl = 0
    for bi, (im, lb) in enumerate(tr_dl):
        im, lb = im.to(DEVICE), lb.to(DEVICE)
        opt.zero_grad(); loss = crit(model(im), lb); loss.backward(); opt.step(); tl += loss.item()
    sch.step()

    model.eval(); c = t = 0
    with torch.no_grad():
        for i, lb in enumerate([all_labels[i] for i in te_idx]):
            im = vt(all_imgs[te_idx[i]]).unsqueeze(0).to(DEVICE)
            c += (model(im).argmax(1).item() == M[lb]); t += 1
    a = c / t
    if a > best:
        best = a
        torch.save(model.state_dict(), 'D:/temp/behavior_model/cnn_model_best.pt')
        log(f'  >>> New best model saved: {a:.1%}')
    elapsed = time.time() - t0
    log(f'  [{elapsed:.0f}s] E{e+1}/{EPOCHS}: loss={tl/len(tr_dl):.3f} acc={a:.1%} best={best:.1%} ({time.time()-t_epoch:.0f}s/epoch)')

log(f'\n=== Done! Best: {best:.1%} ({time.time()-t0:.0f}s) ===')

model.eval(); ap, at = [], []
with torch.no_grad():
    for i, lb in enumerate([all_labels[i] for i in te_idx]):
        im = vt(all_imgs[te_idx[i]]).unsqueeze(0).to(DEVICE)
        ap.append(model(im).argmax(1).item()); at.append(M[lb])
rev = {0: 'standing', 1: 'sitting', 2: 'lying'}
log(classification_report([rev[t] for t in at], [rev[p] for p in ap], digits=3))

os.makedirs('D:/temp/behavior_model', exist_ok=True)
torch.save(model.state_dict(), 'D:/temp/behavior_model/cnn_model.pt')
print('Model saved: D:/temp/behavior_model/cnn_model.pt')
