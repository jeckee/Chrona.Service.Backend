# Chrona Service API Contract (v1)

Base URL path: `/api/v1`. All agent endpoints expect `Content-Type: application/json`.

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
