# DevDigest — план покращень

> **Дата:** 2026-09-20\
> **Обсяг:** весь репозиторій — `server/`, `client/`, `reviewer-core/`, `e2e/`, CI та тулінг.\
> **Підстава:** скіли `onion-architecture`, `frontend-ui-architecture`, `react-best-practices`,
> `next-best-practices`, `fastify-best-practices`, `drizzle-orm-patterns`,
> `postgresql-table-design`, `zod`, `react-testing-library`; `INSIGHTS.md` усіх пакетів.

## Як читати

Кожен пункт спирається на перевірений у коді факт; шлях у кінці — доказ. Для фронтенду вказано
рівень авторитетності за скілом `frontend-ui-architecture`:

- **SPEC** — вимога React / Next.js / TypeScript. Порушення ламає збірку, рантайм або бандл.
- **CONV** — усталена конвенція без офіційного джерела. Рекомендація, а не правило.
- **PROJ** — рішення проєкту. Офіційного джерела немає; питання лише в тому, щоб обрати одне
  і записати.

Пріоритети: **P0** — автоматичні бар'єри, яких зараз немає; **P1** — виміряний архітектурний борг;
**P2** — фронтенд.

## Зведення

| # | Пункт | Частина | Пріоритет |
|---|---|---|---|
| 1 | Лінтера немає в жодному пакеті | крос | P0 — ✅ зроблено |
| 2 | 0 із 48 ручок мають `response`-схему | server | P0 |
| 3 | 0 транзакцій при мультизаписних потоках | server | P0 |
| 4 | Бізнес-логіка і SQL у route-хендлерах | server | P0 |
| 5 | `pnpm arch`: 17 попереджень | server | P1 |
| 6 | Service locator замість DI (36 місць) | server | P1 |
| 7 | 51 FK-колонка проти 18 індексів | server | P1 |
| 8 | N+1 у синхронізації PR | server | P1 |
| 9 | Застосунок повністю клієнтський | client | P2 |
| 10 | Hover у React-стані | client | P2 |
| 11 | Два підходи до стилів; Tailwind не використовується | client | P2 |
| 12 | Немає фабрики ключів TanStack Query | client | P2 |
| 13 | SSE і polling дублюють одне одного | client | P2 |
| 14 | i18n напівзроблений | client | P2 |
| 15 | 14 тест-файлів на 256 вихідних | client | P2 |

## P0 — бар'єри, яких немає

### 1. У репозиторії немає лінтера

Ні ESLint, ні Biome, ні Prettier — ні конфігу, ні залежності, ні скрипта `lint` у жодному з
чотирьох пакетів. П'ять workflow у CI проганяють лише `typecheck` і `vitest`. При цьому в коді
є три коментарі `eslint-disable … react-hooks/exhaustive-deps` — вони декоративні, правило
ніколи не виконувалось проти цього коду.

Наслідок: увесь клас помилок `react-hooks` (застарілі замикання, пропущені залежності, умовні
хуки) не ловиться нічим.

**Дії.** Додати `eslint` + `eslint-plugin-react-hooks` (v5, правила для React 19) +
`@next/eslint-plugin-next` у `client`; `typescript-eslint` у `server` і `reviewer-core`. Скрипт
`lint` у кожен `package.json`, крок у чотири workflow. Перші три місця для перевірки — наявні
`disable`.

**Статус (2026-09-20): зроблено.** ESLint 10 (flat config) у всіх чотирьох пакетах,
скрипт `lint` у кожному `package.json`, кроки в `client.yml`, `server-unit.yml`,
`reviewer-core.yml` і `e2e-web.yml`. Базовий стан: `client` 0 помилок / 13 попереджень,
решта 0 / 0. Правила з порушеннями стоять як `warn` із коментарем `OUTSTANDING`,
як і в `.dependency-cruiser.cjs`; деталі — у `TESTING.md` § Lint.

**Рівень:** SPEC.
**Докази:** `client/src/lib/hooks/reviews.ts:212`,
`client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:60`,
`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:39`

### 2. Жодна з 48 ручок API не має `response`-схеми

`grep 'response:' server/src/modules/*/routes.ts` повертає 0. Водночас `server/AGENTS.md`
стверджує: «One Zod contract drives **both** request validation and response serialization via
`fastify-type-provider-zod`». Документація описує стан, якого немає.

Наслідки не теоретичні: сервер віддає те, що повернув сервіс, без звірки з контрактом; дрейф
ловиться лише `test/contracts.test.ts`; `fast-json-stringify` не вмикається; а клієнт робить
`as T` без парсингу. Контракт не перевіряється **на жодному** кінці.

**Дії.** Додавати `response: { 200: <Contract> }` поручково, починаючи з `reviews` і `pulls`.
Поля, що читаються з jsonb, — `nullish()`, не `nullable()` (див. запис про `RunStats` у
`server/INSIGHTS.md`).

**Докази:** `server/src/modules/reviews/routes.ts:29`, `client/src/lib/api.ts:70`

### 3. Жодної транзакції в усьому сервері

`grep 'transaction(' server/src` — 0 збігів. При цьому є мультизаписні потоки: імпорт деталей PR
робить `delete(prFiles)` → `insert(prFiles)` → `delete(prCommits)` → `insert(prCommits)` поспіль.
Падіння між `delete` і `insert` лишає PR без файлів назавжди, і це не виглядає як збій — PR просто
показується без змін.

**Дії.** Загорнути цю послідовність у `db.transaction`. Друга черга — збереження review + findings
і цикл upsert-ів у settings.

**Докази:** `server/src/modules/pulls/routes.ts:232`, `server/src/modules/settings/routes.ts:52`

### 4. Бізнес-логіка і SQL у route-хендлерах

`pulls/routes.ts` — 374 рядки з прямими `container.db.select/insert/delete`, викликами Octokit і
циклами. `workspace/routes.ts` — те саме в мініатюрі. `pulls` і `workspace` — єдині модулі без
`service.ts`; для порівняння, `reviews/`, `agents/` і `repos/` мають повний набір
routes + service + repository.

`pnpm arch` бачить це як `routes-dont-touch-persistence` (4) і частину
`no-orm-outside-persistence` (8).

**Дії.** Витягнути `pulls/service.ts` і `pulls/repository.ts` за зразком `modules/reviews/`. Це
знімає чотири з сімнадцяти попереджень і робить імпорт PR тестованим без HTTP-сервера.

**Докази:** `server/src/modules/pulls/routes.ts:1`, `server/src/modules/workspace/routes.ts:17`

## P1 — виміряний архітектурний борг

### 5. `pnpm arch`: 17 попереджень — це готовий список

Baseline підтверджено запуском: 0 errors, 17 warnings, 150 модулів, 467 залежностей. Розклад —
ORM поза persistence (8), цикли (5), адаптери знають про модулі (2), крос-модульні внутрішності
(1), routes → schema (4, всередині ORM-суми).

Порядок за співвідношенням ціна/ефект:

1. `adapters/astgrep` і `adapters/depgraph` → `modules/repo-intel/constants.ts` (2 порушення).
   Найдешевше: константи переїжджають у ring 0 або передаються аргументом. Після цього правило
   `adapters-dont-know-modules` підвищується до `error`.
2. `modules/repos/service.ts` → `repo-intel/constants.ts` (1) — те саме.
3. Вузол `container.ts ↔ repo-intel/service.ts` — чотири з п'яти циклів. Причина: `RepoIntelService`
   приймає весь `Container`, а контейнер його ж конструює. Лікується конструктором, що приймає
   рівно потрібне (`git`, `codeIndex`, `config`, `depgraph`, `tokenizer`).

Правило зі скіла: правило переводиться в `error` тим самим комітом, який закриває його останнє
порушення. Зростання будь-якого лічильника — це регресія.

**Докази:** `server/.dependency-cruiser.cjs:12`

### 6. Service locator замість DI

36 звернень `this.container.<щось>` усередині тіл методів: `repo-intel/service.ts` — 15,
`reviews/run-executor.ts` — 10, `repos/service.ts` — 6, решта в `agents/service.ts` і
`reviews/service.ts`. Залежність невидима в сигнатурі, тож тест змушений будувати повний контейнер.

Скіл `onion-architecture` називає це найбільшим боргом пакета і задає режим виправлення:
**при дотику до файлу, ніколи sweep-ом**. `repo-intel/service.ts` (764 рядки — найбільший файл
сервера) варто зробити першим, бо він же центр циклів із пункту 5.

**Докази:** `server/src/modules/repo-intel/service.ts:151`

### 7. 51 FK-колонка проти 18 індексів

Postgres не індексує зовнішні ключі автоматично — це вже коштувало часу на `reviews.pr_id` і
`findings.review_id` (записано в `server/INSIGHTS.md`). Решта FK лишилась неперевіреною, а
`pr_files`, `pr_commits`, `code_chunks` і `references` читаються саме по них.

**Дії.** Пройтись `server/src/db/schema/*.ts`, додати `index()` в extras-колбек для тих FK, що
реально читаються, далі `pnpm db:generate`. Не «всі підряд» — індекс сповільнює запис.

**Докази:** `server/src/db/schema/reviews.ts:53`

### 8. N+1 у синхронізації PR

Цикл по списку PR із окремим `UPDATE` на кожен, і окремий `getPullRequest` на кожен у гілці
з деталями; у polling-модулі — та сама форма. Для репозиторію на 100 PR це 100 раундтрипів.

**Дії.** Батчити: `inArray` для читань, один `insert … on conflict do update` з масивом значень
для записів.

**Докази:** `server/src/modules/pulls/routes.ts:50`, `server/src/modules/polling/routes.ts:31`

## P2 — фронтенд

### 9. Застосунок повністю клієнтський, попри власну конвенцію

Усі 8 `page.tsx` починаються з `'use client'`; директива стоїть у 54 файлах. `client/AGENTS.md`
каже: «Server Components by default; add `'use client'` only where you need state, effects or
TanStack Query» — фактично навпаки.

Наслідок за специфікацією: директива на сторінці затягує в клієнтський бандл усе піддерево, RSC
не використовується взагалі, початковий рендер — порожній каркас плюс запит із браузера.

Чесна рамка: для local-first інструмента з API на окремому порту це може бути свідомим рішенням,
і скіл прямо вимагає не перебудовувати наявний код без запиту. Тому пропонується **розв'язка, а не
міграція**:

- **(а)** визнати SPA-режим і виправити `client/AGENTS.md`, щоб конвенція не суперечила коду; або
- **(б)** на одному маршруті (`/repos/[repoId]/pulls`) спробувати серверний prefetch плюс
  `HydrationBoundary` і виміряти виграш, перш ніж поширювати.

**Рівень:** SPEC (механіка директиви) + PROJ (що з цим робити).
**Докази:** `client/src/app/repos/[repoId]/pulls/page.tsx:3`, `client/AGENTS.md`

### 10. Hover тримається в React-стані

`PRRow` тримає `useState(false)` на рядок списку; `CodeLine` — те саме **на кожен рядок діфа**.
Кожне наведення означає ререндер компонента; у великому діфі це найпомітніше гальмо застосунку.
Ще дев'ять таких місць у `vendor/ui` (`Button`, `Card`, `Chip`, `NavItem`, `IconBtn`, …).

**Дії.** Перевести на CSS `:hover`. Впирається в пункт 11.

**Рівень:** CONV.
**Докази:** `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:18`,
`client/src/components/diff-viewer/CodeLine/CodeLine.tsx`

### 11. Два підходи до стилів; Tailwind оплачений і не використовується

337 інлайнових `style={}` проти 30 `className` (поза `vendor/`), 25 файлів `styles.ts`.
Tailwind 4 стоїть у залежностях і імпортується через `vendor/ui/styles.css`, але класів
практично немає.

Інлайнові стилі не вміють `:hover`, `:focus-visible` і media-запити — звідси й пункт 10, і
відсутність focus-стилів загалом (питання доступності).

**Дії.** Головне — обрати одне. Мінімальний крок без переписування: CSS-класи для інтерактивних
станів (hover / focus) поверх наявних інлайнових стилів; решта лишається як є.

**Рівень:** PROJ.
**Докази:** `client/src/app/repos/[repoId]/pulls/styles.ts:6`, `client/src/app/globals.css:5`

### 12. Немає фабрики ключів TanStack Query

Ключі-літерали розкидані по хуках: `["reviews", prId]`, `["pr-runs", prId]`, `["pull", prId]`,
`["pulls", repoId]`, `["secrets-status"]`, `["provider-models"]` — і інвалідація повторює їх руками
щонайменше у восьми місцях. Друкарська помилка в ключі інвалідації не дає ні помилки типів, ні
падіння тесту: кеш просто не оновлюється.

**Дії.** `client/src/lib/query-keys.ts` із фабрикою; ключі стають типізованими й описаними один раз.

**Рівень:** CONV (офіційні доки не наказують; це стандарт спільноти).
**Докази:** `client/src/lib/hooks/reviews.ts:66`, `client/src/lib/hooks/core.ts:44`

### 13. SSE і polling дублюють одне одного

`usePrRuns` і `usePrActiveRuns` опитують сервер кожні 4 секунди, поки щось виконується, і
паралельно `useRunEvents` тримає `EventSource` на ті самі запуски. Дві правди про один стан.

Додатково: `useRunEvents` накопичує події через `setEvents(prev => [...prev, parsed])` на кожен
кадр — для довгого логу це квадратична робота по ререндерах.

**Дії.** Поки SSE відкритий — глушити `refetchInterval`, а подію `result` / `error` перетворювати
на `qc.invalidateQueries`. Накопичення подій батчити.

**Рівень:** CONV.
**Докази:** `client/src/lib/hooks/reviews.ts:33`, `client/src/lib/hooks/reviews.ts:180`

### 14. i18n напівзроблений

Шістнадцять компонентів у `src/app` без `useTranslations` містять живий англійський текст —
наприклад підписи вкладок `"Agent runs"` і `"Files changed"` у шапці PR, `Description` в
огляді. Локаль одна (`messages/en`), 18 неймспейсів, 1083 рядки.

**Дії.** Або довести до кінця (винести решту рядків), або звузити конвенцію в `client/AGENTS.md`
до «рядки, які реально локалізуються». Зараз правило порушується мовчки.

**Рівень:** PROJ.
**Докази:**
`client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:132`,
`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:16`

### 15. Тестове покриття фронту непропорційне

14 тест-файлів на 256 вихідних (для порівняння, server: 24 на 108). Непокриті: жоден `page.tsx`,
увесь `lib/hooks/*`, `lib/api.ts`, `repo-context`, `toast`.

**Дії.** Першими — `lib/hooks/reviews.ts` (найскладніша логіка: SSE плюс polling) і `lib/api.ts`
(нормалізація помилок). Скіл `react-testing-library` дає готові рецепти для хуків.

**Рівень:** CONV.
**Докази:** `client/vitest.config.ts:19`

## Дрібне, але дешеве

- `EMBEDDINGS_ENABLED: z.string().optional()` плюс порівняння `=== 'true'` — на булів через
  `z.coerce` / `transform`; те саме для `REPO_INTEL_ENABLED`.
  (`server/src/platform/config.ts:24`)
- `reviewer-core` живе на **npm**, решта — на **pnpm**. Ціна: три workflow змушені робити окремий
  `npm ci` у `reviewer-core`, інакше сервер падає з `ERR_MODULE_NOT_FOUND` — це прямо описано
  коментарями в `server-unit.yml` і `e2e-web.yml`. Уніфікація прибирає три кроки CI і цілий клас
  «чому воно не стартує».
- `server/clones/` — 11 МБ склонованих репозиторіїв (включно з копіями самого dev-digest)
  усередині пакета. `.gitignore` їх ловить, але вони засмічують `find` і `grep` і виглядають у
  результатах пошуку як справжній код. Варто винести `DEVDIGEST_CLONE_DIR` за межі пакета за
  замовчуванням. (`server/src/platform/config.ts:72`)
- `client/pnpm-workspace.yaml` (неотрековано) містить незаповнений плейсхолдер
  `allowBuilds: esbuild: set this to true or false`.

## Рекомендований порядок

1. Пункти **1–3** — лінтер, `response`-схеми, транзакції. Три бар'єри, що ловлять помилки
   автоматично й назавжди; жоден не вимагає рефакторингу архітектури.
2. Пункт **5** у названому порядку — прогрес вимірюється командою (`pnpm arch`, 17 → менше).
3. Пункт **4**, і разом із ним **6** для тих файлів, яких торкаємось.
4. Фронтенд: спершу **9** як рішення (а чи б), бо від нього залежить, чи має сенс частина решти;
   далі **12**, **13**, **11 + 10** у парі.

