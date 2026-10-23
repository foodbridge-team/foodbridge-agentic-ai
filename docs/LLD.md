# FoodBridge AI — Low-Level Design

## 1. Runtime and source layout

| Path | Design role |
|---|---|
| `web.ts` | HTTP routes, session authentication, authorization, request validation, memory-backed records, notifications, upload storage, and workflow orchestration. |
| `core/types.ts` | Shared role, verification, donation, match, handover, OTP, and ledger types. |
| `core/matching.ts` | Eligibility checks and deterministic candidate ranking. |
| `core/handover.ts` | Two-stage pickup/delivery state machine. |
| `core/otp.ts` | OTP creation and verification. |
| `core/ledger.ts` | Chained audit event creation and integrity verification. |
| `public/*.html`, `public/*.js`, `public/style.css` | Landing page and role-based browser UI. |
| `private_uploads/proofs/` | Delivery proof files; not public static assets. |
| `public/uploads/documents/` | NGO registration files; static access is explicitly blocked. |
| `prisma/schema.prisma` | Proposed PostgreSQL schema, currently disconnected from runtime code. |

The service runs on the Node.js native HTTP and crypto modules without third-party runtime dependencies.

## 2. Core in-memory entities

### User

`PlatformUser` contains an ID, normalized email, scrypt password hash, role, name, organization/contact data, verification status, availability, optional NGO profile/capacity/document/vehicle fields, demo flag, and creation time. Password hashes are stored as `salt:hash`; the plaintext password is not retained.

### NGO profile

The matching profile (`Ngo`) contains an ID, verified flag, coordinates, free capacity, accepted food categories, excluded allergens, maximum receiver radius, and optional demo flag. An NGO user is associated with its own profile ID.

### Donation

`PlatformDonation` extends the matching `Donation` fields with title, donor ID/name, lifecycle status, handover type, assigned NGO/collector, delivered quantity, proof reference, creation time, and optional demo flag. Core matching fields are quantity, coordinates, deadline, allergens, storage status, and category.

### Handover and proof

`activeHandovers` maps a donation ID to its `Handover` instance. `deliveryProofs` maps a proof ID to the donation, uploader, and private file path. These maps are process-local and disappear on restart.

### Audit event

Each ledger event has a sequence number, event type, resource ID, payload, timestamp, previous hash, and SHA-256 digest. The ledger refuses payload keys matching OTP/password/secret/token to avoid recording sensitive values.

## 3. Authentication and authorization

1. Registration/login validates inputs and verifies passwords using Node.js `scryptSync` with a random per-account salt.
2. Successful login or registration issues an HMAC-SHA-256 signed token with subject and 12-hour expiry, placed in the `foodbridge_session` cookie.
3. Each protected API request resolves and verifies the signature and expiry, then reloads the user by subject from server memory.
4. Route handlers enforce role, approval status, account ownership, and assignment. Frontend checks are not considered an authorization control.
5. Mutation requests with a mismatching `Origin` are rejected. Production requires `JWT_SECRET`, `OTP_PEPPER`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`; production cookies use `Secure`.

### Authorization summary

| Action | Required actor |
|---|---|
| Review verification queue / decide approval / view registration document | Admin |
| Publish donation / issue pickup OTP | Approved donor; donor must own the donation |
| Match / reserve food / issue delivery OTP | Approved NGO; profile must match the authenticated NGO |
| Change availability / confirm assigned courier steps | Approved delivery partner |
| Confirm self-pickup steps | Approved NGO assigned as the self-pickup collector |
| Complete handover | Assigned collector, valid delivery OTP, proof uploaded by that collector, valid quantity |

Admin setup is through private production configuration or development seed data. There is no public admin registration route.

## 4. HTTP API

All API responses use JSON except the authorized admin document response. Requests are sent to the same origin as the web application.

| Method and path | Access | Purpose |
|---|---|---|
| `GET /donor-login`, `GET /donor-signup` | Public page | Distinct donor sign-in and registration views. |
| `GET /ngo-login`, `GET /ngo-signup` | Public page | Distinct NGO sign-in and registration views. |
| `GET /delivery-login`, `GET /delivery-signup` | Public page | Distinct delivery-partner sign-in and registration views. |
| `POST /api/auth/register` | Public; admin role prohibited | Register donor, NGO, or delivery partner; creates pending account. |
| `POST /api/auth/login` | Public | Authenticate credentials and set session cookie. |
| `GET /api/auth/me` | Session | Return current public user/profile data. |
| `POST /api/auth/logout` | Session | Clear the session cookie. |
| `GET /api/admin/verifications` | Admin | List accounts awaiting review. |
| `POST /api/admin/verify` | Admin | Approve or reject a verification request. |
| `GET /api/admin/users` | Admin | Retrieve user management data. |
| `GET /api/admin/documents/:userId` | Admin | Read the applicant's protected document. |
| `POST /api/delivery/status` | Approved delivery partner | Set availability; cannot become available while an assignment is active. |
| `GET /api/donations` | Public/session; response filtered by role | List visible donations; precise coordinates are restricted by role/approval. |
| `POST /api/donations` | Approved donor | Validate and publish a food listing, pickup address, and device-confirmed matching coordinates. |
| `POST /api/match` | Approved NGO | Check one listed donation against the caller's NGO profile and return eligibility/ranking reasons. |
| `POST /api/reserve` | Approved NGO | Reserve eligible listing for courier dispatch or NGO self-pickup. |
| `POST /api/pickup-otp` | Owning donor | Issue pickup code for an active handover. |
| `POST /api/verify-pickup` | Assigned courier or self-pickup NGO | Verify pickup code and transition to picked up. |
| `POST /api/delivery-otp` | Receiving approved NGO | Issue the handover code. |
| `POST /api/delivery-proof` | Assigned collector | Upload a validated JPG/PNG proof image. |
| `POST /api/complete-delivery` | Assigned collector | Confirm OTP, proof reference, and quantity; complete handover. |
| `GET /api/ledger` | Public in the current implementation | Read audit events and chain-verification result. |
| `GET /api/stats` | Public | Read current aggregate statistics. |
| `GET /api/notifications` | Session | Read notifications for the current user. |
| `POST /api/reset` | Development-only administrative flow | Reset local demo state; unavailable as a production operation. |

The implementation is authoritative for exact request/response fields and status codes. The API currently has no generated OpenAPI specification.

The audit endpoint currently has no authentication check. Its payload should therefore remain free of personal data and secrets; deployments that require restricted audit access should add server-side authorization.

## 5. Matching and reservation rules

`eligible(donation, ngos, now)` rejects expired donations and blocks donations without acceptable storage confirmation. For each NGO it checks:

1. Admin verification.
2. Free capacity is at least the requested quantity.
3. Donation category is accepted.
4. No declared allergen conflicts with excluded allergens.
5. NGO is within its configured maximum distance.
6. Estimated transit at 25 km/h completes before the donation deadline.

Eligible candidates are ranked deterministically using distance, capacity buffer, and urgency. The result includes distance, an estimated transit time, remaining time, capacity, category, and allergen suitability. These explanations use the stored donation and NGO profile, not generated or invented data. The score is a heuristic, not a probability.

Reservation repeats the eligibility check on the server to avoid relying on stale match results. Only `LISTED` donations can be reserved. In the single server process, the listing transition and collector assignment are performed synchronously; there is no cross-process transaction or database lock. If courier mode is requested and none is available, the listing is not reserved and the API returns the self-pickup guidance message.

## 6. Handover state machine

```text
LISTED
  └─ reserve + eligible ─> RESERVED ─> ASSIGNED
                                      ├─ pickup OTP valid ─> PICKED_UP
                                      │                       └─ delivery OTP + proof + quantity ─> DELIVERED
```

The handover object starts as `RESERVED`; courier assignment or self-pickup sets its collector, handover type, and `ASSIGNED` state. Pickup OTP is restricted to the donor as issuer and assigned collector as entrant. Delivery OTP is restricted to the receiving NGO as issuer and assigned collector as entrant. Completion requires:

- Current state is `PICKED_UP`.
- Authenticated actor is the assigned courier or NGO self-pickup collector.
- Delivery OTP verifies successfully.
- A JPG/PNG proof reference belongs to this donation and actor.
- Received quantity is a positive integer no greater than the listed amount.

Only after all checks pass does the state become `DELIVERED`. In courier mode, the partner becomes available again after confirmed completion. The core state machine has a cancellation operation/status, but the current HTTP API does not expose a cancellation route.

## 7. Upload and input controls

- NGO documents: required for NGO registration; PDF/JPG/PNG only; 5 MB maximum; content signatures checked; generated server-side file name; file permissions restricted; public static access blocked.
- Delivery proof: JPG/PNG only; 5 MB maximum; content signature checked; stored in private proof directory; reference is bound to the uploader and donation.
- Registration, donation, availability, OTP, and completion fields receive server-side type/range/ownership checks.
- JSON request bodies are limited to 8 MB. Upload data is base64 encoded inside JSON.
- Public and unassigned users receive rounded donation coordinates. Donors see their own pickup point; the assigned NGO and collector receive the exact coordinates and address after reservation.
- The pickup address is omitted from public feeds and match previews. It is returned to the donor, admin, and the assigned/receiving participants after reservation. Device geolocation supplies matching coordinates; it does not geocode or validate the typed address.

## 8. Notifications and audit

Notifications are added for admin verification requests, new listings, reservation/assignment, pickup, and confirmed handover. They are stored in memory and returned for the authenticated user.

Important audit events include registration, verification, listing, reservation, assignment/self-pickup, availability change, OTP failures, pickup confirmation, proof upload, and delivery completion. Each event points to the previous event hash. This detects changes to the in-memory sequence but does not provide durable or independently anchored audit storage.

## 9. Configuration, setup, and tests

- Requirement: Node.js `>=22.18`.
- Local run: copy `.env.example` to `.env`, run `npm run web`, then open `http://localhost:3000`.
- Tests: `npm test`.
- Production requires `NODE_ENV=production` and strong unique `JWT_SECRET`, `OTP_PEPPER`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` values. Serve over HTTPS.
- No database migration is currently required or usable. `DATABASE_URL` and Prisma are not connected to the server.
- The test suite includes core matching, OTP, and ledger tests plus HTTP integration coverage for verification, authorization, protected documents, courier delivery, unavailable-courier self-pickup fallback, and confirmed completion.
