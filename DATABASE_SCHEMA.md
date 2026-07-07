# Database Schema

The application uses SQLite for persistent storage of call history and webhook data. All tables are managed by Sequelize ORM.

## Tables

### `sessions`
Stores the core pairing and state of each call connection between Party A and Party B.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| id | UUID | NO | UUIDV4 | Primary key, session identifier |
| partyA | STRING | NO | - | Real phone number of Party A (never exposed to Party B) |
| partyB | STRING | NO | - | Real phone number of Party B (never exposed to Party A) |
| status | ENUM | NO | initiated | Session state: initiated, ringing-a, bridging, completed, failed |
| callSid | STRING | YES | NULL | Twilio Call SID for initial call to Party A |
| recordingSid | STRING | YES | NULL | Twilio Recording SID for dual-channel recording |
| transcriptSid | STRING | YES | NULL | Twilio Conversation Intelligence Transcript SID |
| ciTranscript | JSON | NO | [] | Post-call speaker-labeled transcript with confidence scores |
| createdAt | DATE | NO | NOW | Timestamp when session was created |
| updatedAt | DATE | NO | NOW | Timestamp of last update |

### `calls`
Detailed call-level events for each party (A or B), tracking the lifecycle of individual calls.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| id | UUID | NO | UUIDV4 | Primary key, unique call event identifier |
| sessionId | UUID | NO | - | Foreign key to sessions table |
| callSid | STRING | NO | - | Unique Twilio Call SID |
| leg | ENUM(A, B) | NO | - | Which party this call is for |
| partyNumber | STRING | NO | - | Phone number of the party |
| status | ENUM | NO | - | Call status: queued, ringing, in-progress, completed, busy, no-answer, failed, canceled |
| answeredBy | STRING | YES | NULL | Answering machine detection: machine_start, machine_end, human, fax, unknown |
| direction | ENUM | NO | - | inbound or outbound |
| createdAt | DATE | NO | NOW | Timestamp when call event was created |
| updatedAt | DATE | NO | NOW | Timestamp of last update |

**Indexes**: callSid (unique)

### `recordings`
Tracks dual-channel recording metadata for each session.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| id | UUID | NO | UUIDV4 | Primary key, unique recording identifier |
| sessionId | UUID | NO | - | Foreign key to sessions table (one-to-one) |
| recordingSid | STRING | NO | - | Unique Twilio Recording SID |
| duration | INTEGER | YES | NULL | Duration of recording in seconds |
| channels | INTEGER | NO | 2 | Number of channels (1=mono, 2=dual channel A/B) |
| status | ENUM | NO | queued | Status: queued, processing, completed, failed |
| url | STRING | YES | NULL | Twilio media URL for the recording |
| createdAt | DATE | NO | NOW | Timestamp when recording was created |
| updatedAt | DATE | NO | NOW | Timestamp of last update |

**Indexes**: recordingSid (unique)

### `transcripts`
Stores Conversation Intelligence transcription metadata and results.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| id | UUID | NO | UUIDV4 | Primary key, unique transcript identifier |
| sessionId | UUID | NO | - | Foreign key to sessions table (one-to-one) |
| transcriptSid | STRING | NO | - | Unique Twilio Conversation Intelligence Transcript SID |
| status | ENUM | NO | processing | Status: processing, completed, failed |
| language | STRING | NO | en | Language code of the transcript |
| sentences | JSON | NO | [] | Array of sentence objects: {speaker, text, confidence, sentenceIndex, mediaChannel} |
| createdAt | DATE | NO | NOW | Timestamp when transcript was created |
| updatedAt | DATE | NO | NOW | Timestamp of last update |

**Indexes**: transcriptSid (unique)

## Relationships

```
Session (1) ──┬─── (N) Call
              ├─── (1) Recording
              └─── (1) Transcript
```

- **Session → Calls**: One session has many call events (cascading delete)
- **Session → Recording**: One session has one recording (cascading delete)
- **Session → Transcript**: One session has one transcript (cascading delete)

## Database File

The SQLite database is stored at `./call-history.db` and is created automatically on first startup.

## Data access

Persistence is exposed through the repository layer in `src/repositories/`, one module
per entity. Services and controllers depend on these functions, never on the Sequelize
models directly.

```typescript
import {
  sessionRepository,
  callRepository,
} from "./repositories/index.js";
```

### Get all sessions with related data
```typescript
const { rows, count } = await sessionRepository.listSessions({ limit: 50, offset: 0 });
```

### Get a specific session with all related data
```typescript
const session = await sessionRepository.getSession(sessionId);
// session.calls (all call events)
// session.recording (recording metadata)
// session.transcript (transcript data)
```

### Update session status
```typescript
await sessionRepository.updateSession(sessionId, { status: "completed" });
```

### Track call events
```typescript
const call = await callRepository.createCall({
  sessionId,
  callSid: "CA...",
  leg: "A",
  partyNumber: "+1234567890",
  direction: "outbound",
});

await callRepository.updateCall(callSid, { status: "completed" });
```
