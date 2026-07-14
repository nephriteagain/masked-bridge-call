# twilio-masked-bridge

Connect two phone numbers through Twilio so they can talk, with **both real numbers
masked** from each other, and the conversation **transcribed after the call** for logging.

You initiate every call (outbound-only), and neither party can dial the masked number
back — so this needs only **one Twilio number**, no matter how many pairs use it.

## How the masking works

There is exactly one trick, applied twice:

- The outbound call to **A** uses your Twilio number as `from`, so A sees the masked number.
- The `<Dial>` to **B** uses your Twilio number as `callerId`, so B sees the masked number too.

The mapping of which two real numbers are talking lives only in your backend
(the `sessions` table). It is never sent to either party.

## Flow

```
POST /connect ───────► call A (from = Twilio #)
                          │ A answers
                          ▼
                     POST /webhooks/bridge
                          │  <Dial callerId=Twilio # record=record-from-answer-dual> → call B
                          ▼
                   A and B talk, masked, recorded (dual channel)
                          │ call ends
                          ▼
                     /webhooks/recording  (RecordingSid) ──► create Conversation Intelligence transcript
                          │ transcript finishes processing (async)
                          ▼
                     /webhooks/intelligence  ──► fetch sentences → final speaker-labeled transcript
```

Webhooks Twilio calls (all namespaced under `/webhooks`):
- `/webhooks/bridge` – runs when A answers; dials B and records both legs in dual channel.
- `/webhooks/party-b-status` – per-leg B lifecycle (ringing/answered); drives the live
  "which party connected" status and the "both connected" timer.
- `/webhooks/dial-status` – runs when the B leg ends; handles "B didn't answer"/declined.
- `/webhooks/call-status` – lifecycle of the A call; handles "A didn't answer".
- `/webhooks/recording` – runs when the recording is ready; kicks off post-call transcription.
- `/webhooks/intelligence` – runs when Conversation Intelligence finishes; delivers the transcript.

## Project structure

```
src/
  config/         Typed, validated environment configuration
  db/             Sequelize connection + lifecycle (init/close)
  models/         Sequelize models and their associations
  repositories/   Data-access layer (one module per entity)
  services/       Business logic (Twilio wrapper, call orchestration, transcripts)
  controllers/    Thin HTTP request handlers
  routes/         Route definitions (public API + /webhooks)
  middleware/     Twilio signature check, error handling, async wrapper
  utils/          Structured logger and error types
  app.ts          Express app factory (importable by tests)
  server.ts       Entrypoint: init DB, start server, graceful shutdown
```

Request flow: **route → middleware → controller → service → repository → model**.
HTTP concerns stay in controllers; telephony in the Twilio service; persistence in
repositories. See `DATABASE_SCHEMA.md` for the data model.

## Setup

Requires Node 18+.

```bash
npm install
cp .env.example .env      # then fill in your values
```

Fill in `.env`:
- `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` – from the Twilio console (Account → API keys & tokens).
- `TWILIO_NUMBER` – the single number both parties will see (E.164, e.g. `+15551234567`).
- `BASE_URL` – the public https URL Twilio can reach this server at (see below).
- `INTELLIGENCE_SERVICE_SID` – your Conversation Intelligence Service SID (`GA...`).

### Set up Conversation Intelligence (for the post-call transcript)

1. In the Twilio Console, go to **Conversational Intelligence → Services** and create a Service.
2. Copy its **Service SID** (`GA...`) into `INTELLIGENCE_SERVICE_SID` in `.env`.
3. Set that Service's **webhook URL** to `<BASE_URL>/webhooks/intelligence` so finished
   transcripts are delivered to this app.

Channels: the recording is dual-channel, with **channel 1 = party A** (the leg you
called first) and **channel 2 = party B**. The app labels them A/B accordingly. By
default Conversation Intelligence calls channel 1 "Agent" and channel 2 "Customer";
that labeling doesn't affect the A/B mapping this app produces.

If you'd rather not call the create-transcript API yourself, enable **Auto Transcribe**
on the Service and every recording is transcribed automatically — the `/intelligence`
webhook still delivers the result. (The app's explicit create call is harmless either way.)

## Running locally

Twilio needs to reach your webhooks over the public internet, so expose your local
server with a tunnel (e.g. ngrok):

```bash
# terminal 1
npm start

# terminal 2
ngrok http 3000
```

Copy the `https://...ngrok-free.app` URL ngrok prints into `BASE_URL` in `.env`,
then restart `npm start` so it picks up the new value.

## Provider "Call Connect" flow

This POC exercises the provider-facing Call Connect user stories. **Party A is the
provider** (the person calling); **party B is the client**. `POST /connect` sends the
heads-up text (stub) and places the call in one step:

```bash
curl -X POST http://localhost:3000/connect \
  -H "Content-Type: application/json" \
  -d '{"partyA":"+1PROVIDER","partyB":"+1CLIENT"}'
# -> { "sessionId": "...", "callSid": "...", "status": "ringing-a" }
```

Your phone (A) rings; answer it; the client (B) is then dialed; both of you see only
the Twilio number. While it connects, poll the live status:

```bash
curl http://localhost:3000/sessions/<sessionId>/status
# -> { phase, message, parties:{ provider, client }, connectedAt, durationSeconds, ... }
```

### Provider endpoints (all JSON)

| Method + path | Story | Purpose |
|---|---|---|
| `POST /connect` | 1,3 | Create session, send heads-up text (stub), and place the call. |
| `GET /sessions/:id/status` | 4,5,7,8 | Live `phase`, per-party state, and the call timer (`durationSeconds`). |
| `POST /sessions/:id/cancel` | 6,13 | Cancel connecting / leave in-progress call. Needs `{confirm:true}` (409 otherwise). |
| `GET /sessions/:id/summary` | 9 | End-of-call summary + `documented` (recorded/transcribed) flags. |
| `GET /sessions/:id/events` | 12 | Timestamped activity log of every phone event. |
| `GET /notifications` | 10 | In-app notifications (e.g. transcript ready); `POST /notifications/:id/read`. |
| `GET /sessions/:id` | 11 | Session + post-call speaker-labeled `ciTranscript`. |

`phase` progresses: `contacting_provider → contacting_client → connected → ended`,
with terminal branches `client_declined` (client pressed decline / busy), `canceled`
(provider canceled), and `failed`. (The consent gate was dropped as unnecessary for a POC.)

**Out of scope here** (the parent app owns them): the real heads-up SMS (a function
call there — stubbed to a logged event), and the video half of the stories (video
transcript merge, "rejoin video"). Leaving the phone call *is* implemented via cancel.

## Provider test UI

Open **http://localhost:3000/** in a browser for a simple provider "session screen":
a mock video strip, a **Contact client** button, the consent modal, live per-party
status + call timer, a cancel/leave confirmation, the decline banner, the end-of-call
summary, the transcript view, a notification bell, and the live activity log. It is a
static page (`public/index.html`) that polls the endpoints above — no build step.
(`GET /health` remains the JSON liveness check.)

## Try it via API

After the call ends, transcription runs asynchronously; read the result back:

```bash
curl http://localhost:3000/sessions/<sessionId>
# -> ciTranscript is the speaker-labeled post-call transcript
#    (empty until the /intelligence webhook fires, seconds-to-minutes after the call)
```

## Notes for production

- **Session store:** state persists in SQLite (`call-history.db`) via Sequelize. For a
  multi-instance deployment, point the connection in `src/db/index.ts` at Postgres/MySQL
  and replace `sync({ alter: true })` with a proper migration workflow.
- **Signature validation:** set `VALIDATE_TWILIO_REQUESTS=true` to reject any webhook
  not signed by Twilio. `BASE_URL` must exactly match the public URL Twilio hits.
- **Voicemail:** set `USE_MACHINE_DETECTION=true` so that if A's voicemail answers,
  B is not bridged into it.
- **Recording/transcription consent:** transcribing calls triggers consent laws that
  vary by jurisdiction (e.g. two-party-consent states). Announce or otherwise obtain
  consent as required before connecting.
- **Caller-ID reputation:** a single number making high outbound volume can get flagged
  "spam likely" by carriers. If that happens at scale, rotate across a few numbers —
  for deliverability, not for masking.

## Reference docs

- `<Dial>` / `callerId` / `record`: https://www.twilio.com/docs/voice/twiml/dial
- Recordings resource: https://www.twilio.com/docs/voice/api/recording
- Conversation Intelligence transcript API: https://www.twilio.com/docs/voice/intelligence/api/transcript-resource
- Conversation Intelligence onboarding: https://www.twilio.com/docs/conversational-intelligence/onboarding
- Calls API (originate): https://www.twilio.com/docs/voice/api/call-resource
- Node helper library: https://www.twilio.com/docs/libraries/node
