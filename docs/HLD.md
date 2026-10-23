# FoodBridge AI — High-Level Design

**Tagline:** Good Food Deserves a Second Chance.

## 1. Purpose and scope

FoodBridge AI connects surplus-food donors with eligible NGOs and shelters. It supports donor and organization verification, food listing and suitability matching, verified delivery-partner dispatch or NGO self-pickup, and confirmed handover tracking.

This document describes the application as it currently runs. The service is a zero-dependency Node.js application. Runtime business data is held in process memory; the Prisma/PostgreSQL schema is a draft and is not connected to the server.

## 2. System context

```text
 Donor ───────┐
 NGO/Shelter ─┼── Browser portals ── HTTP/JSON ── Node.js web server
 Delivery ────┤                                  ├── Authentication / RBAC
 Admin ───────┘                                  ├── Verification and uploads
                                                  ├── Matching and reservation
                                                  ├── Handover state machine
                                                  └── SHA-256 audit ledger
                                                         │
                                    Process memory ───────┤
                                    Local files ──────────┘
```

The browser UI is served from `public/`. Role-specific pages call the same backend API. There is no external identity provider, database, message broker, map provider, or hosted AI service in the current runtime.

## 3. Main components

| Component | Responsibility |
|---|---|
| Browser portals | Landing page and donor, NGO, delivery, and admin views; submits forms and displays API-backed statuses and notifications. |
| `web.ts` | Native Node.js HTTP server, static-file handling, JSON API, cookie sessions, validation, role authorization, upload handling, orchestration, and demo seeds. |
| `core/matching.ts` | Food-safety and receiver eligibility checks, geographic distance, transit feasibility, ranking, and match explanations. |
| `core/handover.ts` | Reservation-to-completion state machine, pickup and delivery OTP verification, proof requirement, and audit events. |
| `core/otp.ts` | One-time code generation, hashing, expiry, and attempt rules. |
| `core/ledger.ts` | Append-only in-memory audit events with SHA-256 hash chaining and chain verification. |
| Local filesystem | Verification documents and private delivery-proof images. |
| `prisma/schema.prisma` | Future PostgreSQL data model only; it is not used by the running service. |

## 4. Roles and trust boundaries

- **Donor:** submits a donation after admin approval; issues the pickup OTP.
- **NGO/Shelter:** submits organization details and a registration document; after approval, views matches, reserves eligible food, and can perform self-pickup.
- **Delivery partner (`VOLUNTEER`):** after approval, controls availability and performs only assigned pickup/delivery steps.
- **Admin:** reviews verification requests, approves or rejects accounts, and accesses protected verification documents. Admin accounts are not publicly registrable.
- **Anonymous visitor:** can view public pages and limited listing information; cannot perform protected business actions.

The server is the authorization boundary. Client-side role views are for usability only; API handlers independently check the authenticated account, role, approval status, and resource ownership.

## 5. End-to-end workflows

### Account verification

1. Donor, NGO, or delivery partner submits registration. Public admin registration is rejected.
2. Registration creates a pending account. NGO registration also requires organization details, capacity, location, and a PDF/JPG/PNG registration document.
3. Admin reviews the request and the protected document, then approves or rejects it.
4. The approval status controls publishing, reservation, matching, delivery availability, and handover actions.

### Donation and matching

1. An approved donor publishes a listing with category, quantity, storage declaration, allergens, pickup address, device-confirmed matching location, and freshness deadline.
2. The approved NGO requests matches for a listed donation.
3. The server filters for safety, verification, capacity, accepted category, allergens, radius, and feasible pickup before ranking candidates.
4. Each candidate includes suitability reasons derived from stored listing/profile data.

### Reservation, pickup, and completion

1. An approved NGO reserves an eligible listing. The server rejects non-listed items and duplicate/conflicting reservations.
2. A verified available courier is assigned, or the NGO selects self-pickup. If none are available, the API returns: “Delivery partners are not available. Please arrange NGO self-pickup.”
3. The donor issues a pickup OTP; only the assigned collector can confirm it.
4. The receiving NGO issues a delivery OTP. The assigned collector uploads image proof and confirms received quantity and the OTP.
5. Only successful confirmation changes the donation to `DELIVERED`; the relevant parties are notified and audit events are appended.

## 6. Data and deployment view

- User accounts, NGO profiles, donations, notifications, reservations, active handovers, proof metadata, and audit events are currently held in server process memory.
- NGO registration documents are stored under `public/uploads/documents`, but static serving is blocked and access is restricted to the admin document API.
- Delivery proof images are stored under `private_uploads/proofs` and are not exposed through the public static handler.
- Pickup addresses and precise coordinates are withheld from public feeds and pre-reservation match previews; authorized parties receive them after assignment.
- The browser uses an `HttpOnly`, `SameSite=Strict` signed session cookie. Production sets `Secure` and requires configured secrets and admin credentials.
- The development server defaults to port `3000`; `PORT` can override it.

## 7. Current constraints and future boundary

Restarting the server resets runtime accounts, listings, reservations, notifications, OTP state, proof metadata, and the audit chain to development seeds (or an empty production state). The uploaded files are separate from that volatile metadata. Durable database persistence, migrations, multi-instance coordination, and durable audit storage are not implemented. Do not treat the current process-memory application as production-ready for durable transactions.

The matching feature is AI-assisted in its explanation-oriented UI, but the implemented algorithm is deterministic and rule-based; it does not call an LLM or external model. The audit chain is tamper-evident within the running process and is not a blockchain.
