# NAIA private WhatsApp setup

NAIA uses the official Meta WhatsApp Business Cloud API. The business number
is the bot endpoint; founders keep writing from their normal WhatsApp accounts.
There is no WhatsApp Web session, QR pairing, Evolution API, or phone that must
remain online for the Cloud API bridge.

## Security contract

- `WHATSAPP_BUSINESS_ACCOUNT_ID` and `WHATSAPP_PHONE_NUMBER_ID` pin the
  webhook to one Meta business account and one destination number.
- `WHATSAPP_USER_MAP` is the founder allowlist and identity map.
- A sender missing from the map is acknowledged to Meta and then silently
  ignored before any async task, database write, provider read, or LLM call.
- A mapped email is resolved again against `profiles` and
  `organization_memberships` for every message, and the membership must still
  have the `owner` role. Missing or non-owner profiles are silently ignored.
- CRM and external writes still require a signed, single-use approval button.
- Only the founder's bounded commands are retained for follow-up context. They
  are service-role only, scoped by organization and profile, limited to eight
  commands in the prompt, and purged after 30 days. NAIA responses are never
  copied into Supabase because they may contain Gmail, Calendar, CRM, or
  private founder knowledge.

Do not put phone numbers, Meta tokens, or app secrets in Git. Configure them in
Vercel and `.env.local` only.

## 1. Protect the existing business number

The temporary number may already be active in the WhatsApp Business mobile
app. During Meta onboarding, continue only if the flow explicitly offers a
coexistence option that preserves the mobile app and its conversations.

If Meta offers only a full migration, stop and use Meta's test number until a
new dedicated line is available. A full migration can remove the number from
the mobile WhatsApp Business app and interrupt guest operations.

## 2. Create the Meta application

1. Open [Meta for Developers](https://developers.facebook.com/apps/).
2. Create a Business app owned by the Qarizmi Meta Business Portfolio.
3. Add the **WhatsApp** product.
4. Select or create the Qarizmi WhatsApp Business Account (WABA).
5. Add the business number through the supported Cloud API or coexistence
   onboarding flow and complete its SMS or voice verification.
6. In **WhatsApp > API Setup**, record the **Phone number ID** and **WhatsApp
   Business Account ID**. The phone number ID is a Meta identifier, not the
   visible telephone number.

## 3. Create the permanent access token

1. Open Meta Business Settings, then **Users > System users**.
2. Create a Qarizmi system user with administrator access.
3. Assign the Meta app and WABA assets to that system user.
4. Generate a permanent token for the app with
   `whatsapp_business_messaging` and `whatsapp_business_management`.
5. Store the token only as `WHATSAPP_ACCESS_TOKEN` in Vercel.

## 4. Configure Vercel

Add these server-only variables to **Production** and **Preview**:

```dotenv
WHATSAPP_ACCESS_TOKEN=<permanent Meta system-user token>
WHATSAPP_PHONE_NUMBER_ID=<Meta Phone number ID>
WHATSAPP_BUSINESS_ACCOUNT_ID=<Meta WABA ID>
WHATSAPP_VERIFY_TOKEN=<new random value shared only with Meta>
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_USER_MAP=<founder phone:Qarizmi email pairs>
GROQ_WHISPER_LANGUAGE=auto
```

Use international sender numbers without `+`, spaces, or punctuation in
`WHATSAPP_USER_MAP`. Mark tokens, secrets, and the map as sensitive variables.
Never use a `NEXT_PUBLIC_` prefix.

After changing Vercel variables, redeploy the application. Existing
deployments do not automatically receive newly added values.

## 5. Configure the Meta webhook

1. Open the app's **WhatsApp > Configuration** page.
2. Set the callback URL to
   `https://os.qarizmi.com/api/whatsapp/webhook`.
3. Enter exactly the same value used for `WHATSAPP_VERIFY_TOKEN`.
4. Complete Meta's verification handshake.
5. Subscribe the WABA webhook to the `messages` field.
6. Put the Meta app in Live mode when the business setup is ready.

Meta sends inbound messages and status receipts to the same endpoint. The
route verifies `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET` before parsing
or processing the payload.

## 6. Apply the database migration

Deploy the Supabase migration included with this feature before testing
conversation continuity:

```bash
supabase db push
```

The bridge still answers without command history if the service-role client is
not configured, but production must have `SUPABASE_SERVICE_ROLE_KEY` so
pending approvals, deduplication, and founder command context are durable
across deployments.

## 7. Acceptance test

1. From each authorized founder number, send `Que sais-tu faire ?`.
2. Send a CRM instruction and confirm that NAIA returns the complete lead
   summary plus explicit **Valider** and **Ignorer** buttons.
3. Approve it once and confirm that a second tap cannot execute it again.
4. Send a French-English voice note and check that the action uses its
   transcription.
5. Forward a text message to the NAIA number and confirm that it is treated as
   normal text. Images, documents, contact cards, and non-audio attachments are
   deliberately ignored in this first version.
6. Send a normal guest message from an unlisted number. The Airbnb WhatsApp
   experience must remain unchanged and NAIA must send no response.
7. Confirm in Qarizmi OS that only the explicitly approved CRM action exists.

## Operations

- To revoke a founder immediately, remove their pair from
  `WHATSAPP_USER_MAP`, redeploy, and invalidate any pending approvals if the
  phone may be compromised.
- Rotate `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and
  `WHATSAPP_VERIFY_TOKEN` after any suspected exposure.
- Never add guest or employee numbers to the founder map as a convenience.
- Do not train or improve a shared AI model with WhatsApp conversation data.

## Meta policy note

Meta's terms, product eligibility, data-processing obligations, and any rules
specific to AI assistants can change. Before production use, Qarizmi must
review the current WhatsApp Business Solution Terms and obtain Meta or legal
confirmation that this private internal-assistant use case is permitted. Keep
the app private and use Meta's test number until that review and a dedicated
NAIA line are complete.

Current terms: <https://www.whatsapp.com/legal/business-solution-terms>
