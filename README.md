<div align="center">

<img src="og-image.jpg" width="92%" alt="DEVZIKKY CHECKOUT — support and checkout artwork">

# 💳 DEVZIKKY CHECKOUT

### More than a checkout. A support platform for the work behind DEVZIKKY TECH.

**A developer-built payment, project-support and transaction-management platform.**

<p>
  <a href="https://devzikkycheckout.vercel.app/"><img src="https://img.shields.io/badge/Live%20on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Live on Vercel"></a>
  <a href="https://devzikkycheckout.myng.net/"><img src="https://img.shields.io/badge/Custom%20domain-myng.net-8b7cff?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Custom domain"></a>
  <img src="https://img.shields.io/badge/Hosting%20tested-Vercel%20only-55e6ff?style=for-the-badge&logo=vercel&logoColor=black" alt="Vercel only tested">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 20 or newer">
  <img src="https://img.shields.io/badge/Payments-Paystack-00C3F7?style=for-the-badge" alt="Paystack">
  <img src="https://img.shields.io/badge/Database-Neon%20Postgres-00E599?style=for-the-badge&logo=postgresql&logoColor=black" alt="Neon PostgreSQL">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-4cdda0?style=for-the-badge" alt="MIT License"></a>
</p>

<p>
  <a href="https://github.com/zikky0001-droid/DEVZIKKY-CHECKOUT">Repository</a>
  ·
  <a href="https://devzikkycheckout.vercel.app/">Live application</a>
  ·
  <a href="https://devzikkycheckout.vercel.app/api">API documentation</a>
  ·
  <a href="https://devzikkycheckout.vercel.app/statistics">Statistics Centre</a>
</p>

<br>

<img src="icon1.jpg" width="570" alt="DEVZIKKY CHECKOUT icon artwork">
&nbsp;&nbsp;&nbsp;
<img src="icon2.jpg" width="670" alt="DEVZIKKY CHECKOUT alternate icon artwork">

<br>

**BUILD · TEST · VERIFY · IMPROVE**

</div>

---

## 📌 About the project

**DEVZIKKY CHECKOUT** is the payment and support platform for projects built under the **DEVZIKKY TECH** identity.

It gives visitors a way to make voluntary contributions or service payments while providing the developer with tools to initialize payments, verify transaction status, review records, inspect aggregate statistics and maintain the platform.

The project is designed around a practical principle: a checkout should do more than collect a payment. It should also provide clear payment information, dependable verification, useful operational visibility and sensible privacy boundaries.

> **Hosting and testing scope:** This project has been deployed and tested on **Vercel only**. Vercel is the only hosting platform currently verified for this repository. Other hosting providers and deployment environments have not been tested, and compatibility with them is not claimed.

## 🌐 Live deployments

| Environment | URL |
|---|---|
| Primary Vercel deployment | [devzikkycheckout.vercel.app](https://devzikkycheckout.vercel.app/) |
| Custom domain | [devzikkycheckout.myng.net](https://devzikkycheckout.myng.net/) |
| Public API documentation | [Open API docs](https://devzikkycheckout.vercel.app/api) |
| Statistics Centre | [Open statistics](https://devzikkycheckout.vercel.app/statistics) |
| Support information | [How to support](https://devzikkycheckout.vercel.app/support) |
| Project directory | [Explore projects](https://devzikkycheckout.vercel.app/projects) |

The Vercel URL is used as the primary project reference in this README. The `.myng.net` address is the connected custom domain. Both addresses currently serve the application.

## 🖼️ Project artwork

The repository includes its own artwork. These are local repository assets, not externally hosted placeholders.

| Asset | Purpose |
|---|---|
| `og-image.jpg` | Lightweight social-sharing and link-preview artwork |
| `icon1.jpg` | Primary project artwork |
| `icon2.jpg` | Alternate project artwork |

The Open Graph artwork is kept separate from the larger icon artwork so link previews can use a smaller image.

---

## ✨ What the platform includes

### 💳 Checkout and payments

- Paystack-powered payment initialization and checkout redirection.
- Donation and service-payment flows.
- NGN settlement with support for entering amounts in configured currencies.
- Server-side amount validation; whole-number amounts only.
- Configured NGN payment range: **₦100–₦5,000,000**.
- Server-side payment verification using the transaction reference.
- Paystack webhook handling for payment events.
- Clear payment-return and thank-you experience.
- Exchange-rate lookup with stored snapshots and a configured fallback path.

### 🔐 Admin Control Room

The private Control Room provides administrative access to transaction records and related operational actions.

- Administrator authentication using the server-side `ADMIN_KEY`.
- Transaction listing with status information.
- Transaction exports in JSON format.
- Status filters for all, successful, pending and failed records.
- Donor/contact details remain within the protected administrative area.

### 📊 Statistics Centre

The Statistics Centre presents aggregate transaction information.

- Successful, pending and failed/reversed transaction counts.
- Verified payment value in NGN.
- Daily, weekly, monthly and yearly grouping.
- Custom date ranges and preset periods.
- Payment timeline and value visualizations.
- Payment-type and original-currency breakdowns.
- Recent public activity references.
- JSON exports for statistics and public payment activity.
- Africa/Lagos timezone handling.
- Up to three years of statistics history, subject to retained records.

Public statistics are aggregate-focused. The public activity export excludes donor names, email addresses and private notes. A note is included publicly only when the donor explicitly opted in.

### 📡 Runtime Logs

A separate, private Runtime Logs area provides a view of Vercel runtime activity.

- Dedicated Runtime Logs sign-in and session handling.
- Vercel project/deployment log retrieval.
- Refresh and filter/search tools in the dashboard.
- Sanitization of sensitive values before log display.
- Uses Vercel-side access configuration; the Vercel token is not placed in browser code.

Runtime Logs require the optional Vercel environment variables listed below.

### 🔌 Server-to-server automation API

The automation API lets a server-side integration create and verify payment transactions without using the website checkout form.

- `POST /api/automation/initialize`
- `POST /api/automation/verify`
- Authenticated using `Authorization: Bearer YOUR_API_KEY`.
- Uses the existing `API_KEY` environment variable.
- Optional name, email and note fields on initialization.
- Server-side verification determines the payment state; clients cannot declare a payment successful themselves.

### 🩺 Service and developer endpoints

The public API includes liveness, readiness, payment-limit, exchange-rate and statistics endpoints. See the [API documentation](https://devzikkycheckout.vercel.app/api) for request examples and response formats.

---

## 🧭 How a website payment works

```text
Visitor opens the checkout
          │
          ▼
Enters payment details and amount
          │
          ▼
DEVZIKKY PAY validates the request
          │
          ▼
Server initializes the transaction with Paystack
          │
          ▼
Visitor is redirected to Paystack Checkout
          │
          ▼
Paystack processes the payment
          │
          ├──────────────► Paystack webhook event
          │
          ▼
Server verifies the transaction with Paystack
          │
          ▼
Transaction status is stored in Neon Postgres
          │
          ▼
Thank-you / payment status page
          │
          ▼
Admin Dashboard and aggregate Statistics Centre
```

A browser redirect alone is not proof of payment. The application uses server-side Paystack verification to establish the transaction status.

## 🔌 API overview

The API documentation page is the source of truth for the public request and response formats.

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `GET` | `/api/ping` | Lightweight service liveness check | Public |
| `GET` | `/api/health` | Database/schema/configuration readiness | Public; does not expose secret values |
| `GET` | `/api/payment-limits` | Current NGN payment limits and whole-number rule | Public |
| `GET` | `/api/rates` | Configured exchange-rate response | Public |
| `GET` | `/api/rate` | Compatibility alias for `/api/rates` | Public |
| `POST` | `/api/pay/initialize` | Initialize a website checkout | Public checkout flow |
| `GET` | `/api/pay/verify?reference=...` | Verify a website payment reference | Public checkout flow |
| `GET` | `/api/stats` | Aggregate statistics and time series | Public aggregate data |
| `GET` | `/api/stats/export` | Public successful-payment activity export | Public, privacy-filtered |
| `POST` | `/api/automation/initialize` | Create a server-to-server payment link | Bearer API key |
| `POST` | `/api/automation/verify` | Verify a server-to-server transaction | Bearer API key |
| `POST` | `/api/webhook` | Receive Paystack webhook events | Paystack signature validation |

Private Admin and Runtime Logs routes are intentionally not listed as public-use endpoints. They require their respective authentication/session controls.

### 🧪 Automation API example

Initialize a transaction:

```bash
curl -X POST \
  "https://devzikkycheckout.vercel.app/api/automation/initialize" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "amount": 1500,
    "name": "Example",
    "email": "billing@example.com",
    "note": "Automation"
  }'
```

Verify a previously created reference:

```bash
curl -X POST \
  "https://devzikkycheckout.vercel.app/api/automation/verify" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "reference": "DZP-REPLACE-WITH-REFERENCE"
  }'
```

**Initialization rules**

- `amount` is required and must be a whole-number NGN amount.
- The accepted range is ₦100 through ₦5,000,000 inclusive.
- `name` is optional (maximum 20 characters).
- `email` is optional (maximum 50 characters) and must be valid.
- `note` is optional (maximum 200 characters).
- Omitted, `null`, empty/whitespace values and the literal string `"null"` use the configured defaults for optional fields.
- Optional fields must otherwise be strings.

**Verification rule:** `ok: true` means the verification request was processed. Only `paid: true` with `payment_status: "success"` confirms a successful payment. A pending or failed state must not be treated as paid.

---

## 🧰 Technology stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript |
| Serverless API | Node.js on Vercel Functions |
| Runtime | Node.js 20 or newer |
| Database | Neon serverless PostgreSQL |
| Database client | `@neondatabase/serverless` |
| Payment provider | Paystack |
| Charts | Chart.js |
| Chart interactions | Hammer.js and Chart.js Zoom plugin |
| Hosting tested | Vercel only |

The frontend is a static HTML/CSS/JavaScript application. Backend routes are implemented as Vercel serverless functions. The project does not use a separate frontend framework or application build pipeline in the current package configuration.

## 🗂️ Repository structure

```text
DEVZIKKY-CHECKOUT/
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── config.js
├── schema.sql
├── vercel.json
│
├── icon1.jpg
├── icon2.jpg
├── og-image.jpg
│
├── api/
│   ├── [...path].js
│   ├── admin/
│   │   ├── export.js
│   │   ├── login.js
│   │   ├── logout.js
│   │   ├── logs.js
│   │   └── transactions.js
│   ├── automation/
│   │   └── [action].js
│   ├── logs/
│   │   └── [action].js
│   ├── pay/
│   │   ├── initialize.js
│   │   └── verify.js
│   └── stats/
│       └── export.js
│
└── public/
    ├── index.html
    ├── about.html
    ├── projects.html
    ├── donate.html
    ├── support.html
    ├── faq.html
    ├── privacy.html
    ├── roadmap.html
    ├── statistics.html
    ├── api.html
    ├── admin.html
    ├── control-room.html
    ├── log.html
    ├── thank-you.html
    ├── 404.html
    ├── app.js
    ├── site.js
    ├── footer.js
    ├── statistics-visuals.js
    ├── statistics.css
    ├── style.css
    ├── checkout.css
    ├── logs.css
    ├── theme.css
    ├── theme-init.js
    ├── loader.js
    ├── loader.css
    ├── effects.css
    ├── footer.css
    ├── thank-you.css
    ├── error-monitor.js
    ├── icon1.jpg
    ├── icon2.jpg
    └── og-image.jpg
```

The API directory contains explicit Vercel function entry points. The shared API router keeps common payment, verification, authentication and data-handling logic centralized.

---

## 🚀 Deployment — Vercel

> [!IMPORTANT]
> **Vercel is the only hosting platform on which this project has been tested.** The repository is public, but that does not mean deployment has been validated on Netlify, Render, Railway, Cloudflare, GitHub Pages or a generic Node.js server. Do not assume those platforms are compatible without separate testing.

### Requirements

- A GitHub account and access to this repository.
- A Vercel account.
- A Neon PostgreSQL database.
- A Paystack account and server-side API key.
- A Node.js 20+ runtime (as declared in `package.json`).

### Setup

1. Fork or clone this repository.
2. Create a Neon PostgreSQL database.
3. Run `schema.sql` once against a **new** database to create the required database objects.
4. Import the repository into Vercel.
5. Configure the environment variables listed below in Vercel Project Settings.
6. Set `APP_URL` to the production URL that should be used for payment return/callback URLs.
7. Deploy the project through Vercel.
8. Test `/api/ping`, `/api/health`, the checkout flow and payment verification after deployment.

**Database note:** `schema.sql` is the initial schema setup. Do not use it as a replacement for a migration on an existing database containing live transactions.

### Vercel environment variables

Set these in the Vercel project settings. Do not commit real values to GitHub.

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `PAYSTACK_KEY` | Yes | Server-side Paystack API key |
| `ADMIN_KEY` | Yes | Private Admin and Runtime Logs credential basis |
| `API_KEY` | Yes | Bearer key for server-to-server automation endpoints |
| `APP_URL` | Yes | Application base URL used when creating payment callback URLs |
| `VERCEL_ACCESS_TOKEN` | Runtime Logs only | Server-side Vercel API access |
| `VERCEL_PROJECT_ID` | Runtime Logs only | Vercel project identifier for log retrieval |
| `VERCEL_TEAM_ID` | Runtime Logs only | Vercel team identifier for log retrieval |

The optional Runtime Logs variables are needed only when enabling the private Vercel Runtime Logs dashboard.

See [`.env.example`](.env.example) for variable names and placeholder formats. The example file does not contain production credentials.

---

## 🔒 Security and privacy notes

- Keep `DATABASE_URL`, `PAYSTACK_KEY`, `ADMIN_KEY`, `API_KEY` and Vercel access credentials server-side.
- Never put secret values in `public/`, browser JavaScript, HTML, query parameters, screenshots or public issue reports.
- Use separate strong random values for `ADMIN_KEY` and `API_KEY`.
- The automation API requires a Bearer API key.
- The Admin Control Room is protected by its own session flow.
- Runtime Logs use a separate session namespace and remain private.
- Public statistics and activity exports are designed to exclude donor names, email addresses and private notes.
- Public notes are exposed only when the donor explicitly opts in.
- Do not commit `.env` files or real provider credentials.
- Rotate any credential that has been accidentally exposed.

This README describes the current repository design; it is not a substitute for reviewing the deployment configuration and security settings before operating your own instance.

---

## 🧑‍💻 About the developer

**DEV ZIKKY** is a student developer and independent builder working under the **DEVZIKKY TECH** identity.

The wider project ecosystem explores practical software across:

- Web development and responsive interfaces.
- Node.js, APIs and backend integrations.
- AI assistants and model-provider experiments.
- Email workflows and temporary inbox tools.
- Telegram automation and bot utilities.
- Developer tools, calculators and content utilities.
- Security-awareness projects.

A hands-on workflow is part of the story: experimenting, reading documentation, writing code, testing requests, debugging failures, deploying, monitoring and improving. Some projects have been developed directly from an Android device using Termux alongside other development tools.

> *Build something useful. Test what matters. Improve what is real.*

## 🌐 Other DEVZIKKY projects

DEVZIKKY CHECKOUT is one part of a wider collection of independent projects.

| Project | What it explores | Link |
|---|---|---|
| **ZIKKY AI** | AI chat and assistant experiments | [zikky-ai.xo.je](https://zikky-ai.xo.je) |
| **DEVZIKKY AI** | Developer-oriented AI assistant | [devzikky.onrender.com](https://devzikky.onrender.com) |
| **ZMAIL Studio** | Email workspace and sending API | [zmail.zone.id](https://zmail.zone.id) |
| **ZMAIL Drop** | Public temporary inbox | [zmaildrop.vercel.app](https://zmaildrop.vercel.app) |
| **ZDROPMAIL** | Separate temporary inbox experiment | [zdropmail.vercel.app](https://zdropmail.vercel.app) |
| **ZQUOTE** | Quote-image generation API | [zquote-tau.vercel.app](https://zquote-tau.vercel.app) |
| **DEV ZIKKY PAIR** | WhatsApp bot utility | [dev-zikky-pair.onrender.com](https://dev-zikky-pair.onrender.com) |
| **ZIKKY Manga Hub** | Manga reader project | [zikkymangahub.onrender.com](https://zikkymangahub.onrender.com) |
| **ZIKKY Calculator** | Lightweight web calculator | [zikkycal.netlify.app](https://zikkycal.netlify.app) |
| **ZIKKY Telegram Bot** | Telegram automation and utilities | [t.me/zbot101bot](https://t.me/zbot101bot) |
| **Phishing Edu** | Security-awareness learning project | [zikkyphishing.netlify.app](https://zikkyphishing.netlify.app) |

These are separate projects with their own deployments, capabilities and availability. They are not bundled dependencies of DEVZIKKY CHECKOUT.

---

## 🤝 Support the work

Support for DEVZIKKY TECH can help with the practical costs of maintaining public projects:

- Hosting and serverless function usage.
- Database usage and storage.
- Domain renewals.
- Development tools and infrastructure.
- Testing, maintenance and future improvements.

Support is voluntary. You can also help by exploring the projects, reporting reproducible issues, suggesting improvements or contributing to the code.

**Support page:** [DEVZIKKY CHECKOUT — Donate & Support](https://devzikkycheckout.vercel.app/donate)

## 📬 Contact and links

| Channel | Destination |
|---|---|
| 🌐 Portfolio | [zikkytech.xo.je](https://zikkytech.xo.je) |
| 💻 GitHub | [@zikky0001-droid](https://github.com/zikky0001-droid) |
| ✉️ Email | [zikkystar0001@gmail.com](mailto:zikkystar0001@gmail.com) |
| 📸 Instagram | [@devzikky](https://instagram.com/devzikky) |
| ▶️ YouTube | [@devzikky](https://m.youtube.com/@devzikky) |
| 🎵 TikTok | [@devzikky](https://www.tiktok.com/@devzikky) |
| ✈️ Telegram | [@devzikky](https://t.me/devzikky) |

For project questions, bug reports and technical discussion, GitHub Issues and the public contact channels above are the preferred starting points.

---

## 🧩 Contributing

Contributions, issue reports and documentation improvements are welcome.

A useful contribution process:

1. Fork the repository.
2. Create a focused feature branch.
3. Make a small, clearly scoped change.
4. Test the affected behavior on the Vercel deployment workflow.
5. Describe what changed and how it was checked.
6. Open a pull request with relevant context.

Keep changes consistent with the existing architecture. In particular, avoid exposing credentials, weakening payment verification, changing privacy defaults or adding serverless functions without considering the Vercel deployment limits configured for this project.

## 📜 License

This project is released under the **MIT License**. See [`LICENSE`](LICENSE) for the full text.

---

<div align="center">

### ⭐ Explore. Learn. Build. Improve.

If this project is useful or interesting, consider giving the repository a star.

<a href="https://github.com/zikky0001-droid/DEVZIKKY-CHECKOUT">
  <img src="https://img.shields.io/badge/STAR%20THE%20REPOSITORY-07090d?style=for-the-badge&logo=github&logoColor=8b7cff" alt="Star this repository">
</a>
<a href="https://github.com/zikky0001-droid/DEVZIKKY-CHECKOUT/issues">
  <img src="https://img.shields.io/badge/REPORT%20AN%20ISSUE-07090d?style=for-the-badge&logo=github&logoColor=55e6ff" alt="Report an issue">
</a>

**DEVZIKKY CHECKOUT** · A project by **DEVZIKKY TECH**

Built with curiosity, tested on Vercel, and improved one iteration at a time.

🇳🇬 **DEVZIKKY TECH**

</div>
