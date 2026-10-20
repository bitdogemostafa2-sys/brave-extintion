# تثبيت Brave Multi-Account Containers / Brave Installation

## العربية

### التثبيت السريع (5 دقائق)

1. حمّل المشروع: اضغط `Code → Download ZIP` وفك الضغط.
2. افتح Brave واكتب في شريط العنوان: `brave://extensions/`
3. فعّل **Developer mode** (الزرار أعلى اليمين).
4. اضغط **Load unpacked** واختر مجلد `src` داخل المشروع.
5. ثبّت الأيقونة: اضغط أيقونة القطع (🧩) بجانب شريط العنوان → 📌 Pin بجانب "Firefox Multi-Account Containers".
6. اضغط الأيقونة — ستظهر نفس واجهة Firefox تماماً.

### الاختصارات

- `Ctrl+Period` لفتح اللوحة (قابل للتخصيص في `brave://extensions/shortcuts`)
- `Ctrl+Shift+1`..`0` لفتح الحاويات 1..10

### إلغاء التثبيت

`brave://extensions/` → Remove بجانب الإضافة.

---

## English

### Quick Install (5 minutes)

1. Download project: `Code → Download ZIP` and unzip.
2. Open Brave and go to `brave://extensions/`
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the `src` folder inside the project.
5. Pin the icon: click puzzle piece (🧩) next to address bar → 📌 Pin next to "Firefox Multi-Account Containers".
6. Click the icon — you'll see the exact Firefox UI.

### Shortcuts

- `Ctrl+Period` to open panel (customize at `brave://extensions/shortcuts`)
- `Ctrl+Shift+1`..`0` to open containers 1..10

### Uninstall

`brave://extensions/` → Remove next to extension.

---

## Build for Store

```bash
./bin/build-brave.sh
# creates brave-multi-account-containers.zip ready for Chrome Web Store
```

Brave supports Chrome Web Store extensions natively — uploading there makes it installable on Brave with one click.
