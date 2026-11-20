# JibonCare Firebase phone login

Android package: `com.jiboncare`. Firebase project: `jiboncare`.

The Android app sends and verifies SMS through Firebase Authentication. It exchanges the Firebase ID token at `POST /api/v1/patient-app/auth/firebase` for the existing rotating patient access/refresh session. The API verifies Google RS256 signatures, project audience and issuer, expiry, UID, Indian phone number, phone provider and authentication within the last ten minutes. It reuses the existing MongoDB account and refuses disabled accounts or a changed bound Firebase UID. Clinic records remain in MongoDB. No Firebase service-account private key is needed for this signature verification flow.

The existing SMS webhook API stays supported. Public config selects Firebase when `PATIENT_APP_FIREBASE_PROJECT_ID` is set; this deployment defaults to `jiboncare`. Other deployments must override that variable to their own project and rebuild using matching Android config. This marks integration availability, not a guarantee that Firebase billing/SMS quotas are configured.

## Required Firebase console setup

1. Enable Authentication > Phone.
2. Allow India in Authentication > Settings > SMS region policy.
3. Add both SHA-1 and SHA-256 from the **Print testing APK signing fingerprints** step of the Patient Android APK workflow, under Project settings > Your apps > Android > Add fingerprint.
4. For real SMS, configure Blaze billing and SMS quotas. For testing, configure fictional test numbers and codes in Firebase; the app never disables verification or embeds a fixed OTP.
5. Download updated google-services.json if Firebase asks and use it in mobile/android/app.
6. Install the rebuilt APK. The previous APK has no Firebase support.

The current APK is for internal testing and uses the repository's testing signing certificate. A Play Store release needs a private production signing key, the Play app-signing fingerprints registered in Firebase, and a new production build. The client google-services.json contains public Firebase app identifiers/API configuration, not service-account credentials. Restrict Android API key usage to the intended package/certificates and required APIs. Do not add service-account JSON or private keys to the app or repository.

Google receives the phone number for authentication and abuse prevention; the login screen discloses this before sending OTP. Limit resend attempts and SMS regions, monitor usage and configure billing alerts. Alerts do not cap spending.

Firebase token exchange validates recent phone authentication locally; it does not perform Firebase Admin account-revocation lookup. Existing ERP account/session revocation remains authoritative after exchange. Apple/iOS Firebase configuration is not included in this Android update.
