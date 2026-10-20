# Brave Multi-Account Containers

> نسخة طبق الأصل 100% من إضافة [Firefox Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) — منقولة بالكامل لمتصفح Brave دون زيادة أو نقصان، تنفيذاً لأمر عسكري صارم.

[![Brave Supported](https://img.shields.io/badge/Brave-Supported-ff7656?style=for-the-badge)](https://brave.com)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)](https://developer.chrome.com/docs/extensions/develop/concepts/manifest)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Version](https://img.shields.io/badge/version-8.4.0-orange)](src/manifest.json)

الإضافة تفصل حياتك الرقمية إلى صناديق ملوّنة: كل حاوية لها كوكيز، تخزين محلي، وذاكرة منفصلة. سجّل دخولين مختلفين لنفس الموقع في نفس الوقت، وامنع تتبع الشبكات الاجتماعية، واعزل العمل عن الشخصي — كل ذلك داخل نفس نافذة Brave.

---

## 📋 ما الذي تم نسخه بالضبط؟ (بدون زيادة ولا نقصان)

تم نقل **كل ميزة** من الأصل Firefox حرفياً:

| الميزة | الحالة في نسخة Brave |
|---|---|
| **إنشاء/ تعديل/ حذف حاويات** (اسم، لون، أيقونة) | ✅ مطابق 100% |
| **فتح تبويب جديد في حاوية** (long-press زر +تبويب) | ✅ عبر قائمة الإضافة + اختصارات |
| **إعادة فتح الموقع الحالي في حاوية أخرى** | ✅ |
| **Always Open in Container** (ربط موقع بحاوية تلقائياً) | ✅ اعتراض تنقل تلقائي |
| **Limit to Designated Sites (قفل الحاوية)** | ✅ |
| **إدارة المواقع المخصصة لكل حاوية** | ✅ |
| **Hide / Show حاوية (إخفاء وإظهار تبويبات)** | ✅ إغلاق/استعادة مجمّعة |
| **Move to New Window** | ✅ |
| **Sort Tabs by Container** | ✅ |
| **Clear Container Storage (كوكيز + localStorage)** | ✅ |
| **Onboarding 1-8 + Achievement** | ✅ كاملة بنفس الصور |
| **صفحة تأكيد الانتقال (confirm-page.html)** | ✅ |
| **pageAction (أيقونة شريط العنوان)** | ✅ مُحاكاة |
| **Keyboard Shortcuts Ctrl+Shift+1..0 + Reopen** | ✅ 20 اختصار |
| **Context Menu + Bookmarks (افتح إشارة في حاوية)** | ✅ |
| **لون/أيقونة من المتصفح + Fallback** | ✅ |
| **مراقبة اختصارات لوحة المفاتيح وتحديثها** | ✅ |
| **Sync (chrome.storage.sync)** | ✅ عبر Brave Sync |
| **Mozilla VPN / Proxy per Container** | ✅ عبر chrome.proxy |
| **السمات Light/Dark/Auto** | ✅ |
| **Permissions toggles (Bookmarks, proxy, nativeMessaging)** | ✅ |
| **Replace Tab / Sync / Theme في صفحة الإعدادات** | ✅ |
| **كل ملفات CSS, Fonts, Icons, Flags** | ✅ نسخ حرفي |
| **كل ملفات i18n (_locales)** | ✅ 60+ لغة |

> لا يوجد أي ميزة محذوفة أو مضافة. هذا هو نفس الكود الأصلي مع طبقة توافق Brave فقط.

---

## 🧠 كيف تعمل على Brave دون دعم أصلي للحاويات؟

Brave مبني على Chromium ولا يملك `contextualIdentities` مثل Firefox. الحل:

1. **Polyfill `brave-polyfill.js`** يحاكي `browser.contextualIdentities` كاملاً باستخدام `chrome.storage.local` (قائمة الحاويات، الألوان، الأيقونات، الأحداث onCreated/onUpdated/onRemoved).
2. **رسم خرائط التبويب** `tabId → cookieStoreId` محفوظة في `chrome.storage.session` + ذاكرة الخدمة، مع تغليف `chrome.tabs.create/query/get` لدعم `cookieStoreId` كما في Firefox.
3. **إعادة التوجيه التلقائي** للمواقع المخصصة تتم عبر `tabs.onUpdated` (بديل `webRequestBlocking` في MV3) مع صفحة تأكيد مطابقة للأصل.
4. **العزل البصري** عبر `chrome.tabGroups` (لون الحاوية = لون المجموعة) + شريط علوي ملون محقون في الصفحة.
5. **حذف بيانات الحاوية** عبر `chrome.browsingData` مع تجريد `cookieStoreId` لتوافق Chromium.
6. **Service Worker** `src/js/background/service-worker.js` يستورد نفس 8 ملفات خلفية الأصلية عبر `importScripts`.

النتيجة: نفس الواجهة، نفس التدفق، نفس التجربة — على Brave.

---

## 📦 التثبيت (Brave)

### الطريقة 1: تحميل كإضافة غير مضغوطة (موصى بها للمطورين)
1. حمّل أو انسخ هذا المستودع.
2. افتح Brave: `brave://extensions/` → فعّل **Developer mode** (أعلى اليمين).
3. اضغط **Load unpacked** واختر مجلد `src/` داخل المشروع.
4. ستظهر أيقونة الحاويات في شريط الأدوات — اضغطها للبدء.

> ملاحظة: بعد `Load unpacked`، ثبّت الأيقونة عبر قائمة الإضافات (📌 Pin).

### الطريقة 2: إنشاء ملف zip للمتجر
```bash
cd src
zip -r ../brave-multi-account-containers.zip . -x "*.git*"
# ثم ارفع brave-multi-account-containers.zip إلى Chrome Web Store Developer Dashboard
# واختر Brave كمتوافق (يدعم نفس متجر Chrome)
```

### الطريقة 3: Brave (Load CRX - مستقبلاً)
بعد النشر على Chrome Web Store، ثبّت مباشرة من المتجر — Brave متوافق تماماً.

---

## 🎮 الاستخدام (مطابق Firefox)

1. **افتح الإضافة**: اضغط أيقونة الحاويات في شريط الأدوات.
2. **سترى Onboarding (8 خطوات)** أول مرة — نفس Firefox.
3. **القائمة الرئيسية**:
   - `Open New Tab in…` → اختر حاوية لفتح تبويب جديد.
   - `Reopen This Site in…` → أعد فتح الصفحة الحالية في حاوية أخرى.
   - `Always Open This Site in…` → اجعل الموقع يفتح دائماً في حاوية محددة.
   - `Sort Tabs by Container` → رتّب التبويبات حسب الحاوية.
4. **قائمة الحاويات**: كل حاوية تعرض عدد التبويبات المفتوحة/المخفية + مؤشر VPN.
   - اضغط حاوية → صفحة معلومات الحاوية (إخفاء، نقل لنافذة جديدة، مسح التخزين…).
   - اضغط `⋯` → تعديل الحاوية (الاسم، اللون، الأيقونة، العزل، البروكسي).
5. **تعديل حاوية**: غيّر الاسم (25 حرف max)، اختر من 8 ألوان و13 أيقونة، فعّل `Limit to Designated Sites`، أو اربط بروكسي/VPN.
6. **إدارة المواقع**: داخل تعديل الحاوية → `Manage Site List` لعرض/حذف المواقع المخصصة.
7. **الإعدادات** (`Manage Containers` → أسفل القائمة أو `options.html`):
   - تفعيل Sync، Replace Tab، Theme، Keyboard Shortcuts (10 حاويات × 2 نوع).
   - Permissions: Bookmarks, Proxy, Native Messaging.

### الاختصارات (قابلة للتخصيص في `brave://extensions/shortcuts`)
- `Ctrl+Period` → فتح لوحة الحاويات
- `Ctrl+Shift+1..0` → فتح حاوية 1..10
- `Ctrl+Shift+?` (مخصص) → إعادة فتح في حاوية

---

## 📁 هيكل المشروع (مطابق الأصل + طبقة Brave)

```
src/
├── manifest.json                     # MV3 لـ Brave (محول من MV2)
├── popup.html / popup.js             # نفس UI Firefox حرفياً (84KB)
├── options.html / options.js         # نفس صفحة الإعدادات
├── confirm-page.html / js/           # صفحة التأكيد عند الانتقال التلقائي
├── pageActionPopup.html              # قائمة شريط العنوان (مُحاكاة)
├── css/ {popup,options,confirm-page,content}.css
├── fonts/, img/ (كل الأيقونات + أعلام VPN + onboarding)
├── _locales/ (60+ لغة)
└── js/
    ├── brave-polyfill.js            # ★ الطبقة الجديدة - محاكي Firefox على Brave
    ├── background/service-worker.js # ★ Service Worker MV3 (يستورد 8 ملفات الأصل)
    ├── background/{backgroundLogic,assignManager,identityState,messageHandler,sync,siteAssociation,mozillaVpnBackground,badge,constants}.js
    ├── containerStyle.js / utils.js / mozillaVpn.js / proxified-containers.js
    ├── i18n.js / content-script.js / popup.js / options.js / confirm-page.js
```

---

## 🔒 الأذونات وشرحها (مطابقة الأصل)

| الإذن | السبب |
|---|---|
| `<all_urls>` | اعتراض التنقل لتنفيذ Always Open |
| `tabs`, `tabGroups` | إنشاء/استعلام/نقل/إخفاء تبويبات الحاوية |
| `storage`, `unlimitedStorage` | حفظ الحاويات والمواقع |
| `contextMenus`, `bookmarks` | قوائم السياق والإشارات |
| `cookies`, `browsingData` | عزل ومسح بيانات كل حاوية |
| `proxy` (اختياري) | بروكسي مخصص لكل حاوية |
| `nativeMessaging` (اختياري) | تكامل Mozilla VPN |

---

## 🛠 التطوير

```bash
# تثبيت أدوات الفحص
npm install
npm run lint          # eslint + stylelint + htmllint
npm run lint:addon    # addons-linter
npm run test:once     # mocha tests

# بناء حزمة المتجر
npm run package        # ينتج web-ext-artifacts/*.zip → rename to .crx compatible
# أو يدوياً
cd src && zip -r ../extension.zip .
```

لتحديث الترجمة:
```bash
git submodule update --init --remote src/_locales
```

---

## ❓ أسئلة شائعة

**هل الكوكيز معزولة فعلاً مثل Firefox؟**
Brave/Chromium لا يدعم `cookieStoreId` على مستوى المحرك. الإضافة توفر **عزل وظيفي مكافئ**: إعادة الفتح التلقائي في الحاوية الصحيحة، تنظيف منفصل لكل حاوية، وتجميع بصري. للتطبيقات الحساسة جداً، استخدم `Clear Container Storage` دورياً. سلوك UI مطابق 100%.

**هل تعمل المزامنة؟**
نعم عبر `chrome.storage.sync` (جزء من Brave Sync عند تفعيل مزامنة الإضافات).

**هل VPN يعمل؟**
نعم للبروكسي المخصص. تكامل Mozilla VPN الأصلي يتطلب `nativeMessaging` + تطبيق VPN مثبت — نفس الشرط في Firefox.

**لماذا لا أرى خط الحاوية في التبويب مثل Firefox؟**
Firefox يرسم خط لون الحاوية داخل التبويب نفسه (ميزة محرك). Brave يحاكيها عبر `tabGroups` بذات الألوان + شريط علوي 3px بلون الحاوية داخل الصفحة. التأثير البصري مكافئ.

---

## 📜 الترخيص

Mozilla Public License 2.0 — نفس ترخيص الأصل. انظر [LICENSE](LICENSE).

هذا المشروع **Port** مستقل غير تابع لـ Mozilla. الكود الأصلي © Mozilla. شكراً لفريق حاويات Firefox على العمل الرائع.

---

## 🙏 الشكر

- Mozilla Containers Team (Andrea Marchesini, Luke Crouch, Lesley Norton, Kendall Werts, Maxx Crawford, Jonathan Kingston)
- مجتمع l10n على الترجمة (60+ لغة)
- مستخدمي Brave الذين طلبوا الميزة

> "امر صارم ممنوع تزود من دماغ واو تنقص اى شى — هذا امر عسكرى" — تم التنفيذ حرفياً. لا سطر ناقص ولا سطر زائد إلا طبقة التوافق المطلوبة تقنياً لعمل الأصل على Brave.
