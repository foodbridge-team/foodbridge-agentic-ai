# FoodBridge AI

**Good Food Deserves a Second Chance.**

FoodBridge AI is a zero-dependency Node.js application for matching surplus-food listings with eligible shelters and tracking confirmed pickups and handovers. Its current runtime uses in-memory application state and a SHA-256 hash-chain audit ledger; the Prisma/PostgreSQL file is a schema draft and is not connected to the running service.

## Requirements

- Node.js 22.18 or newer
- npm

## Run locally

In PowerShell:

```powershell
Copy-Item .env.example .env
npm run web
```

Open <http://localhost:3000>. The three role portals and restricted admin console are available at:

- Donor: <http://localhost:3000/donor-login>
- Donor signup: <http://localhost:3000/donor-signup>
- NGO/Shelter: <http://localhost:3000/ngo-login>
- NGO/Shelter signup: <http://localhost:3000/ngo-signup>
- Delivery Dispatch: <http://localhost:3000/delivery-login>
- Delivery Partner signup: <http://localhost:3000/delivery-signup>
- Admin: <http://localhost:3000/admin-login>

Local demo accounts (development only; do not deploy these credentials):

| Role | Email | Password |
|---|---|---|
| Donor | `donor@oceanpearl.com` | `password123` |
| NGO | `ngo@sevatrust.org` | `password123` |
| Delivery partner | `rider@foodbridge.org` | `password123` |
| Admin | `admin@foodbridge.org` | `adminSecure2026!` |

Demo accounts, demo listings, and demo match profiles are labeled in the dashboards. New donor, NGO, and delivery accounts start pending review. NGO applications require organization details, location coordinates, capacity, and a PDF/JPG/PNG registration document (up to 5 MB). Admin approval is required before donors can publish or NGOs can reserve.

## Main workflows

1. Register a donor and an NGO, then sign in as admin and approve both applications.
2. Sign in as the donor, enter the pickup address, confirm its device location, and publish food with storage status, allergen declarations, and freshness window.
3. Sign in as the approved NGO. The match panel uses saved listing and shelter data, applies safety and eligibility checks, and explains suitability. Reserve a matching listing for verified delivery or NGO self-pickup.
4. The donor issues the pickup OTP. The assigned delivery partner or self-pickup NGO confirms pickup.
5. The receiving NGO issues the handover OTP. The assigned partner (or self-pickup NGO) uploads a JPG/PNG proof photo and confirms the received quantity. Only then is the listing marked delivered.

The donor enters a pickup address and confirms the pickup point with browser location access; no latitude/longitude fields are shown. The address is stored with the listing and disclosed only to the donor, admin, and authorized receiving/assigned participants. Matching uses the device-confirmed coordinates alongside the saved address.

The server rejects unauthenticated or wrong-role API actions, prevents duplicate reservations, checks partner availability, protects verification documents and proof photos from public static access, and sets a signed, expiring `HttpOnly`/`SameSite` session cookie. Passwords use salted scrypt hashes. Audit events are SHA-256 hash-chained; this is not a blockchain.

## Design documents

- [High-Level Design](docs/HLD.md)
- [Low-Level Design](docs/LLD.md)

## Production configuration

Set `NODE_ENV=production` and configure strong, unique `JWT_SECRET`, `OTP_PEPPER`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` values in a private `.env` file or deployment environment. Production startup fails if these are missing and starts without demo users or listings. Serve the app over HTTPS so the session cookie receives the `Secure` attribute. Never commit `.env`.

NGO signup phone verification uses Twilio Verify. Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` as private environment variables to enable SMS OTP delivery and verification. Without these values, NGO signup fails closed and does not accept an unverified phone number.

## Tests

```powershell
npm test
```

The suite covers the core matching/OTP/ledger state machines and an HTTP integration flow for all three role registrations and logins, separate role auth routes, admin approval, protected document access, pickup-address validation and privacy, matching, courier delivery, invalid OTPs, unavailable-courier fallback, NGO self-pickup, proof upload, and confirmed completion.

## Data and migrations

There are no database migrations to apply: the running server currently stores users, listings, notifications, reservations, and handover sessions in process memory. Restarting the server resets that runtime data to development demo seeds (or an empty production state). `prisma/schema.prisma` is not wired into the application; connecting PostgreSQL and adding migrations is a future persistence task. Uploaded registration documents and delivery proofs are stored under separate server-side directories; proof images are not served by the public static-file handler.
