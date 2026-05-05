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

## POST `/billing/apple/verify`

Apple subscription verification endpoint skeleton (authenticated).  
Current phase is placeholder-only for macOS integration and does **not** validate StoreKit with Apple yet.

### Request JSON

At least one of `transactionId` or `signedTransactionInfo` is required.

```json
{
  "productId": "chrona.pro.monthly",
  "transactionId": "2000000123456789",
  "signedTransactionInfo": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
  "appAccountToken": "supabase-user-id"
}
```

### Response JSON (501)

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Apple subscription verify is not implemented yet. Keep calling /api/v1/me to refresh entitlement state."
  }
}
```

---

## POST `/billing/apple/restore`

Apple restore endpoint skeleton (authenticated).  
Current phase is placeholder-only for macOS integration and does **not** validate StoreKit with Apple yet.

### Request JSON

```json
{
  "transactions": [
    {
      "transactionId": "2000000123456789",
      "signedTransactionInfo": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  ]
}
```

`transactions` is optional in this placeholder stage.

### Response JSON (501)

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Apple restore is not implemented yet. Keep calling /api/v1/me to refresh entitlement state."
  }
}
```

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
