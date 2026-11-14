# JibonCare patient mobile app

Separate React Native Community CLI application with Android and iOS projects. The existing clinic website and backend are unchanged.

## Windows launcher (works in existing PowerShell terminals)

The launcher loads the local Node installation and saved Java/Android settings without changing PowerShell execution policy.

```powershell
cd D:\MEDICITY-GUWAHATI\pushkar-clinic\mobile
.\dev.cmd check
.\dev.cmd start
```

Keep Metro running. In a second terminal in `mobile`, run:

```powershell
.\dev.cmd android
```

Android installation uses port 8081 and the connected device's architecture. On this workspace's Windows machine, Java 17, SDK Platform 37.0, build tools, CMake and NDK are installed; an ARM64 debug APK was built successfully. If the phone rejects USB installation, the built APK can be installed manually from the phone's Downloads folder after reviewing its installation prompt.

## Run on Android

Install Node.js (see `engines` in package.json), the React Native Android prerequisites, and configure an emulator or connected device. Then:

```sh
cd mobile
npm ci
npm start
```

In a second terminal:

```sh
cd mobile
npm run android
```

For iOS, use macOS with Xcode, run `bundle install` inside `mobile`, then `cd ios && bundle exec pod install`, return to `mobile`, and run `npm run ios` with Metro running.

Official environment setup: https://reactnative.dev/docs/getting-started-without-a-framework

## Review screens without an emulator

```sh
cd mobile
npm ci
npm run preview:screens
```

Open http://127.0.0.1:5181. The sidebar opens all 24 screens. The browser shell renders the same screen components through React Native Web, with browser-only adapters for navigation, safe areas, gradients, SVG and QR codes. It is a design review aid; Android/iOS are the primary application. Device-specific features and native navigation must be checked on a device.

In native development builds, the small grid button at the top right opens the screen picker. It is absent from release builds.

## Static demo behaviour

- Start with **Get Started**, enter any 10-digit mobile number, then use **528471** as the OTP. No SMS is sent.
- Forms, family members, searches, specialty filters, tabs, appointment selections, booking confirmation, check-in and cancellation work in memory.
- Payment asks for explicit demo confirmation and never charges money.
- Queue values, medical records, prescriptions, lab reports, invoices and notification contents are sample data. They are not fetched from the clinic backend.
- File upload, PDF download, camera scanning, calendar integration and report viewing explain their placeholder behaviour. Sharing uses the native share sheet; clinic directions can open maps.
- Demo state resets when the app restarts. Family, booking and notification state are shared between screens during the session.
- Temporary JibonCare branding and original local SVG doctor/clinic illustrations approximate the supplied reference. They are not the final logo or exact reference artwork.

## Screens

1. Welcome / Login
2. OTP Verification
3. Patient Profile Setup
4. Family Members
5. Home
6. Clinic Search / Listing
7. Clinic Details
8. Doctor Search / Listing
9. Doctor Profile
10. Select Appointment
11. Visit Details
12. Review & Payment
13. Booking Confirmation
14. My Appointments
15. Appointment Details
16. Patient Check-in
17. Live Queue
18. Turn Alert / Consultation
19. Medical Records
20. Visit / Prescription Details
21. Lab Tests & Reports
22. Payments & Invoices
23. Notifications
24. Account, Settings & Help

## Source map

- `src/screens/`: all screen layouts, grouped by patient journey.
- `src/components/ui.tsx`: headers, buttons, fields, cards, bottom tabs and the development screen picker.
- `src/components/Illustrations.tsx`: replaceable logo (`Brand`), doctor avatars and clinic illustration.
- `src/theme.ts`: shared colors, soft card styles and typography.
- `src/components/HealthArtwork.tsx`: shared wave headers, background curves, and vector hospital/tree landscape, styled after the latest reference. Artwork sits after scrollable content so it does not cover forms or records.
- `design/screen-overview.png`: refreshed overview of all 24 styled screens.
- `src/data/DemoContext.tsx`: mock data and session-only UI state; replace with authenticated services in the API phase.
- `src/navigation.ts`: typed routes.
- `preview/`: browser-only review shell; excluded from native TypeScript compilation and Metro entry point.

## Checks

```sh
npm run typecheck
npm run lint
npm test -- --runInBand
npm run preview:build
```

Tests render each of the 24 screens and verify shared booking selections and demo payment confirmation. Native integrations are mocked in these tests. Android JavaScript bundling has also been checked. An ARM64 Android debug APK has been built successfully. The Xiaomi phone rejected automatic USB installation; native launch verification and the iOS build remain pending.
