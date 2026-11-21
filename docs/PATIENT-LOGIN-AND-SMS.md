# Patient login and SMS gateway setup

## Patient app

The initial screen is mobile number + password login. It offers Forgot password, Login with OTP, and Register / Create Account. Guest entry is removed.

- Register: enter full name, Indian mobile number, optional email and password (12?128 characters), send OTP, enter the six-digit code, Verify & create account. Verification creates the account and signs in directly.
- Password login: existing account + password; passwords use salted scrypt, never plaintext.
- OTP login: request a login OTP for an existing account and verify to sign in.
- Forgot password: verify a password-reset OTP, set and confirm a new password, then save and sign in directly. Previous mobile sessions and other outstanding reset grants are revoked.
- Existing OTP-only/Firebase patients keep their accounts and records. Use Forgot password to set a first password, or Login with OTP.

Codes expire after five minutes, allow five verification attempts, and are consumed atomically. Registration/login/reset purposes are stored server-side and cannot be exchanged. A reset grant expires after five minutes and can be used once. Phone/IP rate limits and a 60-second resend cooldown apply. Requests use uniform responses for unknown or ineligible accounts. OTPs and reset grants are hashed; pending registration stores a password hash only. Password login uses a dummy hash for unknown numbers and limits attempts by phone and IP.

## Super Admin settings

Open **Super Admin > Platform Settings > Patient App ? SMS Gateway**.

1. Rotate the API key shown in the supplied dashboard screenshot.
2. Enter the gateway username and replacement API key.
3. Enter the approved sender ID, DLT entity ID and approved content-template ID.
4. Paste the exact approved OTP message. Replace only its code variable with `{code}`. The application replaces this with a random six-digit code; all other text stays unchanged. Make sure any stated expiry agrees with five minutes.
5. The provider endpoint is fixed to `https://mobicomm.dove-sms.com/submitsms.jsp`. Its HTTPS GET parameters follow the supplied dashboard sample: `user`, `key`, `mobile`, `message`, `senderid`, `accusage=1`.
6. If the provider automatically maps DLT templates, leave Entity API parameter name and Template API parameter name blank. If its documentation requires explicit DLT parameters, enter the documented names. Do not guess them.
7. Enter the documented accepted-response prefix. This must be confirmed from your gateway documentation or a redacted successful API response. No default is guessed; HTTP 200 alone is not success. A response starting with this exact prefix is treated as provider acceptance, not handset delivery.
8. Enable the gateway and save. An empty API key on subsequent edits preserves the stored key.
9. Enter a test number and click Send test SMS. This sends a provider-billed message with an inert code that cannot log in. Check the gateway delivery report and approved route/credits if it fails. Then test real app registration.

API keys are encrypted with AES-256-GCM using a key derived from the existing JWT_SECRET, never returned in read responses and never included in app builds. Keep JWT_SECRET stable; after changing it, re-enter the SMS API key. No SMS credentials need to be added to the APK, GitHub or new Hostinger environment variables. Existing backend webhook configuration remains an optional fallback when the database gateway is disabled. Firebase login is disabled by default and is not used by the current app.

Your screenshot shows transactional/DLT credits and zero dedicated OTP credits. Ask Dove/mobiCOMM whether the approved OTP template can use the transactional route and whether the account/route is enabled. Do not assume the displayed balance guarantees OTP delivery.

The app/backend/transport can be tested with synthetic data on CI, but actual delivery needs your approved sender/template, valid credentials, route balance and the provider's confirmed response format. No real SMS is sent by automated tests.
