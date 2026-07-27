# UpgradeLab Online

Frontend работает на GitHub Pages, аккаунты и данные — в Firebase, апгрейды и продажи — в Cloud Functions.

## Важно

Это симулятор без настоящих денег и реальных предметов. `firebaseConfig` в браузере не является паролем. Никогда не публикуй service-account JSON или приватные ключи.

## 1. Firebase Console

1. Authentication → Sign-in method → Email/Password: включить обычный Email/Password. Email link можно выключить.
2. Firestore Database: создать базу.
3. Authentication → Settings → Authorized domains: добавить `<твой-ник>.github.io`.
4. Для Cloud Functions проект обычно должен быть на Blaze plan. Установи бюджетные уведомления в Google Cloud Billing.

## 2. Установка Firebase CLI

Открой терминал в корне проекта:

```bash
npm install
cd functions
npm install
cd ..
npx firebase login
npx firebase use upgradelab
```

## 3. Развернуть сервер и правила

```bash
npm run deploy:backend
```

После этого регистрация, отдельные профили, баланс, инвентарь, история, лента побед и защищённые апгрейды начнут работать.

## 4. GitHub Pages

Создай репозиторий и положи **содержимое папки `public` в корень репозитория**. Затем:

Settings → Pages → Deploy from a branch → `main` / `(root)`.

Или храни весь проект в репозитории, а GitHub Actions копирует `public` в Pages.

## Защита от F5

`startUpgrade` использует Firestore-транзакцию и `requestId`. Повторный запрос с тем же ID возвращает уже сохранённый результат, а не списывает ставку второй раз. Браузер не определяет победу и не меняет баланс напрямую.

## App Check

Сначала проверь сайт без обязательного App Check. Затем подключи reCAPTCHA Enterprise в Firebase Console и поменяй `enforceAppCheck:false` на `true` во всех callable functions. Не включай принудительную проверку до добавления App Check в `public/app.js`, иначе сайт перестанет обращаться к функциям.

## Ограничение текущей сборки

Каталог изображений загружается из открытой базы, а цены пока рассчитываются одинаково у клиента и сохраняются сервером в момент операции. Для действительно рыночных цен нужен отдельный серверный источник цен и каталог цен, которому доверяет Cloud Function.


## V11 без Cloud Functions
Эта версия работает как полностью виртуальный симулятор прямо через Firestore. Обязательно вставьте содержимое `firestore.rules` в Firebase Console → Firestore → Rules → Publish. Баланс пополняется кнопкой `+` рядом с балансом, настоящие платежи отсутствуют.
