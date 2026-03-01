# منظومة إدارة مدرسة الشمامسة

منظومة ويب لإدارة مدرسة الشمامسة للمديرين والمدرسين والطلاب وأولياء الأمور.

## التشغيل المحلي
1. تثبيت الحزم:

```bash
npm install
```

2. إعداد Firebase Admin في `.env.local`:

```
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

3. تشغيل السيرفر:

```bash
npm run dev
```

## المسارات الأساسية
- الواجهة الرئيسية: `src/app/page.tsx`
- تسجيل الدخول: `src/app/login/page.tsx`
- بوابة الدور: `src/app/portal/page.tsx`
- لوحة التحكم: `src/app/dashboard/page.tsx`
- الإعدادات: `src/app/settings/page.tsx`
