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
- `/webhooks/dial-status` – runs when the B leg ends; handles "B didn't answer".
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

## Try it

```bash
curl -X POST http://localhost:3000/connect \
  -H "Content-Type: application/json" \
  -d '{"partyA":"+1XXXXXXXXXX","partyB":"+1YYYYYYYYYY"}'
# -> { "sessionId": "...", "callSid": "...", "status": "ringing-a" }
```

Your phone (A) rings; answer it; B is then dialed; both of you see only the Twilio
number. The call is recorded in dual channel. A short while after you hang up
(transcription runs asynchronously), read the result back:

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
