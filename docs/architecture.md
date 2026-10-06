# BOOST architecture

Diagrams of the system as it is actually built. Every relationship here was read
out of the code — route mounts in `backend/server.js`, the tables in
`backend/schema.sql`, the mounts in each `frontend/*.html`.

All diagrams are Mermaid, so they render on GitHub and stay diff-able in review.

---

## Component diagram

What the system is made of, and how the pieces depend on each other.

```mermaid
flowchart TB
    subgraph Browser["Browser — one page per module"]
        direction TB
        HTML["Page shell<br/>dashboard / requests / quotations /<br/>orders / documents / bidding /<br/>reports / scanner / settings"]
        Layout["layout.js<br/><i>nav, sidebar, bell, drawer,<br/>badges, BOOST.json()</i>"]
        Icons["icons.js<br/><i>inline SVG set</i>"]
        DT["datatable.js<br/><i>shared list: filters, sort,<br/>pagination, bulk actions</i>"]
        Pages["Per-page module script<br/><i>requests.js, bidding.js,<br/>reports.js, scanner.js…</i>"]
        Auth["login.js / reset.js<br/><i>public pages</i>"]
    end

    subgraph Server["Node.js — single Express process, port 4000"]
        direction TB
        MW["Middleware chain<br/>helmet · cors · cookieParser ·<br/>express.json · /api logger + no-store"]
        PG["middleware/auth.js<br/><i>readSession, requireAuth,<br/>requirePageAuth</i>"]
        subgraph Routers["Routers — one per domain"]
            direction LR
            RAuth["auth.js<br/><i>7 endpoints</i>"]
            RReq["requests.js<br/><i>7</i>"]
            RMod["modules.js<br/><i>7</i>"]
            RBid["bidding.js<br/><i>7</i>"]
            RRep["reports.js<br/><i>4</i>"]
            RDash["dashboard.js<br/><i>1</i>"]
            RAcc["account.js<br/><i>2</i>"]
            RNot["notifications.js<br/><i>1</i>"]
            RScan["scanner.js<br/><i>2</i>"]
        end
        subgraph Services["Services"]
            direction LR
            SAct["activity.js<br/><i>audit trail</i>"]
            SMail["mailer.js<br/><i>password reset</i>"]
            SOcr["ocr.js<br/><i>tesseract worker</i>"]
        end
        Static["express.static<br/><i>frontend/ + uploads/</i>"]
    end

    subgraph Data["State"]
        DB[("PostgreSQL<br/>10 tables")]
        FS[["uploads/<br/><i>scans and attachments</i>"]]
        Lang[["langdata/<br/><i>eng.traineddata</i>"]]
    end

    SMTP["SMTP server<br/><i>optional</i>"]
    Console["Server console<br/><i>fallback when no SMTP</i>"]

    HTML --> Layout
    Layout --> Icons
    Layout --> DT
    Layout <--> Pages
    DT --> Pages
    HTML --> Auth

    Layout & DT & Pages & Auth -.->|"fetch /api/*<br/>credentials: include"| MW
    MW --> PG
    PG --> Routers
    Routers --> Services
    Routers --> Static
    Static --> FS
    SOcr --> Lang
    Routers & Services --> DB
    SMail --> SMTP
    SMail -.->|"no SMTP_HOST"| Console
```

---

## Deployment diagram

What has to exist for BOOST to run, and where each piece lives.

```mermaid
flowchart TB
    User(("Procurement staff<br/><i>browser</i>"))

    subgraph Host["Single application host — Node 18+, no container required"]
        direction TB
        Proc["<b>BOOST process</b><br/>npm start / npm run dev<br/>HOST=0.0.0.0 · PORT=4000<br/><i>express, single instance</i>"]
        Env[("backend/.env<br/><i>DATABASE_URL, JWT_SECRET,<br/>UPLOAD_DIR, SMTP_*</i>")]
        Web["Static frontend<br/>frontend/*.html + css + js"]
        Up[["backend/uploads/<br/><i>user files, gitignored</i>"]]
        Lang[["backend/langdata/<br/><i>OCR model, gitignored</i>"]]
        Node["node_modules<br/><i>express, pg, jsonwebtoken,<br/>bcrypt, tesseract.js,<br/>nodemailer, helmet</i>"]
    end

    Mail["SMTP relay<br/><i>password reset email</i>"]
    DB[("<b>PostgreSQL</b><br/><i>users, procurement_requests,<br/>quotations, purchase_orders,<br/>documents, bids, bid_submissions,<br/>request_attachments,<br/>request_events, activity_log,<br/>password_reset_tokens</i>")]

    User -->|"HTTPS :4000<br/><i>pages + JSON API</i>"| Proc
    Proc --> Web
    Proc --> Up
    Proc --> Lang
    Proc --> Node
    Proc -->|"pg · DATABASE_URL<br/><i>pool, transactions</i>"| DB
    Proc -.->|"only if SMTP_HOST set"| Mail
    Env -.-> Proc

    classDef store fill:#eef2ff,stroke:#4f46e5
    classDef proc fill:#ecfdf5,stroke:#059669
    class DB,Up,Lang,Env store
    class Proc proc
```

### Runtime notes

- **One process.** `server.js` keeps serving through an unhandled error so a
  single OCR fault cannot take procurement offline for everyone. The exception
  is a port-bind failure, which exits `1` rather than leaving a dead process
  holding nothing.
- **Postgres is the only stateful dependency.** Everything else is rebuildable.
- **Uploads and OCR model are on disk, not in git.** `setup-ocr.js` fetches the
  language data; `.gitignore` excludes both directories.
- **SMTP is optional.** With no `SMTP_HOST`, the reset link is printed to the
  server console and, in development only, returned in the API response.

---

## Class diagram

The backend's structural classes and their collaborators, as they are actually
wired in `server.js`.

```mermaid
classDiagram
    class ExpressApp {
        -PORT : int
        -HOST : string
        -FRONTEND_DIR : string
        +use(mw)
        +listen(PORT, HOST)
    }

    class AuthMiddleware {
        +COOKIE_NAME : string
        +readSession(req)
        +optionalAuth(req, res, next)
        +requireAuth(req, res, next)
        +requirePageAuth(req, res, next)
        +redirectIfAuthenticated(req, res, next)
    }

    class Router {
        <<interface>>
        +get(path, mw, handler)
        +post(path, mw, handler)
        +patch(path, mw, handler)
    }

    namespace Routers {
        class AuthRouter {
            +login()
            +logout()
            +forgotPassword()
            +checkResetToken(token)
            +resetPassword()
            +me()
            +sessionInfo()
        }
        class RequestsRouter {
            +list()
            +detail(id)
            +create()
            +changeStatus(id)
            +bulkStatus()
            +uploadAttachment(id)
            +downloadAttachment(id, attachmentId)
        }
        class ModulesRouter {
            +navCounts()
            +listQuotations()
            +listOrders()
            +listDocuments()
            +activity(entity, id)
            +setQuotationStatus(id)
            +setOrderStatus(id)
        }
        class BiddingRouter {
            +listPackages()
            +packageDetail(id)
            +createPackage()
            +setPackageStatus(id)
            +addSubmission(id)
            +awardSubmission(id, submissionId)
            +analyticsSummary()
        }
        class ReportsRouter {
            +spend()
            +suppliers()
            +cycleTimes()
            +overview()
        }
        class DashboardRouter {
            +overview()
        }
        class AccountRouter {
            +summary()
            +changePassword()
        }
        class NotificationsRouter {
            +list()
        }
        class ScannerRouter {
            +status()
            +ocr()
        }
    }

    namespace Services {
        class ActivityLog {
            +record(entityType, entityRef, action, actor)
            +forEntity(entityType, entityRef)
            +recent(limit)
            +isEntityType(type)
            +ENTITY_TYPES : Set
        }
        class Mailer {
            +sendPasswordReset(to, name, resetUrl)
            +smtpConfigured() : bool
        }
        class OcrEngine {
            +recognizeBuffer(buffer)
            +decodeImage(dataUrl)
            +extractFields(text)
            +detectKind(fields)
            +isReady() : bool
            +shutdown()
        }
    }

    class AuthMiddleware {
        +COOKIE_NAME : string
        +readSession(req)
        +optionalAuth(req, res, next)
        +requireAuth(req, res, next)
        +requirePageAuth(req, res, next)
        +redirectIfAuthenticated(req, res, next)
    }

    class PgPool {
        +query(text, values) : Promise
        +connect()
        +end()
    }

    ExpressApp --> AuthMiddleware : uses
    ExpressApp --> Router : mounts

    AuthRouter ..|> Router
    RequestsRouter ..|> Router
    ModulesRouter ..|> Router
    BiddingRouter ..|> Router
    ReportsRouter ..|> Router
    DashboardRouter ..|> Router
    AccountRouter ..|> Router
    NotificationsRouter ..|> Router
    ScannerRouter ..|> Router

    RequestsRouter --> ActivityLog
    BiddingRouter --> ActivityLog
    ModulesRouter --> ActivityLog
    AccountRouter --> ActivityLog
    ScannerRouter --> OcrEngine
    AuthRouter --> Mailer
    AuthRouter --> ActivityLog

    RequestsRouter --> PgPool
    ModulesRouter --> PgPool
    BiddingRouter --> PgPool
    ReportsRouter --> PgPool
    DashboardRouter --> PgPool
    AccountRouter --> PgPool
    NotificationsRouter --> PgPool
    ScannerRouter --> PgPool
    AuthRouter --> PgPool
```

---

## Data model

Not requested, but a class diagram without it tends to get asked for next.

```mermaid
erDiagram
    users {
        int id PK
        string full_name
        string email UK
        string username UK
        string password_hash
        string role
        boolean is_active
        int failed_attempts
        datetime locked_until
        datetime last_login_at
        datetime created_at
        datetime updated_at
    }

    procurement_requests {
        int id PK
        string request_number UK
        string requester_name
        string department
        string item_description
        int quantity
        numeric estimated_amount
        string status
        datetime requested_at
        date due_date
        int created_by FK
        datetime created_at
        datetime updated_at
    }

    quotations {
        int id PK
        string quotation_number UK
        int request_id FK
        string supplier_name
        string item_description
        numeric total_amount
        string status
        date valid_until
        datetime created_at
        datetime updated_at
    }

    purchase_orders {
        int id PK
        string order_number UK
        int quotation_id FK
        string supplier_name
        numeric total_amount
        string status
        datetime ordered_at
        date expected_delivery_date
        datetime created_at
        datetime updated_at
    }

    documents {
        int id PK
        string document_number UK
        string title
        string document_type
        string file_name
        int file_size_bytes
        int uploaded_by FK
        datetime uploaded_at
        datetime created_at
    }

    request_attachments {
        int id PK
        int request_id FK
        string file_name
        string stored_name
        string mime_type
        int size_bytes
        string source
        int uploaded_by FK
        datetime uploaded_at
    }

    bids {
        int id PK
        string bid_number UK
        int request_id FK
        string title
        string status
        datetime opened_at
        datetime closed_at
        string notes
        int created_by FK
        datetime created_at
        datetime updated_at
    }

    bid_submissions {
        int id PK
        int bid_id FK
        string supplier_name
        numeric total_amount
        string notes
        string status
        datetime submitted_at
        datetime awarded_at
    }

    password_reset_tokens {
        int id PK
        int user_id FK
        string token_hash UK
        datetime expires_at
        datetime used_at
        string requested_ip
        datetime created_at
    }

    request_events {
        int id PK
        int request_id FK
        int actor_id FK
        string actor_name
        string action
        string from_status
        string to_status
        string note
        datetime created_at
    }

    activity_log {
        int id PK
        string entity_type
        int entity_id
        string entity_ref
        string action
        string from_status
        string to_status
        int actor_id FK
        string actor_name
        string note
        datetime created_at
    }

    users ||--o{ procurement_requests : raises
    users ||--o{ bids : creates
    users ||--o{ documents : uploads
    users ||--o{ request_attachments : uploads
    users ||--o{ request_events : acts
    users ||--o{ activity_log : acts
    users ||--o{ password_reset_tokens : requests
    procurement_requests ||--o{ quotations : "quoted by"
    procurement_requests ||--o{ bids : "tendered as"
    procurement_requests ||--o{ request_attachments : "has"
    procurement_requests ||--o{ request_events : "audited by"
    quotations ||--o{ purchase_orders : "becomes"
    bids ||--|{ bid_submissions : "receives"
```

Two relationships that look obvious are deliberately **not** drawn, because the
schema does not have them:

- **`documents` has no `request_id`.** A document belongs to whoever uploaded
  it, not to a request, so there is no request-to-document link.
- **`bid_submissions` has no `user_id`.** A submission records a supplier
  *name*, not an account, because offers can come from suppliers with no login
  in BOOST. `UNIQUE (bid_id, supplier_name)` is what stops a supplier bidding
  twice on one package.

Two rules the schema enforces rather than trusting the application code:

- `idx_bid_single_award` — a partial unique index allowing at most **one**
  awarded submission per package.
- `password_reset_tokens.token_hash` — the token is stored only as a SHA-256
  hash, so a database leak cannot be replayed against the reset endpoint.

---

## Rendered images

The Mermaid blocks above render on GitHub. The same diagrams are also written out
as files, in both SVG (scales for print, a few KB) and PNG at 2× for pasting
straight into a document:

| Diagram | SVG | PNG |
| --- | --- | --- |
| Component | [component-diagram.svg](diagrams/component-diagram.svg) | [component-diagram.png](diagrams/component-diagram.png) |
| Deployment | [deployment-diagram.svg](diagrams/deployment-diagram.svg) | [deployment-diagram.png](diagrams/deployment-diagram.png) |
| Class | [class-diagram.svg](diagrams/class-diagram.svg) | [class-diagram.png](diagrams/class-diagram.png) |
| Data model | [data-model.svg](diagrams/data-model.svg) | [data-model.png](diagrams/data-model.png) |

Module screenshots live alongside them in [`screenshots/`](screenshots/).

### Regenerating

```bash
cd backend
npm run docs:diagrams   # re-render these diagrams from the Mermaid in this file
npm run docs:shots      # re-capture the module screenshots
npm run docs            # both
```

Both drive the Edge already installed on the machine over the Chrome DevTools
Protocol (`scripts/lib/browser.js`), so no browser-automation package is needed.
`docs:diagrams` doubles as a syntax check: a diagram Mermaid cannot parse is
reported as a failure rather than quietly producing an empty image.

> The class diagram is wide (3378px) because Mermaid lays classes out in a single
> band. Use the SVG if it needs to fit a portrait page — it scales without
> blurring.

### Editing these in Lucidchart

Lucidchart reads Mermaid directly, so nothing needs converting:

1. Open a Lucidchart document.
2. **Diagram as code** in the left toolbar (Individual, Team or Enterprise plans).
3. **+ New Mermaid diagram**, paste the block from this file, **Generate**.

All four types here are supported — Flowchart, Class and Entity Relationship.
Two things to expect: the code must be in English, and once generated the diagram
is edited *through the code* rather than by dragging shapes.

### Checking these against the code

The diagrams assert names that can drift, so they are verified mechanically:

```bash
npm run check:diagrams   # 74 assertions
npm run check:schema     # proves the schema builds from an empty database
npm run check            # all three, plus the route sweep
```

`check:diagrams` parses this file and compares it with the source: service and
middleware members must exist, every route mount and endpoint count must match,
every table and column in the data model must exist *and* nothing may be missing
from it, and each dependency, env var and on-disk path named above must be real.

That check has already earned its keep. It caught that `documents` has no
`request_id` and `bid_submissions` no `user_id` — two relationships this file
originally drew that the schema does not have.