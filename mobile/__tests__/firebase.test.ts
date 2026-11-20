jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
import {
  requestFirebaseOtp,
  confirmFirebaseOtp,
  clearFirebaseLogin,
} from '../src/live/firebase';
const mockConfirm = jest.fn(),
  mockRequest = jest.fn(),
  mockToken = jest.fn(),
  mockSignOut = jest.fn();
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({}),
  signInWithPhoneNumber: (...args: unknown[]) => mockRequest(...args),
  getIdToken: (...args: unknown[]) => mockToken(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
  mockRequest.mockResolvedValue({ confirm: mockConfirm });
  mockConfirm.mockResolvedValue({ user: { uid: 'synthetic' } });
  mockToken.mockResolvedValue('synthetic-signed-token');
});
test('Firebase SMS confirmation stays in memory and yields a signed token', async () => {
  await clearFirebaseLogin();
  await expect(confirmFirebaseOtp('123456')).rejects.toThrow(
    'Request a new OTP',
  );
  const challenge = await requestFirebaseOtp('+919999999999');
  expect(challenge.challenge_id).toBe('firebase');
  expect(mockRequest).toHaveBeenCalledWith({}, '+919999999999', false);
  expect(await confirmFirebaseOtp('123456')).toBe('synthetic-signed-token');
  expect(mockConfirm).toHaveBeenCalledWith('123456');
  await expect(confirmFirebaseOtp('123456')).rejects.toThrow(
    'Request a new OTP',
  );
  await requestFirebaseOtp('+919999999999', true);
  expect(mockRequest).toHaveBeenLastCalledWith({}, '+919999999999', true);
  await clearFirebaseLogin();
});
