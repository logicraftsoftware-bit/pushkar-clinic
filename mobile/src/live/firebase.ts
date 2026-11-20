import {
  getAuth,
  signInWithPhoneNumber,
  signOut,
  getIdToken,
  onAuthStateChanged,
} from '@react-native-firebase/auth';
import { Platform } from 'react-native';

let expectedPhone = '';
let confirmation: Awaited<ReturnType<typeof signInWithPhoneNumber>> | null =
  null;
export async function requestFirebaseOtp(phone: string) {
  if (Platform.OS !== 'android')
    throw new Error(
      'Firebase phone sign-in is currently configured for Android only.',
    );
  confirmation = null;
  expectedPhone = '';
  const auth = getAuth();
  await signOutIfPresent(auth);
  expectedPhone = phone;
  confirmation = await signInWithPhoneNumber(auth, phone);
  return { challenge_id: 'firebase', resend_after: 60, phone };
}
export async function confirmFirebaseOtp(code: string) {
  if (!confirmation) throw new Error('Request a new OTP to continue.');
  const result = await confirmation.confirm(code);
  if (!result?.user)
    throw new Error('Phone verification did not complete. Request a new OTP.');
  const token = await getIdToken(result.user, true);
  confirmation = null;
  return token;
}
export async function clearFirebaseLogin() {
  confirmation = null;
  expectedPhone = '';
  await signOutIfPresent(getAuth());
}

export function observeFirebaseOtp(complete: (token: string) => void) {
  return onAuthStateChanged(getAuth(), user => {
    if (user && expectedPhone && user.phoneNumber === expectedPhone) {
      void getIdToken(user, true)
        .then(complete)
        .catch(() => {});
    }
  });
}

async function signOutIfPresent(auth: ReturnType<typeof getAuth>) {
  try {
    await signOut(auth);
  } catch (error) {
    // Firebase's native bridge rejects signOut on a fresh installation.
    if ((error as { code?: string }).code !== 'auth/no-current-user')
      throw error;
  }
}
