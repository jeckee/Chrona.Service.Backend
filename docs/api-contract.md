# Chrona Service API Contract (v1)

Base URL path: `/api/v1`. All agent endpoints expect `Content-Type: application/json`.

---

## GET `/me`

Returns authenticated user profile and entitlement status.

### Response JSON (200)

```json
{
  "user": {
    "id": "supabase-user-id",
    "email": "user@example.com"
  },
  "entitlement": {
    "status": "none",
    "productId": null,
    "expiresAt": null,
    "trialEndsAt": null
  }
}
```

`entitlement.status` is always one of:
- `none`
- `trial`
- `active`
- `expired`

---

## POST `/subscriptions/verify`

Server-authoritative Apple subscription verification (authenticated).  
Client sends only StoreKit 2 `transaction.jwsRepresentation` in `signedTransaction`.

### Server-authoritative invariants

The server is the only source of truth for `entitlement.status`. Clients MUST NOT
attempt to set or echo `status`, `productId`, `expiresAt`, or `trialEndsAt`.

JWS verification anchors the certificate chain to Apple Root CA (G3 + Inc Root)
via `@apple/app-store-server-library`. Server enforces, in this order:

1. JWS signature + Apple Root CA chain
2. `bundleId` matches `APPLE_BUNDLE_ID`
3. `environment` is one of `APPLE_ALLOWED_ENVIRONMENTS`
4. `productId` is in `APPLE_ALLOWED_PRODUCT_IDS`
5. `appAccountToken` (UUID, set by macOS at purchase via `Product.PurchaseOption.appAccountToken`) equals the authenticated Supabase user id

Status mapping:

- `revocationDate` present → `expired`
- `expiresDate` missing or in the past → `expired`
- `offerDiscountType === "FREE_TRIAL"` and not expired → `trial`
- otherwise not expired → `active`

### Request JSON

```json
{
  "signedTransaction": "eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUl..."
}
```

### Response JSON (200)

```json
{
  "entitlement": {
    "status": "trial",
    "productId": "cc.chrona.pro.monthly",
    "expiresAt": "2026-05-20T00:00:00.000Z",
    "trialEndsAt": "2026-05-20T00:00:00.000Z"
  }
}
```

### Invalid transaction (400)

Returned for any client-attributable failure: bad JWS, wrong chain, unknown
bundleId/productId/environment, missing or mismatched `appAccountToken`.

```json
{
  "error": {
    "code": "INVALID_TRANSACTION",
    "message": "Invalid Apple transaction"
  }
}
```

### Internal error (500)

Returned for server-side faults (DB unavailable, certs missing, etc.). Clients
should retry with backoff rather than treating this as a terminal payment failure.

```json
{
  "error": "Internal Server Error",
  "message": "Failed to persist entitlement."
}
```

### Required environment variables

| Name | Purpose |
| --- | --- |
| `APPLE_BUNDLE_ID` | Single bundle id the JWS must match (e.g. `cc.chrona.mac`). |
| `APPLE_APP_APPLE_ID` | Numeric Apple app id; **required** when `Production` is in `APPLE_ALLOWED_ENVIRONMENTS`. |
| `APPLE_ALLOWED_ENVIRONMENTS` | CSV of `Production`, `Sandbox`, `Xcode`, `LocalTesting`. |
| `APPLE_ALLOWED_PRODUCT_IDS` | CSV of product ids accepted by the server. |
| `APPLE_ROOT_CERTS_DIR` | (optional) Override path to directory containing `AppleRootCA-G3.cer` and `AppleIncRootCertificate.cer`. Defaults to `<cwd>/certs`. |
| `APPLE_ENABLE_ONLINE_CHECKS` | (optional) `true` to enable OCSP + current-time cert expiry. Default `false`. |

Apple root certificates ship in repo under `certs/` and are bundled into the
function via `vercel.json` `includeFiles`.

---

## POST `/agent/schedule`

Scheduling protocol (distinct from summary). Validates top-level JSON shape then returns a **mock** scheduling result (no model call).

### Request JSON

```json
{
  "selectedDate": "2026-05-04",
  "currentTime": "2026-05-04T09:00:00",
  "workingHours": [
    {
      "start": "2026-05-04T09:00:00",
      "end": "2026-05-04T17:00:00"
    }
  ],
  "scheduledTasks": [
    {
      "taskId": "scheduled-1",
      "title": "Team sync",
      "start": "2026-05-04T10:00:00",
      "end": "2026-05-04T11:00:00",
      "status": "todo"
    }
  ],
  "unscheduledTasks": [
    {
      "taskId": "task-1",
      "title": "Write product spec",
      "estimatedMinutes": null,
      "priority": null,
      "userTimeHint": null,
      "status": "todo",
      "needs_analysis": true
    }
  ]
}
```

### Response JSON (200 — mock body)

```json
{
  "task_updates": [],
  "schedule_result": {
    "scheduled": [],
    "unscheduled": []
  }
}
```

### Validation errors (400)

Shape: `{ "error": string, "message": string }` (see `APIError` in `src/types/agent.ts`).

Example:

```json
{
  "error": "Bad Request",
  "message": "selectedDate must be a non-empty string."
}
```

---

### Subscription required (402)

When entitlement is not usable (`none`/`expired`), agent endpoints return:

```json
{
  "error": {
    "code": "SUBSCRIPTION_REQUIRED",
    "message": "Subscription required to use Chrona"
  }
}
```

---

## POST `/agent/summary`

Daily summary protocol (distinct from schedule). Validates top-level JSON shape then returns fixed **mock** text (no model call).

### Request JSON

```json
{
  "date": "2026-05-04",
  "tasks": [
    {
      "taskId": "t1",
      "title": "Design review",
      "status": "done",
      "isScheduled": true,
      "priority": "medium",
      "estimatedMinutes": 45,
      "conclusion": "Wrapped up UX feedback."
    },
    {
      "taskId": "t2",
      "title": "API contract",
      "status": "todo",
      "isScheduled": false,
      "priority": "high",
      "estimatedMinutes": null,
      "conclusion": ""
    }
  ]
}
```

### Response JSON (200 — mock body)

```json
{
  "text": "Completed Today:\n• Sample output"
}
```

### Validation errors (400)

Example:

```json
{
  "error": "Bad Request",
  "message": "date must be a non-empty string."
}
```

---

### Subscription required (402)

When entitlement is not usable (`none`/`expired`), agent endpoints return:

```json
{
  "error": {
    "code": "SUBSCRIPTION_REQUIRED",
    "message": "Subscription required to use Chrona"
  }
}
```

---

## Local smoke checks

Both routes require **POST** with a JSON body (a bare `curl` URL without `-X POST` and body will not match).

```bash
curl -sS -X POST http://localhost:3000/api/v1/agent/schedule \
  -H 'Content-Type: application/json' \
  -d '{"selectedDate":"2026-05-04","currentTime":"2026-05-04T09:00:00","workingHours":[],"scheduledTasks":[],"unscheduledTasks":[]}'

curl -sS -X POST http://localhost:3000/api/v1/agent/summary \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-05-04","tasks":[]}'
```

Prompts used when AI is wired live are loaded from `src/prompts/scheduling.yaml` and `src/prompts/summary.yaml` (`{{variable}}` substitution; JSON segments use 2-space `JSON.stringify` with sorted keys).
