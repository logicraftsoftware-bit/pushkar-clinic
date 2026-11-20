import {
  getAuth,
  signInWithPhoneNumber,
  signOut,
  getIdToken,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';
import { Platform } from 'react-native';

let confirmation: FirebaseAuthTypes.ConfirmationResult | null = null;
export async function requestFirebaseOtp(phone: string, resend = false) {
  if (Platform.OS !== 'android')
    throw new Error(
      'Firebase phone sign-in is currently configured for Android only.',
    );
  confirmation = null;
  const auth = getAuth();
  await signOut(auth);
  confirmation = await signInWithPhoneNumber(auth, phone, resend);
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
  await signOut(getAuth());
}
